---
'@singapore-editor/markdown': patch
'@singapore-editor/tree-sitter': patch
'@singapore-editor/tree-sitter-languages': patch
---

Breaking: Tree-sitter and Markdown parsing require Node.js 26.0.0 or newer, Bun 1.2.22 or newer, Chromium 144 or newer, Firefox 145 or newer, or Safari 26.2 or newer.

Improved memory growth so retained `heap()` views stay attached and track the new heap length.

Fixed Markdown extension access above 2 GiB and semantic decoding from resizable memory by updating `tree-sitter-md` to 0.1.6.
