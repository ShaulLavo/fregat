# E020: Cursor jump history

Completed 2026-09-25. Same-document navigation has a bounded trail that survives edits.
`editor.jumpTo(anchor, head?, cause?)` records the current location and the destination.
`setSelection` also accepts `jumpCause: 'pointer' | 'find' | 'go-to-line' | 'provider'`.
Committed Find navigation and complete pointer gestures use that boundary. Find query previews
move the selection without recording jumps; Enter, Next and Previous record jumps. Ordinary
arrow movement creates no waypoint.
Multiple explicit jumps inside one operation keep its first origin and final destination.

`jumpBack()` and `jumpForward()` return whether a destination was found. The command IDs have
those same names and run through the existing keymap. The methods return false at an empty
trail or either end. Default jump shortcuts always prevent browser navigation, including when
no destination is available. Hosts can override these bindings
to supply workspace navigation. Cross-file tab and focus policy belongs to the host.
Selection correction remains available separately as `cursorUndo` / `cursorRedo`.

Windows and Linux bind Alt+Left / Alt+Right. macOS uses Control+Minus / Control+Shift+Minus,
preserving Option+Arrow word navigation. Windows/Linux rectangle expansion uses
Control+K then Alt+Left / Right. This keeps horizontal expansion on arrows while preserving
Alt+Arrow for jumps, Alt+Shift+Arrow for structural selection, and Control+Alt+Shift+Arrow
for word-part selection. macOS keeps its existing rectangle chords. Hosts can override the
shared keymap.

Each view keeps up to 50 locations. A location stores anchors, selection affinity, last-added
selection identity, and an anchored viewport with a row-relative pixel offset and horizontal scroll.
It holds no document snapshot. Each selection endpoint has anchors on both sides. Resolution
prefers the left neighbor and falls back to the right if deleted. Document boundaries survive
deletions, and an empty-document origin stays at zero when text is inserted. A waypoint is
skipped only when both neighbors of a primary endpoint are deleted. Deleted secondary
selections are removed. Deleted waypoints remain eligible after undo, within the bounded trail.
Equivalent destinations are skipped.
A new jump discards the forward tail. Destination scroll is captured after reveal.
Detach, clear, document replacement, and disposal release the trail and pending pointer capture.

Use separate `createEditorBufferSession(buffer)` sessions over one `createEditorTextBuffer(text)`
for split views: each view then has its own selection and jump trail while observing shared edits.
The [demo](../../examples/app/jump-history.html) provides Find, go-to-line, edits, and two such views.

Verification is in [jumpHistory.test.ts](../../packages/editor/test/jumpHistory.test.ts) and
[jumpHistory.browser.test.ts](../../packages/editor/test/jumpHistory.browser.test.ts): anchor drift,
deleted destinations and undo, primary selection, affinity, 50-entry eviction, forward-tail replacement,
operation coalescing, independent views, detach/reattach, trusted pointer and keyboard events,
Find, focus and viewport restoration after insertion. Existing cursor-history and column tests remain green.
