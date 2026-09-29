# Plan 250: Queued-message edit, delivery and steering commands

## Status and authorization

- Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has".
- Triage: ZT-31, queued messages and steering. Size: M. Depends on Plan 206.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.json` and `206-zed-translation.json`.

## Outcome

Edit, remove, clear or deliver queued messages from the keyboard, choose whether the first
message steers at a tool boundary, and send the current draft immediately.

## Zed actions and behavior

Reference: Zed `933d8d93`.

- `agent::EditFirstQueuedMessage` restores the first entry to the main composer;
  `agent::RemoveFirstQueuedMessage` removes it; `agent::ClearMessageQueue` clears the queue.
- `agent::SendNextQueuedMessage` sends the first queued entry. `agent::SendImmediately` sends
  the current nonempty composer draft. These have different targets.
- `agent::ToggleSteerFirstQueuedMessage` toggles the front entry's tool-boundary steering flag
  for the native agent. Other entries retain FIFO order. Cancellation caused by an immediate
  send is absorbed before automatic queue processing resumes.

Sources: [thread_view.rs, queue handlers](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/thread_view.rs#L12406),
[message_editor.rs, immediate draft send](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/message_editor.rs#L1007),
[message_queue.rs, queue state machine](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/agent_ui/src/conversation_view/message_queue.rs#L8).

## Existing Fregat behavior

`apps/web/src/features/chat/hooks/use-session-composer.ts` already serializes composer
mutations and exposes send-now and restore. `state/follow-up-store.ts` owns queues by scoped
session; `state/send-follow-up.ts` retries the same submission receipt after a lost response.
`components/queued-message-row.tsx` disables restore for uncertain delivery. The automatic
sender in `components/queued-follow-up-senders.tsx` shares that queue. Paths are under
`apps/web/src/features/chat/` unless expanded above. There is no per-entry steer flag or full
six-command catalog coverage. Editor changes are unnecessary.

## Design

Add `chat.queue.editFirst`, `removeFirst`, `clear`, `sendNext`, `toggleSteerFirst` and
`chat.sendImmediately` to the Plan 206 command table, with typed scoped-session targets.
Bindings live in its `zed`/`ours` preset data for `Chat > Editor`, retaining platform chords
from the translation. Queue handlers read the current head when executed. Narrow chat actions
serve both the row UI and focus-node handlers.

Store each unsent entry's delivery mode explicitly. Preserve Fregat's submission receipt and
uncertain state. Remove, edit and clear operate only on entries whose delivery is known to be
unsent; uncertain entries remain visible for receipt-based retry. Immediate draft delivery uses
the same capability, pending-request and turn-state guards as send-now. Steering is available
when the provider supports it. All effects use the chat mutation keys, a per-session scope and
cache settlement before resolution.

## Steps

- [ ] Extend the existing queue scenario with keyboard calls that fail before wiring commands.
- [ ] Add per-entry delivery intent and guarded edit/remove/clear operations to the queue owner.
- [ ] Route immediate draft, next-entry and automatic sends through the same receipt-aware path.
- [ ] Register commands, focused contexts, preset rows and shortcut hints; remove duplicate handlers.
- [ ] Verify, commit and ship the implementation through the mesh.

## Acceptance

- Run the focused `use-session-composer` tests and queue-owner tests. Fixture providers cover
  running, idle, paused, pending permission and lost acknowledgment. Repeated sends submit once;
  uncertain clear/edit preserves the original receipt; background delivery consumes the head once.
- Extend `scripts/agent/scenarios/chat-queue.ts` and `chat-queue-away.ts` with edit, remove,
  clear, steer and distinct immediate-draft/queued-head cases. Assert prompt and attachment
  preservation, then read screenshots from the named evidence directory.
- Run `bun run gates`. Heavy checks and `bun run agent:browser scenario <name>` use
  `/work/tmp/wave-heavy/run.sh` with fixture providers and explicit free server ports.

## Out of scope

Conversation search, queue reordering, provider-specific interruption features and TUI UX.
