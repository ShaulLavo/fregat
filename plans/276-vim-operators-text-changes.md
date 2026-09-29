# Plan 276: Vim operators and text changes

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-57; size L. Depends on Plan 207, Plan 204, Plan 206, Plan 275, Plan 225.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Compose motions with delete, change, yank, indentation, case conversion, comments, reflow, exchange and surrounds.

## Zed actions and behavior

- `PushDelete`, `PushChange`, `PushYank` enter pending operator states. Motion completion
  consumes counts/range kind; change enters insertion and yank preserves text. Direct
  DeleteLeft/Right/ToEndOfLine, ChangeToEndOfLine, Substitute/Line and YankLine apply counted
  ranges immediately. Sources: [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs), [`crates/vim/src/normal/delete.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/delete.rs),
  [`crates/vim/src/normal/change.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/change.rs), [`crates/vim/src/normal/yank.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/yank.rs), [`crates/vim/src/normal/substitute.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/substitute.rs).
- Indent/Outdent/AutoIndent and their Push variants transform complete affected lines.
  Case/ROT13 commands and their Push variants transform selected motion ranges.
  Sources: [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs), [`crates/vim/src/normal/convert.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/convert.rs).
- JoinLines/JoinLinesNoWhitespace differ in whitespace normalization. Rewrap/PushRewrap
  honor paragraph and comment prefixes. ToggleComments/ToggleBlockComments and their Push
  variants apply language comment syntax. Sources: [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs), [`crates/vim/src/rewrap.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/rewrap.rs),
  [`crates/vim/src/normal/toggle_comments.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/toggle_comments.rs).
- `PushReplace` waits for replacement text. Increment/Decrement change counted numeric or
  supported toggle-word targets; `Exchange` swaps two selected ranges and `ClearExchange`
  cancels the pending range. Sources: [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs), [`crates/vim/src/normal/increment.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/increment.rs), [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs).
- PushAddSurrounds/DeleteSurrounds/ChangeSurrounds collect a range or target delimiter and
  update its pair, preserving target arguments and nesting rules. Source: [`crates/vim/src/surrounds.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/surrounds.rs).

The full `vim::` action inventory follows.

`vim::AutoIndent`, `vim::ChangeCase`, `vim::ChangeToEndOfLine`, `vim::ClearExchange`, `vim::ConvertToLowerCase`, `vim::ConvertToRot13`, `vim::ConvertToUpperCase`, `vim::Decrement`, `vim::DeleteLeft`, `vim::DeleteRight`, `vim::DeleteToEndOfLine`, `vim::Exchange`, `vim::Increment`, `vim::Indent`, `vim::JoinLines`, `vim::JoinLinesNoWhitespace`, `vim::Outdent`, `vim::PushAddSurrounds`, `vim::PushAutoIndent`, `vim::PushChange`, `vim::PushChangeSurrounds`, `vim::PushDelete`, `vim::PushDeleteSurrounds`, `vim::PushIndent`, `vim::PushLowercase`, `vim::PushOppositeCase`, `vim::PushOutdent`, `vim::PushReplace`, `vim::PushRewrap`, `vim::PushRot13`, `vim::PushToggleBlockComments`, `vim::PushToggleComments`, `vim::PushUppercase`, `vim::PushYank`, `vim::Rewrap`, `vim::Substitute`, `vim::SubstituteLine`, `vim::ToggleBlockComments`, `vim::ToggleComments`, `vim::YankLine`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/editor/editActions.ts`, `editor/packages/editor/src/editor/textEdits.ts`, `editor/packages/editor/src/editor/indentation.ts` and
`editor/packages/editor/src/editor/commandRouter.ts` execute existing edit/indent/comment/join operations. `editor/packages/editor/src/editor/commandCatalog.ts`
lists those commands. `editor/packages/editor/src/documentSession.ts` owns edit transactions, inverse edits and undo groups.
Fregat's `apps/web/src/keymap/state/undo-barrier.ts` coordinates history boundaries; its command
table routes existing edits. Plan 225 adds transforms; Vim operator composition remains missing.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

Implement a typed operator in `editor/packages/vim` consuming Plan 275's resolved range and
count. Reuse Editor transforms after converting the Vim range once. Keep pending operator,
exchange range and surround target in Plan 274's state; remap stored ranges through document
edits. Record successful edits with a semantic change descriptor for Plan 279.

One completed operation creates one undo unit. A change operator and its following insert
session share the intended Vim undo group. Yank needs a typed register write interface owned
by the workspace Vim service, initially supporting the unnamed register here; Plan 279 extends
register selection/history and playback. Never create an independent Vim undo stack. Readonly
views expose motion/yank availability and decline changes. Forced motion changes inclusive or
linewise interpretation before transforms. Keep comment/reflow configuration in the registry
and existing language/settings owners.

## Steps

- [ ] Add failing operator fixtures for count composition, range kinds and change-plus-insert undo grouping.
- [ ] Implement d/c/y pending state and direct delete/substitute/yank commands with unnamed register writes.
- [ ] Compose indentation, case/ROT13, joining, comment and rewrap operations with Editor transforms.
- [ ] Implement counted increment/decrement, replacement waiting state and anchor-backed exchange.
- [ ] Implement surrounds through a shared pair-range resolver; coordinate its full text-object support with Plan 277.
- [ ] Register command/payload mappings and add the operator browser scenario.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-operators`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

Model fixtures cover `3d2w`, `dd`, `cc`, `yy`, `cw` versus `dw` at line endings, backwards and
linewise ranges, readonly edits, failed operands, numeric formats, nested surrounds and exchange
cancellation. The browser scenario changes a word, inserts text, undoes once, yanks a line and checks its register value, toggles a comment and joins lines. The document and all views
observe the same single transaction; cancelled operators change neither text nor registers.

## Out of scope

Named/numbered/clipboard register policy, macros and dot repeat are Plan 279. Complete text
objects are Plan 277; visual/block behavior is Plan 278. Shell filters are Plan 281.
