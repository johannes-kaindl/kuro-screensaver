// PowerPolicy — gathers every system signal the wallpaper's power policy needs
// (battery, Low Power Mode, thermal pressure, screen lock, display sleep) and
// fires onChange on the main queue; the AppDelegate combines them with
// per-window occlusion and applies the pure Core decision (renderState) to each
// wallpaper view. Battery stays polled: plug/unplug latency is irrelevant for a
// wallpaper, and polling avoids the IOPS C-callback dance.

import AppKit
import IOKit.ps

final class PowerPolicy {
    var onChange: (() -> Void)?
    private(set) var onBattery = false
    private(set) var lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    private(set) var thermal = ProcessInfo.processInfo.thermalState
    private(set) var screenLocked = false
    private(set) var screensAsleep = false

    private var timer: Timer?
    private var tokens: [(center: NotificationCenter, token: NSObjectProtocol)] = []

    func start() {
        onBattery = PowerPolicy.isOnBattery()
        let t = Timer(timeInterval: 5, repeats: true) { [weak self] _ in self?.pollBattery() }
        t.tolerance = 2   // coalesce: exact phase is irrelevant, save wakeups
        RunLoop.main.add(t, forMode: .common); timer = t

        observe(.default, .NSProcessInfoPowerStateDidChange) { [weak self] in
            self?.lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        }
        observe(.default, ProcessInfo.thermalStateDidChangeNotification) { [weak self] in
            self?.thermal = ProcessInfo.processInfo.thermalState
        }
        let ws = NSWorkspace.shared.notificationCenter
        observe(ws, NSWorkspace.screensDidSleepNotification) { [weak self] in self?.screensAsleep = true }
        observe(ws, NSWorkspace.screensDidWakeNotification) { [weak self] in self?.screensAsleep = false }
        let dnc = DistributedNotificationCenter.default()
        observe(dnc, Notification.Name("com.apple.screenIsLocked")) { [weak self] in self?.screenLocked = true }
        observe(dnc, Notification.Name("com.apple.screenIsUnlocked")) { [weak self] in self?.screenLocked = false }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        tokens.forEach { $0.center.removeObserver($0.token) }
        tokens.removeAll()
    }
    deinit { stop() }

    /// Register on `center`, hop to main, apply the mutation, then fire onChange.
    private func observe(_ center: NotificationCenter, _ name: Notification.Name,
                         _ apply: @escaping () -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            apply(); self?.onChange?()
        }
        tokens.append((center, token))
    }

    private func pollBattery() {
        let b = PowerPolicy.isOnBattery()
        guard b != onBattery else { return }
        onBattery = b
        onChange?()
    }

    /// True when running on battery. A desktop Mac (no battery source) → false.
    static func isOnBattery() -> Bool {
        guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] else {
            return false
        }
        for source in list {
            guard let desc = IOPSGetPowerSourceDescription(blob, source)?.takeUnretainedValue() as? [String: Any],
                  let state = desc[kIOPSPowerSourceStateKey] as? String else { continue }
            if state == kIOPSBatteryPowerValue { return true }
        }
        return false
    }
}
