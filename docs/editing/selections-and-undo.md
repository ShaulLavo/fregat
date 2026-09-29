# Selections & Undo

## Selection Model (Locked: Anchor-Based)

Editors need cursor positions and selected ranges that survive edits. Anchor-based selections are
structurally stable — no rebasing is required at call sites.

### Selection Type

Generic over position type: `Selection<T>` with `id`, `start: T`, `end: T`, `reversed`,
`goal: SelectionGoal`, and `affinity: SelectionAffinity`.

- `reversed`: selection created by moving backward
- `goal`: preserves horizontal intent for vertical movement
- `affinity`: identifies which logical side owns the selection head when one offset has two valid
  visual caret positions

### SelectionGoal

- **none** — no sticky position
- **horizontal** — row-local CSS pixel x-coordinate for vertical arrow/page movement
- **lineEnd** — preserve the logical end-of-line aim through vertical movement

`SelectionGoal` lives with selection state because it describes the active selection's movement
intent. Pixel values are display-derived; the position layer never depends on them.

Column selection is represented by the ordinary selections it creates, not by a `SelectionGoal`
variant.

### Caret Affinity

`SelectionAffinity` is `'before' | 'after'`. It belongs to the head, not to both ordered range
endpoints: `before` chooses the ending edge of the logical content before the offset and `after`
chooses the starting edge of the logical content after it. The distinction is observable at BiDi
run boundaries and wrap seams, where one UTF-16 offset can have two valid screen positions.

Affinity defaults to `after` when a caller creates a selection without one. Existing selections
must preserve it whenever their endpoints are rebuilt; genuinely new caret positions choose an
affinity from the operation that created them. Directional landings use the inside affinity at
document/line edges, and browser hit testing supplies affinity for pointer-created carets.

Affinity round-trips through anchors, history, explicit post-edit selections, plugin contribution
contexts, and the React and Solid command/controlled-selection APIs. Public
`Editor.setSelection(anchor, head?, options?)` accepts `affinity`, `reveal`, and `revealOffset` in
one options object. The public editor setter reveals the head by default; contribution setters are
reveal-opt-in. An explicit `revealOffset` is the reveal target and takes precedence over the boolean
default. The deprecated numeric reveal argument remains accepted as shorthand for
`{ revealOffset: number }`. `Editor.edit(..., { selection })` accepts affinity independently of
reveal behavior.

### Storage

Active selections live in a `SelectionSet<Anchor>`. The set also records the last-added selection
and whether it is normalized for a particular snapshot. Anchor-backed selections remain durable
across edits and resolve to screen coordinates at paint time.

**Normalization invariant:** document-sorted with no mergeable overlaps. This is a derived property,
not an eagerly maintained one; affinity-distinct carets may deliberately share an offset.

### Multi-Cursor

Multiple `Selection<Anchor>` entries. A cursor with no visible selection has start and end resolving
to the same offset. Collapsed caret identity includes affinity, so two carets at one offset remain
distinct when one is `before` and the other is `after`.

### Lazy Normalization

Demand-driven, not per-edit.

**Must normalize:** before multi-selection edits, after edits that may cause overlap/reordering, and
before consumers that rely on document order or non-overlap. APIs that accept an externally rebuilt
set normalize before pairing it with source metadata.

**Can skip:** single-cursor typing/deletion/navigation and edits provably contained within one
selection's span.

**Dirty-flag model:** edits mark a set dirty; consumers normalize on demand. The normalized flag is
scoped to the snapshot used for normalization, so a normalized selection set from one snapshot must
be normalized again before use with another snapshot.

### Normalization Semantics

- Resolve every selection to offsets in the current snapshot.
- Sort by resolved start, then resolved end. At the same collapsed offset, `before` sorts before
  `after`; id is the final tie-break.
- Merge overlapping non-empty ranges, but keep ranges that only touch at an edge separate.
- A collapsed cursor touching a non-empty range is absorbed by that range. Duplicate collapsed
  cursors with the same affinity merge; opposite affinities at the same offset remain distinct.
- A merged range keeps the last-added participant's `id`, direction, goal, and affinity. If neither
  participant is last-added, the first one in resolved order steers the survivor.
- Normalization carries `lastAddedIndex` to the surviving selection so subsequent multi-cursor
  gestures continue from the cursor the user last added.
- Collapsed selections are never reversed.
- Deleted anchors are normalized through their resolved visible gap offsets. Normalization may replace
  deleted endpoint anchors with live anchors at the resolved offsets.

### Risks

- Large multi-cursor sets cost O(k log n + k log k): resolve k anchors against the piece tree, then
  sort k selections
- Dirty-flag must be conservative (false positives OK, false negatives = bugs)
- Normalization must never infer visual caret identity from an offset alone

---

## Batch Edits

Atomic multi-edit for multi-cursor typing, find-replace, format-on-save.

**Ordering contract:** offsets against _original_ snapshot. Implementation adjusts internally. No overlap allowed.

**Implementation:** sort descending, apply sequentially. One snapshot + one undo entry.

**Cost:** O(k log n) for k edits.

### Selection-Aware Editing

Initial command surface:

- replace every active selection/cursor with the same text
- delete selected ranges
- backspace collapsed cursors at grapheme-aware delete boundaries, with indentation-aware tab-stop
  deletion

Text replacement and deletion paths normalize first, produce non-overlapping offset edits against
the original snapshot, apply them through `applyBatchToPieceTable`, then collapse each affected
selection to its post-edit caret while preserving id, goal, and affinity. Indent and outdent instead
project both original endpoints through their edits, preserving selection shape and direction.

Backspace computes one target for every original selection, coalesces overlapping deletion ranges
only for the piece-table batch, then projects every target through those edits. This keeps
affinity-distinct carets, last-added identity, and document-start no-op carets even when several
targets share one physical deletion. Undo and redo restore the resulting selection set with the
snapshot.

---

## Edit Representation

`Edit<D>`: `old: { start: D, end: D }`, `new: { start: D, end: D }`. For buffer ops, D = Offset.

`Patch`: ordered non-overlapping Edits. Composable: `compose(A, B)` = old-to-new directly.

Consumers: decoration rebase, display layer invalidation.

**Current edit type:** `TextEdit` in `packages/editor/src/tokens.ts`.

---

## Undo / Redo

### Snapshot-Based

Two stacks (undo, redo). Edit pushes current to undo, clears redo. Undo pushes to redo, pops undo.

With anchor resolution: snapshot = `(root, reverseIndex)` tuple. Switch = O(1) swap. Memory-efficient via structural sharing.

Phase 3 stores snapshots and selection state together in history entries. Undo and redo stacks are
linked stacks so push/pop snapshot switching stays O(1). This keeps selection restoration explicit
while preserving the anchor property that selections can still resolve across snapshots.

### Anchor Identity Across Undo

Anchors reference immutable buffers, not the treap. Resolvable against any snapshot. Same anchor may be live/deleted depending on snapshot. Undoing deletion restores liveness.

### Serialized History

`buffer.serializeHistory()` returns the graph as plain data and `buffer.restoreHistory(data)`
rebuilds it over a freshly created buffer, so a host can keep undo across a close or a reload.
No text is stored: each state carries the edits from its parent and their inverse, and the
restoring buffer's own text stands in for the current state. Restore climbs to the root with
the inverse edits, then fills the other branches forward. A recorded transaction is reused only
when it spans exactly parent to state; a state replaced outside the graph is diffed instead.
Selections are stored as offsets, because anchors do not outlive their buffer. Only a buffer
with no history of its own accepts one, and the host vouches that the text matches (a content
hash); the length check and the batch's range checks catch data that cannot fit.

### Future: Operation-Based Undo

For collaboration: individual operations must be reversible without affecting concurrent ones. Deferred.
