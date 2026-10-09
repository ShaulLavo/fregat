---
'@singapore-editor/core': patch
---

Added `tokenStoreBackingBytes` to `documentAnalysis.inspectRetention()` and its entry reports. Packed token backing buffers are measured once across shared results; worker heaps and WASM remain explicitly unmeasured.
