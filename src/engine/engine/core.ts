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

const SCENE_REGISTRY = {
  terrain: TerrainScene,
  city:    CityScene,
  rift:    RiftScene,
  tunnel:  TunnelScene,
  void:    VoidScene,
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

export class Engine {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  scene: THREE.Scene;
  world: THREE.Group;
  cam: THREE.PerspectiveCamera;
  mats = new MaterialPool();

  bloomPass: UnrealBloomPass;
  trailPass: AfterimagePass;
  burnPass: AfterimagePass;
  chromaPass: ShaderPass;

  currentScene: SceneId | null = null;
  currentUpdater: SceneUpdater | null = null;
  currentSceneObj: any = null;

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

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), settings.fx.bloom.strength, 0.6, 0.05);
    this.bloomPass.enabled = settings.fx.bloom.on;
    this.composer.addPass(this.bloomPass);

    this.trailPass = new AfterimagePass(settings.fx.trails.damp);
    this.trailPass.enabled = settings.fx.trails.on;
    this.composer.addPass(this.trailPass);

    this.burnPass = new AfterimagePass(0.97 * settings.fx.burnDecay.strength + 0.5);
    this.burnPass.enabled = settings.fx.burnDecay.on;
    this.composer.addPass(this.burnPass);

    this.chromaPass = new ShaderPass(CHROMA_SHADER);
    this.chromaPass.uniforms.offset.value = settings.fx.chromaticAberration.offset / 1000;
    this.chromaPass.enabled = settings.fx.chromaticAberration.on;
    this.composer.addPass(this.chromaPass);

    this.mats.setColorHex(color.hex);

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
    this.cam.aspect = W / H;
    this.cam.fov = Engine.defaultFov(W, H);
    this.cam.updateProjectionMatrix();
  };

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

    // v1.2 — Reset FoV to aspect-aware default (not hard-coded 72°). Some
    // scenes (tunnel) push FoV during boost; this restores the baseline on
    // each scene-load so boosts compose against the current viewport.
    this.cam.fov = Engine.defaultFov(window.innerWidth, window.innerHeight);
    this.cam.updateProjectionMatrix();

    // Re-seed per scene to keep layouts varied but reproducible per session
    this.rng = mkRng(this.seed + this.hashId(id));

    const ctx: SceneCtx = {
      scene: this.scene, world: this.world, cam: this.cam,
      mats: this.mats, rng: this.rng, settings: this.settings,
    };
    const mod = SCENE_REGISTRY[id];
    this.currentSceneObj = mod;
    this.currentUpdater = mod.build.call(mod, ctx);
    this.currentScene = id;
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
    this.bloomPass.strength = s.fx.bloom.strength;
    this.trailPass.enabled  = s.fx.trails.on;
    (this.trailPass.uniforms as any).damp.value = s.fx.trails.damp;
    this.burnPass.enabled   = s.fx.burnDecay.on;
    (this.burnPass.uniforms as any).damp.value = 0.5 + 0.47 * s.fx.burnDecay.strength;
    this.chromaPass.enabled = s.fx.chromaticAberration.on;
    this.chromaPass.uniforms.offset.value = s.fx.chromaticAberration.offset / 1000;
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
    this.composer.dispose?.();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export const ALL_SCENES = Object.keys(SCENE_REGISTRY) as SceneId[];
