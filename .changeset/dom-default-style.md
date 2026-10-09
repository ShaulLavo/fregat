---
'ghostty-webgpu': patch
---

Improved DOM rendering with contained fixed-row and run layout, direct packed-text projection for plain rows, and reused default run styles. Improved plain-row frame text construction by reusing owned glyph projections while preserving every terminal column and immutable snapshot data. Reused live canvas style declarations while keeping per-frame flow and padding updates. Styled cells, selections, cursor cells, and wide glyphs retain their existing appearance.
