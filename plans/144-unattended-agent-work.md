# Plan 144: Unattended and multi-agent work

## Status and authorization

- Status: RESEARCH PLAN — the research phase decides what Platform builds; no implementation
  scope yet. Q1–Q3 decided 2026-09-25. The research phase runs after PRs #32 (Plan 148) and #35
  (Plan 145) merge.
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

## Phases

Written after the research phase.

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
