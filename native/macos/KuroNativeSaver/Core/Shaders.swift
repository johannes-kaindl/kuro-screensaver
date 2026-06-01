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
        float4 p0;        // x = exposure
    };

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

    // ---- composite (sceneHDR + bloom → tonemap → target; CRT added later) --
    fragment float4 composite_f(FSQOut in [[stage_in]],
                                texture2d<float> sceneTex [[texture(0)]],
                                texture2d<float> bloomTex [[texture(1)]],
                                constant PostUniforms& u [[buffer(0)]]) {
        constexpr sampler s(filter::linear, address::clamp_to_edge);
        float3 c = sceneTex.sample(s, in.uv).rgb;
        float3 b = bloomTex.sample(s, in.uv).rgb;
        c += b * u.p0.y;                        // bloom strength
        c = aces(c * u.p0.x);                   // exposure
        return float4(c, 1.0);
    }
    """
}
