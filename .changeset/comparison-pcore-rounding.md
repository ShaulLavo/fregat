---
'ghostty-webgpu': patch
---

Terminal comparisons on macOS no longer discard a measurement when a process's fast-core time comes out a few nanoseconds above its total CPU time because of unit-conversion rounding.
