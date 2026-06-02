// FontAtlas — a monospace glyph atlas baked at runtime via CoreText into an
// r8Unorm coverage texture (no Xcode/metal compiler needed). CoreText + CoreGraphics
// only (no AppKit) so it also builds in the headless harness. The text pipeline
// tints coverage with the accent color, and because text is drawn into the HDR
// scene the CRT post (bloom/scanlines/glitch) treats it.
//
// Two regions: a narrow-cell MAIN grid (ASCII + katakana + symbols, half-width)
// and, below it, full-width SQUARE cells for the vault KANJI — CJK glyphs are
// full-width and would be clipped by the narrow Latin cells (that's why the big
// vault kanji looked broken), so they get their own square cells + drawKanji().

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
    private var kanjiCell: [Character: (col: Int, rowFromTop: Int)] = [:]
    /// UV of a guaranteed fully-opaque texel (a baked solid cell) — for fillRect.
    let solidU: Float, solidV: Float

    init(device: MTLDevice, fontName: String = "Menlo", pointSize: CGFloat = 64) {
        // MAIN charset: printable ASCII + katakana + symbols (half-width).
        var chars: [Character] = (32...126).map { Character(UnicodeScalar($0)!) }
        let extra = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー" +
                    "›↳«»█✛●○◢◣"
        chars += Array(extra)
        var seen = Set<Character>(); chars = chars.filter { seen.insert($0).inserted }
        // KANJI (full-width, baked square so they aren't clipped).
        let kanji = Array("黒脳鉄毒命霊魔電紅光炎幻珠護軍監")

        let font = CTFontCreateWithName(fontName as CFString, pointSize, nil)
        let ascent = CTFontGetAscent(font), descent = CTFontGetDescent(font), leading = CTFontGetLeading(font)
        cellH = Int(ceil(ascent + descent + leading)) + 2
        var glyph = CGGlyph(0); var uni = UniChar(77) // 'M'
        CTFontGetGlyphsForCharacters(font, &uni, &glyph, 1)
        var adv = CGSize.zero; CTFontGetAdvancesForGlyphs(font, .horizontal, &glyph, &adv, 1)
        cellW = Int(ceil(adv.width)) + 2

        // MAIN grid (+1 cell reserved for the solid-fill texel).
        cols = Int(ceil(Double(chars.count + 1).squareRoot()))
        let mainRows = Int(ceil(Double(chars.count + 1) / Double(cols)))
        let mainW = cols * cellW, mainH = mainRows * cellH
        // KANJI region: square cells (cellH × cellH) below the main grid.
        let kCols = max(1, Int(ceil(Double(kanji.count).squareRoot())))
        let kRows = Int(ceil(Double(kanji.count) / Double(kCols)))
        let kW = kCols * cellH, kH = kRows * cellH
        atlasW = max(mainW, kW); atlasH = mainH + kH

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

        // --- vault kanji (full-width square cells, bottom region) ---
        for (j, c) in kanji.enumerated() {
            let kc = j % kCols, kr = j / kCols
            let rowFromTop = mainRows + kr
            kanjiCell[c] = (col: kc, rowFromTop: rowFromTop)
            let cellBottom = atlasH - (rowFromTop + 1) * cellH
            // centre the glyph in its square cell
            var g = CGGlyph(0); var u = (c.unicodeScalars.first.map { UniChar($0.value) }) ?? 0
            CTFontGetGlyphsForCharacters(font, &u, &g, 1)
            var ka = CGSize.zero; CTFontGetAdvancesForGlyphs(font, .horizontal, &g, &ka, 1)
            let xOff = max(1, (CGFloat(cellH) - ka.width) / 2)
            let astr = CFAttributedStringCreate(nil, String(c) as CFString, attrs as CFDictionary)!
            let line = CTLineCreateWithAttributedString(astr)
            ctx.textPosition = CGPoint(x: CGFloat(kc * cellH) + xOff, y: CGFloat(cellBottom) + descent + 1)
            CTLineDraw(line, ctx)
        }

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

    /// Atlas UV rect for a full-width vault kanji (square cell, cellH × cellH).
    func kanjiUV(_ c: Character) -> (uLo: Float, uHi: Float, vTop: Float, vBottom: Float)? {
        guard let p = kanjiCell[c] else { return nil }
        let uLo = Float(p.col * cellH) / Float(atlasW)
        let uHi = Float((p.col + 1) * cellH) / Float(atlasW)
        let vTop = Float(p.rowFromTop * cellH) / Float(atlasH)
        let vBottom = Float((p.rowFromTop + 1) * cellH) / Float(atlasH)
        return (uLo, uHi, vTop, vBottom)
    }

    var cellAspect: Float { Float(cellW) / Float(cellH) }
}
