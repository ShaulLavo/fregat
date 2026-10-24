# Anchor System

## Semantics

- Anchors are stable references into immutable buffers
- Structurally immutable — never change across edits
- Resolved relative to a snapshot
- Always resolve to a document offset
- Deterministic: given (anchor, snapshot), resolution always produces the same offset and liveness
- May refer to live or deleted text
- Deletion changes liveness, not identity
- Liveness determined at resolution time, not creation time
- Bias (left/right) controls boundary behavior at insertion points
- An anchor may be live in one snapshot and deleted in another (e.g., across undo/redo)

### Why anchors

- Eliminates rebasing at call sites
- Natural fit with piece table's immutable buffer model
- Proven in Zed at scale
- Liveness model gives consumers clear information

### Alternatives evaluated

1. **Explicit rebasing (CodeMirror-style):** Every call site must remember to rebase. Subtle bugs when forgotten.
2. **Interval tree tracking (VS Code-style):** Central maintenance cost and registration overhead.
3. **Offset-only (current state):** Meaningless after any edit.

---

## Creating Anchors

`anchorAt(snapshot, offset, bias)`:

1. **Validate offset.** Must be at a code-point boundary — rejects mid-surrogate-pair offsets.
2. Walk the tree to find the containing Piece.
3. Compute buffer-relative offset: `piece.start + (offset - pieceStartInDocument)`.
4. Return `{ buffer: piece.buffer, offset: bufferRelativeOffset, bias }`.

Always creates a real anchor. Never returns sentinels. Callers wanting absolute start/end must use `Anchor.MIN` / `Anchor.MAX` explicitly.

Convenience: `anchorBefore` = left bias, `anchorAfter` = right bias.

### Anchor Bias Is Not Caret Affinity

`AnchorBias` (`left`/`right`) controls how a durable storage position resolves when edits insert or
delete text at its boundary. `SelectionAffinity` (`before`/`after`) controls which painted caret a
selection head owns when one logical offset has multiple visual positions. They are orthogonal: an
anchor can resolve to the same offset while the selection affinity changes, and normalization must
not merge affinity-distinct carets merely because their anchors resolve together. See
[Selections & Undo](../editing/selections-and-undo.md#caret-affinity).

**Reference:** Tree walk and buffer structure in `packages/textbuffer/src/pieceTable.ts`. Piece type in `packages/textbuffer/src/pieceTableTypes.ts`.

---

## Deletion and Bias Rules

Resolution produces `ResolvedAnchor`: `{ offset, liveness }`.

- **Live:** exact visible position. Liveness = `live`.
- **Deleted:** gap where text used to be. Liveness = `deleted`.
- **Bias at gap:** Left = left edge, Right = right edge. The gap of a deleted piece reaches, on each side, to the nearest piece whose buffer is no newer than its own: another part of the same insert, or text that was there when it was inserted. Text between arrived later, so bias decides which side of it the anchor takes. An insert deleted whole has no other piece of its own buffer, so the gap is bounded by the older text around it, never by the document's start or end.
- **Where text lands:** an insert goes after the last visible piece ending at its offset, and a replacement's text where its hidden text began. Neither goes between two tombstones, so the side a deleted anchor takes never depends on the tree's shape.
- **Replacement (delete + insert):** delete-first, then insert. Left-biased stays before new text; right-biased stays after.
- **Boundary clamping:** clamps to 0 / document.length at document edges.
- **Deterministic** for a given (anchor, snapshot) pair.
- **Replacement is not a special case.** Fully defined by delete-first + bias.

### Deletion Representation

Deletes preserve anchor-resolvable identity by keeping deleted pieces in the tree as invisible pieces.

- `Piece` gains `visible: boolean`.
- Delete marks the affected visible pieces invisible instead of physically discarding them.
- User-facing document length and offsets use visible length only.
- `subtreeVisibleLength` is the canonical prefix-sum aggregate for document offsets.
- `subtreeLength` remains physical buffer span length for internal traversal/debugging.
- Collaboration can reuse the same visibility model; no separate deleted-span history index exists.

This is required for deleted anchors to resolve deterministically. If deleted pieces were physically removed, the current direct-node reverse-index design would have no snapshot-local place to find the deleted buffer span.

Maintenance compacts each run of adjacent invisible pieces. Tombstones whose deleted anchors resolve alike share one textless **stand-in**, and the reverse index leads their entries to it; every anchor resolves exactly as before. See [tombstone compaction](../storage/e006-tombstone-compaction.md).

### Boundary Creation

When `anchorAt(snapshot, offset, bias)` lands exactly between two visible pieces:

- left bias anchors to the end of the piece on the left
- right bias anchors to the start of the piece on the right
- at document boundaries, real anchors still use real boundary pieces when available
- callers that need absolute document start/end independent of content use `Anchor.MIN` / `Anchor.MAX`

---

## Resolution Architecture

The reverse index is not a second persistent tree keyed by `(buffer, piece.start)` with entries that point at pieces: that design cost twice the sequence tree's write cost. See the [reverse-index cost report](../performance/e039-reverse-index-cost.md). The index works as follows.

### 1. The sequence tree finds original text

The tree is enriched with `subtreeVisibleLength`, the prefix sum for document offsets, with `subtreeOriginalLength`, the same sum over the original buffer's pieces, and with `subtreeMinBuffer`. The original buffer's pieces tile it in document order, so an anchor into original text is found by one descent, with no index entry and no index write when original text is cut.

### 2. A persistent vector finds inserted text

Buffer ids are dense and the newest is always next, so inserted buffers are indexed by a persistent vector with a shared tail: a new buffer is an append that copies nothing on a linear history. A slot holds the order of the buffer's only piece, or a small tree of `start → order` once the buffer is cut. Entries hold no visibility and no length, so tombstoning and typing write nothing. The order leads to the piece by one descent of the sequence tree.

**Why Fenwick rejected:** Flat arrays with no structural-sharing seam — incompatible with persistent snapshots. Also duplicates info already in the tree.

### Resolution flow

1. If sentinel, return immediately.
2. Find the piece: by original offset for the original buffer, by the index's order otherwise. The same descent yields the visible length before it.
3. Live visible piece: that prefix plus the offset within the piece.
4. Invisible piece: return deleted liveness and move the prefix to the gap edge bias selects, skipping newer text by `subtreeMinBuffer`.

---

## Snapshot Consistency

Snapshot = `(root, reverseIndex)` tuple. Both immutable to their holder. Undo/redo = O(1) swap.

| Structure     | Per-edit cost                                                                    | Memory per delta |
| ------------- | -------------------------------------------------------------------------------- | ---------------- |
| Sequence tree | O(log n) nodes (already happening)                                               | ~100 bytes/node  |
| Reverse index | One slot per new buffer; a short path per 16 buffers or per cut of inserted text | one slot         |

**GC safety:** The reverse index holds orders, not nodes, and its tail is shared with newer snapshots of the same history. Dropping a snapshot drops its root and its view of the index. **Invariant:** snapshots must be retained/discarded as complete tuples — never expose roots individually.

### Comparing Anchors

`compareAnchors(snapshot, a, b)` resolves both to offsets. Same offset: left bias < right bias.

---

## Consumer Use

| Consumer                         | Uses anchors?                                |
| -------------------------------- | -------------------------------------------- |
| Selections, folds, widgets       | Yes                                          |
| Layout                           | No (offsets/Points only)                     |
| Dense decorations (syntax, lint) | Coarse only (per-line/region, not per token) |

---

## What Still Needs Validation

- Write-path overhead constant factor and GC pressure under rapid editing
- Deleted resolution against real editing patterns (delete-and-retype, replace, multi-cursor)
- Debug inspector for opaque anchors
- Memory characteristics of thousands of small anchor objects in GC'd runtime
- Whether Zed model translates to JS (ownership semantics, zero-cost abstractions absent)
