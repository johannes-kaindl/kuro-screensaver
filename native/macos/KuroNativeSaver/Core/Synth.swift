// Synth — the atmospheric audio: a 60 Hz CRT hum + an 80s "Carpenter" soundscape
// (triangle drone pad, sawtooth bass pulse, square arpeggio) with LFO-swept
// one-pole low-passes. Ported from audio/synth.ts. Rendered in a single
// real-time AVAudioSourceNode callback (allocation-free). Off by default —
// screensavers usually run muted; toggle in the app config.
//
// NOTE: audio output cannot be verified in this headless build — needs on-device ears.

import AVFoundation

final class Synth {
    private let engine = AVAudioEngine()
    private var source: AVAudioSourceNode?
    private var sr: Double = 48000
    var volume: Float = 0.4
    private(set) var running = false

    // oscillator phases (cycles)
    private var pHum = 0.0, pDroneA = 0.0, pDroneB = 0.0, pBass = 0.0, pArp = 0.0
    private var idx: Double = 0            // global sample index → seconds
    private var lpDrone = 0.0, lpBass = 0.0 // one-pole filter states
    private let synthMaster: Float = 0.4
    private let arpNotes: [Double] = [440, 329.63, 440, 587.33]

    func start() {
        guard !running else { return }
        let fmt = engine.outputNode.outputFormat(forBus: 0)
        sr = fmt.sampleRate > 0 ? fmt.sampleRate : 48000
        let node = AVAudioSourceNode { [weak self] _, _, frameCount, ablPtr -> OSStatus in
            guard let self else { return noErr }
            let abl = UnsafeMutableAudioBufferListPointer(ablPtr)
            let n = Int(frameCount)
            for i in 0..<n {
                let s = self.nextSample()
                for buf in abl {
                    let p = buf.mData!.assumingMemoryBound(to: Float.self)
                    p[i] = s
                }
            }
            return noErr
        }
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: fmt)
        source = node
        do { try engine.start(); running = true } catch { running = false }
    }

    func stop() {
        guard running else { return }
        engine.stop()
        if let s = source { engine.detach(s) }
        source = nil; running = false
    }

    // MARK: - DSP (audio thread)

    private func lpCoeff(_ fc: Double) -> Double { 1 - exp(-2 * .pi * fc / sr) }

    private func nextSample() -> Float {
        let t = idx / sr
        idx += 1
        let inc = 1.0 / sr

        // CRT hum 60 Hz
        pHum += 60 * inc; let hum = sin(2 * .pi * pHum) * 0.025

        // drone: triangle 110 + 164.81, lowpass LFO 400..2000 Hz (1/30 Hz)
        pDroneA += 110 * inc; pDroneB += 164.81 * inc
        func tri(_ p: Double) -> Double { 2 * abs(2 * (p - floor(p + 0.5))) - 1 }
        let droneRaw = (tri(pDroneA) + tri(pDroneB)) * 0.5
        let droneFc = 1200 + sin(2 * .pi * t / 30) * 800
        lpDrone += lpCoeff(droneFc) * (droneRaw - lpDrone)
        let drone = lpDrone * 0.16

        // bass: saw 110, pulsed every 0.75s (AD env), lowpass LFO 300..900 (0.25Hz)
        pBass += 110 * inc
        let saw = 2 * (pBass - floor(pBass + 0.5))
        let bp = t.truncatingRemainder(dividingBy: 0.75)
        let bassEnv = bp < 0.01 ? bp / 0.01 : exp(-(bp - 0.01) * 6)
        let bassFc = 600 + sin(2 * .pi * t * 0.25) * 300
        lpBass += lpCoeff(bassFc) * (saw - lpBass)
        let bass = lpBass * bassEnv * 0.22

        // arpeggio: square, 16ths @ ~80 BPM (0.1875s/step), AD env
        let step = Int(t / 0.1875) % arpNotes.count
        pArp += arpNotes[step] * inc
        let sq = sin(2 * .pi * pArp) >= 0 ? 1.0 : -1.0
        let ap = t.truncatingRemainder(dividingBy: 0.1875)
        let arpEnv = ap < 0.005 ? ap / 0.005 : exp(-(ap - 0.005) * 22)
        let arp = sq * arpEnv * 0.09

        let mix = (drone + bass + arp) * Double(synthMaster) + hum
        return Float(mix) * volume
    }
}
