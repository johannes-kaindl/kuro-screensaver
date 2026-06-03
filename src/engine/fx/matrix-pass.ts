// Matrix-rain composite pass. Composites the cinematic rain (rendered to an
// offscreen Canvas-2D and uploaded as `tMatrix`) onto the 3D scene (`tDiffuse`)
// INSIDE the EffectComposer, inserted right after RenderPass and BEFORE
// UnrealBloomPass — so the bright near-white heads cross the bloom threshold (0.05)
// and glow, and the whole thing is subsequently warped by the analog-CRT curvature
// pass. This is what makes the web rain read as native in-monitor content rather
// than a flat overlay pasted on top of the glass.
//
// The rain canvas is opaque black where empty. We treat per-pixel luma as coverage:
// bright glyphs occlude the scene proportionally ("rain in front of the scene") and
// add their own light on top. Over a dark scene (void / the Matrix look) this reads
// as pure rain; over a bright scene it reads as a glowing rain overlay.
export const MATRIX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    tMatrix:  { value: null as unknown },
    occlude:  { value: 2.5 },        // how strongly rain luma dims the scene behind it (≥1 → bright glyphs fully replace the scene, no double-bright stacking)
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tMatrix;
    uniform float occlude;
    varying vec2 vUv;
    void main(){
      vec3 scene = texture2D(tDiffuse, vUv).rgb;
      vec3 rain  = texture2D(tMatrix,  vUv).rgb;
      float cover = clamp(max(rain.r, max(rain.g, rain.b)) * occlude, 0.0, 1.0);
      gl_FragColor = vec4(scene * (1.0 - cover) + rain, 1.0);
    }
  `,
};
