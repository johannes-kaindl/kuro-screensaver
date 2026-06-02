// Headless render harness — renders frames offscreen to PNG so the Metal
// renderer can be verified without a window or a real screensaver activation.
//
// Usage:
//   harness --out DIR [--w W --h H] [--preset KEY] [--scene terrain]
//           [--seconds S --fps F] [--seed N] [--at T]
//
// Builds via swiftc against Core/*.swift (see scripts/build-native-harness.sh).
// Shaders are compiled at runtime, so no Xcode `metal` compiler is needed.

import Metal
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// ---- CLI parsing -----------------------------------------------------------

struct Args {
    var out = "/tmp/kuro-native"
    var w = 1280, h = 720
    var preset = "toxic-haze"
    var scene = "terrain"
    var seconds = 0.0     // if > 0, render a sequence
    var fps = 30.0
    var at = 8.0          // single-frame timestamp (seconds) when seconds==0
    var seed: Int32 = 1337
    var intensity: Float = 0.35
    var forceGlitch: String? = nil   // htear|flicker|chroma|scanpulse (debug)
    var bench = 0                    // if > 0: render N frames timed, no PNG
    var crash: Float = -1            // if >= 0: freeze crash collapse at this amount
}

func parseArgs() -> Args {
    var a = Args()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let k = it.next() {
        switch k {
        case "--out": a.out = it.next() ?? a.out
        case "--w": a.w = Int(it.next() ?? "") ?? a.w
        case "--h": a.h = Int(it.next() ?? "") ?? a.h
        case "--preset": a.preset = it.next() ?? a.preset
        case "--scene": a.scene = it.next() ?? a.scene
        case "--seconds": a.seconds = Double(it.next() ?? "") ?? a.seconds
        case "--fps": a.fps = Double(it.next() ?? "") ?? a.fps
        case "--at": a.at = Double(it.next() ?? "") ?? a.at
        case "--seed": a.seed = Int32(it.next() ?? "") ?? a.seed
        case "--intensity": a.intensity = Float(it.next() ?? "") ?? a.intensity
        case "--force-glitch": a.forceGlitch = it.next()
        case "--bench": a.bench = Int(it.next() ?? "") ?? a.bench
        case "--crash": a.crash = Float(it.next() ?? "") ?? 0.85
        default: FileHandle.standardError.write("unknown arg \(k)\n".data(using: .utf8)!)
        }
    }
    return a
}

func die(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(2)
}

/// Resident memory of this process in MB (for the leak check).
func currentRSSMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576 : 0
}

// ---- PNG output ------------------------------------------------------------

/// Write an rgba8 (premultipliedLast) buffer to a PNG file.
func writePNG(_ rgba: inout [UInt8], width: Int, height: Int, to path: String) {
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: &rgba, width: width, height: height,
                              bitsPerComponent: 8, bytesPerRow: width * 4,
                              space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let img = ctx.makeImage() else { die("CGContext/image failed") }
    let url = URL(fileURLWithPath: path)
    guard let dst = CGImageDestinationCreateWithURL(url as CFURL,
                        UTType.png.identifier as CFString, 1, nil)
    else { die("CGImageDestination failed") }
    CGImageDestinationAddImage(dst, img, nil)
    if !CGImageDestinationFinalize(dst) { die("PNG finalize failed") }
}

/// Read an rgba8/bgra8 texture back into a CPU buffer (as RGBA for PNG).
func readback(_ tex: MTLTexture) -> [UInt8] {
    let w = tex.width, h = tex.height
    var raw = [UInt8](repeating: 0, count: w * h * 4)
    tex.getBytes(&raw, bytesPerRow: w * 4,
                 from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
    if tex.pixelFormat == .bgra8Unorm {
        var i = 0
        while i < raw.count { raw.swapAt(i, i + 2); i += 4 }
    }
    return raw
}

// ---- main ------------------------------------------------------------------

let args = parseArgs()
try? FileManager.default.createDirectory(atPath: args.out,
        withIntermediateDirectories: true)

guard let device = MTLCreateSystemDefaultDevice() else { die("no Metal device") }
FileHandle.standardError.write("device: \(device.name)\n".data(using: .utf8)!)

// Offscreen target mirrors a CAMetalLayer drawable (bgra8) so the composite
// pipeline matches what the .saver host will use.
let td = MTLTextureDescriptor.texture2DDescriptor(
    pixelFormat: .rgba8Unorm, width: args.w, height: args.h, mipmapped: false)
td.usage = [.renderTarget, .shaderRead, .shaderWrite]
guard let target = device.makeTexture(descriptor: td) else { die("no target texture") }
let queue = device.makeCommandQueue()!

_ = queue   // (kept for potential direct use)

var settings = Settings()
settings.scene = args.scene
settings.presetID = args.preset
settings.seed = args.seed
settings.crtIntensity = args.intensity

let ctx = SceneContext(device: device, rng: LCG(seed: args.seed),
                       settings: settings, accent: settings.preset.accentRGB)
let scene: Scene = SceneRegistry.make(args.scene, ctx: ctx)
let renderer = Renderer(device: device, settings: settings, scene: scene,
                        targetFormat: target.pixelFormat)
if let g = args.forceGlitch { renderer.debugForceGlitch(g) }
if args.crash >= 0 { renderer.debugForceCrash(args.crash) }

func drawFrame(path: String) {
    renderer.draw(into: target)
    var rgba = readback(target)
    writePNG(&rgba, width: args.w, height: args.h, to: path)
    print("wrote \(path)")
}

if args.bench > 0 {
    // Warm up, then time N frames (draw() is synchronous → CPU encode + GPU exec).
    for _ in 0..<10 { autoreleasepool { renderer.advance(dt: 1.0 / 60.0); renderer.draw(into: target) } }
    if args.bench > 1 {
        let rss0 = currentRSSMB()
        for _ in 0..<200 { autoreleasepool { renderer.advance(dt: 1.0 / 60.0); renderer.draw(into: target) } }
        FileHandle.standardError.write(String(format: "leak-check: RSS %.0f→%.0f MB after 200 frames\n", rss0, currentRSSMB()).data(using: .utf8)!)
    }
    let start = DispatchTime.now().uptimeNanoseconds
    for _ in 0..<args.bench { autoreleasepool { renderer.advance(dt: 1.0 / 60.0); renderer.draw(into: target) } }
    let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    let perFrame = elapsedMs / Double(args.bench)
    print(String(format: "bench %@/%@ %dx%d: %.3f ms/frame  (%.0f fps cap)",
                 args.scene, args.preset, args.w, args.h, perFrame, 1000.0 / perFrame))
} else if args.seconds > 0 {
    let n = Int(args.seconds * args.fps)
    let stepDt = 1.0 / args.fps
    for f in 0..<n {
        renderer.advance(dt: stepDt)
        drawFrame(path: "\(args.out)/\(args.scene)-\(args.preset)-\(String(format: "%04d", f)).png")
    }
} else {
    let dt = 1.0 / 60.0
    let steps = max(1, Int(args.at * 60))
    for _ in 0..<steps { renderer.advance(dt: dt) }
    drawFrame(path: "\(args.out)/\(args.scene)-\(args.preset).png")
}
