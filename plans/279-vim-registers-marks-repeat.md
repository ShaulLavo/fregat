# Plan 279: Vim registers, marks, macros and repeat

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-60; size L. Depends on Plan 207, Plan 204, Plan 206, Plan 276, Plan 278.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Vim plans also use
  `assets/keymaps/vim.json` at that commit. Preserve action identity and every payload variant.

## Outcome

Use registers for yank/paste, jump to marks and changes, record/replay macros, repeat the last change and control Vim history.

## Zed actions and behavior

- PushRegister selects a register; Paste uses character/line/block metadata and before/after
  payloads; PushReplaceWithRegister replaces a resolved range. Register writes update unnamed,
  yank zero, small-delete and numbered histories; uppercase names append, `_` discards, `+`/`*`
  use the system clipboard/primary selection where supported. Sources: [`crates/vim/src/state.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/state.rs)
  `write_registers`/`read_register`, [`crates/vim/src/normal/paste.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/paste.rs), [`crates/vim/src/vim.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/vim.rs).
- PushMark stores an anchored position; PushJump carries exact-position versus linewise jump.
  ChangeListOlder/Newer navigate recorded edit locations. Sources: [`crates/vim/src/normal/mark.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/mark.rs),
  [`crates/vim/src/change_list.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/change_list.rs).
- ToggleRecord starts/stops recording, PushReplayRegister chooses a macro, ReplayLastRecording
  repeats its register and Repeat replays the last semantic change with count/register state.
  Zed records dispatched actions plus insert events, schedules replay through the dispatcher
  and stops after 10,000 actions. Sources: [`crates/vim/src/normal/repeat.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal/repeat.rs), [`crates/vim/src/state.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/state.rs).
- Undo/Redo use editor history with Vim cursor rules; UndoLastLine restores the current line's
  remembered state. Source: [`crates/vim/src/normal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/vim/src/normal.rs) history handlers.

Preserve all `vim::` action names below and Paste/PushJump payload variants.

`vim::ChangeListNewer`, `vim::ChangeListOlder`, `vim::Paste`, `vim::PushJump`, `vim::PushMark`, `vim::PushRegister`, `vim::PushReplaceWithRegister`, `vim::PushReplayRegister`, `vim::Redo`, `vim::Repeat`, `vim::ReplayLastRecording`, `vim::ToggleRecord`, `vim::Undo`, `vim::UndoLastLine`.

## Existing Fregat and Editor work

Editor paths below name the canonical destination after Plan 207. At this plan's source audit,
those files live under `/work/projects/Editor/packages/`; `editor/` has not landed in Fregat.
Implement package work in `editor/packages/` after the move.

`editor/packages/editor/src/documentSession.ts` owns shared undo/redo and transaction metadata;
`editor/packages/editor/src/history.ts` owns history structure. `editor/packages/editor/src/editor/clipboardMetadata.ts` supplies selection-aware
clipboard data. `editor/packages/textbuffer/src/anchors.ts` and `editor/packages/editor/src/selections.ts`
provide anchor/edit transformation facilities. `apps/web/src/keymap/state/undo-barrier.ts`
coordinates app history; `apps/web/src/keymap/editor-commands.ts` already exposes undo/redo. These are foundations,
not a Vim register bank, macro recorder, mark map or semantic dot-repeat log.

## Design

Follow [the keymap architecture](../docs/keymap/architecture.md). Add typed commands and
availability to `apps/web/src/keymap/table.ts` through its owning command module; Editor
commands also belong in `editor/packages/editor/src/editor/commandCatalog.ts`. Put keys and argument variants in Plan 206's
`apps/web/src/keymap/presets/` data. Hosted Editor joins the window dispatcher and publishes
contexts. Standalone Editor exports the modal pack as data. Keep keys out of command metadata.
Use the existing document mutation/undo path for synchronous edits. Async reads and effects
use feature-owned TanStack query/mutation options and settle the cache before resolving.

Extend Plan 276's unnamed register interface in the workspace-owned Vim service. Store typed
character/line/block register values and semantic replay events. Keep per-document marks and
change locations as anchors; uppercase marks carry document/environment identity for navigation.
Views share the register bank within the window workspace, while mode/pending state stays local.

Observe successful command dispatch and committed insert events once. Replays use the same
command bus, suppress recording of replayed events and terminate on focus/disposal or a bounded
step limit. Put the replay limit and clipboard policy in application-scope registry settings
with Zed defaults; run settings:reference. Dot repeat re-resolves the recorded operation at the
current cursor, with a supplied count replacing the recorded count as Zed does. Undo/redo remains
in documentSession; UndoLastLine records a line-specific inverse through that same history.

Clipboard reads/writes use feature mutation options and settle state before Paste resolves.
Use desktop primary selection only where exposed by the host; report the actual capability.
Cross-document mark navigation uses the workspace action owner without feature-to-feature imports.

## Steps

- [ ] Add failing fixtures for register metadata/history, dot-repeat grouping and macro termination.
- [ ] Implement register selection, append/black-hole/numbered policy, paste and replace-with-register.
- [ ] Implement anchored marks, jump variants, change-list traversal and UndoLastLine.
- [ ] Record semantic commands/insertions and implement count-aware repeat and register macro playback.
- [ ] Connect clipboard/mark navigation through owning services with mutation settlement and structured errors.
- [ ] Register settings, commands and modal preset variants; add the repeat/register scenario.

## Acceptance

Run the focused package fixtures and hosted keymap tests, then `bun run gates`. Add the named
scenario under `scripts/agent/scenarios/` and selectors in `scripts/agent/selectors.ts`.
Use fixture providers and disposable repositories. Run `bun run agent:browser scenario vim-registers-repeat`
and `bun run agent:browser look`; read the screenshots and record the evidence directory.
Commit by path, push, and deploy the completed implementation through the mesh.

Fixtures cover named/unnamed/numbered/black-hole/clipboard registers, uppercase append,
linewise/block paste, deleted mark ranges, cross-document marks, dot counts, changes containing
insertions, undo/redo and line undo. Test self-recursive and mutually recursive macros, empty
registers, focus change and disposal against the configured replay bound. Scenario records a
macro, replays it with a count, repeats a change at a new location and jumps after edits.
Use an injected clipboard adapter; `agent:browser caches` confirms clipboard mutation settlement.
No macro/test invokes a real provider, account or external CLI.

## Out of scope

Ex command history/evaluation, shell filters and Helix repeat semantics. Workspace/Ex actions
are Plan 281. Clipboard primary-selection support depends on the host's capabilities.
