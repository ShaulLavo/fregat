# Editor decorations: learn from CodeMirror and Lexical, then beat what we have

Status: **research — no implementation scope yet.** Requested 2026-09-13.

The editor already has a decoration primitive. `@singapor/core` exposes `registerInlineReplacementProvider` and `InlineReplacementSpec`, and [`@singapor/markdown`](../../Editor/packages/markdown/src/index.ts) uses it to hide fences, drop heading markers and collapse links while the buffer keeps holding source. That is the right shape. It is also inline-only, driven by generically-named Tree-sitter captures, and has never been compared against the two systems that solved this problem thoroughly.

This plan does that comparison and then improves our layer. It is the gate for [Plan 108](108-markdown-modes.md) Phase 2, for an eventual Obsidian mode, and — less obviously but more valuably — for removing Lexical from the chat composer. [Root PLAN.md](../PLAN.md) owns scheduling.

## Why this is worth doing properly

Obsidian is closed source, but its architecture is not secret: the public `obsidian-api` typings import `Extension` and `StateField` from `@codemirror/state` and `EditorView` and `ViewPlugin` from `@codemirror/view`, and export `editorEditorField: StateField<EditorView>` — "Use this StateField to get a reference to the EditorView". Live Preview is CodeMirror 6 decorations. The reference implementation for the experience we want is open source even though the product is not.

Separately, the chat composer runs on Lexical for exactly one capability: `ChatInputMentionNode extends DecoratorNode`, giving `@`-mention chips that the caret steps over and one backspace deletes. Everything else around it — draft, submit, surround, line-boundary, history plugins — is ours. If our editor gains atomic ranges and widgets, that capability stops needing a second editor framework.

## What we have today

| Piece               | Current state                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitive           | `InlineReplacementSpec[]` returned from a registered provider. Inline ranges only.                                                                                                                                                                                                                  |
| Source of structure | Tree-sitter highlight captures. `@singapor/markdown`'s own comment: the queries "name things generically — `punctuation.delimiter` covers both emphasis fences and link brackets", so constructs are recovered "by containment for emphasis and code spans, and by adjacency for links and images." |
| Failure posture     | Anything not matching its expected shape is left as plain text, so malformed input renders as source rather than losing characters. A good default, and evidence the recovery is heuristic.                                                                                                         |
| Missing             | Block-level replacement (a rendered table, image or fence). Widget lifecycle. Explicit atomic-range caret semantics. A composition story for two providers decorating overlapping ranges.                                                                                                           |
| Consumers           | One: markdown preview.                                                                                                                                                                                                                                                                              |

## Questions this plan must answer

1. **What is the full decoration taxonomy we need?** CodeMirror distinguishes mark (style a range), widget (insert at a point), replace (substitute a range, inline or block) and line decorations, over a `RangeSet` that maps through document changes. Which of these do we need, and which are we missing?
2. **How do decorations survive edits?** A decoration set that is recomputed from scratch per keystroke is correct and slow; one that maps through changes is fast and subtle. Which does our rendering path allow, and what does it cost on a large file?
3. **What are the caret semantics of a replaced range?** Entering, leaving, selecting across, backspacing into, and undoing over. This is where both CodeMirror's `atomicRanges` and Lexical's `DecoratorNode` earn their complexity, and where our inline replacements are currently unspecified.
4. **How do two providers compose?** Markdown preview plus LSP inlay hints plus a find highlight, over overlapping ranges, with deterministic ordering.
5. **What does a block widget mean in a virtualized renderer?** Our editor virtualizes; a rendered table has a height the line model does not know. This is the hardest question and the one that decides whether Plan 108 Phase 2 is weeks or months.
6. **Is the Tree-sitter capture source a dead end?** For markdown, almost certainly — [Plan 108](108-markdown-modes.md) D5 already proposes moving to an AST. Is that markdown-specific or a general statement about deriving structure from highlight queries?
7. **Could the composer run on this?** With widgets and atomic ranges, is `ChatInputMentionNode` expressible as a decoration over a plain buffer? If yes, Lexical becomes deletable and the composer becomes one more editor host.

## Research steps

1. **Clone the references** into `/work/projects/references/` per the workspace layout rules: `codemirror/view` and `codemirror/state`, `facebook/lexical`, and the `obsidianmd/obsidian-api` typings. Read `Decoration`, `RangeSet`, `ViewPlugin`, `atomicRanges` and `blockWidget` in CM6, and `DecoratorNode`, `NodeKey` and the reconciler in Lexical.
2. **Survey real plugins, not just the APIs.** CodeMirror's own markdown live-preview examples, and two or three third-party decoration-heavy plugins. The APIs describe what is possible; the plugins show which parts are actually usable.
3. **Write the gap table.** Each capability, whether `@singapor` has it, what it would take, and which consumer wants it.
4. **Answer the seven questions** in a decision table, including an honest verdict on question 5 with a measurement, not an estimate.
5. **Propose the API.** A concrete decoration API for `@singapor/core`, with migration notes for the one existing consumer.
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
- No change to `@singapor/markdown` or to the current preview behaviour.
- No composer changes. Question 7 is answered here; acting on it is a separate plan.
- No commitment to Obsidian mode. This plan establishes whether the foundation can support it, not whether we build it.
