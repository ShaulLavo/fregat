# Native Editor Internals — Research Synthesis

Deep-read of the reference codebases in `~/Desktop/D/references/` (2026-08-28): CodeEditTextView + CodeEditSourceEditor (custom CoreText, macOS), STTextView (TextKit 2, macOS/iOS), Runestone (custom CoreText, iOS), plus a breadth pass over CotEditor, Chime, CodeEdit-the-app, and CodeEditorView. Input to plan 2 (`native-editor-core-design.md`). Fits the settled ghostty model: custom owner-drawn surface, native everything else.

## Verdict: custom CoreText, not TextKit 2

STTextView is the best TextKit 2 practitioner in existence, and its source is a catalog of reasons not to follow it:

- A dozen FB-numbered workarounds for engine bugs it cannot fix: `NSTextContentStorage.replaceContents` non-functional (FB9925647), selection corruption after edits fixed by hand, wrong metrics on the last empty line (FB15131180), `lineHeightMultiple` ignored in fragment drawing, `usageBoundsForTextContainer` notification broken until macOS 15.6 (FB13291926), and more.
- One **private-API selector call just to draw a fragment** (`NSTextLayoutFragment` needs layout; no public API; they call an obfuscated `layout` selector).
- **Document height is only ever an estimate** — exact height requires a whole-document `ensureLayout` their own comment says takes _seconds_; they clamp against an end-anchor as a workaround. This alone disqualifies it against our bench bar: geometry must be exact and cheap.
- And the "free" stack still isn't free: they hand-wrote ~250 lines of `NSTextInputClient`, 235 lines of `NSAccessibility`, a 338-line `NSTextCheckingClient`, all the caret/selection/gutter views — ~7,100 LOC in the AppKit target anyway.

The custom path costs, measured on macOS: CodeEditTextView is ~9,400 LOC total, of which the parts TextKit would have provided — typesetting (~900), layout (~1,380), line tree (~1,030) — are the parts we _want_ to own, and the "OS integration tax" is small: **~300 LOC `NSTextInputClient` + ~100 LOC marked-text state machine + ~170 LOC accessibility**. (Runestone's ~2,500–3,000-line input bill is a UIKit/`UITextInput` phenomenon; the macOS protocol is an order of magnitude cheaper, confirmed independently by both macOS codebases.) In exchange: exact geometry at all times, per-line incremental everything, no dependency on Apple fixing radars.

## The convergent core: one augmented red-black tree

Two codebases that never talked to each other (CodeEditTextView, Runestone) built the same structure — an order-statistics red-black tree over lines, augmented with cumulative sums so multiple coordinate systems resolve in O(log n) against one index (the AvalonEdit/CodeMirror document-model lineage):

| Aggregate per node | CodeEditTextView                       | Runestone                                        | Ours                       |
| ------------------ | -------------------------------------- | ------------------------------------------------ | -------------------------- |
| UTF-16 length      | ✓                                      | ✓                                                | ✓                          |
| Line count         | ✓                                      | ✓ (order statistics)                             | ✓                          |
| **Pixel height**   | ✓ (scroll-y → line, O(1) total height) | ✓                                                | ✓                          |
| **Byte count**     | —                                      | ✓ (tree-sitter `InputEdit` needs no string scan) | ✓ — take Runestone's trick |

Shared companion techniques, all worth adopting wholesale:

- **Estimated heights live in the tree** and self-correct as lines get measured; total document height is the root sum — O(1), always consistent with the scrollbar.
- **Above-viewport height corrections feed back as a scroll-offset adjustment** so the viewport never jumps (both implement this independently).
- **The same tree type is reused per-line for wrap fragments.**
- Runestone only: **resumable partial typesetting** of a single line (a 10k-wrap megaline typesets only to the visible y, keeps a `startOffset` to continue) + `bestGuessNumberOfLineFragments` extrapolation.
- CodeEditTextView only: `Unmanaged` node references in hot paths (measured 15% on insert), O(n) bulk build of a perfectly balanced tree at open.

## Design directives for plan 2

1. **Own the text buffer — by porting the web editor's piece table.** CodeEditTextView's ceiling is `NSTextStorage`-as-document (UTF-16 contiguous, main-thread-only, styling mutates storage → re-typesets); Runestone wraps `NSMutableString`. Neither owns their buffer. We already do, once: `editor/packages/editor/src/pieceTable/` (~3,600 LOC) is a **persistent (path-copying) treap-based piece table** — deterministic seeded FNV priorities, subtree aggregates (length, _visible_ length, piece count, line breaks, order min/max), piece-level visibility (folding lives in the document model), bias-carrying anchors with surrogate-pair awareness, snapshots. Port it 1:1: it plays the same O(log n) role as the references' red-black line trees, its UTF-16 offsets are exactly what CoreText/`NSAttributedString` index by, and **persistence gives immutable `Sendable` snapshots for free** — background tree-sitter/LSP/highlight reads with zero locks, which directly deletes the main-thread ceiling that caps every reference editor. The 35-test suite (+ its edge cases) ports first as the spec. Keep the web editor's layering: the piece table stays geometry-free; pixel heights and byte counts live in the line/layout layer above it (the references' height-augmented tree, Runestone's byte trick). One thing to bench honestly: path-copying churn under ARC (JS's GC eats persistent-tree garbage happily; Swift refcounting may want `final` classes or arena nodes — measure, don't guess).
2. **Style never enters the character store.** CodeEdit keeps highlight runs in a rope-backed `RangeStore` and then _copies them into storage attributes_ — the copy is the mistake (their own weak spot; CotEditor's temporary-attributes trick is the same lesson from the TextKit 1 world). Apply style at typeset time from the run store.
3. **Per-line `CTTypesetter` → `CTLine` fragments**, marked-text attributes overlaid pre-typeset. Line-break via `CTTypesetterSuggestLineBreak` (both repos carry a width-overshoot workaround — copy it).
4. **Rendering**: recycled per-fragment views (both) work but CodeEdit flags view churn; plan 2 should bench fragment `CALayer`s vs views. Selection/caret painted separately from text so selection changes never redraw glyphs (all three do this).
5. **IME**: `NSTextInputClient` (~350 LOC). Steal CodeEditTextView's multi-cursor marked-text handling (documented as more correct than VS Code) and undo-suppressed composition; note STTextView's finding that dictation enters through the `replacementRange == NSNotFound` path. Test Korean composition early — Runestone's comment museum shows it's the IME that breaks first.
6. **Accessibility**: modern `NSAccessibility` protocol, single `.textArea` element, tree-backed O(log n) line queries — CodeEditTextView's ~170-line model is the template.
7. **Undo**: custom stack of (mutation, inverse) pairs behind an `UndoManager` subclass so menu validation works (CEUndoManager model); record selections per group (their approximation is a flagged weakness).
8. **Highlighting pipeline**: Chime's three-phase Neon styler is the state of the art — instant cheap fallback → tree-sitter tokens → async LSP semantic tokens, revalidating only visible ranges — combined with CodeEdit's valid/pending/visible IndexSet algebra and 4,096-char chunking. Their `HighlightProviding` protocol seam (tree-sitter and LSP as peer providers) maps directly onto our server-proxy plan. Do **not** copy CodeEdit's `TreeSitterExecutor` (a polling spinlock they themselves apologize for).
9. **Edits map to tree-sitter via byte aggregates** (Runestone): store byte counts in the tree, emit `InputEdit` without scanning, diff old/new trees with `ts_tree_get_changed_ranges`, invalidate at line granularity.

## Reading map

| Question              | Open                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Line tree             | `CodeEditTextView/Sources/CodeEditTextView/TextLineStorage/` and `Runestone/Sources/Runestone/RedBlackTree/` + `LineManager/`              |
| Viewport layout loop  | `CodeEditTextView/.../TextLayoutManager/TextLayoutManager+Layout.swift` (~320 lines, excellent)                                            |
| IME on macOS          | `CodeEditTextView/.../TextView/TextView+NSTextInput.swift` + `MarkedTextManager/`; STTextView's `STTextView+NSTextInputClient.swift`       |
| IME horror checklist  | `Runestone/.../Core/TextInputView.swift` (comments)                                                                                        |
| Highlight scheduling  | `CodeEditSourceEditor/.../Highlighting/` (IndexSet algebra, RangeStore); `Chime/Modules/Highlighting/Highlighter.swift` (three-phase Neon) |
| TextKit 2 bug catalog | grep STTextView for `FB`                                                                                                                   |
| SwiftUI↔AppKit seam   | `CodeEdit/Features/Editor/Views/CodeFileView.swift`; the revert story in `CodeEditWindowController.swift`                                  |
| macOS citizenship     | CotEditor (encodings, line endings, find/replace)                                                                                          |
