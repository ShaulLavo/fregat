---
'@singapore-editor/core': patch
---

Breaking: `InlineReplacementRender` receives the display text and its starting offset within the replacement. Update direct renderer calls to pass that text and `0` for a complete replacement. Added `wrap: 'text'` to split textual replacements into independently rendered row fragments while ordinary widgets keep their existing wrapping behavior.
