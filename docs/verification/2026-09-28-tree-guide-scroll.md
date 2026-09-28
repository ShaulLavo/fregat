# Tree guides during scrolling

The row window's clip was calculated from React's last scroll snapshot. Native scrolling could move that clip beneath the pinned folders before React committed again. A browser test reproduced flow rows painting into the sticky stack after an 8px scroll with layout updates held back.

The first fix, `b72d40b8c`, animated the clip on a `ScrollTimeline`. It passed the initial tests and was deployed, but the owner still saw the defect. A capture of the owner's exact live address with 6× CPU throttling recorded an 8px clip mismatch. Evidence: `/work/tmp/fregat-evidence/20260928T105428Z-scenario-tree-scroll-live/frames.json`, frame 5. This invalidated the initial completion claim.

The replacement puts rows inside a viewport-sized sticky clipping wrapper below the pinned folders. The clipping boundary is structural. The native scroll timeline translates the row window inside it, clamped at both ends to keep the viewport filled while React catches up. Browsers without `ScrollTimeline` update the transform on scroll events. The sticky folders remain inside the original native scroller, preserving wheel and touch input.

Validation:

- All 88 tree browser tests passed. The seam tests hold back both React updates and the scroll animation during ±8px and ±120px scrolls. Other coverage includes wheel input and touch panning over pinned folders, drag/drop, keyboard focus, menus, rename, collapse, and list boundaries.
- The replacement's development capture recorded 45 frames with zero seam or coverage errors under 6× CPU throttling. Screenshots and screencast frames were inspected: `/work/tmp/fregat-evidence/20260928T110149Z-scenario-tree-sticky-scroll/`.
- `tree-scroll-live` is a read-only scenario for an existing workspace address. It records the loaded release, browser, screencast frames, and per-frame geometry. `tree-sticky-scroll` uses the same capture after its setup.
- The scenario produced no server warnings/errors. Browser warnings were adapter discovery, a capture-related GPU readback warning, and an LSP WebSocket closed while switching files, also present in the baseline.

## Migration history audit

The clipping formula originated in `73d81b4c4` on September 14, before the recent migration. PRs 135 and 141 moved and extracted it without changing the formula. The original rationale was stopping text from painting through transparent sticky folders; see `2026-09-14-tree-sticky-clipping.md`.

[PR 171](https://github.com/ShaulLavo/fregat/pull/171) changed guide drawing from borders on spacing elements to absolute spans in `TreeRowLead`. [PR 177](https://github.com/ShaulLavo/fregat/pull/177) recorded approximately 1.1ms more React work per wheel from `ListRow`, accepted because its measured dropped-frame and long-task counts did not increase. These changes could expose an older timing defect, but that causal link has not been demonstrated.

An earlier light-DOM migration slowdown was found and repaired before landing: recorded style work fell from the regressed 478ms to 137ms, against a 162ms baseline. PR 192's review also repaired obsolete benchmark calls and verification-harness defects. The targeted history review found no additional confirmed current product regression. Static parity screenshots and aggregate timing measurements did not cover the faulty intermediate-frame seam.

Sources searched: git history through file moves, PR descriptions and discussions, migration plans, and prior verification notes. No dedicated error tracker, chat history, or product analytics source was available. This is a targeted audit of scrolling, row drawing, and related migration changes, not an exhaustive audit of every file-tree feature.
