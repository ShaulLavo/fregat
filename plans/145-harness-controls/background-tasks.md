# 145 · Background tasks: list and stop

- Status: PROPOSED.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

A session lists the background tasks it is running (background shells, monitors, backgrounded
subagents) with their description and type, and each one can be stopped on its own without
stopping the agent.

## What exists today

- The Claude adapter maps `task_started`, `task_progress`, `task_updated` and `task_notification`
  to `task.*` runtime events (`claude.ts` `handleSystemMessage`). It drops
  `background_tasks_changed` ("roster snapshot; task.* events carry per-task truth").
- `apps/server/src/provider/background-liveness.ts` (`BackgroundTaskRegistry`, owned by
  `provider-service.ts`) derives `working | monitoring` for the rail; the rail shows "Monitoring"
  (`chat-mode/utils/attention-state.ts`).
- `task.started` and `task.updated` are quiet in `activity-visibility.ts`. Running child agents
  render in `chat/components/agents-panel.tsx`.
- The only stop control is Stop Agent for the whole session
  (`keymap/menus/utils/session-actions-menu.ts`, `stopAgent`).
- The Codex adapter emits no `task.*` events.

## Harness support

- Claude (verified, `sdk.d.ts`): `background_tasks_changed` carries the full live set
  (`task_id`, `task_type`, `description`, `ambient`) with replace semantics, and is re-sent after a
  repeated `initialize`; `stopTask(taskId)` emits a `task_notification` with status `stopped`.
  Hosts should exclude `ambient` tasks from activity indicators.
- Codex (verified): `thread/backgroundTerminals/list|terminate|clean` exist upstream and in the
  installed 0.156.1 only under `codex app-server generate-json-schema --experimental`. Our pinned
  schema has none.

## Decisions

- **D1 — Source of the list.** Recommended: Claude's `background_tasks_changed` level signal, not
  pairing `task.*` edges; the SDK documents that a missed edge can wedge a stale indicator. Keep
  `BackgroundTaskRegistry` for liveness; if the level signal proves more reliable, fold the
  registry onto it in a follow-up.
- **D2 — Codex.** Recommended: Claude only in this plan. Codex's API is experimental; list it as
  unsupported with a disabled reason and revisit when it leaves `--experimental`.

## Steps

1. Claude adapter: stop dropping `background_tasks_changed`; emit a `tasks.roster` runtime event
   with the non-ambient tasks. Reset the roster when the CLI process restarts.
2. Project the roster onto the session (server) so the web reads it like other session state.
3. Adapter mutation `stopTask({ sessionId, taskId })` → `query.stopTask(taskId)`, capability-gated.
4. Web: a Background section beside the agents panel listing tasks as `ListRow`s with a stop
   button (`Tooltip`, `OrbitLoader` while the mutation is pending).

## Verification

- Server test through the `createQuery` seam: a roster message replaces the set; `stopTask` is
  called with the id; the stopped notification clears the row.
- Real run: ask Claude to start `sleep 600` in the background and a monitor; both appear; stop the
  sleep; the monitor stays and the agent keeps running.
- `bun run agent:browser look`; extend `scripts/agent/scenarios/background-liveness.ts` if it can
  drive the new section.

## Not copied

- Codex's experimental background-terminal API until it is stable.
