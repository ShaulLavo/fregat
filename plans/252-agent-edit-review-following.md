# Plan 252: Agent edit review and source following

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-33, agent edit review and following. Size: L.
- Depends on Plans 207, 204, 206 and 243, repository review and hunk navigation.
- Coordinate remaining scope with existing Plans 139 and 169; reuse their delivered contracts.

## Outcome

Open an agent's edits, keep or reject selected edits or all remaining edits, undo the last
rejection, and send a message while following the agent's edited source.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `agent::OpenAgentDiff` opens the thread's changed buffers. `agent::Keep` and `agent::Reject`
  act on edits intersecting the current editor selection. `agent::KeepAll` marks remaining
  edits kept; `agent::RejectAll` reverses remaining edits through the thread action log.
- `agent::UndoLastReject` reverses the last rejection. Zed retains rejection history and offers
  undo after a reject-all that changed buffers.
- `agent::ChatWithFollow` starts following the agent and sends the composer message.

Sources: [agent_diff.rs, selection and batch review](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/agent_diff.rs#L270),
[agent_panel.rs, open diff](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/agent_panel.rs#L451),
[thread_view.rs, reject history](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L2900),
[message_editor.rs, send and follow](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/message_editor.rs#L1019).

## Existing Fregat and Editor behavior

`apps/web/src/features/chat/utils/turn-diff-view.ts` projects checkpoint diffs.
`apps/web/src/features/chat-mode/hooks/use-checkpoint-hunk-revert.ts` already exposes a hunk
revert mutation. `apps/web/src/features/editor/state/workspace-edit-service.ts` owns versioned
preconditions, transaction receipts, rollback and undo; its tests cover one active-buffer edit
as one Editor undo transaction. These provide review and transactions, but agent keep/reject
ownership and rejection history still need a contract.

Editor document transactions and view contributions live in
`/work/projects/Editor/packages/editor/src/` at this baseline, including `createPlugin.ts` and
`plugins.ts`. After Plan 207, work belongs in `editor/packages/editor/`, with host behavior in
Fregat. Never implement document reversal as a view-only decoration.

## Design

Create an agent-review owner keyed by scoped session, turn and edit ID. Track baseline and
result revisions, affected paths/ranges, review disposition and rejection receipts. Keeping an
already-applied edit changes its review disposition; rejection applies a guarded inverse
transaction. Check current revisions before touching files. Concurrent human edits yield a
visible conflict with the document preserved. Undo-last-reject uses the inverse receipt and
the shared workspace undo barriers. Batch review uses one transaction group with rollback.

Register `chat.openAgentDiff`, `chat.sendWithFollow` and `agentReview.keep`, `keepAll`, `reject`,
`rejectAll`, `undoLastReject` in the command table. Presets reproduce `Chat > Editor`,
`AgentDiff` and `Editor && editor_agent_diff` contexts. Follow mode opens local source locations
from agent edit events, stops when the user takes over, and retains session identity. Async
review uses domain mutation keys, per-session serialization and cache settlement. Shared
document contracts belong in Editor packages; providers and panels remain in Fregat.

## Steps

- [ ] Reproduce missing review commands with fixture edits; add failing revision/undo tests.
- [ ] Establish edit provenance, inverse transactions and conflict behavior using existing owners.
- [ ] Wire selected/all review and rejection history across open, dirty and unopened files.
- [ ] Add source following and send-with-follow to the chat owner.
- [ ] Register contexts/presets and review controls; verify, commit and deploy server changes.

## Acceptance

- Extend `apps/web/src/features/editor/tests/workspace-edit-service.test.ts` with review
  transactions: reject/undo round-trip, keep followed by reject-all, concurrent user edit,
  two-file failure rollback and repeated command delivery. Check disk and document revisions.
- Add `agent-edit-review` under `scripts/agent/scenarios/` using fixture provider edit events.
  Exercise all seven commands, a source-follow jump and user takeover. Read screenshots back;
  use `agent:browser caches` to prove mutation settlement.
- Run the touched review/transaction tests and `bun run gates`. Heavy commands use the wave
  slot wrapper. Verify on dev, then deploy with `--server --restart` when server code changes.

## Out of scope

Cloud collaborator following, whole-checkpoint rewind, Git staging and TUI review UX.
