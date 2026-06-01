// Smoke test for the built .saver: load the bundle, resolve NSPrincipalClass,
// confirm it is a ScreenSaverView subclass, and instantiate it (exercising the
// full host init path — CAMetalLayer, Renderer, runtime shader compilation,
// scene buffers). This verifies everything short of real screensaver
// activation/compositing (which needs on-device eyes). Run by
// scripts/build-native-saver.sh.

import Foundation
import AppKit
import ScreenSaver

let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
guard let b = Bundle(path: path) else { print("FAIL: no bundle at \(path)"); exit(1) }
guard b.load() else { print("FAIL: bundle.load() failed"); exit(1) }
guard let pc = b.principalClass else { print("FAIL: no principalClass"); exit(1) }
print("principalClass: \(NSStringFromClass(pc))")
guard let ssType = pc as? ScreenSaverView.Type else {
    print("FAIL: principalClass is not a ScreenSaverView subclass"); exit(1)
}
print("OK: ScreenSaverView subclass")
guard let view = ssType.init(frame: NSRect(x: 0, y: 0, width: 1280, height: 720),
                             isPreview: false) else {
    print("FAIL: init(frame:isPreview:) returned nil"); exit(1)
}
print("OK: instantiated \(type(of: view)) — host init ran (layer + renderer + shaders)")
print("hasConfigureSheet: \(view.hasConfigureSheet)")
print("ALL PASS")
