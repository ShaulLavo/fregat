# Position Types & Conversions

## Position Hierarchy

| Type       | Purpose                                           | Durability                              |
| ---------- | ------------------------------------------------- | --------------------------------------- |
| **Offset** | UTF-16 code unit index into document              | Ephemeral — invalid after any edit      |
| **Point**  | `{ row, column }` logical document coordinate     | Ephemeral — valid only for one snapshot |
| **Anchor** | `{ buffer, offset, bias }` into immutable buffers | Durable — survives arbitrary edits      |

### Offset

Zero-indexed UTF-16 code unit offset from document start. The piece table's native coordinate. All other position types convert through Offset as an intermediary.

Not every valid offset is a valid anchor point. Offsets can address any code unit, including mid-surrogate-pair. Anchor creation enforces code-point boundaries.

### Point

Logical document coordinate: `row` is the zero-indexed buffer line and `column` is the zero-indexed
UTF-16 code-unit offset from that line's start. A Point contains no display x, wrap-row identity, or
BiDi caret affinity. It is ephemeral and valid only for the snapshot that produced it; display
geometry is derived separately from mounted rows. Wrapping, inline projection, and BiDi layout can
map one Point to another display row or to more than one valid x position selected by affinity.

### Anchor

Durable position reference that survives arbitrary edits. Points into immutable buffer storage. Never requires rebasing.

See [Anchors](anchors.md) for full semantics.

### Sentinel Anchors

`Anchor.MIN` (always offset 0) and `Anchor.MAX` (always document length). NOT the same as real anchors at document boundaries — sentinels ignore bias. Opt-in only; `anchorAt` never returns them.

### Display Position Types

Each display transform layer may introduce its own branded type (structurally identical to Point but tagged). First concrete type: **FoldPoint**. See [Display Transforms](../display/transforms.md).

---

## Line-Break Augmentation

### Problem

The treap has no way to convert between offsets and row/column positions without scanning for newlines. Row-based operations are O(n). Unacceptable.

### Design

Extend treap aggregates to track newline counts. O(log n) conversion.

**Normalization (locked):** All input normalized to `\n` at system boundary. Piece table assumes `\n`-only.

**Piece-level:** Each Piece gains `lineBreaks` field (computed at creation by scanning buffer slice).

**Treap-level:** Each node gains `subtreeLineBreaks`, maintained in the same aggregate pattern as `subtreeLength` (see `packages/textbuffer/src/pieceTable.ts`).

### offsetToPoint

Walks treap using `subtreeLineBreaks` to count newlines preceding target. O(log n). Within final piece, linear scan for column.

### pointToOffset

Seeks to target row via `subtreeLineBreaks`, adds column. Clamps column to line end if out of range.
Both ends of the row come from one descent (`findLineRange`, E046): the break that ends the row is
in the piece the descent lands in, or it is the first break after it, found by walking on from the
landing. `lineRange` and `readPieceTableLine` are the same lookup; a row inside one piece is sliced
straight from that piece's chunk.

---

## Conversion Functions

| Function      | Input         | Output         | Complexity                    |
| ------------- | ------------- | -------------- | ----------------------------- |
| offsetToPoint | Offset        | Point          | O(log n)                      |
| pointToOffset | Point         | Offset         | O(log n)                      |
| anchorAt      | Offset + Bias | Anchor         | O(log n)                      |
| resolveAnchor | Anchor        | ResolvedAnchor | O(log n)                      |
| anchorToPoint | Anchor        | Point          | resolveAnchor + offsetToPoint |
| pointToAnchor | Point + Bias  | Anchor         | pointToOffset + anchorAt      |

All conversions funnel through Offset. N types = 2N functions, not N^2.

### Open question

Whether offset-first creates unnecessary round-trips for Point-heavy consumer code. May need mixed model: offset as write-path canonical, line/column cached for render-facing code.
