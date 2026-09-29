# Plan 274: Vim mode state and modal input

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-55; size L. Depends on Plan 207, Plan 204, Plan 206, Plan 222.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Enable Vim and switch between normal, insert and replace modes, with counts and pending commands visible to the shared dispatcher.

## Zed actions and behavior

- `vim::SwitchToInsertMode`, `vim::SwitchToNormalMode` change modes. `vim::NormalBefore`
  cancels an active operator first; otherwise it leaves insertion with the caret on the preceding
  character. `vim::ClearOperators` clears pending state. `vim::Number` appends a count digit;
  pre/post operator counts multiply, so `3d2w` has count six. `vim::PushForcedMotion` changes the
  next motion's range kind. Sources: [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs), [`crates/vim/src/state.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/state.rs), [`crates/vim/src/insert.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/insert.rs).
- `vim::PushLiteral` waits for literal input; `vim::Literal` inserts the supplied literal value.
  `vim::ToggleReplace` enters replace mode with a fresh replacement log; `vim::UndoReplace`
  restores overwritten text. Sources: [`crates/vim/src/digraph.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/digraph.rs), [`crates/vim/src/replace.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/replace.rs).
- `workspace::SendKeystrokes` parses and dispatches a sequence through the focused keymap,
  tracking dispatched sequences to prevent recursion. Source:
  [`crates/workspace/src/workspace.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/workspace/src/workspace.rs) `send_keystrokes_impl`.

Zed publishes `vim_mode`, `vim_operator`, and `VimControl`; motion-taking operators use
`operator`, finds use `waiting`, and literal entry publishes `literal` or `waiting` according to its prefix. Source: [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs) `extend_key_context`.

`vim::ClearOperators`, `vim::Literal`, `vim::NormalBefore`, `vim::Number`, `vim::PushForcedMotion`, `vim::PushLiteral`, `vim::SwitchToInsertMode`, `vim::SwitchToNormalMode`, `vim::ToggleReplace`, `vim::UndoReplace`, `workspace::SendKeystrokes`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/createPlugin.ts` exposes `textGate`, `cursorStyle` and the current
`keyParticipant`; `editor/packages/editor/src/editor/Editor.ts` consults text gates for native input. `editor/packages/editor/src/plugins.ts` defines
line/block/underline cursors. `editor/packages/editor/src/documentSession.ts` owns selections and history.
`apps/web/src/keymap/editor-commands.ts` routes existing editing commands through the app table.
No Vim package or modal state machine exists in the audited Editor source. Plan 204 removes
`keyParticipant`; modal input must use the dispatcher plus the retained native text gate.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

Create `editor/packages/vim` with a typed mode/pending-input union and one per-view controller.
Its zustand store publishes the snapshot; workspace-scoped state for future registers/replay
has an explicit owner. Keep counts, pending operator and replacement inverses in the model.
Register an application-scope Vim setting alongside its consumer and run `settings:reference`.
The default remains ordinary editing until enabled; Vim is a modal pack layered over the
selected preset, independent of `ours`/`zed`/`vscode` selection.

Publish Zed-compatible context keys from the controller. Gate text in normal/operator modes;
waiting states receive committed native input for literal/find operands. Preserve insert-mode
IME and browser beforeinput behavior through Plan 222. Mode updates and cursor changes happen
in the same command turn. SendKeystrokes feeds normalized key input through the same dispatcher,
with a scoped queue, cycle detection and cancellation on focus/disposal. Never synthesize a
second DOM key listener. Validate argument variants, including literal prefixes and digits.

## Steps

- [ ] Add a failing mode/input model test and hosted scenario before creating the controller.
- [ ] Implement the mode/pending union, counts, forced-motion flag, replace inverses and cancellation.
- [ ] Connect textGate and cursorStyle; publish contexts and register commands through Plan 204.
- [ ] Add the Vim setting and modal preset from pinned assets/keymaps/vim.json, preserving payloads and null/unbind rows.
- [ ] Implement SendKeystrokes queue and disposal/focus cancellation; add the /dev modal-input fixture.
- [ ] Verify insert composition, readonly behavior and Escape handling; run settings generation and focused checks.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-mode-input`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

The scenario proves normal-mode letters leave text unchanged, insert accepts composition,
replace overwrites and Backspace restores, Escape clears waiting/count state, and moving focus
to chat cancels pending input. Model tests prove `3d2w` count composition, zero as motion versus
count digit, forced-motion consumption and recursive SendKeystrokes termination. Run a hosted
IME browser test for composition commits and cancellation. Disabling Vim restores ordinary
input and removes modal contexts.

## Out of scope

Full motions/operators, visual selections, text objects, registers, macros and insert entry
variants belong to Plans 275–280. Ex/workspace integration is Plan 281; Helix is Plan 282.
