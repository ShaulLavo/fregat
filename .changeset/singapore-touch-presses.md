---
'@singapore-editor/core': patch
'@singapore-editor/diff': patch
'@singapore-editor/lsp-plugin': patch
---

Breaking: `EditorPressParticipant` now receives `MouseEvent | TouchEvent` so plugins can claim taps and holds before selection changes. Update typed participants to accept both event types and read touch coordinates from `event.touches[0]`. Fixed blank-area caret placement, repeated word-selection notifications, and backward native selections after edits.

Fixed touch press handling on diff separators and modified-touch definition links.
