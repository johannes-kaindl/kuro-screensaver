// Shaders — all MSL source, compiled at runtime (device.makeLibrary(source:)),
// so no Xcode `metal` build-time compiler is required. Grows across tasks
// (scene pass now; bloom + CRT composite added later).
//
// Uniform structs here MUST match the Swift mirrors in Scene.swift / Renderer.swift
// field-for-field. We use only float4x4 / float4 (16-byte aligned) to avoid any
// struct-layout ambiguity between Swift and MSL.

enum Shaders {
    static let source = """
    #include <metal_stdlib>
    using namespace metal;

    // ---- shared structs ----------------------------------------------------
    struct SceneUniforms {
        float4x4 mvp;
        float4x4 modelView;
        float4 color;     // rgb, a = opacity
        float4 params;    // x=fogDensity, y=pointSizeWorld, z=pointScale, w=isPoint
    };
    struct PostUniforms {
        float4 p0;        // exposure, bloomStrength, chromaOffset, scanOpacity
        float4 p1;        // scanDriftY(px), vignetteInner, vignetteStrength, time
        float4 p2;        // hTearAmount, hTearBandY, brightness, scanPulse (glitch)
        float4 p3;        // vRoll, blackFrame, skewX, staticAmt (glitch)
        float4 p4;        // collapse, flash, curvature, bezelSharpness
        float4 p5;        // maskStrength, maskCellPx, grain, flicker
        float4 p6;        // ntsc, halation, _, _
    };

    inline float hash21(float2 p) {
        return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
    }

    // ACES filmic tonemap (Narkowicz approximation).
    inline float3 aces(float3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
    }

    // ---- scene pass (lines + points, unlit accent, FogExp2) ----------------
    struct SceneVOut {
        float4 pos [[position]];
        float pointSize [[point_size]];
        float3 color;
        float opacity;
        float viewZ;
        float fogDensity;
    };

    vertex SceneVOut scene_v(uint vid [[vertex_id]],
                             device const packed_float3* positions [[buffer(0)]],
                             constant SceneUniforms& u [[buffer(1)]]) {
        float3 p = float3(positions[vid]);
        float4 viewPos = u.modelView * float4(p, 1.0);
        SceneVOut o;
        o.pos = u.mvp * float4(p, 1.0);
        o.viewZ = -viewPos.z;
        o.color = u.color.rgb;
        o.opacity = u.color.a;
        o.fogDensity = u.params.x;
        if (u.params.w > 0.5) {
            float ps = u.params.y * u.params.z / max(o.viewZ, 0.001); // size attenuation
            o.pointSize = clamp(ps, 1.0, 48.0);
        } else {
            o.pointSize = 1.0;
        }
        return o;
    }

    fragment float4 scene_f(SceneVOut in [[stage_in]]) {
        float fd = in.viewZ;
        float fog = 1.0 - exp(-in.fogDensity * in.fogDensity * fd * fd); // FogExp2
        float3 col = in.color * in.opacity;
        col = mix(col, float3(0.0), fog);   // fog toward black
        return float4(col, 1.0);
    }

    // ---- fullscreen triangle (uv with origin top-left, Metal texture coords) ----
    struct FSQOut { float4 pos [[position]]; float2 uv; };
    vertex FSQOut fsq_v(uint vid [[vertex_id]]) {
        float2 v[3] = { float2(-1, -1), float2(-1, 3), float2(3, -1) };
        FSQOut o;
        o.pos = float4(v[vid], 0, 1);
        o.uv = float2(v[vid].x * 0.5 + 0.5, -v[vid].y * 0.5 + 0.5);
        return o;
    }

    // ---- phosphor trails (feedback: max of scene vs decayed previous frame) --
    fragment float4 trails_f(FSQOut in [[stage_in]],
                             texture2d<float> sceneTex [[texture(0)]],
                             texture2d<float> persistTex [[texture(1)]],
                             constant float& decay [[buffer(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float3 sc = sceneTex.sample(s, in.uv).rgb;
        float3 pr = persistTex.sample(s, in.uv).rgb;
        return float4(max(sc, pr * decay), 1.0);
    }

    // ---- bloom threshold (keep bright pixels; MPS blurs the result) --------
    fragment float4 threshold_f(FSQOut in [[stage_in]],
                                texture2d<float> sceneTex [[texture(0)]],
                                constant PostUniforms& u [[buffer(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float3 c = sceneTex.sample(s, in.uv).rgb;
        float luma = dot(c, float3(0.299, 0.587, 0.114));
        float t = u.p0.x;                       // threshold
        float soft = smoothstep(t, t + 0.15, luma);
        return float4(c * soft, 1.0);
    }

    // ---- composite: scene + bloom, then the CRT look ----------------------
    // p0: exposure, bloomStrength, chromaOffset, scanOpacity
    // p1: scanDriftY(px), vignetteInner, vignetteStrength, time
    // p2: hTearAmount, hTearBandY, brightness, scanPulse
    fragment float4 composite_f(FSQOut in [[stage_in]],
                                texture2d<float> sceneTex [[texture(0)]],
                                texture2d<float> bloomTex [[texture(1)]],
                                constant PostUniforms& u [[buffer(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float bs = u.p0.y;
        float2 uv = in.uv;
        float sy = in.uv.y;                      // original screen y (for line/scan)

        // CRT screen curvature (radial barrel): warps the SAMPLING uv only;
        // scanlines/vignette/static stay screen-space (they use in.pos/in.uv).
        float bezel = 1.0; bool offGlass = false;
        float curv = u.p4.z;
        if (curv > 0.0001) {
            float aspect = float(sceneTex.get_width()) / float(sceneTex.get_height());
            float2 cc = uv * 2.0 - 1.0; cc.x *= aspect;
            float2 warp = cc * (1.0 + curv * dot(cc, cc));
            warp.x /= aspect;
            uv = warp * 0.5 + 0.5;
            float bp = max(0.4, u.p4.w);
            float2 fw = smoothstep(0.0, 0.02 * bp, uv) * smoothstep(0.0, 0.02 * bp, 1.0 - uv);
            bezel = fw.x * fw.y;
            offGlass = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0);
        }

        // geometry glitches: h-tear band, v-roll, wave skew
        float tear = u.p2.x;
        if (tear != 0.0) { uv.x += tear * exp(-pow((uv.y - u.p2.y) * 6.0, 2.0)); }
        uv.y = fract(uv.y + u.p3.x);             // v-roll (wraps)
        uv.x += (uv.y - 0.5) * u.p3.z;           // wave skew

        // crash collapse: squeeze the image vertically toward a center line
        float collapse = u.p4.x;
        if (collapse > 0.0) {
            float sq = 1.0 - collapse * 0.997;
            uv.y = 0.5 + (uv.y - 0.5) / sq;
        }
        bool outside = (collapse > 0.0) && (uv.y < 0.0 || uv.y > 1.0);

        // chromatic aberration: radial RGB split about screen center
        float off = u.p0.z;
        float2 dr = (uv - 0.5) * off;
        float3 col;
        col.r = sceneTex.sample(s, uv - dr).r + bloomTex.sample(s, uv - dr).r * bs;
        col.g = sceneTex.sample(s, uv).g       + bloomTex.sample(s, uv).g       * bs;
        col.b = sceneTex.sample(s, uv + dr).b  + bloomTex.sample(s, uv + dr).b  * bs;
        if (outside) col = float3(0.0);

        // halation: warm phosphor glow bleed around bright areas (extra warm bloom)
        col += bloomTex.sample(s, uv).rgb * u.p6.y * 3.0 * float3(1.0, 0.55, 0.25);

        col = aces(col * u.p0.x);               // exposure + tonemap
        col *= u.p2.z;                          // brightness flicker (default 1)
        col *= (1.0 + u.p4.y);                  // crash reboot flash

        // scanlines: sinusoidal darkening, 4px period, drifting; + glitch pulse
        float scanAmt = u.p0.w * (1.0 + u.p2.w);
        float s2 = 0.5 + 0.5 * sin((in.pos.y + u.p1.x) * 3.14159265 / 2.0);
        col *= (1.0 - scanAmt * s2);

        // vignette: radial smoothstep darkening toward the edges
        float r = length(in.uv - 0.5);
        float vig = smoothstep(u.p1.y, 0.72, r);
        col *= (1.0 - vig * 0.72 * u.p1.z);

        // static burst (screen-blended hash noise)
        if (u.p3.w > 0.0) {
            float n = hash21(in.uv * 800.0 + u.p1.w);
            col = 1.0 - (1.0 - col) * (1.0 - n * u.p3.w);
        }

        // crash power-off line (bright pinch at center while collapsing)
        if (collapse > 0.0) {
            float line = exp(-pow((sy - 0.5) * 220.0, 2.0)) * collapse;
            col += float3(0.78, 0.95, 0.84) * line;   // CRT phosphor-white pinch
        }

        // NTSC composite shimmer: dot-crawl chroma wiggle + slight luma smear
        float ntsc = u.p6.x;
        if (ntsc > 0.0) {
            float crawl = sin(in.pos.y * 1.7 + in.pos.x * 0.9 + u.p1.w * 18.0) * ntsc * 0.11;
            col.r += crawl; col.b -= crawl;
            float lum = dot(col, float3(0.299, 0.587, 0.114));
            col = mix(col, float3(lum), ntsc * 0.26);
        }

        // aperture grille (energy-preserving cos lobes) — RGB phosphor stripes
        float maskStr = u.p5.x;
        if (maskStr > 0.001) {
            float cell = max(2.0, u.p5.y);
            float tx = fract(in.pos.x / cell);
            float3 m = float3(0.5 + 0.5 * cos(6.2831853 * tx),
                              0.5 + 0.5 * cos(6.2831853 * (tx - 0.33333)),
                              0.5 + 0.5 * cos(6.2831853 * (tx - 0.66667))) * 2.0; // mean ~1
            col *= mix(float3(1.0), m, maskStr);
        }
        // constant analog grain + gentle brightness shimmer
        float grain = u.p5.z;
        if (grain > 0.0) { col += (hash21(in.pos.xy + floor(u.p1.w * 60.0)) - 0.5) * grain; }
        float flick = u.p5.w;
        if (flick > 0.0) { col *= 1.0 - flick * (0.5 + 0.5 * sin(u.p1.w * 38.0)); }

        // CRT glass edge (curvature bezel + outside-glass black)
        col *= bezel;
        if (offGlass) col = float3(0.0);

        // black-frame drop (wins over everything)
        if (u.p3.y > 0.5) col = float3(0.0);

        return float4(col, 1.0);
    }

    // ---- text overlay (font-atlas coverage tinted by accent) ----------------
    // Vertex buffer is flat floats, 8 per vertex: posX, posY (clip), u, v, r,g,b,a.
    struct TextVOut { float4 pos [[position]]; float2 uv; float4 color; };
    vertex TextVOut text_v(uint vid [[vertex_id]], device const float* verts [[buffer(0)]]) {
        uint b = vid * 8;
        TextVOut o;
        o.pos = float4(verts[b], verts[b + 1], 0, 1);
        o.uv = float2(verts[b + 2], verts[b + 3]);
        o.color = float4(verts[b + 4], verts[b + 5], verts[b + 6], verts[b + 7]);
        return o;
    }
    fragment float4 text_f(TextVOut in [[stage_in]], texture2d<float> atlas [[texture(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float cov = atlas.sample(s, in.uv).r;
        return float4(in.color.rgb, in.color.a * cov);
    }
    """
}
