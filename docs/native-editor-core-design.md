# Native editor core design

**Status:** design complete. On 2026-08-28, the visually corrected 10 MiB source-backed CoreText microspike measured 1.298 ms p95 across 200 calibrated clock samples and 1.369 ms p95 across 282 complete `Keystroke` intervals in an attached Logging trace. Both span synthetic key input through `CATransaction` completion and pass the binding sub-2 ms work gate. An exported inserted frame also passed visual QA for orientation, text order, insertion position, style, and selection. The result selects CoreText, one owner-drawn `NSView`, and app-owned synchronous layers. TextKit 2 and Metal are out of the first implementation.

This document turns the binding directives in `native-plan-of-plans.md` and `native-editor-internals-research.md` into an implementation order. The web buffer source was read at `../Editor` commit `b09199679c680255aa07c0c2c70ae77895023ad5`. The CodeEditTextView and Runestone references were read from `~/Desktop/D/references/` on 2026-08-28.

## Settled architecture

The editor has four layers with one-way ownership.

| layer                 | owns                                                                                                   | does not own                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| piece table           | UTF-16 text, persistent edits, visibility, anchors, snapshots                                          | lines, pixel geometry, styles, selections             |
| line and layout tree  | logical-line identity, UTF-16 and parser-byte indexes, estimated and measured pixel height, wrap state | character storage, syntax style data                  |
| typesetting and paint | temporary attributed lines, `CTTypesetter`, `CTLine` fragments, glyph and decoration drawing           | document text or selection state                      |
| AppKit integration    | `NSTextInputClient`, composition sessions, responder chain, one accessibility text-area element        | alternate text storage or alternate coordinate models |

The piece table is nonisolated and produces immutable `Sendable` snapshots. The line tree, CoreText objects, and `NSView` stay on `MainActor`. Background tree-sitter, LSP, and style work reads snapshots and returns revision-tagged results. No background task shares a mutable cursor, line node, `CTTypesetter`, or `CTLine`.

UTF-16 remains the editor's document coordinate. CoreText, `NSRange`, the web piece table, IME, and macOS accessibility already use it. The implementation must not introduce Swift `Character` counts into a text offset.

The primary implementation references are:

| concern                         | source                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| web buffer                      | `editor/packages/editor/src/pieceTable/` and `editor/packages/editor/test/pieceTable-*.test.ts`                                                                                      |
| CodeEdit line tree              | `CodeEditTextView/Sources/CodeEditTextView/TextLineStorage/TextLineStorage.swift:14-639` and `TextLineStorage+Node.swift:53-70`                                                      |
| CodeEdit viewport layout        | `CodeEditTextView/Sources/CodeEditTextView/TextLayoutManager/TextLayoutManager+Layout.swift:65-277`                                                                                  |
| Runestone line aggregates       | `Runestone/Sources/Runestone/LineManager/DocumentLineNodeData.swift:4-32` and `LineManager.swift:51-377`                                                                             |
| Runestone megaline continuation | `Runestone/Sources/Runestone/TextView/LineController/LineTypesetter.swift:17-245` and `LineController.swift:34-265`                                                                  |
| CoreText fragment mechanics     | `CodeEditTextView/Sources/CodeEditTextView/TextLine/Typesetter/Typesetter.swift:130-223` and `Runestone/Sources/Runestone/TextView/LineController/LineFragmentRenderer.swift:96-104` |
| macOS text input                | `CodeEditTextView/Sources/CodeEditTextView/TextView/TextView+NSTextInput.swift` and `MarkedTextManager/MarkedTextManager.swift`                                                      |
| macOS accessibility             | `CodeEditTextView/Sources/CodeEditTextView/TextView/TextView+Accessibility.swift` and `Tests/CodeEditTextViewTests/AccessibilityTests.swift`                                         |

## The CoreText microspike passes the source-backed planning gate

The planning spike is implemented in `EditorBench` as `--coretext-spike`. It owns one immutable 10,485,771-byte source and a spike-only one-insertion overlay at global UTF-16 offset 5,242,885. No copied hot line survives setup. During every timed edit, layout resolves the source line at that global offset, copies its two source slices around the insertion, applies style runs, builds `CTLine` fragments, paints a selection separately, and draws synchronously through an app-owned hosted `CALayer`. It sends a synthetic AppKit `NSEvent` through `keyDown(with:)` and `interpretKeyEvents(_:)`. Each insertion is reverted and repainted outside the interval so every sample starts from the same state.

The executable proves source participation on every sample. It pins the corpus byte count, UTF-16 length, digest, global edit offset, and affected source range. It also checks the edited revision and length, local insertion mapping, and inserted glyph run. It records one source-backed line read for each measured edit, observes a largest affected-line string of 99 UTF-16 units, restores the baseline length after cleanup, and verifies the full source digest after the run.

This is still a planning spike, not the native editor. Its overlay edit is O(1), and Foundation resolves one warm source line. It does not measure the future piece-table treap, augmented line tree, snapshots, anchors, scrolling, IME, or accessibility. The gate answers whether the chosen input, CoreText, paint, and layer path fits the budget when its text comes from a real global coordinate in a 10 MiB document. Later implementation phases replace each stand-in and rerun the same work gate.

Run it from `apps/mac`:

```bash
swift run -c release EditorBench --coretext-spike=200
```

Timing is not visual QA. Export the exact hosted-layer contents for an inserted frame and inspect the PNG before accepting a renderer result:

```bash
swift run -c release EditorBench \
	--coretext-snapshot=/tmp/platform-coretext-spike.png
```

The first inspection exposed vertically flipped glyphs even though the glyph-run and dirty-rect assertions passed. The corrected frame shows upright left-to-right text, the inserted `x` after the line's five-unit prefix, a purple `const` run supplied by the style store, and a separately painted selection over `value61672`. The draw path now rejects a vertically flipped effective glyph transform.

To validate the signposts, run a longer spike in one terminal and attach Logging from another. On this machine, AppKit drawing stalled when `xctrace` launched the command-line executable. Attaching preserves the normal application launch.

```bash
# Terminal 1
swift run -c release EditorBench --coretext-spike=600

# Terminal 2
native_editor_trace_dir="$(mktemp -d /tmp/platform-native-editor-spike.XXXXXX)"
native_editor_pid="$(pgrep -n -x EditorBench)"
xcrun xctrace record --template "Logging" --time-limit 12s \
	--output "$native_editor_trace_dir/keystroke.trace" \
	--attach "$native_editor_pid"

python3 .agents/skills/swiftui-expert-skill/scripts/analyze_trace.py \
	--trace "$native_editor_trace_dir/keystroke.trace" \
	--list-signposts --signpost-subsystem dev.platform.editor \
	--signpost-category Latency --json-only 2>/dev/null \
	| jq '([.intervals[] | select(.name == "Keystroke") | .duration_ms] | sort) as $d
		| {count: ($d | length),
			p50_ms: $d[((($d | length) * 0.50 | ceil) - 1)],
			p95_ms: $d[((($d | length) * 0.95 | ceil) - 1)],
			max_ms: $d[-1]}'
```

The calibrated release run on the plan-1 machine produced this result:

| metric                   |                      result |
| ------------------------ | --------------------------: |
| corpus                   |            10,485,771 bytes |
| warmup                   |                    10 edits |
| measured edits           |                         200 |
| post-cleanup delay       |                       40 ms |
| source UTF-16 length     |                  10,485,771 |
| global insertion         |                   5,242,885 |
| source line range        |             `{5242880, 98}` |
| largest affected line    |             99 UTF-16 units |
| CPU calibration          |                    70.25 ms |
| input-to-transaction p50 |                    1.074 ms |
| input-to-transaction p95 |         **1.298 ms — pass** |
| input-to-transaction max |                    1.873 ms |
| apply-edit p95           |                    0.096 ms |
| typeset and layout p95   |                    0.556 ms |
| draw p95                 |                    0.422 ms |
| commit-wait p95          |                    0.256 ms |
| input through draw p95   | 1.057 ms — attribution only |

The calibrated table uses `ContinuousClock` across the same endpoints as plan 1's `Keystroke` interval. Only the analyzed Logging trace is the signpost result. The attached 600-sample run reported 69.09 ms CPU calibration; the 282 complete intervals captured during the 12-second trace measured 0.870 ms p50, **1.369 ms p95**, and 2.051 ms max. All 282 contained exactly one ordered `ApplyEdit`, `Layout`, `Draw`, and `Commit` event.

The first honest run used AppKit's managed backing layer and failed at 3.720 ms p95, with 2.932 ms in commit wait. Moving transaction boundaries, changing the display entry point, and adding or removing `CATransaction.flush()` did not fix it. An empty transaction and a visible property change on an app-owned layer both completed below 0.25 ms p95, localizing the cost to managed backing-store paint.

The passing design makes the view layer-hosting: it assigns an app-owned `CALayer`, invalidates that layer, draws CoreText synchronously in `CALayer.draw(in:)`, and commits one explicit transaction without calling `flush()`. `drawsAsynchronously` stays false. The completion endpoint did not move. The spike rejects missing stages, requires the inserted `x` to reach a real glyph run inside the dirty region, and requires nonnil layer contents before accepting a sample. A disabled-action `CATransaction` completion does not prove compositor submission or photon time. This number is the CPU work gate through transaction completion; Animation Hitches supplies presentation evidence later.

Swift imports `CALayer.draw(in:)` as nonisolated even though this layer is main-thread-only. The spike bridges that SDK seam with a private `MainThreadOnly<CGContext>: @unchecked Sendable` carrier, a main-queue precondition, and `MainActor.assumeIsolated`. This is not permission to pass CoreText or AppKit objects between actors: production keeps the bridge local to the synchronous hosted layer and preserves `drawsAsynchronously == false`.

### What the spike proves

The result proves that a global edit overlay, source-backed affected-line read, per-line CoreText construction, owner-drawn paint, and transaction completion fit inside 2 ms p95 on the 10 MiB source. It also exercises style outside the buffer and a separate selection-paint pass.

The spike does not claim that the Swift piece table, augmented line tree, IME, accessibility, scrolling, or tree-sitter already passes. Its one-insertion overlay stands in for the future O(log n) piece-table edit. Each implementation phase below replaces one stand-in and fills its own `EditorBench` row.

The first implementation uses this stack:

- Use one layer-hosting `NSView` with CoreText and app-owned synchronous layers. Never hand hot-surface backing-store ownership back to AppKit without rerunning the gate.
- Split production paint into three regional layers: background and selection, glyphs, then diagnostics and carets. The spike measured one hosted layer, so phase 5 gates the three-layer commit path before it replaces the control.
- Draw only invalidated fragments into the glyph layer. A selection or caret move invalidates only its decoration layer, so it emits no `CTLineDraw`.
- Do not create an `NSView` per fragment.
- When the scrolling path exists, compare the selected regional layers against recycled fragment `CALayer`s and recycled fragment views. Adopt per-fragment objects only if an interleaved trace beats regional drawing without adding churn.
- Consider Metal only after a measured CoreText bottleneck remains after fixing layout, allocation, and invalidation scope.

## Port the web piece table before designing a buffer

The source directory has exactly 19 TypeScript files and 3,569 lines. Production code accounts for 2,968 lines. `pieceTable.test.ts` accounts for 601 lines and 35 tests.

Regenerate the inventory with:

```bash
rg --files editor/packages/editor/src/pieceTable | sort
wc -l editor/packages/editor/src/pieceTable/*
```

### Source inventory and direct imports

The `imports` column lists only imports within `src/pieceTable/`. It is the dependency graph for the port order.

| source               | lines | imports                                                                                                                          |
| -------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------- |
| `lineEndings.ts`     |   181 | none                                                                                                                             |
| `pieceTableTypes.ts` |   120 | `lineEndings`                                                                                                                    |
| `internalTypes.ts`   |    11 | `pieceTableTypes`                                                                                                                |
| `orders.ts`          |    55 | `pieceTableTypes`                                                                                                                |
| `priority.ts`        |    50 | `pieceTableTypes`                                                                                                                |
| `buffers.ts`         |   409 | `pieceTableTypes`, `orders`, `priority`, `lineEndings`                                                                           |
| `tree.ts`            |   476 | `pieceTableTypes`, `internalTypes`, `buffers`, `orders`, `priority`                                                              |
| `walker.ts`          |   233 | `pieceTableTypes`, `buffers`, `tree`                                                                                             |
| `reverseIndex.ts`    |   237 | `pieceTableTypes`, `internalTypes`, `tree`, `priority`                                                                           |
| `positions.ts`       |   157 | `pieceTableTypes`, `buffers`, `tree`                                                                                             |
| `reads.ts`           |   160 | `pieceTableTypes`, `buffers`, `tree`, `walker`                                                                                   |
| `snapshot.ts`        |    68 | `pieceTableTypes`, `buffers`, `reverseIndex`, `tree`, `orders`, `priority`, `lineEndings`                                        |
| `documentText.ts`    |    47 | `pieceTableTypes`, `reads`, `lineEndings`                                                                                        |
| `anchors.ts`         |   249 | `pieceTableTypes`, `buffers`, `reads`, `reverseIndex`, `tree`                                                                    |
| `diff.ts`            |   116 | `pieceTableTypes`, `reads`, `walker`                                                                                             |
| `edits.ts`           |   296 | `pieceTableTypes`, `internalTypes`, `buffers`, `orders`, `reverseIndex`, `reads`, `snapshot`, `tree`                             |
| `pieceTable.ts`      |    47 | `pieceTableTypes`, `tree`, `anchors`, `diff`, `edits`, `positions`, `reads`, `snapshot`, `lineEndings`, `documentText`, `walker` |
| `index.ts`           |    56 | `pieceTableTypes`, `pieceTable`                                                                                                  |
| `pieceTable.test.ts` |   601 | `index`, `buffers`                                                                                                               |

### Port the tests first

Translate `pieceTable.test.ts` into `Tests/EditorCoreTests/PieceTableTests.swift` before production types exist. Keep its seeded random generator and its UTF-16 string oracle. The initial test target must fail to compile until the public shape exists and remain red until wave 9 supplies the complete API. It is the port's executable specification, not a per-wave gate.

The 35 tests are the first specification, not the whole specification. The sibling `editor/packages/editor/test/` directory has 12 focused `pieceTable-*.test.ts` suites with another 1,868 lines and 108 tests. Translate all of them before implementation and assign each suite to the wave that owns its primary behavior:

| suite         | tests | implementation owner |
| ------------- | ----: | -------------------: |
| anchors       |     8 |                    8 |
| buffers       |    13 |                    4 |
| diff          |     7 |                    8 |
| edits         |    14 |                    8 |
| line endings  |    27 |                    1 |
| orders        |     3 |                    3 |
| positions     |    11 |                    6 |
| reads         |     4 |                    7 |
| reverse index |     2 |                    6 |
| snapshot      |     3 |                    7 |
| tree          |     4 |                    5 |
| walker        |    12 |                    6 |

Ownership does not imply that the whole suite can run in that wave. Run the smallest slice whose dependencies exist. Of the 27 line-ending tests, 12 exercise pure line-ending logic in wave 1, 5 need ingestion in wave 7, 5 need `DocumentText` in wave 8, and 5 belong to the later native document-session boundary. Of the 13 buffer tests, 11 run in wave 4 and 2 branch-history cases wait for edits in wave 8. The reverse-index comparator runs in wave 6; its lookup test waits for snapshot and insertion support. Walker, position, and read cases similarly wait for the smallest snapshot or edit fixture they use. Low-level insert APIs continue to accept normalized text.

Some JavaScript tests probe an implementation mechanism. Translate the constraint instead:

- Replace prototype-identity assertions with Swift type-method behavior checks.
- Replace `Proxy` node-read counts with an internal test visit counter or a focused complexity bench.
- Replace `Uint32Array` backing checks with `UInt32` storage and capacity-growth checks.
- Replace object-identity assertions with shared-root and old-snapshot isolation assertions.

### Bottom-up port order

Port production code in these import-derived waves. End each wave by running every translated test slice that is now runnable; do not block a dependency wave on a central test that imports the future public API.

0. Translate the central 35-test specification. Do not add production shims to make the test translation easier.
1. Port `lineEndings.ts`.
2. Port the domain types from `pieceTableTypes.ts` as Swift value types.
3. Port `internalTypes.ts`, `orders.ts`, and `priority.ts` in parallel.
4. Port `buffers.ts`.
5. Port `tree.ts`.
6. Port `walker.ts`, `reverseIndex.ts`, and `positions.ts` in parallel.
7. Port `reads.ts` and `snapshot.ts` in parallel.
8. Port `documentText.ts`, `anchors.ts`, `diff.ts`, and `edits.ts` in parallel.
9. Port the real public and debug behavior from `pieceTable.ts`.
10. Make the central 35 tests and all runnable low-level slices green, then run all 108 focused parity tests together. Leave the five `DocumentSession` cases for the layer that owns that boundary.

`index.ts` has no Swift counterpart. `EditorCore` module visibility replaces the package barrel.

### Behavior that stays identical

The port keeps the algorithms and edge behavior below.

**Line endings and ingestion.** Default ingestion normalizes CRLF, lone CR, U+2028, and U+2029 to LF. A caller that passes the trusted `normalized: true` fast path may supply CRLF, so LF-only storage is an ingestion contract rather than a defensive invariant inside low-level edits. Ingestion strips only a leading byte-order mark and records the original line ending, byte-order mark, and unusual-terminator flag. CRLF wins when `loneCR + CRLFPairs` is a strict majority of all recognized CR/LF terminators; lone CR therefore votes for CRLF. Save can restore LF or CRLF, but cannot reconstruct U+2028 or U+2029.

**Buffers.** The original document is one immutable buffer. Inserted text goes to append-only chunks capped at 16,384 UTF-16 units. At a nonterminal provisional boundary, move back one code unit whenever the last included unit is CR or a high surrogate; the source deliberately does this conservative check without inspecting whether the next unit is LF or a low surrogate. Persistent pages hold 1,024 chunk references. Extending a tail creates new storage so older snapshots still read the prior text.

**Document treap.** The in-order sequence is document order and the priority is a min heap. Merge, split, and update copy the touched path and share every untouched node. Aggregates contain physical UTF-16 length, visible UTF-16 length, physical piece count, visible line breaks, and minimum and maximum floating order. A delete keeps the pieces and flips visibility. Reads and walkers skip hidden pieces while anchor resolution can still find them.

**Reverse treap.** A second persistent treap indexes pieces by canonical buffer identifier and backing-buffer start. Canonical identifiers compare as strings, so `buffer:10` sorts before `buffer:2`; converting the suffix to an integer is a semantic change. The tree uses a distinct priority kind. Split, coalesce, visibility changes, and order normalization update both roots in the same logical snapshot.

**Orders and priorities.** Piece orders start at 1,024, interpolate inside a gap, and trigger full in-order normalization below the existing minimum-gap formula. Priority remains the seeded deterministic FNV-1a-style mix, one mix per UTF-16 code unit, followed by the existing avalanche. The hashed sequence stays exact: finite/truncated seed in base 36, treap kind, canonical buffer string, start, length, finite/truncated order in base 36, and `visible` or `hidden`. Line-break counts are not hashed. New nodes receive a priority once. Visibility, tail, and ordinary order replacements in both treaps retain it. Full order normalization also retains every document-treap priority while changing piece orders and aggregates; rebuilding the reverse index recomputes only reverse-treap priorities from the normalized orders.

**Walks and positions.** A mutable walker traverses one immutable snapshot. Sequential UTF-16 reads are amortized O(1), and seek is O(log pieces). It rejoins surrogate pairs across piece boundaries but returns bare unpaired code units unchanged. Offset-to-point and point-to-offset use visible-length and line-break aggregates. Point lookup clamps negative coordinates, long columns, and rows beyond the document. A trailing LF creates a final empty row.

**Anchors.** A real anchor stores a buffer-local UTF-16 offset and left or right bias. Minimum and maximum anchors remain live sentinels. Creation snaps an offset inside a surrogate pair to its left boundary, and repeated snapping is idempotent. Bias chooses the side at a piece boundary. An anchor inside deleted content resolves to the nearest visible edge selected by bias and reports deleted liveness. Left bias sorts first only when two real anchors resolve to the same offset and their biases differ; sentinels and equal-bias anchors keep their existing comparison behavior.

**Edits.** Ranges are half-open UTF-16 ranges. Batch edits reject overlaps in the original input, validate against the original snapshot, snap surrogate boundaries, always merge overlaps introduced only by snapping, retain the input ordinal, and apply in descending offset order. Equal `(from, to)` edits sort by input ordinal ascending. Surrogate repair preserves the web rules for carets, nonempty ranges, replacement halves, and adjacent sibling edits. An insert coalesces only when the visible non-original piece at the edit point uses the newest add-buffer identifier, its physical window reaches that chunk's tail even if a tombstone follows in document order, and the entire backing add-buffer chunk after extension stays within 16,384 UTF-16 units. Empty edits return the same logical snapshot and share the same roots and store.

**Reads, snapshots, and diff.** Reads expose chunk and piece streams without materializing the document. Root identity remains an equality fast path because backing windows never mutate. Snapshots carry both treap roots and the persistent buffer store. Diff returns the same single prefix/suffix edit and scans suffixes in 4,096-unit windows.

### Deliberate Swift divergences

Every deliberate buffer semantic or data-structure difference from the TypeScript implementation is listed here. An unlisted difference in that scope is a port bug.

| area                    | Swift design                                                                                                                                        | reason and invariant                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| domain records          | `Piece`, `TextPoint`, edit, anchor, resolved anchor, options, buffer identifier, and snapshot become `struct` or `enum` values                      | Swift value semantics replace JavaScript record identity. Logical behavior and structural sharing stay the same.                                |
| offset types            | use `UTF16Offset`, `UTF16Length`, `PieceBufferID`, `TreeSitterByteOffset`, and `TreeSitterByteLength` wrappers at public and cross-layer boundaries | Prevent unit mixing. The raw values stay integer UTF-16 units or explicitly named parser bytes.                                                 |
| text backing            | immutable, `Sendable` UTF-16 code-unit storage rather than Swift `String` iteration                                                                 | Avoid grapheme traversal and repeated `String.Index` walks. Convert only a requested line or range for CoreText.                                |
| recursive nodes         | immutable `final class` nodes with `let` fields and aggregates calculated in `init`                                                                 | Recursive value structs copy the wrong unit. Final classes preserve path sharing and make mutation through an alias impossible.                 |
| snapshots               | immutable `struct: Sendable` with transitively immutable roots, buffers, and metadata                                                               | Background consumers read without locks. Walkers remain local mutable values and are not `Sendable`.                                            |
| newline indexes         | each immutable UTF-16 buffer chunk owns an immutable `UInt32` newline-offset vector built with the chunk                                            | The TypeScript code mutates a lazily shared `Map` inside nominally readonly buffers. That leak is incompatible with a real `Sendable` snapshot. |
| priority representation | store the post-avalanche priority as raw `UInt32`, not a `Double` divided by 2^32                                                                   | Preserve exact ordering and ties without a floating conversion. The UTF-16 code-unit hash input and avalanche remain bit-for-bit compatible.    |
| stable batch order      | carry the edit's input ordinal and include it in the descending application sort                                                                    | ECMAScript sort stability is current behavior. Swift sort stability is not a contract.                                                          |
| errors                  | public invalid range, offset, and overlap failures use a typed `PieceTableError`. Impossible internal states use preconditions                      | Replace JavaScript `RangeError` without weakening validation. Tests port by error case.                                                         |
| file layout             | split large TypeScript files into PascalCase Swift files with one primary type                                                                      | Match the native package convention. Do not add a barrel or facade whose only job is re-exporting.                                              |
| test probes             | use Swift-native structural-sharing, visit-count, storage-width, and capacity checks                                                                | Preserve the constraint instead of copying a JavaScript runtime trick.                                                                          |

Seed-zero priority vectors pin compatibility for both treaps:

| piece                                                     | document treap | reverse treap |
| --------------------------------------------------------- | -------------: | ------------: |
| `buffer:0`, start 0, length 5, order 1024, visible        |   `0xf3e891d6` |  `0x83472fce` |
| `buffer:1`, start 0, length 3, order 512, visible         |   `0xdad9ae74` |  `0xb50961d6` |
| same piece, hidden                                        |   `0xaa006a43` |  `0x89536081` |
| `buffer:42`, start 16384, length 9, order 1024.5, visible |   `0xe375b150` |  `0xa140f915` |

### ARC strategy

Start with immutable `final class` nodes in both treaps. Record allocations, retain and release samples, edit p50 and p95, snapshot creation, and peak resident memory in `EditorBench`. This baseline is a decision, not a temporary implementation.

Add an arena or slab only if Instruments attributes a failed gate to node allocation or ARC. An arena version must use stable handles, retain every generation reached by a live snapshot, and prove reclamation after snapshots die. Raw pointers would require a small audited `@unchecked Sendable` boundary. The arena replaces class nodes only after an interleaved benchmark shows the gain and all parity tests remain green.

### Swift file map

Use these feature folders under `apps/mac/Sources/EditorCore/`. Do not create a folder before its first file lands.

| source responsibility      | Swift files                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| offsets and points         | `TextBuffer/UTF16Offset.swift`, `TextBuffer/UTF16Length.swift`, `TextBuffer/TextPoint.swift`, `TextBuffer/TreeSitterByteOffset.swift`, `TextBuffer/TreeSitterByteLength.swift` |
| pieces and edits           | `TextBuffer/Piece.swift`, `TextBuffer/PieceBufferID.swift`, `TextBuffer/PieceTableEdit.swift`, `TextBuffer/SplitContext.swift`, `TextBuffer/PieceTableError.swift`             |
| anchors                    | `TextBuffer/PieceTableAnchor.swift`, `TextBuffer/AnchorResolver.swift`                                                                                                         |
| snapshot                   | `TextBuffer/PieceTableSnapshot.swift`                                                                                                                                          |
| line endings and save text | `TextBuffer/DocumentLineEnding.swift`, `TextBuffer/DocumentText.swift`                                                                                                         |
| order and priority         | `TextBuffer/PieceOrder.swift`, `TextBuffer/PiecePriority.swift`                                                                                                                |
| backing buffers            | `TextBuffer/PieceBuffer.swift`, `TextBuffer/PieceBufferStore.swift`, `TextBuffer/LineBreakIndex.swift`                                                                         |
| document treap             | `TextBuffer/PieceTreeNode.swift`, `TextBuffer/PieceTree.swift`                                                                                                                 |
| reverse treap              | `TextBuffer/AnchorIndexNode.swift`, `TextBuffer/AnchorIndex.swift`                                                                                                             |
| walking, reads, positions  | `TextBuffer/PieceTableWalker.swift`, `TextBuffer/PieceTableReads.swift`, `TextBuffer/PieceTablePositions.swift`                                                                |
| mutations and diff         | `TextBuffer/PieceTableEdits.swift`, `TextBuffer/PieceTableDiff.swift`                                                                                                          |
| public and debug surface   | `TextBuffer/PieceTable.swift`, `TextBuffer/PieceTableDebug.swift`                                                                                                              |

The web snapshot has no revision. Keep `PieceTableSnapshot` as the exact ported value and add `DocumentRevision` plus `RevisionedSnapshot` in the document layer above it. That layer assigns monotonic revisions to edit transactions. Line caches do not key on that global revision; they use line-local content generations so an unrelated edit does not invalidate the viewport.

## Put line and layout state above the buffer

The piece table remains geometry-free. A mutable augmented line tree indexes one `LineRecord` per visible logical line. CodeEditTextView and Runestone both use this model. Port the aggregate and lookup behavior, not either red-black implementation verbatim.

CodeEditTextView's tree uses `final class` nodes, strong children, an `unowned` parent, and left-subtree aggregates. It reports a measured 15 percent insertion gain from `Unmanaged` in its hot path. Its delete path appears to skip black-leaf fixup when the replacement is nil, and its tests do not prove full black-height and red-parent invariants. Runestone has a generic aggregate-driven lookup and a correct O(n) bulk build, but its byte-count name hides the tree-sitter unit.

Use a sentinel-backed red-black tree with full subtree aggregates. Keep ordinary Swift references first. Consider `Unmanaged` only after an Instruments trace attributes a failed layout-tree gate to retain and release traffic.

### Line data and aggregates

Each node stores this own-line data:

- A stable `LineID` that survives height changes.
- Stable, biased start and end anchors that resolve in any descendant snapshot. A line start and the preceding nonfinal line end share the same left-biased boundary: an insertion there enters the following line. The final line ends at the maximum sentinel so an append remains inside it.
- A `LineContentRevision` that changes only when this line's shaped content or delimiter changes.
- UTF-16 content length and delimiter length.
- `TreeSitterByteLength` including the delimiter.
- Current `LineHeightState`.
- Estimated or measured maximum width.
- Layout invalidation and cache epochs.

The resolved anchor pair is authoritative for the current range. Stored lengths and aggregates are cached consequences and must match it after every edit.

Each node stores these subtree aggregates:

- UTF-16 length.
- Tree-sitter byte length.
- Logical line count.
- Pixel height, including estimates for unmeasured content.
- Maximum estimated or measured line width.

The tree supports O(log lines) lookup by row, UTF-16 offset, tree-sitter byte offset, and y position. The root exposes total length, parser bytes, line count, current estimated document height, and horizontal document extent in O(1). The clip view reads both scrollbar extents from this root; there is no second width owner.

Runestone's property named byte count is not UTF-8. It configures tree-sitter for UTF-16 and stores `utf16.count * 2`. Native APIs distinguish `TreeSitterByteOffset` from `TreeSitterByteLength`, and the parser configuration decides their conversion. The first implementation also uses UTF-16LE, so a delimiter consumes `delimiterUTF16Length * 2` parser bytes. Do not repeat Runestone's subtraction of raw UTF-16 delimiter units from a byte total.

The byte aggregate stays explicit even when it is twice the UTF-16 aggregate. It documents the parser contract and prevents an `InputEdit` from accepting a text offset by accident. If plan 4 selects UTF-8 input after measurement, the tree shape survives but the parser input callback, `TSPoint.column`, `InputEdit` conversion, restart checkpoints, and byte-to-UTF-16 maps must all change together. Treat that as a parser-coordinate migration, not a one-line calculation change.

### Define line boundaries once

The empty document contains one empty logical line. A trailing LF creates a final empty line. If the trusted pre-normalized path exposes CRLF, the pair is one delimiter of UTF-16 length 2, CoreText excludes both code units, and a trailing CRLF creates one final empty line. A line-tree range includes its delimiter, while CoreText shapes only the content before it. The delimiter offset belongs to the preceding line; the document-end offset belongs to the final line. Y lookup uses half-open vertical ranges, except that the exact root height resolves to the final line's lower edge. These rules are shared by offset lookup, hit testing, accessibility, tree-sitter points, and edit repair, and receive direct LF and CRLF boundary tests.

### Build and edit the line tree

At open, scan the piece-table snapshot through contiguous code-unit chunks. Find line endings with the lowest-cost buffer view, but store UTF-16 offsets and parser bytes. Build a balanced tree from the ordered line records in O(n). Do not insert n lines one at a time.

An edit produces the old and new affected line spans from piece-table anchors. Rebuild only the logical lines touched by the edit, plus the boundary lines whose delimiters joined or split. Preserve `LineID` for a line whose start anchor survives. Update aggregates on the changed path and through rotations. In debug and test builds, verify:

- root is black.
- no red node has a red child.
- every root-to-leaf path has equal black height.
- parent links are consistent.
- each aggregate equals the node's own value plus both child aggregates.
- in-order UTF-16 and byte totals equal the piece-table snapshot.
- tree y lookup and a linear oracle agree after random height corrections.

### Estimated height is real tree state

Measure the default font's ascent, descent, leading, and nominal monospace advance once. A short unmeasured line starts with the nominal fragment height. In wrapped mode, a long line starts with an estimated wrap count based on UTF-16 length, wrap width, tab policy, and nominal advance; pretending an untouched wrapped megaline has one fragment makes the vertical scrollbar unusable. In unwrapped mode, one-fragment height is correct, while width starts as an estimate and is refined by horizontal tiles.

`LineHeightState` has three cases:

```swift
enum LineHeightState {
	case estimated(EstimatedLineHeight)
	case partial(PartialLineLayout)
	case exact(ExactLineLayout)
}
```

For partial layout, pixel height is exact for fragments reached by the sequential layout frontier and estimated for provisional windows and remaining gaps. After every fragment batch, write the new combined height into the node and repair subtree pixel totals. The scrollbar always reads the root total. It never keeps a second document-height counter.

A wrap-width, font-metrics, backing-scale, or tab-policy change invalidates every estimate. Capture the applicable x and y viewport anchors, compute replacement estimates in one linear pass, bulk-build the new aggregate state in O(n), swap it on `MainActor`, and compensate once. Do not repair n nodes with O(log n) point updates. Exact and partial fragment caches become invalid, but the root must always expose coherent estimated extents during the transition.

### Compensate scrolling around a stable anchor

Before a layout batch changes heights, hit-test the viewport top to a character anchor and record its pixel delta from the top of that character's fragment. After height writes, resolve the anchor and force or reuse layout of the fragment that now contains it. Its new global fragment y plus the saved intra-fragment delta is the target viewport y. Adjust the clip view once by `newY - oldY`.

Width correction has the same rule in x. For an unwrapped line, retain the `LineID`, a character anchor at the viewport's left edge, and its intra-tile x delta. Prefer the caret or explicit horizontal-scroll target line; otherwise use the first visible unwrapped line that intersects the left edge. After measured advances replace estimates before that anchor, resolve it through the source index, find its new visual x, and adjust `contentView.bounds.origin.x` once. Batch x and y correction in the same nonanimated clip-view update.

A first direct jump into an unprepared megaline has no fragment to hit-test. Bootstrap with `LineID`, the line-start anchor, and the clamped fraction through the line's estimated local height or width. Prepare a bounded provisional target window without publishing a correction, then promote the bootstrap state to a character anchor plus an intra-fragment x or y delta. Only then update aggregates and apply compensation. The window remains explicitly provisional until sequential layout reaches it. This breaks the dependency cycle without pretending an arbitrary soft-wrap position is an exact CoreText restart point.

This rule handles positive and negative corrections, a viewport that begins inside a wrapped line, direct scrollbar jumps, live scrolling, and multiple corrected lines above the viewport. Do not add one scroll delta per line. Batch first so rounding and clamping happen once.

If an anchor's text was deleted, resolve it with its stored bias. Clamp only after compensation against the new root height or width. Suppress AppKit's automatic scroll animation for this internal correction.

### Lay out the viewport in tree order

One viewport pass shares a single monotonic cooperative budget:

1. Capture the stable top anchor and seek the first visible line by y in O(log lines).
2. Visit that line and following lines through the visible range plus overscan.
3. Typeset only the fragments needed for the current line, write any height correction, and then locate the next line from the updated tree. Never cache the next y before changing the current height.
4. Check the budget before each non-preemptible CoreText call. When it is spent, retain every complete valid fragment and schedule visible continuation for the next run-loop turn. A call already in progress may overrun, so record its maximum as well as its percentiles.
5. Apply one scroll-anchor compensation after the batch.

Each logical line owns linked source-order and visual-geometry indexes rather than an array that must be scanned. The source index maps UTF-16 offsets to leaves. The geometry index aggregates horizontal and vertical advance and maps local y or x to a leaf. This separation is required because bidi visual order is not source order. Leaves retain `CTLine`, source range, geometry, and a provisional or exact-layout-policy tag. Wrapped fragments advance vertically. Unwrapped megaline tiles share one baseline and advance horizontally; estimated gap leaves make a direct horizontal scrollbar jump independent of measured predecessors.

### Resume megaline layout under a cooperative budget

A logical line can be larger than the viewport or the frame budget. Typesetting it to completion before paint is a correctness bug because the editor becomes unresponsive.

`PartialLineLayout` keeps:

- the retained `RevisionedSnapshot`, `LineID`, and `LineContentRevision`.
- the intersecting style and marked-text fingerprints plus font, wrap-width, scale, and tab epochs.
- an `ExactRestartCheckpoint` chain beginning at line start, with the next UTF-16 offset, fragment ordinal, and baseline for the contiguous sequential frontier.
- sparse linked source and geometry trees beyond that frontier whose leaves are provisional prepared windows or estimated gaps.
- per-provisional-window source range, attributed backing, local fragments, estimated global origin, and explicit degraded-layout metadata.
- per-gap UTF-16 range and estimated fragment count, height, and width.
- recent characters-per-fragment samples used to divide a target gap near a requested x or y.
- aggregate exact and estimated height, maximum width, and UTF-16 coverage across both leaf kinds.

Exact soft-wrap state advances only from a checkpoint reached by sequential typesetting; a long line has no general bounded context that makes an arbitrary middle offset an exact restart. A prefix continuation alone still cannot serve a first distant jump, so the sparse trees map a far local y or x through gap estimates and paint a bounded provisional window immediately. That window refines the estimate but does not create an exact checkpoint. The sequential frontier eventually reaches and replaces it. Geometry comes from prefix aggregates, so correction moves later windows without renumbering them.

Resume until one of these conditions holds:

- fragments cover the requested line-local y range plus overscan.
- fragments cover a requested caret or hit-test offset.
- the cooperative frame budget is spent.
- the logical line ends.

Finish the current bounded call before yielding. A layout pass receives a time budget, not a fragment count, but CoreText is not preemptible. The first edit target is a 0.75 ms layout budget; the current microspike's layout p95 is 0.578 ms. Scrolling can spend a separate budget. Record each synchronous call's p50, p95, and max; lower the work-unit cap when a slow call threatens the input gate.

Runestone resumes fragment production but still materializes and attributes the whole logical line synchronously. Split preparation from fragment work in the native design. A background task reads the immutable snapshot and returns revision-tagged UTF-16 storage plus intersecting `StyleRun` values for adjacent windows. `MainActor` accepts them only when `LineID`, `LineContentRevision`, style fingerprint, and layout epochs still match. `PreparedLine` then owns each attributed backing and retained `CTTypesetter`; CoreText objects never cross actors.

One `CTTypesetter` requires one complete attributed backing, so bounded source chunks cannot feed it without reassembly. Normal lines use that per-line path. Megalines use bounded attributed windows from the first implementation: sparse restart frontiers, one `CTTypesetter` per active window, and no hidden full-line `NSAttributedString` construction on `MainActor`. Start with a 4,096-UTF-16-unit hard cap and lower it if a window's measured p95 exceeds 0.5 ms. A composed cluster that exceeds the cap gets one bounded degraded placeholder tile; copy, edit, and accessibility still expose the original code units. Never send that unbounded cluster to CoreText on `MainActor`. Exact display may replace the placeholder only after a separate benchmark justifies a higher hard cap and the new cap passes the same call budget.

The input path and a first scroll jump synchronously prepare the bounded window containing the edit or target x/y, using the last committed style runs. Use exact fragments when the sequential checkpoint is already adjacent; otherwise mark the result provisional and degraded. Adjacent source windows may arrive from the background, while the exact frontier advances cooperatively on `MainActor`. `Draw` cannot end until the edited glyph or explicit oversized-cluster placeholder is in a drawn fragment. This removes both a blank first paint and a hidden whole-line wait.

Cluster-safe overlap is necessary but insufficient for Arabic and Indic shaping, bidi paragraphs, ligatures, combining sequences, ZWJ emoji, and tabs. Window tests compare every boundary with a full-line CoreText oracle. When a capped window differs, expand to the nearest script and bidi boundary only when that boundary still fits inside the hard cap. Otherwise use an explicit megaline fallback: shape each capped window with inherited base direction, disable ligatures across the seam, and report the degraded mode in diagnostics. Wrapped windows produce vertical fragments; unwrapped windows produce horizontal tiles on one baseline. Their visual-order geometry index, not their source interval order, owns x lookup.

Until adjacent preparation arrives, keep the estimated height, width, and existing valid fragments. The cooperative budget is checked between capped windows and fragments; the cap bounds synchronous input size, not elapsed time, and one CoreText call never receives more than it. The megaline gate covers edits, first vertical jumps, first horizontal jumps, provisional-to-exact correction, and slow-call telemetry. It asserts forward progress, x/y anchor stability, and a drawn target.

Discard partial state when line identity, line-content generation, intersecting style or marked-text fingerprint, font metrics, wrap width, scale, or tab policy changes. A global document, style-store, or composition revision alone is not invalidation. Preserve unaffected earlier fragments only when the invalidation starts after their ranges and the shaping context proves that reuse is safe.

## Apply style only while CoreText typesets

The character buffer stores code units and visibility. It never stores `NSAttributedString` attributes.

A separate persistent run store holds `Sendable` value-type `StyleRun`s over UTF-16 ranges. Tree-sitter syntax, LSP semantic tokens, diagnostics, search marks, and inline decorations produce distinct layers. `StyleRun.Payload` is a closed Sendable enum of font descriptor DTOs or tokens, theme or RGBA colors, underline variants, and other scalar values; it never carries `NSFont`, `NSColor`, `NSGlyphInfo`, `NSTextAlternatives`, or arbitrary attributed-string values. `MainActor` resolves payloads to CoreText and AppKit attributes while preparing a line.

Marked text stays in a `MainActor`-only `MarkedTextOverlay`, which can retain the AppKit objects supplied by the input context. Typesetting queries it alongside the persistent style store and includes only its intersecting fingerprint in the cache key. The style store defines deterministic layer precedence and distinguishes metric-changing attributes from paint-only attributes. A line-local fingerprint covers only intersecting runs; its metric subset controls height invalidation. Selection and caret enter neither store.

For one normal logical line:

1. Read the line text from a `PieceTableSnapshot`.
2. Query style runs that intersect the line.
3. Overlay marked-text attributes for active composition ranges.
4. Build a temporary attributed line with the base font and foreground color.
5. Create one `CTTypesetter` for that logical line.
6. Call `CTTypesetterSuggestLineBreak` for each needed fragment.
7. Create and cache the resulting `CTLine` with its UTF-16 range and typographic metrics.

The cache key contains `LineID`, `LineContentRevision`, the line-local style and marked-text fingerprints, font metrics, wrap width, scale, and tab policy. The cached `PreparedLine` retains the snapshot storage that backs it, but an unrelated document edit or composition does not invalidate it. A selection move does not alter that key. Megalines use the bounded attributed-window exception defined above instead of one full-line typesetter.

Both references carry cases where `CTTypesetterSuggestLineBreak` returns a fragment wider than the requested width. Recheck each created `CTLine` with `CTLineGetTypographicBounds`. If it overshoots, use a precomputed composed-cluster boundary index and a bounded search for the largest fitting prefix. Guarantee `nextOffset > currentOffset`; when one cluster is itself wider than the viewport, emit that one overwide cluster. Do not copy Runestone's one-code-unit fallback because it can split a surrogate pair or combining sequence and can turn a long overshoot into a linear loop.

The surface layers paint in this order:

1. Background and current-line decorations.
2. Selection rectangles derived from cached fragment geometry.
3. Glyphs with `CTLineDraw`.
4. Diagnostics, carets, and IME indicators.

Selection changes invalidate only the old and new rectangles in the selection layer. They do not redraw glyphs or rebuild attributed strings, typesetters, or `CTLine`s. Text or style changes invalidate the smallest intersecting line and fragment range that shaping permits.

## Keep undo and highlighting at explicit seams

`EditorUndoManager` subclasses `UndoManager` so native menu validation works, but owns editor groups made of forward mutations, inverse mutations, and before/after selections. The buffer edit operation returns the inverse against its input snapshot; it does not register with AppKit itself. Typing coalescing is policy above the buffer. Composition updates are suppressed until acceptance produces one group, and cancellation produces none.

Plan 4 supplies the parsers and language services, but this core owns their boundary. `HighlightProvider` accepts a `RevisionedSnapshot` and visible-range request, then returns `Sendable` `StyleRun` values tagged with their input revision. Providers run in three phases: an immediate cheap fallback, tree-sitter syntax, then asynchronous LSP semantic tokens. The style store tracks valid, pending, and visible UTF-16 ranges, schedules large work in 4,096-unit chunks, and accepts results only when their source revision and line-content generations still match. Do not import CodeEdit's polling executor.

Every edit derives tree-sitter `InputEdit` positions from the line tree's UTF-16 and parser-byte aggregates without scanning the prefix. After incremental parse, `ts_tree_get_changed_ranges` becomes line-granular style invalidation. The coordinate wrappers make a UTF-16 offset, parser byte offset, and `TSPoint.column` impossible to interchange accidentally.

## Implement macOS input in about 300 protocol lines

Use CodeEditTextView's 292-line `TextView+NSTextInput.swift` as the method checklist and its multi-cursor marked-text behavior as the starting model. Keep the adapter near 300 lines by moving the composition state machine into its own focused type. Do not copy the reference's known mistakes.

`EditorSurfaceView+TextInput.swift` implements:

- `keyDown(with:)`: offer the event to `inputContext?.handleEvent(_:)`, then call `interpretKeyEvents(_:)` only when the context does not handle it.
- `insertText(_:replacementRange:)`.
- `setMarkedText(_:selectedRange:replacementRange:)`.
- `unmarkText()` and `hasMarkedText()`.
- primary `selectedRange()` and `markedRange()` projections.
- `validAttributesForMarkedText()`.
- `attributedSubstring(for:actualRange:)`: clip first, expand to composed-sequence boundaries, and always write the returned UTF-16 range when the pointer is nonnil.
- `firstRect(forCharacterRange:actualRange:)`: clip first, expand safely, lay out the first intersecting fragment, return its first logical rectangle in screen coordinates, and always write the fragment-covered UTF-16 range when the pointer is nonnil.
- `characterIndex(for:)`: convert screen to view coordinates and return the nearest clamped UTF-16 index, including document end. Reserve `NSNotFound` for unavailable window or layout geometry.
- `doCommand(by:)` through the editor command registry and responder chain.
- readonly `unionRectInVisibleSelectedRange` and `documentVisibleRect` properties in screen coordinates.
- `textInputClientDidUpdateSelection()` after selection transactions, `textInputClientDidScroll()` during live scroll, and `inputContext?.invalidateCharacterCoordinates()` after content, selection, or geometry changes.
- `textInputClientWillStartScrollingOrZooming()` and `textInputClientDidEndScrollingOrZooming()` around live scroll or resize, using availability guards where required.

The first adapter deliberately omits optional whole-document `attributedString()`, `fractionOfDistanceThroughGlyph(for:)`, and baseline-delta methods. It returns the window's level from `windowLevel()`, `false` from `drawsVertically(forCharacterAt:)`, `.unspecified` from `preferredTextAccessoryPlacement()`, and `false` from `supportsAdaptiveImageGlyph`; `insert(_:replacementRange:)` for an adaptive image glyph is therefore unavailable. A bounded range or geometry query must never materialize the document.

### Model a composition session explicitly

`CompositionSession` owns:

- the document generation at composition start and the latest generation produced by this composition.
- every original selection and selected text slice.
- the participating cursor identifiers and anchored nonparticipating selections.
- one bias-carrying marked-range anchor pair per participating cursor.
- each selected subrange relative to its marked text.
- the current marked-text attributes.
- the pending semantic undo group.

On the first `setMarkedText` with `replacementRange == NSNotFound`, make every cursor a participant, replace every selection in descending document order, and create one marked range per participant. A later `NSNotFound` call replaces those tracked marks and recomputes them from anchors. Preserve CodeEditTextView's cumulative-delta handling when marked text changes length.

An explicit replacement range is always a primary-only operation. On the first call, anchor secondary selections without creating marks. If an all-cursor session later receives an explicit range, apply that exact primary edit in the current pre-call document before any restoration. Restore only nonprimary marks that were disjoint from the explicit range. For every intersected secondary mark, retain whatever text survives the exact edit, accept it into the pending semantic undo group, and clear its marked state. Rebase the primary result and restored secondary selections through the descending mutations, then track only the new primary mark. `NSTextInputClient` callbacks return `Void` and provide no retry channel, so this rule resolves the callback immediately even when a range boundary lies inside ephemeral secondary text. Anchors alone cannot map that boundary through deleting the marked text first. Do not duplicate the edit across cursors or retain marks for text that was not inserted.

Apply `selectedRange` relative to every resulting marked range. `NSNotFound` means a caret at the end of the inserted marked text; otherwise clamp location and length to its UTF-16 length. CodeEditTextView ignores this argument. Korean and candidate-window navigation depend on it.

`validAttributesForMarkedText()` accepts font and visual keys plus `.markedClauseSegment`, `.languageIdentifier`, `.glyphInfo`, and `.textAlternatives`. Preserve `NSAttributedString.Key("NSTextInputReplacementRangeAttributeName")` when supplied; this SDK exposes no public dotted Swift member for it. Retain clause and language metadata for Japanese and Chinese candidate updates, and apply supported glyph metadata at typeset time. Deliberately omit `.attachment` and the nonpublic `NSTextInsertionUndoable`; adaptive image glyphs are unsupported and the editor owns semantic undo. Plain marked text receives the standard marked-text underline so a caller cannot make an active composition invisible.

Expose the first marked range through the single-range AppKit protocol while retaining all marked ranges internally. Layout overlays marked attributes only on touched lines at typeset time.

Re-derive composition liveness from the session invariants. Do not copy CodeEditTextView's `updateForNewSelections` branch, whose return value appears opposite to its own comments when marked ranges stop matching selections. A nonintersecting external edit may advance the current generation because anchors preserve all marks. Before a command changes cursor count or moves a cursor outside its corresponding mark, accept and clear the current composition, notify `inputContext?.discardMarkedText()`, then apply the command.

External edits enter as revision-tagged anchored mutations, never as an `NSRange` that survives composition teardown. When one intersects a mark, anchor its boundaries in the current generation, restore the originals, clear session state and marks, notify `discardMarkedText()` behind a teardown reentrancy guard, resolve the boundaries in the restored generation, and only then apply it. A boundary inside ephemeral marked text has no stable meaning after restoration; reject that mutation and make its producer recompute after cancellation. A caller that cannot provide anchors must request cancellation before calculating its UTF-16 range. An unexplained generation jump follows the same cancellation order rather than guessing.

`unmarkText()` accepts the current composition. It does not delete it. `cancelComposition()` restores the original slices and selections and creates no undo item. `doCommand(by:)` maps `cancelOperation(_:)` and Escape to that cancellation path, clears protocol state, then synchronizes the input context. Intermediate composition updates do not enter undo history. Acceptance creates one semantic undo group from the original slices to the final marked text.

`insertText` must handle both explicit replacement and `NSNotFound`. With an active composition, `NSNotFound` replaces the tracked participating marks and closes the session. An explicit range always wins: apply it in the current pre-call document, restore disjoint secondary marks, accept intersected secondary text, and accept the resulting primary text. Acceptance creates the same single undo group as `unmarkText()`. Keep STTextView's finding that dictation can arrive through the `NSNotFound` path.

Automated protocol and state-machine tests cover:

- dead-key composition.
- single and multiple cursors.
- selected-text replacement.
- changing marked-text length.
- nonzero selected subranges inside marked text.
- explicit replacement with multiple cursors.
- explicit ranges inside, across, and outside a length-changed primary mark.
- an explicit range crossing a secondary temporary mark.
- dictation through both replacement paths.
- commit, cancel, undo, and redo.
- a real Escape key through `cancelOperation(_:)`.
- emoji, combining marks, split surrogate boundaries, and CRLF-normalized input.
- selection changes and external edits at, outside, and across every marked range.
- first-rectangle clipping across wrapped fragments and nearest-index hit tests outside every view edge.

Real-window integration runs record the macOS version and selected input source. Exercise Korean first, then Japanese and Chinese candidate replacement, dead keys, dictation through both replacement paths, and candidate-window geometry while scrolled and wrapped. These cannot be replaced by direct method calls.

## Keep accessibility to one text-area element

Use CodeEditTextView's 168-line `TextView+Accessibility.swift` as the method and size template. Keep the adapter near 170 protocol lines, with range work in focused helpers. The editor `NSView` is one `.textArea` accessibility element. Do not expose one child per line or fragment. A query locates its start in O(log lines + log fragments), then pays work proportional to the requested text or fragments.

`EditorSurfaceView+Accessibility.swift` implements the concrete AppKit surface:

- `isAccessibilityElement()`, `isAccessibilityEnabled()`, `isAccessibilityFocused()`, `setAccessibilityFocused(_:)`, `accessibilityRole()`, `accessibilityLabel()`, `accessibilityValue()`, and `setAccessibilityValue(_:)`.
- `accessibilityNumberOfCharacters()`.
- `accessibilitySelectedText()`, `setAccessibilitySelectedText(_:)`, `accessibilitySelectedTextRange()`, `setAccessibilitySelectedTextRange(_:)`, `accessibilitySelectedTextRanges()`, and `setAccessibilitySelectedTextRanges(_:)`.
- `accessibilityVisibleCharacterRange()`.
- `accessibilityString(for:)`, `accessibilityAttributedString(for:)`, and `accessibilityStyleRange(for:)`.
- `accessibilityLine(for:)` and `accessibilityRange(forLine:)`.
- `accessibilityRange(for:)` for a character index or screen point and `accessibilityFrame(for:)` for a UTF-16 range.
- `accessibilityInsertionPointLineNumber()`. The modern protocol methods above are the contract; do not override deprecated `accessibilityParameterizedAttributeNames` unless an `AXUIElement` smoke test proves AppKit fails to advertise one.

Materialize the whole document only when a client explicitly asks for `accessibilityValue`. Range queries read a bounded snapshot slice. `accessibilityAttributedString(for:)` emits `NSAccessibility` text attributes, not AppKit or CoreText keys. Geometry queries synchronously typeset every intersecting line and requested fragment before answering, then convert the union to screen coordinates. Content setters require an editable document. Selection setters require a selectable document and valid bounds, so read-only text remains navigable.

For a valid zero-length range, `accessibilityFrame(for:)` returns the insertion-caret rectangle with zero width and the resolved line height in screen coordinates. This includes document end and the final empty line after a trailing newline. It does not return `.zero` merely because the requested range is empty.

Fix the reference defects deliberately:

- Count UTF-16 units, not Swift graphemes.
- Convert points from screen to view coordinates and frames from view to screen coordinates.
- Respect `setAccessibilityFocused(false)` instead of always focusing the view.
- Return the composed-character range at a point, not a zero-length caret.
- Reject negative indexes and clamp only where the protocol requires it.
- Post coalesced value, selection, focus, and layout notifications at editor transaction boundaries.

Method-level tests cover ASCII, emoji, combining marks, multiple selections, line navigation, a trailing empty line, empty-range and document-end caret frames, visible-range changes after scroll, read-only mode, notifications, and bounded queries on a megaline. Real-window smoke tests drive `AXUIElement` for range and screen-frame queries and verify the result with VoiceOver; record the macOS and VoiceOver versions.

## Target and file ownership

Keep the editor implementation in `EditorCore`; annotate AppKit and CoreText owners `@MainActor` while leaving the text buffer nonisolated. `MacApp` owns only window and application composition.

| responsibility                           | owner files                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| document transaction revision            | `EditorCore/Document/DocumentRevision.swift`, `EditorCore/Document/RevisionedSnapshot.swift`                                                  |
| line records and augmented tree          | `EditorCore/Layout/LineRecord.swift`, `EditorCore/Layout/LineTreeNode.swift`, `EditorCore/Layout/LineTree.swift`                              |
| height and fragment state                | `EditorCore/Layout/LineHeightState.swift`, `EditorCore/Layout/FragmentIndex.swift`, `EditorCore/Layout/PartialLineLayout.swift`               |
| prepared CoreText state                  | `EditorCore/Layout/PreparedLine.swift`, `EditorCore/Layout/CoreTextLineTypesetter.swift`                                                      |
| style values and interval store          | `EditorCore/Styling/StyleRun.swift`, `EditorCore/Styling/StyleRunStore.swift`                                                                 |
| highlighting provider boundary           | `EditorCore/Styling/HighlightProvider.swift`, `EditorCore/Styling/HighlightCoordinator.swift`                                                 |
| semantic undo groups                     | `EditorCore/Undo/EditorMutation.swift`, `EditorCore/Undo/EditorUndoGroup.swift`, `EditorCore/Undo/EditorUndoManager.swift`                    |
| owner-drawn surface and decoration paint | `EditorCore/Rendering/EditorSurfaceView.swift`, `EditorCore/Rendering/SelectionRenderer.swift`                                                |
| composition state and protocol adapter   | `EditorCore/Input/CompositionSession.swift`, `EditorCore/Input/MarkedTextOverlay.swift`, `EditorCore/Input/EditorSurfaceView+TextInput.swift` |
| accessibility queries and adapter        | `EditorCore/Accessibility/AccessibilityTextQueries.swift`, `EditorCore/Accessibility/EditorSurfaceView+Accessibility.swift`                   |
| app window and shell                     | `MacApp/main.swift`, later `MacApp/EditorWindowController.swift`                                                                              |

## Implementation sequence and gates

Each phase ends in a state that can be measured and reviewed.

1. Translate the central 35 tests and all 108 focused tests. Record the expected compile failures.
2. Port the buffer in the import-derived waves. Run the smallest newly runnable slices after each wave; run the central suite only after wave 9 completes its API.
3. Add `EditorBench` rows for insert, walk, seek, snapshot, and anchor resolution. Profile ARC before considering an arena.
4. Build the augmented line tree with structural property tests, O(n) bulk build, estimate correction, and scroll-anchor compensation.
5. Replace the spike overlay with the real piece table and line tree. Keep the existing CoreText spike as the same-corpus control. Rerun both the timing trace and inserted-frame visual QA.
6. Add semantic undo groups and prove that every inverse restores text and selections across shared snapshots.
7. Add resumable megaline preparation and fragment layout. Gate input work, background preparation, direct scroll jumps, and estimate correction separately.
8. Add the style run store, provider seam, byte-derived `InputEdit`, and invalidation algebra. Confirm that selection movement emits no typesetting work or glyph drawing.
9. Add `NSTextInputClient` and the composition-session tests. Run Korean composition before adding more editor commands.
10. Add the single-element accessibility adapter and real-window tests.
11. Fill the plan-2 native benchmark rows for piece-table operations, large mount, long line, typing, and scrolling. Capture Animation Hitches separately from the input-to-transaction work gate.

The design plan's exit criterion is complete: the corrected inserted frame passed visual QA, the calibrated 200-sample clock run passed at 1.298 ms p95, and the attached Logging trace passed at 1.369 ms p95 across 282 complete intervals. The editor implementation is not complete. Phase 5 replaces the spike-only global overlay and Foundation line lookup with the real piece-table and line-tree path. Every later phase reruns the timing and visual gates rather than inheriting the spike's result.
