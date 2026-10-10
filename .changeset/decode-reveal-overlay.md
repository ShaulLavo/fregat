---
'@singapore-editor/decode': patch
---

Improved the `createDecodePlugin` reveals: they start the moment a file opens instead of waiting for highlighting, take colours as highlighting lands, keep playing through scrolls, and run as compositor animations. Autoregressive, parallel and token modes now write token by token behind a caret; diffusion resolves scrambled tokens in clusters. Morphs and reveals keep a repainted row hidden until they finish.
