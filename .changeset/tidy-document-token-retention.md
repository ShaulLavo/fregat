---
'@singapore-editor/core': patch
---

Added `tokenStoreBackingBytes` to `documentAnalysis.inspectRetention()` and its entry reports to count shared packed buffers once, including lazy token end indexes after allocation; worker heaps and WASM remain unmeasured.

Added `documentAnalysis.inspectLeases()` for count-based cleanup that reads lease metadata without inspecting token results.

Fixed editing after highlighting retries fail to keep the plain-text fallback interactive until an explicit refresh or provider configuration change retries highlighting.
