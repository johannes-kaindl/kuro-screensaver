// Engine core: renderer + composer + scene-manager + per-frame loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { MaterialPool } from './materials';
import { mkRng, freshSeed } from './rng';
import type { ScreensaverSettings, SceneId } from '../data/defaults';
import type { ResolvedColor } from './color';
import type { SceneCtx, SceneUpdater } from './scenes/scene-base';
import { TerrainScene } from './scenes/terrain';
import { CityScene }    from './scenes/city';
import { RiftScene }    from './scenes/rift';
import { TunnelScene }  from './scenes/tunnel';
import { VoidScene }    from './scenes/void';
import { MatrixScene }  from './scenes/matrix';
import { MatrixRain }   from '../fx/matrix-rain';
import { MATRIX_SHADER } from '../fx/matrix-pass';

const SCENE_REGISTRY = {
  terrain: TerrainScene,
  city:    CityScene,
  rift:    RiftScene,
  tunnel:  TunnelScene,
  void:    VoidScene,
  matrix:  MatrixScene,
};

// Chromatic aberration shader
const CHROMA_SHADER = {
  uniforms: { tDiffuse: { value: null }, offset: { value: 0.0015 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - vec2(0.5);
      float r = texture2D(tDiffuse, vUv - dir * offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + dir * offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// Analog-tube CRT composite (ported from the native Metal Shaders.swift composite_f):
// barrel curvature + bezel, RGB aperture-grille mask, NTSC dot-crawl, warm halation.
// The web already has bloom/trails/chroma + DOM scanlines/vignette, so this pass adds
// only the analog-tube layer and runs LAST. Halation is approximated by a warm-tinted
// blur of the (already-bloomed) frame, since there's no separate bloom texture here.
const CRT_SHADER = {
  uniforms: {
    tDiffuse:   { value: null },
    curvature:  { value: 0.0 },
    aperture:   { value: 0.0 },
    ntsc:       { value: 0.0 },
    halation:   { value: 0.0 },
    time:       { value: 0.0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float curvature, aperture, ntsc, halation, time;
    uniform vec2 resolution;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      float bezel = 1.0; bool offGlass = false;
      if (curvature > 0.0001) {
        float aspect = resolution.x / resolution.y;
        vec2 cc = uv * 2.0 - 1.0; cc.x *= aspect;
        vec2 warp = cc * (1.0 + curvature * dot(cc, cc));
        warp.x /= aspect;
        uv = warp * 0.5 + 0.5;
        vec2 fw = smoothstep(vec2(0.0), vec2(0.012), uv) * smoothstep(vec2(0.0), vec2(0.012), 1.0 - uv);
        bezel = fw.x * fw.y;
        offGlass = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0);
      }
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (halation > 0.0) {
        vec2 p1 = 1.5 / resolution; vec2 p2 = 3.5 / resolution;
        vec3 g = texture2D(tDiffuse, uv + vec2(p1.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(p1.x, 0.0)).rgb
               + texture2D(tDiffuse, uv + vec2(0.0, p1.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, p1.y)).rgb
               + texture2D(tDiffuse, uv + p2).rgb + texture2D(tDiffuse, uv - p2).rgb
               + texture2D(tDiffuse, uv + vec2(p2.x, -p2.y)).rgb + texture2D(tDiffuse, uv + vec2(-p2.x, p2.y)).rgb;
        g = max(vec3(0.0), g * 0.125 - 0.32);
        col += g * halation * vec3(1.0, 0.55, 0.25) * 2.2;
      }
      if (ntsc > 0.0) {
        vec2 pos = vUv * resolution;
        float crawl = sin(pos.y * 1.7 + pos.x * 0.9 + time * 18.0) * ntsc * 0.05;
        col.r += crawl; col.b -= crawl;
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum), ntsc * 0.12);
      }
      if (aperture > 0.001) {
        float tx = fract(vUv.x * resolution.x / 6.0);
        vec3 m = vec3(0.5 + 0.5 * cos(6.2831853 * tx),
                      0.5 + 0.5 * cos(6.2831853 * (tx - 0.33333)),
                      0.5 + 0.5 * cos(6.2831853 * (tx - 0.66667))) * 2.0;
        col *= mix(vec3(1.0), m, aperture);
      }
      col *= bezel;
      if (offGlass) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Engine {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  scene: THREE.Scene;
  world: THREE.Group;
  cam: THREE.PerspectiveCamera;
  mats = new MaterialPool();
  // Second pool for the "enemy" infection: scenes tag an infectable subset of meshes
  // with enemyMats; setEnemyFraction lerps its colour accent→enemy as threat rises.
  enemyMats = new MaterialPool();

  bloomPass: UnrealBloomPass;
  trailPass: AfterimagePass;
  burnPass: AfterimagePass;
  chromaPass: ShaderPass;
  crtPass: ShaderPass;
  matrixPass: ShaderPass;

  // Cinematic matrix rain: drawn to an offscreen 2D canvas and fed as a texture
  // into matrixPass (before bloom) so it blooms + curves like native in-monitor rain.
  private matrixRain = new MatrixRain();
  private matrixCanvas2d!: HTMLCanvasElement;
  private matrixCtx!: CanvasRenderingContext2D;
  private matrixTex!: THREE.CanvasTexture;

  currentScene: SceneId | null = null;
  currentUpdater: SceneUpdater | null = null;
  currentSceneObj: any = null;

  // ── Reactive-world hooks (driven by fx/reactive-world.ts) ───────────────
  /** Called at the TOP of each tick (before the scene updater) so the conductor's
   *  threat value is ready for scenes to read this same frame. */
  onFrame: ((t: number, dt: number) => void) | null = null;
  /** Live signal mirrored from the conductor; scenes read these via SceneCtx thunks. */
  threat = 0;
  storm = 0;
  /** Fog is composed as fogBase × fogThreatMult and written ONCE per frame by the
   *  engine (single writer — avoids the day-night/threat ordering clobber). The
   *  controller sets fogBase; the conductor sets fogThreatMult. */
  fogBase = 0.01;
  fogThreatMult = 1;
  // Bloom is likewise composed as bloomBase × bloomThreatMult and written ONCE per
  // frame by the engine. Controller (day-night / idle-drift) sets bloomBase; the
  // conductor sets bloomThreatMult (storm surge).
  bloomBase = 1.4;
  bloomThreatMult = 1;
  private _crtHalBase = 0;        // base CRT halation/ntsc (pre-threat); set in setCrtUniforms
  private _crtNtscBase = 0;
  private _crtHalAdd = 0;         // threat add on halation/ntsc; set by setCrtThreat
  private _crtNtscAdd = 0;
  private _crtBaseOn = false;     // any base CRT sub-effect enabled by the user
  private _hesT0 = -1;            // camera-hesitation envelope start (clockT); <0 = inactive
  private _hesDur = 0;
  private _accentHex = 0x00ff41;  // current accent + its derived enemy hue (HSL +160°)
  private _enemyHex = 0xff0040;
  private _enemyFraction = 0;     // 0 = subset matches accent, 1 = full enemy

  rng: () => number;
  seed: number;

  private rafId = 0;
  private lastT = 0;
  private clockT = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsT0 = 0;

  // Mouse-parallax: subtle look-around overlay. Strict isolation strategy:
  //   1. Before each scene update, restore cam.rotation from the snapshot saved at the
  //      end of the previous frame (= scene's "natural" rotation, no parallax).
  //   2. Run scene update — scenes mutate rotation freely (some set all axes, some only one).
  //   3. Snapshot the resulting rotation as the new "natural" baseline.
  //   4. Apply parallax as additive delta to .y/.x for THIS render only.
  //
  // Net effect: parallax never accumulates regardless of which scene is active or
  // which axes that scene chooses to set explicitly. The scene's flight path is
  // perfectly preserved.
  parallaxX = 0;
  parallaxY = 0;
  parallaxTargetX = 0;
  parallaxTargetY = 0;
  parallaxEnabled = false;
  parallaxStrength = 0.018;  // ≈ 1° max yaw/pitch — subtle, not a free-look gimbal
  private _baseRotX = 0;
  private _baseRotY = 0;
  private _baseRotZ = 0;

  constructor(host: HTMLElement, public settings: ScreensaverSettings, public color: ResolvedColor) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;display:block;z-index:1';
    host.appendChild(this.canvas);

    const W = host.clientWidth || window.innerWidth;
    const H = host.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x000000, 0.01);
    this.world = new THREE.Group(); this.scene.add(this.world);
    // v1.2 — Aspect-aware FoV (Mobile landscape feedback 2026-05-13):
    //   Jay reported CITY in landscape felt cramped. PerspectiveCamera FoV
    //   is vertical — at a 2:1 landscape ratio a 72° vertical gives a near-
    //   fisheye horizontal FoV that makes objects feel close. defaultFov()
    //   widens vertical FoV on portrait (more building heights visible) and
    //   shrinks it on landscape (less wide-angle distortion + more apparent
    //   distance to scene objects).
    this.cam = new THREE.PerspectiveCamera(Engine.defaultFov(W, H), W / H, 0.1, 600);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cam));

    // Matrix-rain pass runs right after the scene render and BEFORE bloom, so the
    // near-white heads bloom (threshold 0.05) and the CRT pass later warps the rain.
    this.matrixCanvas2d = document.createElement('canvas');   // offscreen — not in the DOM
    this.sizeMatrixCanvas(W, H);
    this.matrixCtx = this.matrixCanvas2d.getContext('2d')!;
    this.matrixTex = new THREE.CanvasTexture(this.matrixCanvas2d);
    this.matrixTex.minFilter = THREE.LinearFilter;
    this.matrixTex.magFilter = THREE.LinearFilter;
    this.matrixTex.generateMipmaps = false;
    this.matrixPass = new ShaderPass(MATRIX_SHADER);
    (this.matrixPass.uniforms as any).tMatrix.value = this.matrixTex;
    this.matrixPass.enabled = settings.fx.matrix.on;
    this.composer.addPass(this.matrixPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), settings.fx.bloom.strength, 0.6, 0.05);
    this.bloomPass.enabled = settings.fx.bloom.on;
    this.bloomBase = settings.fx.bloom.strength;
    this.composer.addPass(this.bloomPass);

    this.trailPass = new AfterimagePass(settings.fx.trails.damp);
    this.trailPass.enabled = settings.fx.trails.on;
    this.composer.addPass(this.trailPass);

    // damp must stay in [0,1] (AfterimagePass max-feedback); use the SAME mapping as
    // applyFxSettings so the constructor can't seed damp > 1 on initial load.
    this.burnPass = new AfterimagePass(0.5 + 0.47 * settings.fx.burnDecay.strength);
    this.burnPass.enabled = settings.fx.burnDecay.on;
    this.composer.addPass(this.burnPass);

    this.chromaPass = new ShaderPass(CHROMA_SHADER);
    this.chromaPass.uniforms.offset.value = settings.fx.chromaticAberration.offset / 1000;
    this.chromaPass.enabled = settings.fx.chromaticAberration.on;
    this.composer.addPass(this.chromaPass);

    // Analog-tube CRT pass runs LAST (curvature warps the final composite).
    this.crtPass = new ShaderPass(CRT_SHADER);
    this.crtPass.uniforms.resolution.value.set(W, H);
    this.setCrtUniforms(settings);
    this.composer.addPass(this.crtPass);

    this.mats.setColorHex(color.hex);
    this._accentHex = color.hex;
    this._enemyHex = this.enemyHexOf(color.hex);

    this.seed = settings.seedLock ?? freshSeed();
    this.rng = mkRng(this.seed);

    window.addEventListener('resize', this.onResize);
  }

  /**
   * v1.2 — Pick a vertical FoV based on viewport aspect ratio.
   *   - Portrait (≤ 0.75 W/H, e.g. phone vertical): 84° — taller scenes
   *     show building heights / tunnel rings without panning up.
   *   - Wide landscape (≥ 1.6 W/H, phone horizontal or wide desktop): 62°
   *     — narrower vertical FoV gives a longer apparent distance and
   *     reduces wide-angle distortion that was making CITY feel cramped.
   *   - In between (desktop window, tablet): 72° — the v1.0/v1.1 default.
   */
  static defaultFov(W: number, H: number): number {
    const a = W / H;
    if (a >= 1.6) return 62;
    // v1.2 update — Jay 2026-05-13: portrait still felt cramped at 84°.
    // Raised to 95° so phone-portrait shows substantially more scene
    // vertically. The wider near-edges are acceptable in atmosphere mode
    // (no objects directly at the rim that distortion would warp visibly).
    if (a <= 0.75) return 95;
    return 72;
  }

  private onResize = () => {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H);
    this.composer.setSize(W, H);
    this.crtPass.uniforms.resolution.value.set(W, H);
    this.cam.aspect = W / H;
    this.cam.fov = Engine.defaultFov(W, H);
    this.cam.updateProjectionMatrix();
  };

  /** Drive the analog-CRT pass uniforms from settings (off → 0, so the pass is a
   *  no-op when nothing is enabled). */
  private setCrtUniforms(s: ScreensaverSettings) {
    const f = s.fx;
    this.crtPass.uniforms.curvature.value = f.curvature.on ? f.curvature.amount : 0;
    this.crtPass.uniforms.aperture.value  = f.aperture.on  ? f.aperture.strength : 0;
    this._crtHalBase  = f.halation.on ? f.halation.amount : 0;
    this._crtNtscBase = f.ntsc.on     ? f.ntsc.amount : 0;
    this._crtBaseOn = f.curvature.on || f.aperture.on || f.ntsc.on || f.halation.on;
    this.applyCrtThreat();
  }

  /** Re-derive the CRT halation/ntsc uniforms from base + threat add (single point
   *  so threat escalation composes on the user's settings instead of clobbering). */
  private applyCrtThreat() {
    this.crtPass.uniforms.halation.value = this._crtHalBase + this._crtHalAdd;
    this.crtPass.uniforms.ntsc.value     = this._crtNtscBase + this._crtNtscAdd;
    this.crtPass.enabled = this._crtBaseOn || this._crtHalAdd > 0.001 || this._crtNtscAdd > 0.001;
  }

  /** Conductor: additive CRT escalation (halation + NTSC) driven by threat. */
  setCrtThreat(halAdd: number, ntscAdd: number) {
    this._crtHalAdd = halAdd;
    this._crtNtscAdd = ntscAdd;
    this.applyCrtThreat();
  }

  /** Conductor: bloom strength multiplier on the current base (storm payoff surge). */
  setBloomThreat(mult: number) {
    this.bloomThreatMult = mult;
  }

  /** Conductor: start a lateral camera-hesitation envelope (the operator "noticing").
   *  No-op if one is already active. Applied in the tick after the scene update. */
  pulseHesitation(durationSec: number) {
    if (this._hesT0 >= 0) return;
    this._hesT0 = this.clockT;
    this._hesDur = Math.max(0.3, durationSec);
  }

  /** HSL hue +160° → a vivid contrasting "enemy" hue for the infection crossfade. */
  private enemyHexOf(hex: number): number {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL((hsl.h + 160 / 360) % 1, Math.max(0.75, hsl.s), Math.min(0.6, Math.max(0.45, hsl.l)));
    return c.getHex();
  }

  /** Conductor: 0 = the infectable subset matches the accent (invisible), 1 = full
   *  enemy colour. Lerps the enemyMats pool colour accent→enemy in RGB. */
  setEnemyFraction(f: number) {
    this._enemyFraction = Math.min(1, Math.max(0, f));
    const a = this._accentHex, b = this._enemyHex, t = this._enemyFraction;
    const ch = (s: number) => Math.round(((a >> s) & 0xff) + (((b >> s) & 0xff) - ((a >> s) & 0xff)) * t);
    this.enemyMats.setColorHex((ch(16) << 16) | (ch(8) << 8) | ch(0));
  }

  /** Size the offscreen rain canvas to the viewport aspect, capped to bound the
   *  per-frame Canvas-2D fillText + texture-upload cost (it samples via normalized
   *  UVs, so a sub-native resolution is fine — the CRT pass softens it anyway). */
  private sizeMatrixCanvas(W: number, H: number) {
    const tw = Math.max(1, Math.min(W, 2048));
    const th = Math.max(1, Math.round(tw * H / W));
    if (this.matrixCanvas2d.width !== tw || this.matrixCanvas2d.height !== th) {
      this.matrixCanvas2d.width = tw;
      this.matrixCanvas2d.height = th;
    }
  }

  /** Theme accent as 0..1 RGB (ResolvedColor.rgb is 0..255). */
  private matrixAccent(): [number, number, number] {
    const [r, g, b] = this.color.rgb;
    return [r / 255, g / 255, b / 255];
  }

  /** Draw one rain frame to the offscreen canvas + flag the texture for re-upload.
   *  density drives BOTH column count and overall opacity (0.35..0.8), so the slider
   *  reads as a single "how much rain" knob rather than just thinning the columns. */
  private drawMatrixFrame() {
    this.sizeMatrixCanvas(window.innerWidth, window.innerHeight);
    const d = this.settings.fx.matrix.density;
    this.matrixRain.render(
      this.matrixCtx, this.matrixCanvas2d.width, this.matrixCanvas2d.height,
      this.clockT, this.matrixAccent(), 0.35 + 0.45 * d, d,
    );
    this.matrixTex.needsUpdate = true;
  }

  loadScene(id: SceneId) {
    // Clear world
    this.world.traverse((o: any) => {
      o.geometry?.dispose?.();
      const ms = ([] as any[]).concat(o.material || []);
      for (const m of ms) m.dispose?.();
    });
    while (this.world.children.length) this.world.remove(this.world.children[0]);
    this.mats.disposeAll();
    this.mats.setColorHex(this.color.hex);
    this.enemyMats.disposeAll();

    // v1.2 — Reset FoV to aspect-aware default (not hard-coded 72°). Some
    // scenes (tunnel) push FoV during boost; this restores the baseline on
    // each scene-load so boosts compose against the current viewport.
    this.cam.fov = Engine.defaultFov(window.innerWidth, window.innerHeight);
    this.cam.updateProjectionMatrix();

    // Re-seed per scene to keep layouts varied but reproducible per session
    this.rng = mkRng(this.seed + this.hashId(id));

    const ctx: SceneCtx = {
      scene: this.scene, world: this.world, cam: this.cam,
      mats: this.mats, enemyMats: this.enemyMats, rng: this.rng, settings: this.settings,
      threat: () => this.threat, storm: () => this.storm,
    };
    const mod = SCENE_REGISTRY[id];
    this.currentSceneObj = mod;
    this.currentUpdater = mod.build.call(mod, ctx);
    this.currentScene = id;
    this.updateMatrixEnabled();   // the MATRIX scene force-enables the rain pass
    this.setEnemyFraction(this._enemyFraction);   // tint the freshly-built enemy subset
    // Capture the scene's chosen fog density as the base the conductor scales.
    const fd = (this.scene.fog as any)?.density;
    if (typeof fd === 'number') this.fogBase = fd;
  }

  /** The matrix rain renders when the fx toggle is on OR the MATRIX scene is active
   *  (a dedicated pure-rain scene, mirroring native — the screen IS the rain). */
  private updateMatrixEnabled() {
    this.matrixPass.enabled = this.settings.fx.matrix.on || this.currentScene === 'matrix';
  }

  private hashId(id: string) {
    let h = 0; for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return h;
  }

  start() {
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const dt = this.lastT === 0 ? 16 : Math.min(50, now - this.lastT);
      this.lastT = now;
      this.clockT += dt / 1000;

      // Step 0 — conductor: compute threat (ready for the scene updater this frame),
      // then write the composed fog density (single writer: base × threat mult).
      this.onFrame?.(this.clockT, dt);
      if (this.scene.fog) (this.scene.fog as any).density = this.fogBase * this.fogThreatMult;
      this.bloomPass.strength = this.bloomBase * this.bloomThreatMult;

      // Step 1 — restore cam.rotation to the previous frame's *scene-natural* baseline.
      //   Without this, scenes that don't set rotation.x/.y every frame (TERRAIN sets only .z;
      //   CITY/CANYON set .y and .z) would let parallax delta compound across frames.
      if (this.parallaxEnabled) {
        this.cam.rotation.x = this._baseRotX;
        this.cam.rotation.y = this._baseRotY;
        this.cam.rotation.z = this._baseRotZ;
      }

      // Step 2 — run scene updater (mutates camera position + rotation).
      this.currentUpdater?.(this.clockT, dt);

      // Step 3 — snapshot the new baseline + Step 4 add parallax delta for this render.
      if (this.parallaxEnabled) {
        this._baseRotX = this.cam.rotation.x;
        this._baseRotY = this.cam.rotation.y;
        this._baseRotZ = this.cam.rotation.z;

        // Smooth cursor with low-pass to avoid jitter
        this.parallaxX += (this.parallaxTargetX - this.parallaxX) * 0.08;
        this.parallaxY += (this.parallaxTargetY - this.parallaxY) * 0.08;
        this.cam.rotation.y += this.parallaxX * this.parallaxStrength;
        this.cam.rotation.x += this.parallaxY * this.parallaxStrength;
        this.cam.updateProjectionMatrix();
      }

      // Camera hesitation: while a pulse is active, gently steady the lateral weave
      // (pull cam.x toward centre) so the flight "notices something". Scenes re-set
      // cam.x every frame, so this dampens without compounding. CameraFly untouched.
      if (this._hesT0 >= 0) {
        const p = (this.clockT - this._hesT0) / this._hesDur;
        if (p >= 1) { this._hesT0 = -1; }
        else {
          const s = Math.sin(Math.PI * p); const env = s * s;   // sin²: smooth in/out
          this.cam.position.x *= (1 - 0.55 * env);
        }
      }

      if (this.matrixPass.enabled) this.drawMatrixFrame();
      this.crtPass.uniforms.time.value = this.clockT;
      this.composer.render();

      // FPS
      this.fpsAcc++;
      if (now - this.fpsT0 > 600) {
        this.fps = Math.round(this.fpsAcc / ((now - this.fpsT0) / 1000));
        this.fpsAcc = 0; this.fpsT0 = now;
      }
    };
    this.lastT = 0; this.fpsT0 = performance.now();
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
  }

  setColor(c: ResolvedColor) {
    this.color = c;
    this.mats.setColorHex(c.hex);
    this._accentHex = c.hex;
    this._enemyHex = this.enemyHexOf(c.hex);
    this.setEnemyFraction(this._enemyFraction);   // re-tint the enemy subset for the new accent
  }

  /**
   * v1.1 — Live-Test 2026-05-11 (screensaver speed-button bug).
   *
   * Each scene captures `ctx.settings` at build time and reads
   * `ctx.settings.speed` every frame. The controller's effectiveSettings()
   * clones the screensaver settings via JSON.parse(JSON.stringify(…)) so
   * the engine and the plugin's persistent settings live in different
   * objects. The v1.0 speed-button handler only mutated the plugin's copy,
   * which the running engine never saw.
   *
   * Fix: mutate the engine's settings object in place. The scene's
   * `ctx.settings` is a reference to `this.settings`, so this propagates
   * to the next frame without touching the scene-build path.
   */
  setSpeed(speed: ScreensaverSettings['speed']) {
    this.settings.speed = speed;
  }

  applyFxSettings(s: ScreensaverSettings) {
    this.settings = s;
    this.bloomPass.enabled  = s.fx.bloom.on;
    this.bloomBase = s.fx.bloom.strength;
    this.trailPass.enabled  = s.fx.trails.on;
    (this.trailPass.uniforms as any).damp.value = s.fx.trails.damp;
    this.burnPass.enabled   = s.fx.burnDecay.on;
    (this.burnPass.uniforms as any).damp.value = 0.5 + 0.47 * s.fx.burnDecay.strength;
    this.chromaPass.enabled = s.fx.chromaticAberration.on;
    this.chromaPass.uniforms.offset.value = s.fx.chromaticAberration.offset / 1000;
    this.updateMatrixEnabled();
    this.setCrtUniforms(s);
  }

  getSceneObj() { return this.currentSceneObj; }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.world.traverse((o: any) => {
      o.geometry?.dispose?.();
      const ms = ([] as any[]).concat(o.material || []);
      for (const m of ms) m.dispose?.();
    });
    this.mats.disposeAll();
    this.enemyMats.disposeAll();
    this.matrixTex?.dispose();
    this.composer.dispose?.();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export const ALL_SCENES = Object.keys(SCENE_REGISTRY) as SceneId[];
