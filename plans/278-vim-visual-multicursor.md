# Plan 278: Vim visual and multi-cursor modes

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-59; size L. Depends on Plan 207, Plan 204, Plan 206, Plan 276, Plan 277, Plan 224.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Select characters, lines or rectangular blocks, edit/yank them, exchange selection ends and restore prior selections.

## Zed actions and behavior

- ToggleVisual/ToggleVisualLine/ToggleVisualBlock enter or toggle their selection kind.
  OtherEnd reverses selection direction; OtherEndRowAware handles block corners.
  RestoreVisualSelection restores prior visual marks. Source: [`crates/vim/src/visual.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/visual.rs), [`crates/vim/src/normal/mark.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/mark.rs).
- VisualDelete/VisualDeleteLine and VisualYank/VisualYankLine preserve character/line/block
  semantics. VisualInsertEndOfLine and VisualInsertFirstNonWhiteSpace create insertion points
  for selected rows. Sources: [`crates/vim/src/visual.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/visual.rs) `visual_delete`/`visual_yank`/visual insert handlers.
- SelectNext/Previous add occurrences; SelectNextMatch/PreviousMatch extend selection using
  search matches. SelectLargerSyntaxNode/SelectSmallerSyntaxNode use structural selection with
  Vim mode transitions. Source: [`crates/vim/src/visual.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/visual.rs) action registration and select handlers.

All covered `vim::` names are listed below; selection kind and match direction stay explicit.

`vim::OtherEnd`, `vim::OtherEndRowAware`, `vim::RestoreVisualSelection`, `vim::SelectLargerSyntaxNode`, `vim::SelectNext`, `vim::SelectNextMatch`, `vim::SelectPrevious`, `vim::SelectPreviousMatch`, `vim::SelectSmallerSyntaxNode`, `vim::ToggleVisual`, `vim::ToggleVisualBlock`, `vim::ToggleVisualLine`, `vim::VisualDelete`, `vim::VisualDeleteLine`, `vim::VisualInsertEndOfLine`, `vim::VisualInsertFirstNonWhiteSpace`, `vim::VisualYank`, `vim::VisualYankLine`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/selections.ts` and `editor/packages/editor/src/editor/selectionRanges.ts` own local
multi-selection and structural selection. `editor/packages/editor/src/editor/Editor.ts` exposes selections, cursor undo
and projections; `editor/packages/editor/src/documentSelectionEdits.ts` plans edits for multiple selections.
`apps/web/src/keymap/editor-commands.ts` already exposes occurrence and secondary-selection
commands. Plans 224 and 277 provide selection/object foundations, but Vim inclusive visual
endpoints and restored/block selection state remain missing.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

Represent character/line/block visual state as a tagged model in `editor/packages/vim`.
Store anchors for both ends, selection kind and block column goals. Convert to Editor ranges
at the view boundary; keep inclusive Vim endpoints distinct from half-open document edits.
Reuse Plan 275 motions and Plan 277 objects. Visual marks remap through edits and survive a
mode exit for restoration. State remains per view, with workspace marks owned by Plan 279.

Block selection uses display geometry and tab stops, with documented behavior for soft wraps
and short lines derived from Zed's visual block fixtures. Emit all per-row edits in one document
transaction. Block insert/change maintains linked insertion points until exit. Register visual
commands in `Editor && vim_mode == visual` with the selection-kind context; insert/completion
children keep their own precedence. Reuse shared UI for the mode indicator.

## Steps

- [ ] Add failing fixtures for inclusive reversed selections, line endings and all block corners.
- [ ] Implement mode toggles, opposite-end behavior and anchor-backed visual restore.
- [ ] Compose visual motions/objects and occurrence/search/syntax selection commands.
- [ ] Implement character/line/block delete/yank and linked per-row insertion with one undo unit.
- [ ] Register commands/preset variants and add visual/block browser coverage.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-visual-block`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

Fixtures cover tabs, soft wraps, short/empty rows, EOF, reversed blocks, all corners and edits
before stored visual marks. Scenario selects a block across unequal rows, inserts/changes text,
undoes once, swaps ends and restores the prior selection. Separate checks cover linewise yank,
occurrence addition and syntax grow/shrink. Primary selection/focus stays stable, and Escape
returns to normal mode with the correct caret.

## Out of scope

Helix selection UX, a second selection engine, macro/register policies and workspace splits.
Plan 279 consumes completed visual operations for dot repeat and registers.
