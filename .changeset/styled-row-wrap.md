---
'@singapore-editor/core': patch
---

Breaking: Added `characterWidth` to each row in `SavedDocumentPaint`; include the effective font's zero-glyph advance when constructing document paint, and regenerate saved document snapshots. Fixed word wrapping for larger headings and other presentation-styled rows, with matching document snapshot replay and support for editors with no gutter.
