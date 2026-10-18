---
'ghostty-webgpu': patch
---

Added the `outputTiming` terminal event. For each burst of written output it reports the last typed input before it, the first and last write, when a frame drew the output and when the browser's page update carried it, all as `performance.now()` times. Bursts end after `outputTiming.quietMs` (default 100) without output, input counts within `outputTiming.inputWindowMs` (default 2000), and timing is recorded only while a listener is attached. `TerminalDataEvent` gains `origin`: `'input'` for typed, pasted, mouse and `sendInput` data, `'reply'` for the terminal's own answers and focus reports.
