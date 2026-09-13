# Two markdown modes: split view and live preview

Status: proposed, implementation not started. Requested 2026-09-13.

The editor already renders markdown as formatted text while the buffer keeps holding markdown source — [`@singapor/markdown`](../../Editor/packages/markdown/src/index.ts) hides fences, drops heading `#`, collapses links to their labels, and restores the source under the caret so it stays editable. That is Obsidian's Live Preview, and it was built as an experiment. It looks right and it is incomplete.

This plan does not delete it. It gives markdown **two modes**: a split view, which a code editor is a natural host for, and a live preview, which is the experiment finished properly. Split view depends only on [Plan 107](107-workspace-markdown.md). Live preview depends on [Plan 111](111-editor-decorations.md), because finishing it needs a decoration layer we have not yet compared against the state of the art. [Root PLAN.md](../PLAN.md) owns scheduling.

## What exists today

| Piece               | Current state                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plugin              | `createMarkdownPreviewPlugin` from `@singapor/markdown`, installed in [`plugins.ts`](../apps/web/src/features/editor/utils/plugins.ts). Include it to turn preview on, remove it to turn it off — there is no user-facing mode.                                                                                                      |
| Mechanism           | `context.registerInlineReplacementProvider` returning `InlineReplacementSpec[]`. The editor already owns an inline replacement primitive; this is not a bolt-on.                                                                                                                                                                     |
| Source of structure | Tree-sitter `markdown` and `markdown_inline` highlight captures — not a markdown AST.                                                                                                                                                                                                                                                |
| Known ceiling       | The package's own comment states it: the queries "name things generically — `punctuation.delimiter` covers both emphasis fences and link brackets", so constructs are recovered "by containment for emphasis and code spans, and by adjacency for links and images." Anything not matching its expected shape is left as plain text. |
| Scope               | Inline only. Headings, emphasis, code spans, links, images, bullets, quotes. No block widgets: no rendered table, no image, no rendered fence, no embedded diagram.                                                                                                                                                                  |
| Split view          | Does not exist.                                                                                                                                                                                                                                                                                                                      |
| Renderer            | None on the editor side. Plan 107 supplies it.                                                                                                                                                                                                                                                                                       |

## Decisions

| Decision                                         | Proposed behavior                                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — two modes, not one                          | Markdown files open in **source**, **split**, or **live preview**. Source is the current plain editor. The experiment becomes live preview rather than being deleted.                                                                 |
| D2 — the mode is a setting, not a constant       | A registry entry in `packages/contracts/src/settings/keys.ts` per [AGENTS.md § Settings](../AGENTS.md#settings), registered in the same pass as its consumer, with a per-document override that does not persist as a global default. |
| D3 — split view ships first                      | It depends only on Plan 107 and answers the immediate need. Live preview waits for Plan 111's findings rather than accreting more adjacency heuristics.                                                                               |
| D4 — one renderer                                | The split view's rendered pane is `@workspace/markdown` from Plan 107, with healing and incremental parsing disabled — a file on disk is not a stream. Same package as chat, so a fence highlights identically in both.               |
| D5 — live preview moves to an AST                | Finishing live preview means driving it from a markdown parse, not from generically-named highlight captures. Containment-and-adjacency recovery is the experiment's ceiling and the reason it is incomplete, not a detail to extend. |
| D6 — block widgets are the missing primitive     | Rendered tables, images and fences are block-level replacements, which `InlineReplacementSpec` cannot express. Whether the editor gains that primitive, and in what shape, is Plan 111's question and this plan's dependency.         |
| D7 — scroll sync is positional, not proportional | Split view scroll sync maps source line to rendered block through the AST's position data. Proportional scrolling desynchronizes on any document with a long fence.                                                                   |
| D8 — no new syntax yet                           | Wiki links, callouts, embeds and backlinks are Obsidian features, not markdown. They are a later plan and are named here only so live preview's design leaves room for them.                                                          |

## Phase 1 — split view

1. **Mode plumbing.** The setting from D2, a command in `keymap/` to cycle modes per the enablement rules in [AGENTS.md § Code Organization](../AGENTS.md#code-organization), and a per-document override.
2. **The pane.** A rendered pane beside the editor, built on Plan 107's package, styled with theme tokens and the existing pane primitives. It is a pane like any other, so it uses `PaneBar` and the bar-height token.
3. **Highlighting parity.** The rendered pane's fences use the editor's highlighter and the active theme, so a TypeScript fence looks the same as the buffer beside it.
4. **Scroll sync (D7).** Source line to rendered block, both directions, driven by the parse's position data. The caret's block stays visible in the rendered pane.
5. **Images and links.** Workspace-relative image paths resolve against the document. A link to another workspace file opens it; an external link goes out.

Completion: a markdown file can be edited in source with a live rendered pane beside it, fences match the editor's theme, and scrolling either pane tracks the other through a document containing a hundred-line fence.

## Phase 2 — live preview, after Plan 111

Blocked on Plan 111's comparison. The steps below are the intended shape, not a commitment ahead of its findings.

1. **Re-source the structure (D5).** Drive replacements from a markdown AST with position data rather than from highlight captures. The existing structural recovery in `replacements.ts` is deleted, not extended.
2. **Block widgets (D6).** Whatever primitive Plan 111 concludes the editor needs, so a table, an image and a fence can each be replaced by a rendered block that the caret can enter and leave predictably.
3. **Caret semantics.** Source reappears under the caret, as today, but defined against the AST: entering a node's range reveals its syntax, leaving it re-renders. Selection across a boundary must not lose characters — the current implementation's stated fallback is to leave malformed markdown alone, and that guarantee is kept.
4. **Undo and edit correctness.** A replacement is a view concern; the buffer holds source at all times. Every editing gesture over a replaced range produces the same buffer as it would in source mode. This is the test surface, not the visuals.
5. **The experiment's behaviour is the baseline.** Nothing it renders correctly today may regress.

Completion: live preview is driven by a parse, supports at least one block widget, and passes an editing-equivalence suite against source mode.

## Phase 3 — the Obsidian question

Not scheduled. Once live preview stands on a real decoration layer, the remaining distance to an Obsidian-style experience is feature work — wiki links, backlinks, callouts, embeds, a vault-shaped index — and most of it needs [Plan 110](110-workspace-indexing.md), not the editor. This phase exists so that gap is written down rather than rediscovered.

## Verification boundaries

- Split view is verified in the browser project against a real workspace file, including a document whose fences are longer than the viewport.
- Scroll sync is asserted on block identity, not on pixel ratio.
- Live preview's acceptance test is editing equivalence: for a corpus of documents and a corpus of gestures, the buffer after the gesture in preview mode equals the buffer after the same gesture in source mode.
- Image and link resolution is tested against real files in a temp workspace through real routes, per [AGENTS.md § Use Real App Code](../AGENTS.md#use-real-app-code).
- Never gate on a bare root `bun run verify`; use the per-workspace baseline delta.

## What this plan does not do

- No deletion of the current preview experiment. It becomes mode three (D1).
- No markdown renderer of its own. Plan 107 owns that (D4).
- No decoration-layer design. Plan 111 owns that, and Phase 2 is blocked on it (D6).
- No Obsidian features — wiki links, callouts, embeds, backlinks (D8).
- No vault or note index. That is Plan 110's territory.
