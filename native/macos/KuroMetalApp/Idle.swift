// Idle — system input-idle time via IOKit (HIDIdleTime on IOHIDSystem). Resets
// only on keyboard/mouse/trackpad activity, so it's the right signal for a
// screensaver. No special entitlement needed.

import Foundation
import IOKit

func systemIdleSeconds() -> Double {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"))
    guard service != 0 else { return 0 }
    defer { IOObjectRelease(service) }
    var props: Unmanaged<CFMutableDictionary>?
    guard IORegistryEntryCreateCFProperties(service, &props, kCFAllocatorDefault, 0) == KERN_SUCCESS,
          let dict = props?.takeRetainedValue() as? [String: Any] else { return 0 }
    // HIDIdleTime is in nanoseconds (may be NSNumber-bridged as UInt64/Int64).
    if let ns = dict["HIDIdleTime"] as? UInt64 { return Double(ns) / 1_000_000_000 }
    if let ns = dict["HIDIdleTime"] as? Int64 { return Double(ns) / 1_000_000_000 }
    return 0
}
