---
'ghostty-webgpu': patch
---

Document scrollback as native page-granular retention and expose its byte budget through core, session, and appearance APIs. Zero bytes disables history. Actual row counts remain shared by history reads, selection, scrolling, and accessibility, with selection observers updated after budget-driven pruning.
