// FontAtlas — a monospace glyph atlas baked at runtime via CoreText into an
// r8Unorm coverage texture (no Xcode/metal compiler needed). CoreText + CoreGraphics
// only (no AppKit) so it also builds in the headless harness. The text pipeline
// tints coverage with the accent color, and because text is drawn into the HDR
// scene the CRT post (bloom/scanlines/glitch) treats it.
//
// A single narrow-cell grid (ASCII + katakana + symbols, half-width) plus one
// reserved solid-fill texel for rect fills.

import Metal
import CoreText
import CoreGraphics
import Foundation

final class FontAtlas {
    let texture: MTLTexture
    let cellW: Int, cellH: Int
    let atlasW: Int, atlasH: Int
    private let cols: Int
    private var index: [Character: Int] = [:]
    /// UV of a guaranteed fully-opaque texel (a baked solid cell) — for fillRect.
    let solidU: Float, solidV: Float

    init(device: MTLDevice, fontName: String = "Menlo", pointSize: CGFloat = 64) {
        // MAIN charset: printable ASCII + katakana + symbols (half-width).
        var chars: [Character] = (32...126).map { Character(UnicodeScalar($0)!) }
        let extra = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー" +
                    "›↳«»█✛●○◢◣"
        chars += Array(extra)
        var seen = Set<Character>(); chars = chars.filter { seen.insert($0).inserted }

        let font = CTFontCreateWithName(fontName as CFString, pointSize, nil)
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font), leading = CTFontGetLeading(font)
        cellH = Int(ceil(ascent + descent + leading)) + 2
        var glyph = CGGlyph(0); var uni = UniChar(77) // 'M'
        CTFontGetGlyphsForCharacters(font, &uni, &glyph, 1)
        var adv = CGSize.zero; CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &adv, 1)
        cellW = Int(ceil(adv.width)) + 2

        // Single grid (+1 cell reserved for the solid-fill texel).
        cols = Int(ceil(Double(chars.count + 1).squareRoot()))
        let mainRows = Int(ceil(Double(chars.count + 1) / Double(cols)))
        atlasW = cols * cellW; atlasH = mainRows * cellH

        let cs = CGColorSpaceCreateDeviceGray()
        let ctx = CGContext(data: nil, width: atlasW, height: atlasH, bitsPerComponent: 8,
                            bytesPerRow: atlasW, space: cs, bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        ctx.setFillColor(gray: 0, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: atlasW, height: atlasH))
        let white = CGColor(colorSpace: cs, components: [1, 1])!
        let attrs: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: white]

        // --- main glyphs (narrow cells, top region) ---
        for (i, c) in chars.enumerated() {
            index[c] = i
            let col = i % cols, rowTop = i / cols
            let cellBottom = atlasH - (rowTop + 1) * cellH      // bottom-up CGContext
            let astr = CFAttributedStringCreate(nil, String(c) as CFString, attrs as CFDictionary)!
            let line = CTLineCreateWithAttributedString(astr)
            ctx.textPosition = CGPoint(x: CGFloat(col * cellW) + 1, y: CGFloat(cellBottom) + descent + 1)
            CTLineDraw(line, ctx)
        }

        // --- solid-fill texel (reserved cell in the main grid) ---
        let si = chars.count, sc = si % cols, sr = si / cols
        ctx.setFillColor(gray: 1, alpha: 1)
        ctx.fill(CGRect(x: sc * cellW, y: atlasH - (sr + 1) * cellH, width: cellW, height: cellH))
        solidU = (Float(sc * cellW) + Float(cellW) * 0.5) / Float(atlasW)
        solidV = (Float(sr * cellH) + Float(cellH) * 0.5) / Float(atlasH)

        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: atlasW, height: atlasH, mipmapped: false)
        td.usage = [.shaderRead]
        texture = device.makeTexture(descriptor: td)!
        texture.replace(region: MTLRegionMake2D(0, 0, atlasW, atlasH), mipmapLevel: 0,
                        withBytes: ctx.data!, bytesPerRow: atlasW)
    }

    /// Atlas UV rect for a (narrow) character. CGBitmapContext memory is TOP-DOWN
    /// (row 0 = image top); vTop is the glyph's visual top (smaller v).
    func uvRect(_ c: Character) -> (uLo: Float, uHi: Float, vTop: Float, vBottom: Float)? {
        guard let i = index[c] else { return nil }
        let col = i % cols, rowTop = i / cols
        let uLo = Float(col * cellW) / Float(atlasW)
        let uHi = Float((col + 1) * cellW) / Float(atlasW)
        let vTop = Float(rowTop * cellH) / Float(atlasH)
        let vBottom = Float((rowTop + 1) * cellH) / Float(atlasH)
        return (uLo, uHi, vTop, vBottom)
    }

    var cellAspect: Float { Float(cellW) / Float(cellH) }
}
