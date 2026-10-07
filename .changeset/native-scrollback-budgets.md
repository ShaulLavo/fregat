---
'ghostty-webgpu': patch
---

Document scrollback as native page-granular retention and expose its byte budget through core, session, and appearance APIs. Zero bytes disables history. Actual row counts remain shared by history reads, selection, scrolling, and accessibility, with selection observers updated after output, reflow, and budget-driven pruning. Validate complete appearance updates before native changes and keep state notifications current when observers perform nested mutations.
