# Editor decorations: learn from CodeMirror and Lexical, then beat what we have

Status: **research done 2026-09-25; proposed phases below await the owner questions.** Requested 2026-09-13.

Decided 2026-09-25: owner — the research is authorized, with the chat composer as its first consumer
(question 7; Plan 126 INTERACTION-11 deletes Lexical). The owner wants it done before the next wave.

The editor already has a decoration primitive. `@singapore-editor/core` exposes `registerInlineReplacementProvider` and `InlineReplacementSpec`, and [`@singapore-editor/markdown`](../../Editor/packages/markdown/src/index.ts) uses it to hide fences, drop heading markers and collapse links while the buffer keeps holding source. That is the right shape. It is also inline-only, driven by generically-named Tree-sitter captures, and has never been compared against the two systems that solved this problem thoroughly.

This plan does that comparison and then improves our layer. It is the gate for [Plan 108](108-markdown-modes.md) Phase 2, for an eventual Obsidian mode, and — less obviously but more valuably — for removing Lexical from the chat composer. [Root PLAN.md](../PLAN.md) owns scheduling.

## Why this is worth doing properly

Obsidian is closed source, but its architecture is not secret: the public `obsidian-api` typings import `Extension` and `StateField` from `@codemirror/state` and `EditorView` and `ViewPlugin` from `@codemirror/view`, and export `editorEditorField: StateField<EditorView>` — "Use this StateField to get a reference to the EditorView". Live Preview is CodeMirror 6 decorations. The reference implementation for the experience we want is open source even though the product is not.

Separately, the chat composer runs on Lexical for exactly one capability: `ChatInputMentionNode extends DecoratorNode`, giving `@`-mention chips that the caret steps over and one backspace deletes. Everything else around it — draft, submit, surround, line-boundary, history plugins — is ours. If our editor gains atomic ranges and widgets, that capability stops needing a second editor framework.

## What we have today

| Piece               | Current state                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive           | `InlineReplacementSpec[]` returned from a registered provider. Inline ranges only.                                                                                                                                                                                                                          |
| Source of structure | Tree-sitter highlight captures. `@singapore-editor/markdown`'s own comment: the queries "name things generically — `punctuation.delimiter` covers both emphasis fences and link brackets", so constructs are recovered "by containment for emphasis and code spans, and by adjacency for links and images." |
| Failure posture     | Anything not matching its expected shape is left as plain text, so malformed input renders as source rather than losing characters. A good default, and evidence the recovery is heuristic.                                                                                                                 |
| Missing             | Block-level replacement (a rendered table, image or fence). Widget lifecycle. Explicit atomic-range caret semantics. A composition story for two providers decorating overlapping ranges.                                                                                                                   |
| Consumers           | One: markdown preview.                                                                                                                                                                                                                                                                                      |

## Questions this plan must answer

1. **What is the full decoration taxonomy we need?** CodeMirror distinguishes mark (style a range), widget (insert at a point), replace (substitute a range, inline or block) and line decorations, over a `RangeSet` that maps through document changes. Which of these do we need, and which are we missing?
2. **How do decorations survive edits?** A decoration set that is recomputed from scratch per keystroke is correct and slow; one that maps through changes is fast and subtle. Which does our rendering path allow, and what does it cost on a large file?
3. **What are the caret semantics of a replaced range?** Entering, leaving, selecting across, backspacing into, and undoing over. This is where both CodeMirror's `atomicRanges` and Lexical's `DecoratorNode` earn their complexity, and where our inline replacements are currently unspecified.
4. **How do two providers compose?** Markdown preview plus LSP inlay hints plus a find highlight, over overlapping ranges, with deterministic ordering.
5. **What does a block widget mean in a virtualized renderer?** Our editor virtualizes; a rendered table has a height the line model does not know. This is the hardest question and the one that decides whether Plan 108 Phase 2 is weeks or months.
6. **Is the Tree-sitter capture source a dead end?** For markdown, almost certainly — [Plan 108](108-markdown-modes.md) D5 already proposes moving to an AST. Is that markdown-specific or a general statement about deriving structure from highlight queries?
7. **Could the composer run on this?** With widgets and atomic ranges, is `ChatInputMentionNode` expressible as a decoration over a plain buffer? If yes, Lexical becomes deletable and the composer becomes one more editor host.

## Research steps

1. **Clone the references** into the repo's `references/` directory (gitignored; see AGENTS.md "Reference Clones"): `codemirror/view` and `codemirror/state`, `facebook/lexical`, and the `obsidianmd/obsidian-api` typings. Read `Decoration`, `RangeSet`, `ViewPlugin`, `atomicRanges` and `blockWidget` in CM6, and `DecoratorNode`, `NodeKey` and the reconciler in Lexical.
2. **Survey real plugins, not just the APIs.** CodeMirror's own markdown live-preview examples, and two or three third-party decoration-heavy plugins. The APIs describe what is possible; the plugins show which parts are actually usable.
3. **Write the gap table.** Each capability, whether `@singapore-editor` has it, what it would take, and which consumer wants it.
4. **Answer the seven questions** in a decision table, including an honest verdict on question 5 with a measurement, not an estimate.
5. **Propose the API.** A concrete decoration API for `@singapore-editor/core`, with migration notes for the one existing consumer.
6. **Split into executable plans.** At minimum: the decoration layer itself, and the composer migration as its own multi-stage sequence.

Completion: a gap table, a decision record, a proposed API, and the follow-up plans it becomes — including an explicit yes or no on question 7.

## What this unblocks

| Downstream                                | Dependency                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Plan 108](108-markdown-modes.md) Phase 2 | Block widgets (its D6) and caret semantics. Phase 2 is explicitly blocked on this plan's findings. |
| Obsidian mode                             | Everything Plan 108 Phase 2 needs, plus the feature work in [Plan 110](110-workspace-indexing.md). |
| Composer de-Lexical                       | Question 7. A multi-stage plan of its own, and not urgent — the composer works today.              |
| LSP inlay hints and inline diagnostics    | Question 4's composition story, whether or not markdown ever needs it.                             |

## What this plan does not do

- No implementation. It produces a gap table, a decision record, a proposed API and follow-up plans.
- No change to `@singapore-editor/markdown` or to the current preview behaviour.
- No composer changes. Question 7 is answered here; acting on it is a separate plan.
- No commitment to Obsidian mode. This plan establishes whether the foundation can support it, not whether we build it.

## Research findings (2026-09-25)

Read from Platform origin/main `9f3438258` (the lane branches carry older copies of this plan) and Editor main `c23cd30`. There is no Plan 171 on main or on any branch. Teardown, pinned reference commits and the benchmark tables are in [docs/editor-decorations/survey.md](../docs/editor-decorations/survey.md). Editor paths below are relative to `Editor/packages/`.

**Question 7: yes.** A mention is expressible as a decoration over a plain buffer, and Lexical becomes deletable. The Editor already renders a replaced range as a DOM widget and moves the caret over it as one unit. It lacks four things a chip needs, all small, and the composer has two larger prerequisites: proportional-font wrap and a content-height signal. Zed's agent message editor already works this way: a mention is an inline crease over the buffer's own link text (`crates/agent_ui/src/mention_set.rs:1084-1176`).

### Correction to "What we have today"

The primitive is wider than inline replacement. The Editor has six decoration channels with four position models: inline replacements, insertions and DOM widgets on piece-table anchors (`editor/src/inlineMap.ts`, `displayTransforms.ts:108-136`); range highlights on raw offsets; the edit-tracked `EditorDecorationStore` with 4-way bias (`editor/src/editor/decorationStore.ts:101`); row decorations; injected rows for the diff. A block-surface subsystem existed and was deleted on 2026-08-22 (Editor `7974443`, 4,548 lines).

### Gap table

| Capability                          | CM6                                                 | Lexical                         | `@singapore-editor` today                                                   | What it takes                                                       | Wanted by                  |
| ----------------------------------- | --------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| Mark (style a range)                | `Decoration.mark`                                   | text format / CSS               | Yes: `setRangeHighlight`, store `text` surface, `zIndex`                    | Fold into one API                                                   | LSP, find, ultrathink      |
| Line decoration                     | `Decoration.line`                                   | element node                    | Yes: `setRowDecorations`                                                    | Fold into one API                                                   | diff, headings             |
| Inline replace                      | `Decoration.replace`                                | `DecoratorNode`                 | Yes, single-line, atomic paint                                              | none                                                                | markdown, composer         |
| Point widget / phantom text         | `Decoration.widget`                                 | inline `DecoratorNode`          | Yes: `insertion` + `cursorStops`                                            | none                                                                | ghost text, inlay hints    |
| Widget DOM lifecycle                | `WidgetType` `eq`/`updateDOM`/`destroy`             | `decorate()` React              | Partial: `render(container)` → `dispose`; no `eq`, no event policy          | Identity key to reuse mounts; pointer-event opt-in                  | composer chip, images      |
| Atomic motion                       | `atomicRanges` facet                                | node step-over                  | Yes (`virtualizedTextView.ts:1976-2002`)                                    | none                                                                | composer                   |
| Atomic delete                       | `deleteCharBackward` widens (`commands.ts:550-556`) | hand-written in Platform plugin | **No**: one grapheme of source (`inputSelectionController.ts:1080-1085`)    | Widen delete/backspace/word-delete over atomic replacements         | composer                   |
| Reveal policy                       | the plugin's (ixora, latex-suite)                   | n/a                             | **Fixed**: any touch reveals (`inlineMap.ts:112-136, 437-442`)              | Per-replacement `reveal: 'touch' \| 'inside' \| 'never'`            | composer, markdown         |
| Re-derive on edit without a grammar | `ViewPlugin.update`                                 | node transforms                 | **No**: providers run when a parse lands (`syntaxController.ts:1259`)       | Provider trigger `'edit'`, run synchronously in the edit operation  | composer                   |
| Mapping cost per edit               | chunked `RangeSet.map`, 0.05 ms at 200k             | n/a                             | O(ranges) re-resolve: 7.2 ms at 20k ranges, 83 ms at 200k                   | Chunked range set shared by replacements and the store              | markdown mode, inlay hints |
| Provider ordering                   | facet precedence                                    | tree order                      | Position only, outermost first; registry has `layer`/`priority` unused here | Source `priority` decides overlaps                                  | markdown + inlay + find    |
| Wrap keeps a replacement whole      | yes                                                 | browser                         | **No** (`Editor/docs/display/transforms.md:274`)                            | Wrap treats a replacement run as unbreakable, at its measured width | composer                   |
| Proportional-font wrap              | browser                                             | browser                         | **No**: wrap counts `characterWidth` columns (E052, Proposed, P3)           | E052                                                                | composer                   |
| Block widget                        | `block: true`, height map                           | block `DecoratorNode`           | **No**: injected rows are fixed-height text; dense row-height index unused  | Height sums in the projection tree + scroll anchoring               | Plan 108 Phase 2           |
| Content height for auto-grow        | `contentHeight`                                     | CSS                             | **No** event; host can compute only for unwrapped rows                      | `onDidChangeContentHeight` from the projection's row count          | composer                   |

### Answers

1. **Taxonomy.** We need all four CM6 kinds plus atomicity and a reveal policy. Mark, line, inline replace and point widget exist today. Missing: block widgets, atomic deletion, per-construct reveal, and one registration that covers all of them.
2. **Surviving edits.** Our inline map is anchored but re-resolves every range on every edit, then reveal walks it again. Measured (survey § Measurements): 7.2 ms for `updateInlineMapForEdit` and 7.9 ms for `revealInlineMap` at 20k ranges (a 10k-line markdown file), two to three such passes per keystroke. CM6 maps 200k ranges in 0.05 ms. The composer is unaffected: 50 mentions build in 0.021 ms. **Recommendation:** composer work proceeds on today's mapping; a chunked, CM6-style range set replaces both the anchored inline map and `EditorDecorationStore.applyEdits` before markdown mode ships on large files.
3. **Caret semantics.** Motion already skips a replacement (atomic). Selection across paints it whole. Undo restores text, and derived decorations come back with it, as in CM6. Missing: delete does not widen, and reveal cannot be turned off. **Recommendation:** adopt CM6's split. `atomic: true` widens Backspace, Delete and word-delete to the whole range and keeps the caret out; `reveal` is separate, defaulting to `'touch'` for markdown (today's behaviour) and `'never'` for chips. A click on a chip maps to one of its edges (`rowOffsetForLocalIndex`, `'nearest'`); a chip that wants the click itself opts in to pointer events.
4. **Composition.** Today overlaps resolve by position (`inlineMap.ts` normalize: earlier start, then longer wins) with provider identity ignored; highlights carry `zIndex`; the projection registry has `layer`/`priority` (`editor/src/editor/displayProjectionRegistry.ts`) that inline replacements do not use. **Recommendation:** each decoration source declares a numeric priority; overlapping replacements resolve by priority, then position; marks stack by priority, as `zIndex` does now. Composer chips outrank markdown replacements.
5. **Block widgets in a virtualized renderer.** Measured: the retained dense row-height index costs 0.5 ms per resized row at 100k rows and 5.7 ms at 1M, 4.5 ms of which is the caller copying the sizes array; memory is O(rows). No producer feeds it. CM6 keeps heights in a tree with estimates and scroll anchoring. The display projection is already an AVL tree with per-subtree row counts, so pixel sums can live there at O(log n) per change. The work is the measure-and-correct loop, scroll anchoring above the viewport (`Editor/docs/parity-monaco-codemirror.md` finding "Measure-back-and-correct loop"), and vertical caret motion and hit testing across a block row. **Verdict:** weeks, as its own Editor plan, and it does not gate the composer. The earlier block-surface attempt was deleted, so the new plan starts from the projection, not from `rowHeightIndex.ts`.
6. **Tree-sitter captures as a source.** Highlight captures are a dead end for structure in general: they are named for colour, which is why markdown recovers constructs by containment and adjacency. Tree-sitter itself is fine. The languages package already keeps per-purpose query files (`tree-sitter-languages/src/queries/*-folds.scm`, `*-injections.scm`); a decoration source gets its own purpose-named query or reads the tree. For markdown, Plan 108 D5 stands.
7. **Composer on this: yes.** Details and the order of work are in the proposed phases.

### Decision record

| Decision                             | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How mentions are held                | **Recommendation:** derived from the text on every edit by `collectComposerMentions`, as CM6's `MatchDecorator` placeholder example does, skipping the token `activeComposerMention` reports at the caret. Paste, draft restore, stash and undo then need no chip code. Lexical and Zed track nodes and re-parse on paste; today a hand-typed mention stays text until reload turns it into a chip (`input-editor-actions.ts` `$setChatInputText`). |
| Where the composer's chip code lives | **Recommendation:** Platform. The Editor gains generic `atomic`, `reveal` and an edit trigger; the mention grammar stays in `@workspace/contracts`.                                                                                                                                                                                                                                                                                                 |
| One decoration API                   | **Recommendation:** one `registerDecorationSource` over the six channels, landed in two steps: the composer-facing fields first on the existing inline map, the unified range set second. Greenfield rule: rename `registerInlineReplacementProvider` in the same pass, no alias.                                                                                                                                                                   |
| Block widgets                        | **Recommendation:** separate Editor plan after the range set; gates Plan 108 Phase 2 and nothing else here.                                                                                                                                                                                                                                                                                                                                         |

### Proposed API

```ts
// @singapore-editor/core/extensions
type DecorationSource = {
  readonly id: string
  /** Higher wins an overlap between replacements and paints marks on top. */
  readonly priority: number
  /** 'edit': run inside the edit operation. 'syntax': run when a parse lands (markdown today). */
  readonly trigger: 'edit' | 'syntax'
  decorations(context: DecorationContext): readonly DecorationSpec[]
}

type DecorationSpec =
  | { kind: 'mark'; from: number; to: number; className?: string; style?: Partial<CSSStyleDeclaration> }
  | { kind: 'line'; row: number; className?: string; gutterClassName?: string }
  | {
      kind: 'replace'
      from: number
      to: number
      text: string // placeholder width until `render` is measured
      render?: InlineReplacementRender
      key?: string // equal keys keep the mounted node, as WidgetType.eq does
      atomic?: boolean // delete widens to the range; caret never rests inside
      reveal?: 'touch' | 'inside' | 'never' // default 'touch'
      groupId?: string
      className?: string
    }
  | { kind: 'widget'; at: number; text: string; render?: InlineReplacementRender; cursorStops?: InlineCursorStops }
  | { kind: 'block'; row: number; placement: 'above' | 'below'; render: InlineReplacementRender; estimatedHeight: number }

registerDecorationSource(source: DecorationSource): EditorDisposable
onDidChangeContentHeight(listener: (height: number) => void): EditorDisposable
```

`block` lands with the block-widget plan; until then the kind is absent. Migration for the one consumer: `@singapore-editor/markdown` registers `{ id: 'markdown-preview', priority: 0, trigger: 'syntax' }` and maps each `InlineReplacementSpec` to `kind: 'replace'` (or `'widget'` for insertions) with `reveal: 'touch'`, which is today's behaviour. Ghost text becomes an internal source with `trigger: 'edit'`. `setInlineMap` stays for hosts that compute maps themselves.

### Owner questions

1. **Composer font and wrap.** The composer sets prose in Inter with soft wrap; the Editor wraps by monospace columns until E052 lands (Proposed, P3, L). Options: (a) E052 becomes a prerequisite of the composer move and rises in priority; (b) the composer switches to the coding font; (c) move now and accept wrong wrap points. **Recommendation:** (a).
   Decided 2026-09-26: owner — (a): E052 (proportional-font wrap) plus word-boundary wrap are composer prerequisites.
2. **Native spellcheck.** Lexical's contenteditable gets the browser's spellcheck and mobile autocorrect suggestions. The Editor paints text outside its input element, so native squiggles cannot appear; keyboard autocorrect can be turned back on for the composer's input. Options: (a) accept losing squiggles; (b) keep Lexical until the Editor has its own spellcheck. **Recommendation:** (a).
3. **Hand-typed mentions become chips.** With derived mentions, typing `@src/app.ts` and a space turns it into a chip immediately, as a reload does today. Options: (a) yes; (b) only menu-inserted mentions are chips, which needs tracked ranges and paste re-parsing, the Zed and Lexical model. **Recommendation:** (a).
   Decided 2026-09-26: recommendation (owner deferred) — (a): a hand-typed `@path` becomes a chip once complete, as on reload today and in T3.

### Proposed phases

The follow-up plans this becomes; numbers are the coordinator's to assign.

1. **Editor: atomic replacements for hosts** (S–M). `atomic` and `reveal` on replacements, widened delete, `trigger: 'edit'` sources, widget `key` reuse, wrap keeps a replacement whole, `onDidChangeContentHeight`, prose input options (autocorrect, autocapitalize). Tests on the simple path: `new Editor(element)`, `setText`, one source.
2. **Editor: E052** (L), per owner question 1.
3. **Platform: composer on our editor** (multi-stage). (a) Host the Editor in the composer with draft sync, submit and send modes, command-menu keys, placeholder overlay and auto-grow; (b) mentions as a derived decoration source with the chip component as `render`; (c) paste handler for files and large-paste fold, surround, history, ultrathink via `setRangeHighlight`; (d) IME, mobile Enter and screen-reader checks in a `chat-composer-editing` scenario at desktop and phone widths; (e) delete Lexical: the `chat-input-*-plugin.tsx` and mention-node components, the Lexical halves of `input-editor-actions.ts`, `use-composer-inbox.ts` and `use-prompt-stash.ts`, and both dependencies; then add `composerRichTextEnabled` with the markdown preview source.
4. **Editor: one decoration range set** (M–L). Chunked mapped range set behind `registerDecorationSource`, replacing the anchored inline map and `EditorDecorationStore` mapping; source priorities; target: a keystroke at 20k replacements costs under 0.5 ms (7.2 ms today).
5. **Editor: block widgets** (L). Height sums in the display projection, measure-and-correct with scroll anchoring, caret and hit testing across block rows. Unblocks Plan 108 Phase 2.

Phases 1–3 are the composer path; 4 and 5 are the markdown path and can run after.
