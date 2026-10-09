---
'@singapore-editor/core': patch
---

Fixed wrapping, horizontal scrolling and text extents for proportional `fontFamily` values such as FreeSans. Mounted plain ASCII/tab rows below 5,000 UTF-16 code units retain native kerning, ligatures and insertion positions; longer rows stay editable with bounded approximate geometry. Tab stops now follow the current browser’s native half-character minimum, including editors initialized while hidden.
