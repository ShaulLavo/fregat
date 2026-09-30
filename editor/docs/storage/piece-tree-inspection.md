# Piece tree inspection

The opt-in `@singapore-editor/core/debug` entry point exposes tree diagnostics. No edit calls the checker,
formatter, or inspection session. A traversal of 124 built modules reachable from the document
and editor entry points finds no inspection module. `getPieceTreeSnapshot(editor.getTextSnapshot())` returns the
underlying immutable piece-table snapshot, or `null` for a string-backed view, without reading text.

## API

- `validatePieceTreeInvariants(snapshot, label?)` returns frozen `issues` and `counts`. Each issue
  identifies a kind, node label, field, expected value, and actual value. The optional label function
  accepts `session.label` to correlate issues with an inspection session.
- `createPieceTreeInspectionSession()` creates identity labels scoped to that session. `inspect`
  copies metadata into frozen records. `compare(before, after)` accepts two explicit roots and
  returns both inspections plus changes for piece-tree and reverse-index nodes.
- `formatPieceTree(snapshot, options?)` prints a deterministic tree. `formatPieceTreeInspection`
  formats previously captured records, and `formatPieceInspectionNode` formats one selected node.
- `excerptLength` defaults to zero and is capped at 120 UTF-16 code units per piece. `maxRows`
  defaults to 200 and is capped at 10,000. Indentation stops at depth 40. Truncation is explicit.

`reused` requires the same node object. `copied` means a different object at the same tree kind and
buffer/start key; changed piece fields are listed separately. This is a correspondence between
snapshots, not proof of allocation history. Unrelated branches can reuse buffer IDs. Equal text or
metadata never counts as shared identity. New and missing keys are `added` and `removed`.

Inspection and validation are iterative and tolerate malformed deep trees. A path-local active set
identifies cycles; a repeated child within one root is a structural error. Separate root traversals
allow sharing across snapshots. Records contain no source-node references. The session's label map
uses weak keys and does not retain roots.

## Invariants

For raw results `L` and `R` from the children and piece `p`, the equations are:

| Field | Expected value |
| --- | --- |
| `subtreeOriginalLength` | `L.originalLength + (p.buffer is the original ? p.length : 0) + R.originalLength` |
| `subtreeVisibleLength` | `L.visibleLength + (p.visible ? p.length : 0) + R.visibleLength` |
| `subtreePieces` | `L.pieces + 1 + R.pieces` |
| `subtreeLineBreaks` | `L.lineBreaks + (p.visible ? rawLFCount(p) : 0) + R.lineBreaks` |
| `subtreeMinBuffer` | minimum of the piece buffer and both raw child minima |
| snapshot `length` | root's raw visible length |
| snapshot `pieceCount` | root's raw piece count |

Null children contribute zero sums. Nodes store no order bounds; the checker recomputes them to
verify that orders rise in document order. The checker scans LF characters directly in buffer ranges; it does not call tree
aggregate helpers or the buffer line-index cache. Invisible pieces still require valid bounds and
raw line-break counts. Invalid ranges produce an issue before scanning.

A piece's `firstLineBreak` is where its breaks begin in its chunk's line index (E046). The checker
expects the count of LF characters in the chunk ahead of `p.start`, scanned once per chunk. Row
lookups and cuts read the index at that position without a search, so a wrong value is a wrong row.

Every left order is strictly below its parent; every right order is strictly above. The tree is
an AVL tree since E040: a node's stored height is one more than its taller child's, and sibling
heights differ by at most one.

Anchor resolution relies on the document order of each buffer's pieces, so the checker reads it
off the pieces sorted by order: a buffer's pieces appear in buffer order with no unit missing
between them, the original buffer's start at 0, and no piece of an older buffer sits between two
pieces of a newer one. Since [E006](e006-tombstone-compaction.md), units may be missing where
compaction dropped a tombstone, but only where the reverse index leads that offset to a stand-in.

Since [E039](../performance/e039-reverse-index-cost.md) the reverse index holds inserted buffers
only. Each of their pieces has exactly one entry, keyed by buffer ID and by starting offset, or by
0 for the buffer's first piece, and the entry's order must equal the piece's. A buffer whose first
piece was compacted keys its first remaining piece by start. Every other entry must lead to a
stand-in: a tombstone of length 0 at start 0, with no line breaks, whose buffer field is a positive
threshold rather than an ID. Stand-ins are left out of the buffer-order and key checks. The small
tree a cut buffer's entries live in is checked for stored heights and balance. The inspector lists
the entries as flat rows, each carrying the piece its order leads to.

Line-index offsets must match LF positions in the index's own recorded text. `scannedLength`
equals that text's length, and `count` equals its LF count. Only the first `count` typed-array slots
are meaningful. Shared caches can describe another branch or a newer snapshot, so current chunk
text is not the reference for this check.

The hand-checked test control uses buffer `a\nb\n`: visible `[0,2)` at order 1 is the left child of
invisible `[2,4)` at order 2. The root totals are original length 4, visible length 2, pieces 2, visible line
breaks 1, minimum order 1, and maximum order 2.

## Demo controls

The example app's **Inspect piece tree** button opens a nonmodal dialog. **Capture before** and
**Capture after** select snapshots explicitly; editing does not refresh or validate them. The dialog
owns at most two roots and releases them, records, and labels when closed. No history is collected.

The snapshot and tree selectors choose before/after and piece/reverse views. Selecting a row shows
its fields, identity change, and changed piece metadata. Collapse and expansion read immutable
records without traversing source trees. **Find in other tree** finds the selected buffer/start
key, including entries beyond the initial row limit. **Show issues** displays up to 200 issues.
The programmatic checker returns the complete issue list.

The dialog renders at most 200 rows. Text is hidden until **Show text excerpts** is checked, then
limited to 80 code units per piece. Full inspection still traverses both trees and stores O(nodes)
metadata; the row limit bounds DOM/output size, not capture memory. Validation costs O(nodes +
scanned text + recorded line-index text) and O(nodes + issues) temporary memory.

## Verification and local measurements

On 2026-09-06, the focused tree, reverse-index, inspection, edit, and snapshot tests pass. Chromium
exercises expansion, selection, reverse lookup, comparison, excerpts, and close on a 1,000,000-LF
buffer with 600 insertions. A 20,000-node malformed chain verifies stack-safe reporting.

The deterministic benchmark starts with the same million-LF buffer and runs 10,000 insertions plus
3,334 deletions with seed 123. The resulting 23,305 piece nodes and 23,305 reverse entries pass all
invariants. [Raw measurements](inspection/2026-09-06.json) record Bun 1.4.0 on this machine.

| Operation | Wall time | Heap delta after collection |
| --- | ---: | ---: |
| Edits with inspection disabled | 146.1 ms | 13.0 MB |
| Validate | 83.4 ms | 0.2 MB |
| Capture records | 25.3 ms | 17.4 MB |
| Compare two roots | 90.4 ms | 33.3 MB |
| Format 200 rows | 25.8 ms | 0.2 MB |

These are single local observations, not budgets. Heap deltas estimate live allocation cost;
they do not measure cumulative allocation or peak RSS, and GC can move unrelated objects between
samples. `bun run bench:inspection` in `packages/editor` reproduces the fixture and measurements.
The E001 browser latency harness is not required for this explicit diagnostic operation.

The new checker exposed an existing heap-order defect when a split piece received a priority
smaller than its ancestor. `splitByVisibleOffset` now merges the split remainder back with the
ancestor. Deterministic churn checks every resulting snapshot and compares text with a string
oracle. This restores the invariant without changing the priority generator or adding validation
to editing.
