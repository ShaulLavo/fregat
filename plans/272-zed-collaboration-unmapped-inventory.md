# Plan 272: Retain Zed collaboration actions as unmapped inventory

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-53; size S. Depends on Plan 206.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Preserve action identity and every payload variant.

## Outcome

See which Zed collaboration shortcuts require cloud channels or remote collaborators, while local session and editor commands keep their current meaning.

## Zed actions and behavior

- `channel_modal::ToggleMode` switches invite/manage-members mode. `collab_panel::InsertSpace`
  inserts into the channel editor/filter; `collab_panel::MoveChannelDown` and
  `collab_panel::MoveChannelUp` reorder channels; `collab_panel::OpenSelectedChannelNotes` opens
  the channel's shared notes; `collab_panel::Remove` removes the selected channel;
  `collab_panel::ToggleFocus` focuses the collaboration panel; `collab_panel::ToggleSelectedChannelFavorite`
  toggles a favorite. Sources: [`crates/collab_ui/src/collab_panel/channel_modal.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/collab_ui/src/collab_panel/channel_modal.rs),
  [`crates/collab_ui/src/collab_panel.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/collab_ui/src/collab_panel.rs).
- `editor::DisplayCursorNames` displays remote cursor labels. `workspace::FollowNextCollaborator`
  chooses the next collaborator and follows their active pane; `workspace::Unfollow` stops that
  relationship. Sources: [`crates/editor/src/editor.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs) `display_cursor_names`,
  [`crates/workspace/src/workspace.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/workspace/src/workspace.rs) `follow_next_collaborator`/`unfollow`.

`channel_modal::ToggleMode`, `collab_panel::InsertSpace`, `collab_panel::MoveChannelDown`, `collab_panel::MoveChannelUp`, `collab_panel::OpenSelectedChannelNotes`, `collab_panel::Remove`, `collab_panel::ToggleFocus`, `collab_panel::ToggleSelectedChannelFavorite`, `editor::DisplayCursorNames`, `workspace::FollowNextCollaborator`, `workspace::Unfollow`.

## Existing Fregat and Editor work

`apps/web/src/features/chat/` owns local provider sessions; `packages/client-core/src/commands/chat.ts`
contains their commands. `apps/web/src/keymap/table.ts` contains workspace/editor commands.
`apps/web/src/features/settings/components/unmapped-shortcuts.tsx` already renders unmapped
rows through `apps/web/src/features/settings/components/keybinding-section.tsx`. The audited owners expose no Zed channel store,
collaborator identity or follow protocol. Editor multi-selection is local view state.

## Design

ZT-53 is an Excluded triage record. This Approved plan executes its inventory/verification work;
cloud collaboration remains out of scope. Keep all eleven action names, original keys,
Linux/macOS contexts and payloads in Plan 206's unmapped preset report, with a reason naming the
required channel/collaborator capability. Keep these records separate from executable null
bindings: an unmapped action must not suppress an existing key.

Do not add commands to `apps/web/src/keymap/table.ts` for these names or map them to local
chat actions. Retain source identity in the translation inventory so a future collaboration
plan can own the mapping. Settings uses its existing shared rows, title recovery and shortcut
display. Editor package work is unnecessary.

## Steps

- [ ] Reconcile all eleven names and every binding row against the pinned translation, with a failing inventory test for a dropped row or local-command substitution.
- [ ] Retain explicit channel/collaborator reasons in Plan 206 preset inventory and Settings.
- [ ] Add a focused dispatch test showing an unmapped row contributes no executable binding or suppression.
- [ ] Add the Settings inventory scenario and read its screenshots.

## Acceptance

The focused preset-inventory test retains every Linux/macOS row and verifies that none targets
a local chat/editor command. Hosted dispatch leaves local command behavior intact, including
keys also bound in another supported context. Add `zed-collaboration-inventory`: filter Settings
to these names and verify their capability reasons, then exercise a supported local command.
Run the focused keybinding-section test, `agent:browser scenario zed-collaboration-inventory`
and `look`; read the screenshots and record evidence. Run gates, commit, push and deploy.

## Out of scope

Zed cloud channels, calls, shared notes, live remote cursors and following collaborators.
The triage exclusion is retained; this plan approves inventory work only.
