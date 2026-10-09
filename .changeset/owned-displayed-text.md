---
'ghostty-webgpu': patch
---

Breaking: `submittedFrame` now contains frame metadata only; read displayed text with synchronous `visibleLines()` or subscribe with `onText(({ frame, rows, rowPatches }) => …)`, disposing the returned subscription when finished. Displayed text and public renderer `onTextFrame` snapshots remain readable after later frames or disposal; `onText` delivers accepted frames in order after opening, and failures before frame acceptance preserve prior metadata, lazy text and styled snapshots. WebGL and WebGPU create owned text on demand, and accessibility is opt-in through `accessibility: {}` or `setAccessibilityEnabled(true)` with its text subscription released when disabled.
