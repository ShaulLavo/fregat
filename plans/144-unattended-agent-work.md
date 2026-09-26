# Plan 144: Unattended and multi-agent work

## Status and authorization

- Status: IN PROGRESS — Phase 2 done 2026-09-26 (wave 2 lane A); Phase 1 on lane B; Phase 3
  next. Research done 2026-09-25. Q1–Q3 decided 2026-09-25. PRs #32 (Plan 148) and #35 (Plan 145)
  were still open, so the research read their lane branches as current truth. One gap: the
  Platform-side rendering of a self-started turn is established by code reading, because the dev
  server was down (see Q1).
- Priority: P2. High value for how the owner already works; depends on answers below.
- Effort: research M; implementation unknown until the capability matrix exists.
- Risk: MED. Building what a harness already does creates two schedulers and two agent trees.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (Paseo,
  Orca, herdr, pstack, VS Code, Codex) and this session's own Claude Code tools.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless
  separately requested.

## Outcome

Agents keep working while the owner is away — on a schedule, until a goal is met, or by
directing other agents — and Platform shows what they are doing and lets the owner stop them.
The owner's question frames the plan: "don't the harnesses we rely on already have that? I'm
not sure how much we need to build ourselves — rather reuse our tools better."

Thesis: host and surface what Claude Code and Codex already do first. Build only what no
harness offers.

## What exists today

- Background tasks are tracked: `apps/server/src/provider/background-liveness.ts`
  (`BackgroundTaskRegistry`, `working` / `monitoring`), fed by the Claude adapter's
  `task_started` and `task_notification` cases (`provider/adapters/claude.ts:966`, `:995`).
- `task.started` and `task.updated` are hidden from the timeline
  (`apps/web/src/features/chat/utils/activity-visibility.ts:21`).
- Running child agents render in `apps/web/src/features/chat/components/agents-panel.tsx`.
- Hook events are ingested (`claude.ts:929`, `hook.started`) but have no UI.
- Nothing in `apps/server/src` calls the SDK's `Query.stopTask(taskId)` (SDK `sdk.d.ts:2947`),
  so a background task cannot be stopped from Platform.
- Platform does not disable any harness tool: no `disallowedTools`, no
  `CLAUDE_CODE_DISABLE_WORKFLOWS` in `apps/server/src`. Scheduling and workflow tools are
  therefore probably available inside Platform sessions today, unobserved.
- Codex goals are not wired: `thread/goal/*` exists upstream
  (`references/codex/codex-rs/app-server-protocol`) but not in
  `provider/adapters/codex-protocol/generate.ts`.
- Plan 087 (`plans/087-stateless-mcp.md`) would expose Platform tools over MCP; it covers code
  intelligence, not agent control.

## What the harnesses provide

Legend: **V** = used first-hand in the 2026-09-24 planning session (Claude Code CLI 2.1.281);
**S** = reported by the survey or read in SDK types, not exercised. Whether each is reachable
through the Agent SDK in a Platform session is an open research question in every row.

| Capability                                  | Harness     | Source | Notes                                                                                      |
| ------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------ |
| Self-paced loop (`/loop`, `ScheduleWakeup`) | Claude Code | V      | SDK marks such prompts `loop_wakeup`; Stop hooks receive `session_crons` (`sdk.d.ts:8841`) |
| Session cron (`CronCreate`)                 | Claude Code | V / S  | Session-scoped; `schedule_wakeup` prompt origin in SDK types                               |
| Cloud routines (`/schedule`)                | Claude Code | V      | Run in Anthropic's cloud, not on this machine                                              |
| Remote triggers (`RemoteTrigger`)           | Claude Code | V      | Listed in `sdk-tools.d.ts`                                                                 |
| Multi-agent workflows (`Workflow`)          | Claude Code | V      | Background tasks of type `workflow` carry a `name` (`sdk.d.ts:162`)                        |
| Background subagents, `SendMessage`         | Claude Code | V      | Surface as `subagent` tasks                                                                |
| `Monitor`, `PushNotification`               | Claude Code | V      | `Monitor` already maps to `monitoring` liveness                                            |
| Stop a background task                      | Claude Code | S      | `Query.stopTask(taskId)`                                                                   |
| Goals (`thread/goal/set`, `get`, `clear`)   | Codex       | S      | Experimental API                                                                           |
| Cloud tasks, `codex exec`                   | Codex       | S      | `codex-rs/cloud-tasks`, `codex-rs/exec`                                                    |

What the references build on top:

| Reference | What                                                                   | Where                                                                                           |
| --------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Paseo     | Cron schedules that start or re-prompt agents; agent-control MCP tools | `packages/server/src/server/schedule/`, `packages/server/src/server/agent/tools/paseo-tools.ts` |
| herdr     | `agent prompt --wait` across terminal agents                           | `src/api/wait.rs`                                                                               |
| pstack    | Run-until-done loop; decision log and recap                            | `skills/poteto-mode/playbooks/autonomous-run.md`, `skills/show-me-your-work/`                   |
| VS Code   | Automations                                                            | `src/vs/workbench/contrib/chat/common/automations/`                                             |
| Orca      | Automations                                                            | `src/main/automations/`                                                                         |

## Scope

In: hosting harness-native unattended work inside Platform sessions, making it visible and
stoppable, and filling only the gaps no harness covers. Out: a Platform scheduler or agent tree
that duplicates a harness feature.

## Questions for the owner

- **Q1 — Where should scheduled work run?**
  - A: inside the harness session (Claude session crons, `/loop`), with Platform keeping the
    session alive and showing it as sleeping.
  - B: Platform's server owns schedules and starts or re-prompts sessions (Paseo's model).
  - C: cloud routines.
  - Recommendation: A first. B only for what must outlive a harness process or span Claude and
    Codex.
  - Decided 2026-09-25: owner — A first, as recommended.
- **Q2 — Cross-harness agent control.** Should a Claude session be able to start and wait on a
  Codex session (and back) through Platform's own MCP tools once Plan 087 lands?
  Recommendation: yes, as the one clearly Platform-only capability; decide the tool list in the
  research phase.
  Decided 2026-09-25: owner — yes, as recommended; it waits on Plan 087, whose M1+ the owner
  discusses first.
- **Q3 — Unattended permissions.** Unattended runs need either full access or saved approval
  rules ([Plan 145](145-harness-controls.md) covers saved rules). Recommendation: opt-in full access per
  unattended session, never a new default.
  Decided 2026-09-25: owner — opt-in full access per unattended session, as recommended.

## Research phase

Runs after PRs #32 and #35 merge (decided 2026-09-25: owner). It uses real provider sessions.

Questions:

1. For each harness capability above, is it reachable in a Platform session through the Agent
   SDK or the Codex app-server, or only in the interactive CLI? Method: start a Platform session
   on the dev server, ask the agent to use each tool, and read `bun run logs` and the SDK
   messages the adapter receives.
2. Does a Platform session survive long enough for a wakeup? Find when the adapter ends the
   `query()` process after a turn and whether a pending session cron keeps it alive. If the
   process ends, the wakeup is lost.
3. What does each capability emit (task types, prompt origins, hook inputs such as
   `background_tasks` and `session_crons`) that Platform can render and stop?
4. Which gaps remain after 1–3: scheduling that survives the harness process, Claude↔Codex
   orchestration, a decision log and recap across a long run, goal verification.

Deliverable: a capability matrix (harness capability × reachable from Platform × Platform
surface needed × build or surface) in this file, then split executable plans. Likely splits:
host and show harness schedules and loops; show and stop background agents and workflows;
decision trail and recap; cross-harness agent tools on Plan 087.

## Research findings (2026-09-25)

Read at: `origin/main` `116f0c611`; `lane/L3` `eed58a4c5` (Plan 145, PR #35, open); `lane/L4`
`68cd13a6f` (Plan 148, PR #32, open). Both PRs were unmerged, so the lane branches are the current
truth for background tasks, hooks and restart. Harness versions: Claude Code CLI 2.1.282, Agent SDK
0.3.281, `codex-cli` 0.157.0 (pinned `rust-v0.157.0`). Line numbers are `origin/main` unless
marked L3 or L4.

### Method

The dev server (Vite on 5173) was down, and AGENTS.md forbids starting one, so no Platform session
could be driven end to end. Instead, `/work/tmp/research/144/probe.ts` runs `query()` with the
options `claudeQueryOptions` builds (streaming prompt queue, `settingSources` user/project/local,
`claude_code` preset, `bypassPermissions`, `includeHookEvents`, the installed CLI), adds in-process
hook callbacks, and logs every SDK message; `debugFile` captures the CLI's scheduler log.
`/work/tmp/research/144/codex-goal.ts` drives `codex app-server` over stdio. What Platform does with
the messages comes from reading the adapter and ingestion code. The runs cost about $1.

| Run   | What was asked                                                         | Observed                                                                                                           |
| ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A     | `ScheduleWakeup` 60 s, one-shot `CronCreate`, background `sleep 600`   | Neither fired in 6 min. `CronList` at 6 min still listed both.                                                     |
| D     | `ScheduleWakeup` 60 s alone                                            | Fired at +73 s as its own turn.                                                                                    |
| E     | Wakeup, cron, background `sleep 400`                                   | Neither fired in 200 s. The scheduler took its lock and never scheduled a fire.                                    |
| F     | Wakeup and cron, no background task                                    | Both fired on the minute boundary as two consecutive turns.                                                        |
| B     | `CronCreate` with `durable: true`                                      | Result: "Session-only (not written to disk, dies when Claude exits)". Durable crons are feature-gated off.         |
| G     | Background `sleep 20` plus a wakeup; a prompt pushed during the wakeup | The task's completion started its own turn at +22.7 s. The pushed prompt was `queued` and ran after that `result`. |
| H     | `/goal A file named done.txt exists … and contains OK`                 | Goal set, the agent wrote the file, the goal check passed, one `result`.                                           |
| Codex | `thread/goal/set` on an idle thread                                    | The app-server started a turn 0.2 s later with no `turn/start`; the goal went `active` → `complete`.               |

The gate in run B is in the CLI bundle: `durable:i=!1 … let s=i&&qse()`, where `qse()` reads the
`tengu_kairos_cron_durable` flag.

### Q1: Reachability

A session built with Platform's options has these tools (run A, `system/init`): `Task`, `Bash`,
`CronCreate`, `CronDelete`, `CronList`, `Monitor`, `PushNotification`, `RemoteTrigger`,
`ScheduleWakeup`, `SendMessage`, `TaskStop`, `Workflow`, among others. `initializationResult().commands`
includes `loop`, `schedule`, `goal` and `recap`. Platform disables none of them.

Capability matrix:

| Capability                                     | Reachable in a Platform session                                                               | Evidence                                                                                                                       | Platform surface needed                      | Build or surface                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------- |
| `ScheduleWakeup`, `/loop`                      | Yes. Fires as a harness-started turn while the CLI process lives.                             | Runs D, F                                                                                                                      | Adopt the turn; "Sleeping until"; keep alive | Surface (phases 1–2)             |
| Session cron (`CronCreate`)                    | Yes, session-only. `durable` is gated off for this account.                                   | Runs F, B                                                                                                                      | Same as above                                | Surface (phases 1–2)             |
| Background task finishes after its turn        | Yes, today. The harness starts a turn to read the notification.                               | Run G                                                                                                                          | Adopt the turn                               | Surface (phase 1); a live defect |
| Cloud routines (`/schedule`, `RemoteTrigger`)  | The tool is reachable. Runs in Anthropic's cloud.                                             | `init` tools                                                                                                                   | None (Q1 decided A)                          | Neither                          |
| `Workflow`                                     | Tool present; not exercised (each run spawns agents)                                          | `init` tools; `task_type: local_workflow` + `name` (`sdk.d.ts:5838`)                                                           | Background-task roster and stop              | Done in Plan 145 (lane L3)       |
| Background subagents, `SendMessage`, `Monitor` | Yes                                                                                           | `init` tools; runs A, G                                                                                                        | Roster, stop, liveness                       | Done in Plan 145 (lane L3)       |
| `PushNotification`                             | Tool present; not exercised: it would reach the owner's phone (`agentPushNotifEnabled` is on) | `init` tools                                                                                                                   | Plan 142                                     | Neither                          |
| Claude `/goal`                                 | Yes                                                                                           | Run H                                                                                                                          | Goal indicator; clear                        | Surface (phase 3)                |
| Codex goals (`thread/goal/*`)                  | Yes, and no longer experimental in 0.157                                                      | Codex run; `features/src/lib.rs:1672` (`Stage::Stable`, on by default); test `thread_goal_methods_are_not_marked_experimental` | Set, get, clear; adopt continuation turns    | Surface (phase 3)                |
| Codex cloud tasks, `codex exec`                | Out of process; not a Platform session                                                        | —                                                                                                                              | None                                         | Neither                          |

What Platform does with a turn the harness started (code reading):

- Claude: `handleStreamEvent` drops every delta when there is no `activeTurn`
  (`claude.ts:1481` on L3). The assistant text still becomes an `item.completed` without a turn id,
  and ingestion treats a turnless message as already projected, so it finalizes with no fallback
  text (`provider-runtime-ingestion.ts:372-374`): the reply is lost. The `result` only logs
  `result.no_active_turn` (`claude.ts:1656` on L3), and `command_lifecycle` frames fall through to
  `recordUnmappedMessage`.
- Codex: `turn/started` with no pending turn returns early (`codex.ts:1806-1808`) and
  `turn/completed` logs `turn_completed.missing_turn` (`codex.ts:1838`).
- Attribution race (run G): `sendTurn` attributes the next `result` after its push to its own turn.
  When a wakeup or task-notification turn is running, the owner's prompt waits in the harness queue
  and the harness turn's `result` arrives first, so Platform would close the owner's turn with the
  wrong result and drop the real reply. Platform pushes user messages without a `uuid`
  (`claude-turn-input.ts:100`), which is the join key `command_lifecycle` reports as `queued`,
  `started` and `completed`. It also omits `origin: { kind: 'human' }`, which the SDK says a host
  wrapping keyboard input must stamp (`sdk.d.ts:5136`).

Task-notification turns already happen whenever a background shell or subagent finishes after its
turn ends, so the first two bullets and the race affect Plan 145's background tasks today, before any
schedule exists.

### Q2: Does a session survive until its wakeup?

The CLI process outlives the turn: the adapter feeds a streaming prompt queue and the query ends only
on `close()` (`claude.ts` `attach`/`pump`). Wakeups and crons fire in SDK mode (runs D, F). Every
session cron lives in that process's memory, and these end it:

1. The idle reaper stops a `ready` session after 30 minutes, sweeping every 5 minutes
   (`provider-session-reaper.ts:13,21`; `provider-service.ts:156,167`). Its only exemption is the
   background-task roster, and crons are not in the roster: run A's `background_tasks_changed`
   listed only the shell. A wakeup longer than 30 minutes (the tool allows 3600 s) or any later cron
   is lost.
2. Restart (Plan 148, lane L4) counts running, starting, waiting, rewinding and background work as
   busy (`engine.ts:490-497` on L4), not schedules. A sleeping session reads as idle and its crons die
   without a warning.
3. Changing model, effort, mode or cwd replaces the query (`claude.ts:576-584` on L3).
4. Durable crons are gated off (run B). Where they are on, they still fire only inside a running CLI
   for that project; a one-shot missed while no CLI ran is surfaced at the next start.
5. Recurring crons expire after 7 days (`CronCreateInput.recurring` docs, `sdk-tools.d.ts`).

A running background task holds back every fire (runs A and E against F). The cause is inferred from
an early return in the scheduler tick; the behaviour is observed. A "sleeping until" label has to say
so when background work is running.

Keeping a session alive costs one CLI process: idle `claude` processes on this machine measured
160–490 MB RSS (`ps -eo rss`, eight processes).

Codex goal continuations run inside the app-server process, under the same reaper. Codex has no
scheduler.

### Q3: What each capability emits

| Signal                                                                                                                                 | Where                                        | Use                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `ScheduleWakeup` result `{ scheduledFor, clampedDelaySeconds, wasClamped }`                                                            | Tool result in the stream                    | "Sleeping until" at once                                                          |
| `CronCreate` result `{ id, humanSchedule, recurring, durable }`                                                                        | Tool result                                  | A schedule row                                                                    |
| Stop hook input `session_crons: [{ id, schedule, recurring, prompt }]`, `background_tasks`                                             | In-process `hooks: { Stop }` callback option | The authoritative list after every turn, harness turns included; no settings file |
| Fire: `command_lifecycle started` with a uuid Platform never sent, `system/init`, assistant, `result`, `command_lifecycle completed`   | Stream                                       | Adopt the turn as scheduled                                                       |
| Task-notification turn: `task_notification`, then `system/init` with no lifecycle frame                                                | Stream                                       | Adopt the turn as a task wake-up                                                  |
| `UserPromptSubmit` hook `prompt` (the fired prompt); `source` is `null` in 2.1.282                                                     | In-process hook callback                     | The harness turn's title                                                          |
| Transcript `turnOrigin: "scheduled"`, `promptSource: "system"`                                                                         | `~/.claude/projects/…/<session>.jsonl`       | History import                                                                    |
| Codex `thread/goal/updated` `{ turnId, goal: { objective, status, tokenBudget, tokensUsed, timeUsedSeconds } }`, `thread/goal/cleared` | App-server notifications                     | Goal indicator                                                                    |

Codex goal statuses are `active`, `paused`, `blocked`, `usageLimited`, `budgetLimited` and
`complete` (`protocol.rs:4092` at the pin); the model has `create_goal`, `get_goal` and
`update_goal` tools (`ext/goal/src/spec.rs:9-11`). Platform's Codex generator lists none of
`thread/goal/*` (`generate.ts` `CLIENT_REQUEST_METHODS` on L3).

Stopping: `Query` has `interrupt`, `stopTask` and `backgroundTasks` but nothing that lists or deletes
a cron (`sdk.d.ts:2719-3085`). A cron ends through the model (`CronDelete`, `ScheduleWakeup` with
`stop: true`) or with the process.

### Q4: Gaps no harness covers

- **Schedules that outlive the CLI process.** Claude's durable crons are gated off here and fire only
  inside a live CLI anyway; Codex has none. This is a real gap. A Platform scheduler that starts
  Claude runs can declare them with `CLAUDE_CODE_HOST_SCHEDULED_RUN=1`, so the harness frames the
  turn as a `scheduled-trigger` (`sdk.d.ts:5174-5180`).
- **Claude↔Codex orchestration.** `SendMessage`, `Workflow` and Codex child agents each stay inside
  one harness. This is Platform-only and belongs on Plan 087 (Q2 decided).
- **Decision log and recap.** Already reachable: `show-me-your-work` (TSV decision log) loads as a
  user skill in every Platform Claude session, Claude has `/recap`, Codex has a recap prompt
  (`codex-rs/context-fragments/src/recap_prompt.rs`), and Plan 145 added transcript export. Nothing
  to build.
- **Goal verification.** Native on both: Codex's continuation prompt carries a completion audit
  (`ext/goal/templates/goals/continuation.md`), and Claude's `/goal` checks its condition in a Stop
  hook. Surface only.

Q3's premise is already met: `DEFAULT_RUNTIME_MODE` is `full-access`
(`packages/contracts/src/orchestration-runtime.ts:106`). What an unattended run still needs is a way
to reach the owner when a harness-started turn opens an approval in an `approval-required` session,
which is Plan 142.

### Recommendations

- Recommendation: adopt harness-started turns as real turns with an origin (`scheduled`, `loop`,
  `task`, `goal`), matched by stamping a `uuid` on every prompt Platform pushes. Hiding them loses
  replies and misattributes the owner's next turn.
- Recommendation: read schedules from an in-process `Stop` hook callback. No `CronList` prompt, no
  settings file, no transcript parsing.
- Recommendation: the reaper exempts a session with a pending cron or an active Codex goal, and the
  Plan 148 Restart confirmation lists sleeping sessions with the schedules it will drop.
- Recommendation: "Cancel schedules" stops the runtime, which drops every cron. Removing one cron is
  a request to the agent.
- Recommendation: Plan 087's agent tools are `list_sessions`, `start_session` (provider, model,
  worktree, prompt), `send_prompt` (optional wait), `wait_for_session`, `read_session_reply` and
  `interrupt_session`. No schedule tools: the harnesses own those.
- Recommendation: drop the "decision trail and recap" split, and the "background agents and
  workflows" split, which Plan 145 finished on lane L3.

### Owner questions

1. **Schedules that must outlive the CLI** (Restart, reaper, model switch).
   - A: accept the loss; Restart and model switch name the schedules they drop.
   - B: build a Platform scheduler now (Paseo's model) for prompts that must survive.
   - Recommendation: A. Revisit B when a real daily routine needs it; no harness offers it today.
   - Decided 2026-09-26: recommendation (wave 2) — A.
2. **Keep-alive budget.** Each sleeping Claude session keeps a 160–490 MB process.
   - A: no cap; the rail shows sleeping sessions and the wide event carries the count.
   - B: cap sleeping sessions at N and refuse new schedules past it.
   - Recommendation: A, on this 31 GB machine with the count logged.
   - Decided 2026-09-26: recommendation (wave 2) — A.

### Proposed phases

1. **Harness-started turns (Claude and Codex).** S–M, server and web. Stamp `uuid` and
   `origin: { kind: 'human' }` on pushed prompts; settle a turn by its own `command_lifecycle`;
   adopt a Claude turn with an unknown or missing lifecycle uuid and a Codex `turn/started` with no
   pending turn as a provider-started turn with an origin; label it in the timeline. Scenarios: a
   background `sleep 20` that ends after its turn shows the follow-up reply; a prompt sent during a
   wakeup turn gets its own reply. Fixes a live defect in Plan 145's background tasks.
2. **Sleeping sessions.** S–M. A `Stop` hook callback feeds a per-session schedule list kept like
   the roster in `ProviderService`; the header shows "Sleeping until …" and the list; the reaper
   and Plan 148 Restart account for schedules; replacing the query warns; "Cancel schedules" stops
   the runtime. Depends on 1.
3. **Goals.** M. Codex `thread/goal/set|get|clear` and goal notifications (schema refresh adds the
   methods); Claude `/goal` from the composer; a goal indicator with status and budget, clear and
   pause. Depends on 1.
4. **Cross-harness agent tools.** On Plan 087 M1+, after the owner's discussion of it.

## Phases

Proposed under Research findings; approved as wave 2 lanes (`docs/next-wave.md`): lane B runs
Phase 1, lane A Phases 2–3.

### Phase 1: harness-started turns (landed 2026-09-26, wave 2 lane B)

- Claude: prompts carry `origin: { kind: 'human' }` beside their uuid. `command_lifecycle` frames
  (outside the SDK's message union, read by shape) drive the turn: `started` with an unknown uuid
  adopts a wakeup or cron as its own turn (`origin: 'scheduled'`); an `init` with nothing running
  adopts the task-notification turn (`'task'`) or anything else (`'provider'`). A prompt sent while
  a harness turn runs waits as the pending turn and starts on its own lifecycle frame, so it gets
  its own result. A harness turn that runs ahead of a queued prompt (a wakeup or task notification
  between push and `started`) streams onto the owner's turn and its `result` is skipped.
- Codex: `turn/started` on the root thread with no turn of ours pending is adopted (`'provider'`).
- Orchestration: `turn.started` with an origin dispatches the internal
  `session.turn.provider-start`, whose `session.turn-provider-started` event makes a running,
  adopted turn the latest turn; the runtime settles it like any other. The decider refuses it
  while a requested turn is still starting or running (that turn owns the runtime). A
  `turn.provider-started` info activity labels the turn ("Scheduled wake-up", "A background task
  finished", "The agent started this turn"). The composer already queues a follow-up while a turn
  runs, so a prompt sent during a harness turn is delivered after it.
- `MockProviderAdapter.startProviderTurn` fakes a harness turn for tests.
- Once the CLI has sent any `command_lifecycle` frame, an owner turn counts as started only at
  its own `started`: a wakeup or task notification that runs between the push and that frame is
  someone else's turn, and its `result` is skipped. Every turn's end reports `ready` with that
  turn's id, so the end of a harness turn the log left out cannot settle a requested turn.
- A harness turn gets a checkpoint like any other: the settle-time capture uses the latest turn.
- Not done here: interrupting the owner's prompt while it waits behind a harness turn (Stop
  interrupts the harness turn; the log refuses a requested turn while a harness turn runs, so this
  is reachable only in a race); a browser scenario and a `look` of a turn with no user message,
  which need a way to make the dev app's mock provider start a harness turn.

### Phase 2: sleeping sessions (landed 2026-09-26, wave 2 lane A)

- An in-process `Stop` hook (`ClaudeAgentSession.stopHook`,
  not on ephemeral sessions) emits `schedules.updated` with the session's `session_crons`.
  `SessionScheduleRegistry` (`provider/session-schedules.ts`) holds them per session, cleared when
  the runtime starts, exits or stops; `utils/cron-next.ts` computes each next fire in local time
  (a one-shot from when a report first listed it). The reaper and the idle stop keep a session with
  schedules (`keepsProcess`); the sweep and a `schedules.changed` event log the sleeping count.
  The shell carries `sleepingUntil`, the rail reads `sleeping`, and a completed turn still
  notifies. Restart lists sleeping sessions (`BusySessionState` `sleeping`, "Sleeping; its wake-ups
  end"); `bun run deploy --restart` waits out other busy sessions, then ends sleeping ones' schedules
  without waiting. Replacing the Claude query (model, effort, mode, folder) warns in the timeline.
  The chat headers show `SchedulesButton` (moon, wake time, list from
  `GET /providers/sessions/:id/schedules`, "Cancel schedules" = `session.runtime.stop`). The mock
  driver's `wakeupMinutes` stands in for `ScheduleWakeup`; scenario `chat-sleeping-session`.

## Dependencies

- Plan 087 for any agent-control tools Platform exposes.
- [Plan 145](145-harness-controls.md) for saved approval rules, background-task list/stop and hooks
  visibility; this plan must not duplicate those surfaces.
- Plan 142 (Web Push) to reach the owner when an unattended run finishes or blocks.

## Out of scope and not copied

- Orca's orchestration model (runs, tasks, dispatches, decision gates): heavy and experimental.
- Hosted relays and Slack, Discord or GitHub triggers (Paseo Hub, pstack automations): built
  for teams; Platform has one owner.
- Reading agent state from the screen for SDK sessions: SDK events are authoritative.
- Codex experimental APIs beyond goals until they stabilise.
