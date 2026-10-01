from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

builder = FontBuilder(1000, isTTF=True)
glyphs = [".notdef", "ink", "white", "black", "gray"]
builder.setupGlyphOrder(glyphs)
builder.setupCharacterMap(
    {ord("M"): "ink", ord("W"): "white", ord("B"): "black", ord("G"): "gray"}
)
pen = TTGlyphPen(None)
pen.moveTo((100, 0))
pen.lineTo((900, 0))
pen.lineTo((900, 700))
pen.lineTo((100, 700))
pen.closePath()
outline = pen.glyph()
empty = TTGlyphPen(None).glyph()
builder.setupGlyf({name: outline if name == "ink" else empty for name in glyphs})
builder.setupHorizontalMetrics({name: (1000, 100) for name in glyphs})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable(
    {
        "familyName": "Intrinsic Colors",
        "styleName": "Regular",
        "psName": "IntrinsicColors-Regular",
    }
)
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.setupCOLR(
    {name: [("ink", index)] for index, name in enumerate(["white", "black", "gray"])}
)
builder.setupCPAL([[(1, 1, 1, 1), (0, 0, 0, 1), (0.5, 0.5, 0.5, 1)]])
builder.font.recalcTimestamp = False
builder.font["head"].created = 2082844800
builder.font["head"].modified = 2082844800
builder.save(
    Path(__file__).resolve().parents[1] / "src/render/tests/fixtures/intrinsic-colors.ttf"
)
