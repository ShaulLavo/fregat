---
'@singapore-editor/core': patch
'@singapore-editor/plugin-ui': patch
---

Changed touch selection to use editor-owned word, line and document selections with double, triple and quadruple taps, long-press dragging and edge scrolling. Added input gesture events and selection commands for optional plugins. Added `createTouchSelectionPlugin` in `@singapore-editor/plugin-ui` with Cut, Copy, Paste, Select all, available Undo/Redo actions, custom items and optional supported haptic feedback.
