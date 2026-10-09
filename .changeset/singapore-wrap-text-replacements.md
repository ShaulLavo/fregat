---
'@singapore-editor/core': patch
---

Breaking: `InlineReplacementRender` receives the display text as its second argument. Update direct renderer calls to pass that text. Added `wrap: 'text'` to split textual replacements into independently rendered row fragments while ordinary widgets keep their existing wrapping behavior.
