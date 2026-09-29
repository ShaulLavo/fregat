# E019 undo graph viewer

E019 is complete on 2026-09-16. `historyViewer.ts` in the editor package is the framework-neutral
model: focus, up to two selected states, a cancellable comparison and a deterministic lane layout.
The demo app under `examples/app` renders it as a History panel with keyboard traversal, a diff
between two selected states and an explicit Restore. The execution plan has been removed; the graph
it browses is [undo-graph.md](undo-graph.md) (E017).

## Contracts that remain

- `createHistoryViewer(buffer, { compare })` subscribes to exactly the supplied buffer and reads
  `getHistoryGraph()` on every change, ignoring events whose graph revision did not move. State is
  the graph, `focusedId`, `selectedIds`, `comparison` and `lostIds`.
- Focus rides along with the current state until the user moves it elsewhere. `focusParent`,
  `focusChild` (preferred child first), `focusPrevious` and `focusNext` (sequence order) and
  `focusCurrent` never touch the buffer. Pruning a focused or selected state lists it in `lostIds`
  for that refresh and returns focus to the current state.
- `toggleSelection` keeps at most two ids in selection order; a third replaces the oldest. Two
  selected states request one comparison through `compare(left, right, signal)`. A request
  captures the ids and node revisions it saw and a generation; a result published later is dropped
  if a newer request exists, and an amended node's new revision re-requests. Deselecting aborts the
  pending request through its signal. An explicit focus, selection or clear acknowledges a
  pruning notice: `lostIds` empties, so a valid pick shows its preview again.
- `restore(id, sourceView)` is `checkoutHistoryState` on the buffer and nothing else; previewing
  and browsing never edit. `dispose` unsubscribes, aborts and drops the node index.
- `layoutHistoryGraph(graph)` puts sequence order on the x axis and lanes on the y axis: a node
  continues its parent's lane when it is the first child placed there, every later sibling opens
  the lowest lane no branch tip still owns. It is recomputed only when the graph revision moves.
- The demo compares by materializing both snapshots into `createTextDiff` with two lines of
  context, refuses past two megabytes with a visible "too large" result, and yields once before
  reading text so a burst of selections settles first. Its hunks print with `+` and `-` prefixes.

## Evidence

- `packages/editor/test/historyViewer.test.ts` covers the lane layout, focus traversal without a
  buffer revision change, restore reaching a second attached view as one `'checkout'` change with
  redo afterwards following the restored branch, a late comparison result being dropped, a
  re-request after an amend, pruned ids and focus recovery, focus following the current state, and
  disposal.
- `examples/app/test/history.spec.ts` drives the real panel in Chromium: type A, undo, type B,
  open History, ArrowUp to the A state, Enter restores it and the editor shows `abcA`; Shift+click
  two states and the diff shows `-abcA` and `+abcB`.
- The graph layout was compared against a plain list on the same fixture in the demo: the graph
  strip shows the fork at a glance, the list carries the labels; the panel shows both, which is the
  shape the Platform pane adopts.

## What is left

- The panel pins nothing beyond the graph's own snapshots, but a host with a diff editor should
  drop both materialized texts after rendering; the demo keeps them only inside the diff result.
- Restore across a workspace-edit barrier stays unavailable; the graph shows the barrier and the
  host offers its own workspace undo.
