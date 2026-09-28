# Markdown editing and parsing behaviour

Research for [Plan 176](../../plans/176-markdown-parser.md), 2026-09-28. This pass inspected
current reference code and official documentation. It did not run those editors interactively or
repeat parser benchmarks. Observations below are evidence; the proposed contract is our inference
from that evidence and the existing source-preserving Editor design.

## What established editors do

| Editor                      | Authoritative document                                       | Relevant practice                                                                                                                             | What it does not establish                                                               |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Obsidian Live Preview       | Markdown source exposed through its editor API               | Formatted content reveals syntax when the caret enters it; Reading view is separate                                                           | Its closed-source parser scheduling and incomplete-tree policy                           |
| SilverBullet                | CodeMirror source document                                   | Selection over an inline construct reveals syntax; rendered tables map clicks to source; composition preserves mapped decorations             | A guarantee that all parsing/decorations run only for visible rows                       |
| CodeMirror + Lezer Markdown | Complete source document, potentially incomplete syntax tree | Explicit parse coverage, reusable fragments, viewport demand and cooperative background parsing                                               | Full-render correctness: Lezer deliberately does not validate reference-link definitions |
| Milkdown                    | ProseMirror rich document imported from Markdown             | Initial document parsed before editor state; expensive code editors mount near the viewport, retain focus and map edits/history to the parent | Exact preservation of original Markdown spelling and whitespace                          |
| Lexical Markdown demo       | Rich document with Markdown import/export                    | Typing shortcuts change structure, respect IME composition and define undo boundaries                                                         | A complete CommonMark renderer or source-preserving file editing                         |

There is no single universal Markdown-editor pipeline. Source-backed preview and rich-document
editing share useful interaction practices, but have different text ownership. For Platform,
retain the existing source buffer and borrow the selection, focus and deferred-display practices.

### Source-backed preview

[Obsidian's editing-mode documentation](https://obsidian.md/help/edit-and-read) describes syntax
revealing when the cursor enters formatted content. Its public API exposes a CodeMirror
`editorLivePreviewField`; that establishes an extension interface, not its private implementation.

SilverBullet provides inspectable precedent. Its
[inline decorations](https://github.com/silverbulletmd/silverbullet/blob/aae7af42a829ff6b4a7ddb0e7638feae536d0a8a/client/codemirror/hide_mark.ts#L45)
leave markers visible when any selection overlaps the complete construct. Its
[table widget](https://github.com/silverbulletmd/silverbullet/blob/aae7af42a829ff6b4a7ddb0e7638feae536d0a8a/client/codemirror/table.ts#L42)
maps clicks to annotated source positions and restores source on selection. Its
[shared helpers](https://github.com/silverbulletmd/silverbullet/blob/aae7af42a829ff6b4a7ddb0e7638feae536d0a8a/client/codemirror/util.ts#L104)
map existing decorations during composition; per-line hiding preserves keyboard entry from below.
These are reasons to test selections and navigation from both sides of a rendered block.

### Complete text and incomplete parsing are separate

CodeMirror's [language implementation](https://github.com/codemirror/language/blob/8e9700018446d46f23267f6e31da56628d5117c0/src/language.ts#L288)
always reads the full editor document. Its parse context tracks reusable fragments, skipped
ranges and progress. Edits create work against the new document and map reusable ranges; scrolling
requests newly needed coverage. Background callbacks use the current state and cancel on destroy.
The [public coverage API](https://codemirror.net/docs/ref/#language.syntaxTreeAvailable) explicitly
allows an incomplete syntax tree.

Its budgets are cooperative: the parser's `advance()` must return before the scheduler checks
the deadline. Copying its millisecond constants would not make a non-yielding wasm parse bounded.
Also, [Lezer's documented reference-link tradeoff](https://code.haverbeke.berlin/lezer/markdown/src/branch/main/README.md)
means its local syntax tree alone is insufficient evidence for rendering a reference link.

CodeMirror also [requires layout-changing decorations before viewport computation](https://github.com/codemirror/view/blob/fbff59ba004d80d8c914f64c42586387b08706ac/src/editorview.ts#L1054).
A table's height can change which rows are visible. Our block geometry therefore belongs to the
Editor display projection; the visible-inline loop cannot be the sole owner of block layout.

### Fully rendered editors defer display work too

Milkdown [parses initial Markdown into its rich document before creating editor state](https://github.com/Milkdown/milkdown/blob/bbb8bcbbb8ce0aa16f92567c23f6236747be9b3b/packages/core/src/internal-plugin/editor-state.ts#L49).
Its [code-block view](https://github.com/Milkdown/milkdown/blob/bbb8bcbbb8ce0aa16f92567c23f6236747be9b3b/packages/components/src/code-block/view/node-view.ts#L23)
shows actual code as a placeholder, mounts the inner editor near the viewport, and retains it
while focused or selected. The same file maps edits and selection to parent transactions and
routes undo and edge navigation to the parent. This defers presentation over known content.

Both [Milkdown input rules](https://github.com/Milkdown/milkdown/blob/bbb8bcbbb8ce0aa16f92567c23f6236747be9b3b/packages/prose/src/toolkit/input-rules/custom-input-rules.ts#L8)
and [Lexical Markdown shortcuts](https://github.com/facebook/lexical/blob/b8cd393673c9aa4fe97df4658f2667b2b1888aca/packages/lexical-markdown/src/MarkdownShortcuts.ts#L581)
protect active IME composition. Their Markdown serializers and rich-paste behaviour are separate
product choices. Adopting those would change Platform's source-editing contract.

## Proposed contract for Platform

This preserves Plan 108's existing source-on-entry behaviour pending the owner's clarification
of "fully rendered inside the editor". The working assumption is rendered block content backed
by source. Keeping syntax hidden during editing is another interaction policy; it can also use
the source buffer with mapped edits and need not adopt rich-document serialization. That policy
requires explicit gesture tests and is not silently selected here. Chat and the existing split
renderer remain unchanged.

1. **One complete source document.** The retained buffer owns all text, edits, undo and revision
   identity from open. Parsing never appends missing text to the user's buffer. One compatible
   `MarkdownDocument` belongs to that buffer's analysis, following Plan 198; each view owns its
   selection, scroll and rendering policy. Closing a view releases its demand, not another
   view's parser. Theme changes reuse structural data where valid.
2. **Complete structure, lazy inline work.** Start with the current parser API's complete block
   parse and document-wide definition index, then resolve inline records for the actual visible
   ranges and necessary enclosing blocks. Opening at a restored position requests that range,
   not always rows 0–60. Definitions after the viewport can affect links before it. Invalidation
   includes changed/deleted definitions and every dependent leaf, including offscreen leaves.
3. **Honest readiness.** Follow Plan 198's identity, revision, configuration and coverage checks.
   A ready visible range attaches with its text and decorations in one paint. A cold pending
   source-backed view remains editable source until exact results exist; preserve existing valid
   content where possible. Use the existing subject-switch loading contract. A future read-only
   rendered presentation can retain its previous complete subject while preparing the new one.
   No incomplete parse is labeled complete; a prefix boundary is not the document's EOF.
4. **Responsiveness is a gate.** Prefetch and warm-up request the same document analysis that
   activation uses. Background priority alone does not make synchronous `setText`/`edit` calls
   yield. Measure cold full block/definition preparation, visible inline work and edit cost in
   the real Editor. If a call misses the established input/frame budget, add a genuinely resumable
   parser operation or measured off-thread preparation before shipping that path. Do not ship a
   synchronous long task merely because it was scheduled during idle time. Phase 1 records the
   chosen mechanism and numeric budgets before integration continues.
5. **Partial parsing requires a separate proof.** The current API has no resumable parse/coverage
   contract. Retire the fixed 60-row prefix-append prescription. Any later partial implementation
   must retain full source, explicit coverage and incomplete global-reference status, never hide
   markers for uncertain constructs, and prove settled results equal a fresh whole-document
   parse. Cutoffs inside paragraphs, fences, lists, tables and HTML are adversarial fixtures.
6. **Edits and background publication.** Edits update the parser from committed source changes,
   then derive current visible results. Background work may publish only for its captured buffer
   incarnation/revision/configuration. Superseded jobs cancel or restart against current text;
   mapped visual ranges are not proof of current semantics. Fence-worker replies use the same
   admission rule. Scrolling promotes the new range; disposal cancels unused work. One view's
   cancellation cannot cancel another's demand.
7. **Caret and selection.** In live preview, any selection intersecting a construct reveals its
   source; leaving allows it to render again. Preserve source-offset selections, multi-cursor
   behaviour, parent undo and source clipboard semantics. Display-only updates create no undo
   entry. Malformed syntax remains source. During IME composition, keep the active input host
   and selection stable; defer replacements that would disturb it until composition completes.
8. **Rendered blocks.** Plan 111 owns measured block heights and the display projection; Plan 108
   owns the interactions. Tables/images/fences use explicit source mappings for click and
   keyboard entry/exit. Mount expensive interactive content near the viewport; keep focused or
   composing content alive. Embedded editing sends source transactions to the parent history.
   Preserve a source-position scroll anchor when block heights settle, including above the
   viewport. Parsing completion alone does not scroll the caret or move focus.

This contract makes parser integration ready to implement after Phase 0. It does not claim that
full rendered-block editing ships in Plan 176, or that the current parser already meets the
large-file scheduling gate.

## Acceptance cases

| Case                                                                          | Required result                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Warm open, revisit, restored scroll far below row 60                          | Correct visible records on first text frame when compatible analysis is ready; same retained document  |
| Cold open and parser failure                                                  | Editable source/pending or terminal fallback; no frozen input; actual task duration measured           |
| Long paragraph, fence, HTML, list or table crossing a proposed parse cutoff   | Same settled records/highlights/folds/injections as fresh full parse; no provisional hidden source     |
| Reference definition at EOF, insertion, deletion, duplicate-first-wins change | Earlier links agree with a fresh parse, including after scrolling back                                 |
| Edit, undo, redo, external reload or rapid A → B → A while work is pending    | Current source and history preserved; obsolete revision/identity results never publish                 |
| Two views with different visible ranges                                       | Shared compatible analysis, independent selections; scrolling/closing one preserves the other's demand |
| Selection across markers or rendered blocks; entry from above/below           | Deterministic source mapping, source-equivalent edits/copy/cut and parent undo                         |
| Hebrew/emoji and IME composition commit/cancel during background work         | Correct UTF-16 positions, stable composition host and selection                                        |
| Rendered height change above viewport; focused widget leaves overscan         | Source scroll anchor preserved; active widget retained                                                 |
| Ordinary, 1 MB, giant single-block, dense-reference and deeply nested files   | Recorded first-frame, input latency, longest task and memory; controlled fallback where needed         |

Extend `prefetch-first-paint` and `editor-tab-hover-highlights`, including a delayed-result negative
control. Compare every expected visible construct and source range with a settled reference;
finding one decorated span cannot prove a fully correct frame. Phase 108's gesture suite checks
buffer/selection/history, and Plan 111's block tests check hit testing and layout. Read back `look`
evidence when those UI changes land. This research pass supplies no UI evidence of its own.

## Reference revisions

Local clones live under `references/`; existing clones were fetched and clean clones updated
before inspection. New clones contained source only, with no installed dependencies.

| Repository                  | Inspected commit                           | Primary files                                                         |
| --------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| codemirror/language         | `8e9700018446d46f23267f6e31da56628d5117c0` | `src/language.ts`                                                     |
| codemirror/view             | `fbff59ba004d80d8c914f64c42586387b08706ac` | `src/editorview.ts`                                                   |
| lezer/markdown              | `f847886185e9262235ed3cf35b32bbb31bbe2f6d` | `README.md`, `src/markdown.ts`                                        |
| obsidianmd/obsidian-api     | `cc1744324150c632416857c98964f87b1574a5fc` | `obsidian.d.ts`                                                       |
| silverbulletmd/silverbullet | `aae7af42a829ff6b4a7ddb0e7638feae536d0a8a` | `client/codemirror/{hide_mark,table,util}.ts`                         |
| Milkdown/milkdown           | `bbb8bcbbb8ce0aa16f92567c23f6236747be9b3b` | editor-state, code-block node-view, input-rules and clipboard plugins |
| facebook/lexical            | `b8cd393673c9aa4fe97df4658f2667b2b1888aca` | markdown-editor demo and MarkdownShortcuts                            |

Open implementation question: whether the current C block/definition pass can meet the browser
input budget for our large-file cases, or needs resumable/off-thread preparation. The references
provide no measurement that answers this for our wasm module. The upstream release discrepancies
and nesting trap are tracked in Plan 176 Phase 0, not accepted as a side effect of lazy rendering.
