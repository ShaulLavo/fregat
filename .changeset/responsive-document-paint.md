---
'@singapore-editor/core': patch
'@singapore-editor/markdown': patch
---

Added `Editor.captureSnapshot({ scope: 'document' })` and the `@singapore-editor/core/paint` entry to capture complete content-layout documents and replay their text, styles, links and gutters at a new width. Unsupported preview content returns an explicit refusal.

Added stable heading anchors to Markdown preview and preserved heading names and anchors in document paint.
