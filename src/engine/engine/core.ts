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
    this.cam = new THREE.PerspectiveCamera(72, W / H, 0.1, 600);

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

  private onResize = () => {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H);
    this.composer.setSize(W, H);
    this.cam.aspect = W / H; this.cam.updateProjectionMatrix();
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

    this.cam.fov = 72; this.cam.updateProjectionMatrix();

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
