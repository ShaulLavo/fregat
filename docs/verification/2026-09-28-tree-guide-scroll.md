# Tree guides during scrolling

The row window's clip was calculated from React's last scroll snapshot. Native scrolling could move that clip beneath the pinned folders before React committed again. A browser test reproduced flow rows painting into the sticky stack after an 8px scroll with layout updates held back.

The clip now follows a native `ScrollTimeline`. Its keyframes account for the window pinning at either overscan edge. Sticky folders, transparent backgrounds, and native wheel/touch input retain their existing layout. Browsers without `ScrollTimeline` update clipping directly on scroll events; compositor synchronization was verified in Chromium only.

Validation:

- 45 Chromium browser tests passed across `tree-parity-scroll-menu`, `tree-parity-touch`, and `tree-view`. Coverage includes ±8px and ±120px scrolls while React updates are held back, wheel input and touch panning over pinned folders, keyboard focus, menus, and rename.
- Web typecheck and all repository gates passed.
- Extended `tree-sticky-scroll` with fast wheel bursts in both directions. Inspected `10-fast-down.png` and `11-fast-up.png` in `/work/tmp/fregat-evidence/20260928T104830Z-scenario-tree-sticky-scroll/`.
- Baseline reproduction: `/tmp/fregat-evidence/20260928T104120Z-scenario-tree-sticky-scroll/`. Settled screenshots alone did not expose the between-frame overlap; the held-layout browser test did.

The final scenario produced no server warnings/errors. Browser warnings were adapter discovery, a capture-related GPU readback warning, and an LSP WebSocket closed while switching files, also present in the baseline.
