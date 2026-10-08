# Anchors

An offset is a position in one document version. An anchor is a durable reference into immutable buffer storage. Resolve it against a snapshot to obtain the position and whether its text is still live there.

## Identity survives deletion

An anchor keeps its identity when text is deleted. Deletion changes its liveness. The anchor still resolves deterministically in that snapshot. An undo or another branch can make the referenced text live again.

An anchor can therefore be live in one snapshot and deleted in another. Store the anchor and resolve it when you need a current position, such as a comment target or navigation marker.

## Bias at an insertion boundary

Left and right bias determine which side of newly inserted text the anchor stays on. A range has two endpoints, and their biases determine whether typing at either edge enters the range.

Anchor bias is a storage rule. Caret affinity is a display rule for choosing a painted caret at an ambiguous visual position. Keep those decisions separate.

## Coordinate rules

Offsets count UTF-16 code units. Anchor creation snaps an offset inside a surrogate pair to the start of that code point. Offsets below zero or beyond the document length throw a `RangeError`. Validate external offsets and check conversions when your application uses byte offsets or user-perceived character counts.

In `a😀b`, offset 2 falls inside the emoji. Resolving an anchor created there returns offset 1:

```ts
import { anchorAfter, createPieceTableSnapshot, resolveAnchor } from '@singapore-editor/textbuffer'

const snapshot = createPieceTableSnapshot('a😀b')
const anchor = anchorAfter(snapshot, 2)
const resolved = resolveAnchor(snapshot, anchor)
console.log(resolved) // { offset: 1, liveness: 'live' }
```

The [anchor design](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/positions/anchors.md) explains resolution and liveness. The generated `textbuffer` reference documents creation and resolution functions.
