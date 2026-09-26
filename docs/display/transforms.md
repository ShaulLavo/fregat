# Display Transforms

## Problem

Buffer coordinates (row/column in actual text) differ from screen coordinates. Folded code, inline
replacements, expanded tabs, and wrapped lines create divergence. The editor must convert between
these spaces.

## Indexed display projection

Each `VirtualizedTextView` owns a `DisplayProjection` over one immutable `TextSnapshot` and its
fold, inline, injected-row, wrap-width, and tab-size configuration. The snapshot remains the text
authority. The view has no document-sized display-row array or line-start array.

The projection uses an AVL sequence with source-line and display-row counts in each subtree.
Plain and folded spans occupy runs. Wrapped lines occupy blocks of at most 256 source lines,
with typed prefix counts and optional tabbed wrap checkpoints. Inline replacements and injected
rows have sparse line entries. Leaves contain relative columns and counts; row lookup derives
absolute offsets from the current snapshot. An edit splices source-line ranges without shifting
unchanged suffix entries.

`TextSnapshot.lineCount`, `lineStart`, and `lineAt` provide source rank/select. Piece snapshots reuse
the buffer newline indexes; detached string snapshots build an explicit source-owned index once.
Original-piece creation builds its index while counting newlines; append-buffer indexes remain lazy.
The first buffer-index scan is recorded as `textSnapshot.sourceIndex`, separately from projection
text reads. `LineStartsView` delegates to these methods. Its `toArray()` is an explicit export for
consumers that need a dense source index; painting and geometry do not call it.

### Lookup and materialization

| Method                                          | Result                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `rowCount`                                      | Exact vertical row count; uniform row height remains the geometry rule.   |
| `getRowMetrics(index)`                          | Source range, columns, and row metadata without reading row text.         |
| `rowForOffset(offset, bias)`                    | Display row containing a source offset, with wrap-boundary bias.          |
| `rowForBufferRow(row)` / `bufferRowForRow(row)` | Source/display row mapping through folds and injections.                  |
| `nextDocumentRow(index, step)`                  | Adjacent document row, skipping injected runs.                            |
| `getRow(index)`                                 | Row content handle, cached for painting or an explicit geometry query.    |
| `getRowTextWindow(index, start, end)`           | A requested display-text slice.                                           |
| `materializeWindow(start, end)`                 | Rows for the requested viewport window, with the end excluded.            |
| `retainWindow(start, end)`                      | Eviction outside the current viewport and overscan, without reading text. |
| `update({ before, after, edits })`              | One final revision from normalized edits in the common pre-edit space.    |
| `reconfigure(input)`                            | Local transform changes, or an explicit reset for a replacement snapshot. |

The row cache retains at most 256 rows and 1 MiB of row strings. Scrolling evicts the previous
window. A zero-height viewport clears the cache and does not materialize rows. Disposal releases
the projection's source and transform references. Source and display ranks have distinct branded
types at the sequence-index boundary.

Live row and chunk `text` values are `TextContent`: a string for small materializations, or a
`RangeText` for large content. `length`, `charAt`, `charCodeAt`, and `codePointAt` work on either;
`slice(start, end)` explicitly reads a string. Range-backed measurements read immutable source
ranges and reuse numeric metrics. Horizontal painting reads bounded windows and keeps inline
widget boundaries intact. Consumers must use mounted chunks when they need paintable text.
There is no implicit string conversion or full row iterator.

`InlineRow` contains source/display lengths and mapping segments. `createInlineRow` remains a
small-input materializer returning `MaterializedInlineRow`; the projection builds the same mapping
without assembling the whole line. The old eager row algorithm lives only in
`test/oracles/displayTransforms.ts` for differential tests.

### Invalidation and remaining global work

Ordinary rendering forwards document snapshots into the view. Single edits use the same projection
transition contract as batches. [E032 batch rendering](../performance/e032-edit-batches.md)
delivers every applied edit in one original-to-final snapshot transition. An already
adopted session target is a no-op; a view that missed the transaction's source revision resets from
the immutable target rather than applying an edit in the wrong coordinate space.

Edits rebuild affected summaries and splice them into the sequence. Transform changes compare sparse
metadata and replace changed source ranges. Edits hidden inside an unchanged fold do not remeasure
its visible output. Every geometry and painting consumer sees the final document/layout pair.

A cold wrap configuration still inspects visible source lines to calculate exact counts. Width and
tab-size changes rebuild those numeric summaries, with source reads bounded to 16 KiB windows.
Tabbed lines retain numeric segment checkpoints. Fold, inline, and injection configuration changes
still inspect sparse transform metadata. Long-line width and BiDi classification can inspect source
text through shared measurements. These costs are separate from row/string materialization.
Horizontal extent still follows observed rows rather than a whole-document maximum-width scan.

Live snapshots retain content handles. `toVisibleSnapshot()` captures mounted paint parts and stays
bounded to mounted content. A live snapshot has no `toJSON()` or `fullText`: whole-view JSON comes
only from `serializeEditorViewSnapshot(snapshot)`, which reads the captured revision's full text and
source line starts on purpose (E033). E034 owns fallback indentation-fold discovery.

Measurements and commands are recorded in [the E031 performance report](../performance/e031-projection.md).

## Decision: Proceed With Layered Transforms

FoldMap validated the core contract: a layer can own local state, update that state against a new
snapshot, and emit output-space invalidations tight enough for the layer above to avoid global
recomputation. The decision is **go** for the layered abstraction, with the constraint that future
layers still need their own validation before the approach is considered locked for every transform.

### Alternatives considered

1. **Monolithic display mapper:** Simpler, potentially faster, harder to test/extend.
2. **Virtual document model (VS Code-style):** Conceptually clean, memory-intensive.
3. **Ad-hoc per consumer:** Doesn't scale.

### Why layers remain viable

- Each layer independently testable
- Additive extensibility
- FoldMap validates tight invalidation for hidden regions, boundary edits, and external edits

**Honest constraint:** Some transforms (tabs, wrapping) may need to be fused in practice.

---

## Layer Interface (Proposed)

Five responsibilities:

1. **Accept edits, determine invalidation**
2. **Update local state** (invalidated portion only)
3. **Emit output invalidation** — `InvalidationSet` in this layer's output coordinate space
4. **Coordinate conversion** — `toThisLayer(point, bias)` and `fromThisLayer(point, bias)`
5. **snapshot()** — immutable view for rendering

The key: layer must communicate **what changed in its output space**. Without this, the layer above recomputes from scratch.

### Invalidation Protocol (Proposed)

Typed ranges: `InvalidatedRange<T>` with `start`, `end`, `lineCountDelta`.

`InvalidationSet<T>` = sorted, non-overlapping ranges for the layer above to reprocess.

- **Ranges not edits:** consuming layer needs region scope, not old content
- **Per-range `lineCountDelta`:** shifts happen at specific locations; single aggregate forces full reprocessing
- **Coordinate shifting between ranges:** walk ranges accumulating deltas. O(ranges) not O(document)
- **Parameterized by `T`:** type system enforces coordinate space matching
- **Empty ranges:** no-op, layer absorbed the edit

FoldMap implements this protocol with `InvalidatedRange<FoldPoint>` records. Shared transform
primitives now live in `packages/editor/src/displayTransforms.ts`, including typed invalidations,
the common layer shape, tab column conversion, and wrap rows.

---

## FoldMap (Validation Layer)

First layer to validate the abstraction. Simplest transform: collapse contiguous regions into single-line placeholders.

Sorted array of fold ranges (start/end Anchors). Converts between buffer Points and FoldPoints by skipping folds.

### FoldMap Invalidation Analysis

| Edit location                         | Output invalidation                                                    |
| ------------------------------------- | ---------------------------------------------------------------------- |
| Inside fold (not touching boundaries) | None; anchors refresh against the next snapshot                        |
| Touching fold boundary                | Placeholder if fold survives; placeholder expands if fold is destroyed |
| Outside any fold                      | Coordinate-shifted pass-through in `FoldPoint` space                   |
| Fold toggled                          | Fold's output range                                                    |

Smallest recomputable unit: a single fold region.

### The Go/No-Go Question

Can FoldMap produce tight enough invalidation that a layer above would not need to globally recompute?

**Decision:** go. FoldMap gives no output invalidation for edits hidden inside folds, local
placeholder invalidation for surviving boundary edits, expansion invalidation when a fold is
destroyed, and pass-through invalidation for external edits. This is precise enough to continue to a
second validation layer instead of collapsing immediately to a monolithic mapper.

### Implemented after FoldMap

- Tab expansion uses configurable `tabSize` math shared with the renderer.
- Wrapping uses indexed numeric summaries and materializes segments on demand with the existing tab-column math.
- `wrapBreak: 'word'` (Editor option `wordWrapBreak`) ends a row at the last word boundary: after a
  run of spaces, beside a CJK character, or at a replacement's edge, falling back to the filling
  column for a word wider than the row. Spaces hang past the edge instead of starting a row, and a
  replacement is never split. Every line that breaks, or is wider than a row, stores explicit row
  ends (the `breaks` of a wrapped entry, shared with tabbed lines). Building the 500k-line
  `bench:transforms` fixture costs 123 ms against 69 ms for character wrap; the character path is
  unchanged.
- A proportional face wraps by measured advances (E052): `wrapAdvance` carries the row width in pixels
  and a per-face glyph table read from a canvas, and both break modes place ends where the running
  advance would pass the width less a 1 px margin. Monospace faces never build the table.

The removed block-row and block-surface APIs are not part of the transform architecture and are not
compatibility targets.

---

## InlineMap (Second Validation Layer)

FoldMap hides whole rows. InlineMap hides and substitutes _within_ a row: the primitive a markdown
live-preview view needs to paint `**bold**` as bold, `# Title` as a heading, and `![](img.png)` as an
image, while the buffer keeps holding plain markdown text.

Implementation: `packages/editor/src/inlineMap.ts` (anchored state, invalidation) and the inline
section of `packages/editor/src/displayTransforms.ts` (stateless row and column math), matching how
FoldMap's state lives apart from the shared wrap/tab primitives.

### Shape

A replacement is a single-line source span painted as substitute text. Empty text hides the span;
non-empty text stands in for it. Per buffer line, `createInlineRow` produces the display text plus a
contiguous segment list covering the whole line, so column conversion in either direction is total.

**Locked:**

- Replacements are intra-line. A span crossing a newline is a fold, not a replacement, and is dropped.
- Replacement text may not contain a newline, so **the layer never adds or removes rows**. Its own
  invalidations always carry `lineCountDelta: 0`; row deltas ride on the external-edit invalidation.
- Replacements are atomic. No display column ever resolves to a source column strictly inside one,
  and a source range overlapping any part of a replacement paints all of it.
- Overlapping replacements are rejected at normalization; the first (outermost) wins.
- Replacements do not absorb edits at their edges — start anchors right, end anchors left — so text
  typed next to `**bold**` lands outside the hidden markers. This is deliberately the inverse of
  FoldMap, whose ranges grow at their boundaries.

### Ambiguity rule

Hidden spans are zero-width in display space, so several source columns share one display column.
`display -> source -> display` is always the identity. `source -> display -> source` is not, at a
hidden boundary. The inverse resolves by bias: `before`/`nearest` to the earliest source column,
`after` to the latest. Horizontal motion passes the bias matching its direction. Bias chooses only
inside a run: the display column at a visible replacement's end always resolves to its source end,
so a step back from the column after a chip lands between the chip and the next character.

### Reveal

`revealInlineMap` drops every replacement that the caret or selection touches, plus the rest of each
touched group, and returns a derived map. Reveal is construct-scoped, not marker-scoped: a caret
anywhere inside `**bold**` unhides both fences. Because mapping and painting both read the revealed
map, they cannot disagree about what is currently hidden.

Each replacement picks its policy with `reveal`: `'touch'` (the default, edges included), `'inside'`
(a caret strictly between the edges, or a selection overlapping the interior), or `'never'`.

### Atomic replacements

A replacement with `atomic: true` is one unit to editing as well as to painting, which is what a chat
composer's mention chip needs. The view hands the atomic spans of the rendered (revealed) map to the
input layer (`VirtualizedTextView.atomicRanges`):

- Every caret move that lands strictly inside one carries on to the edge it was heading for: logical,
  word, visual and vertical motion alike.
- Backspace at its end and Delete at its start take all of it. A word delete, a selection delete and
  a soft keyboard's range deletion widen over any atomic span they would cut into.

A replacement that renders a node can carry a `key`. A mount whose key a later map still holds keeps
its node, so a provider that derives ids from offsets does not remount a widget on every edit before
it. A key repeated within one map falls back to the id.

### Triggers

`registerInlineReplacementProvider(provider, { trigger })` takes `'syntax'` (the default: rerun when
captures land, and captures stay on while it is registered) or `'edit'` (rerun inside every
operation that edits text or moves a selection, with no capture demand). The context carries the
resolved selections, so an edit-triggered provider can leave the token being typed as text.

Captures describe the text of the last parse, so a syntax-triggered provider never reruns on an edit:
the map it made is carried to the current text by its anchors and merged with what the
edit-triggered providers derive, until fresh captures land. A new document drops it and derives the
edit-triggered part from the new text at once.

### InlineMap Invalidation Analysis

| Edit location                        | Output invalidation                                  |
| ------------------------------------ | ---------------------------------------------------- |
| Inside a hidden span, no newline     | None; nothing visible changed                        |
| Touching a replacement that survives | That row, `replacement-changed`                      |
| Touching a replacement that dies     | That row, `replacement-dropped`                      |
| Outside every replacement            | Edited rows, `external-edit`, carrying the row delta |

Smallest recomputable unit: one buffer row. Merging keeps the most specific reason so a coincident
external edit cannot bury the fact that a replacement was dropped.

### Wiring

`Editor.setInlineMap` / `VirtualizedTextView.setInlineMap` install the map. The view keeps the map it
was given and derives what it renders by revealing whatever the current selections touch, so the
caret restores markdown source as it moves and re-hides it on the way out.

The invariant that makes the rest work: **a chunk's `startOffset`/`endOffset` are buffer offsets,
while `localStart`/`localEnd` and every index into row text are display indices.** Anywhere the two
used to be mixed by plain addition now goes through `rowLocalIndexForOffset` /
`rowOffsetForLocalIndex` in `virtualizedTextViewInlineMapping.ts`, which collapse to exactly the old
arithmetic when a row has no mapping. That covers caret DOM boundaries, hit testing, visual-column
motion, chunk construction, hidden-character markers, selection signatures, and token/range
highlight painting.

Native caret APIs also return display-local DOM indices. When they are unavailable or report an
overlay, measured BiDi hit testing maps its fallback local index through
`rowOffsetForLocalIndex(..., 'nearest')` and clamps the result to the row's buffer span. Raw
`row.startOffset + localIndex` is invalid for both inline insertions and replacements because their
display and source lengths differ.

The same-line and plain-row edit fast paths patch row text using buffer-space offsets, so an active
inline map routes edits to a full rebuild via `hasModelRowProjections`.

### Producing replacements

`EditorInlineReplacementProvider` is the contribution point: given the document text, its language,
and the current syntax captures, it returns `InlineReplacementSpec[]`. Providers register through the
plugin context and compose — every registered provider contributes, and the inline map resolves
overlaps outermost-first. Editor rebuilds the map whenever fresh captures settle, so a provider never
schedules anything itself.

`registerInlineReplacementProvider` is optional on `EditorPluginContext` so that adding it did not
break hand-written contexts. The plugin host always provides it; a plugin that finds it missing is
running on a host too old for the contribution and should say so rather than silently registering
nothing.

`@singapore-editor/markdown` is the first consumer. It derives replacements from the existing markdown
highlight queries, which name things generically (`punctuation.delimiter` covers both emphasis fences
and link brackets), so constructs are recovered structurally: by containment for emphasis and code
spans, by adjacency for links and images.

### Still open

- Character wrap (the default) may split a multi-character replacement across rows, which then
  paints as the text it stands for. Word wrap (`wordWrapBreak: 'word'`) keeps every replacement on
  one row; both count a replacement by its placeholder text, not the width its rendered node measures.
- Carrying a syntax-derived map re-resolves every range on each refresh; with many replacements and
  an edit-triggered provider on one editor that is O(ranges) per keystroke until Phase 4's range set.

---

## Decorations (Not Yet Designed)

Constraints defined, design deferred until anchors and selections validated.

### Known

- Range-based with style metadata
- Dense decorations (50K+ Tree-sitter highlight captures) must NOT use one anchor per endpoint
- Invalidation at least line-granular
- Different lifetimes: syntax (Tree-sitter async, high volume), lint (async, medium), transient (frequent, low volume)
- Tree-sitter is the committed source for syntax highlighting, folds, structural selection, indentation, injections, and bracket/tag matching.

### Key question: how dense decorations reference positions

Candidates:

- **Offset-based with Patch rebase:** No anchor overhead. CodeMirror approach.
- **Line-anchored + intra-line offsets:** O(lines) anchors not O(tokens).
- **Interval tree:** Query-efficient but maintenance overhead.

### Current rendering

CSS Highlight API renderer: `packages/editor/src/editor.ts`
Token types: `packages/editor/src/tokens.ts` (`EditorToken`, `EditorTokenStyle`, `TextEdit`)

### Current implementation note

The repo also contains an optional Shiki highlighter package. Transform design should continue to accept renderer-facing decoration/highlight output from whichever syntax or highlighting package a host chooses.
