---
'ghostty-webgpu': patch
---

Breaking: `submittedFrame` now contains frame metadata only; read displayed text with synchronous `visibleLines()` or subscribe with `onText(({ frame, rows, rowPatches }) => …)`, disposing the returned subscription when finished. WebGL and WebGPU retain changed native rows incrementally and create owned text on demand; returned rows remain valid after later frames or terminal disposal, and failed submissions preserve the last accepted text. Accessibility is opt-in through `accessibility: {}` or `setAccessibilityEnabled(true)` and uses `onText` while enabled.
