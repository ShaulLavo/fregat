# Plan 148: Server deploys restart when no turn is running

## Status and authorization

- Status: PROPOSED — D1–D5 have recommended answers; D3 (the maximum wait) wants the owner's number.
- Priority: P1. It is the blocker for developing Platform from inside Platform.
- Effort: M (roughly 300–500 lines across `scripts/deploy/`, the server and one web status item).
- Risk: MED. A drain that never finishes leaves production on the old server; a promotion that
  runs twice or not at all leaves `current` and the running bundle disagreeing.
- Planned at: Platform `bf806401`, 2026-09-25. Origin: the 2026-09-25 daily-driver blocker review.
  The owner keeps the rule "every task ends with a deploy" and wants to run agents from Platform
  itself; killing a turn and resuming it is waste, not a fix.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy --server` (the last one that restarts the old way).

## Outcome

`bun run deploy --server` never interrupts a running turn. It builds, verifies and stages the
release, then returns. The server stops starting new turns and restarts itself as soon as none is
running; queued sends start on the new server. The agent that ran the deploy finishes its turn
normally, and the restart happens after it.

## What exists today

- `deploy()` restarts unconditionally: `scripts/deploy/mesh.ts:115-122` installs the unit, swaps
  `current`, then `restartServer()` (`scripts/deploy/systemd.ts:37-40`, `systemctl --user
restart`) and `waitForServerRelease` (`systemd.ts:42`). The usage text says so
  (`mesh.ts:39`: "drops live terminal and agent sessions"). `--rollback` does the same
  (`mesh.ts:150-162`).
- SIGTERM runs `closeApp` (`apps/server/src/index.ts:111-125`) → `appCleanup`
  (`apps/server/src/app.ts:453-478`): `terminal.dispose()`, `orchestration.close()`, then
  `providerService.shutdown()` (`apps/server/src/provider/provider-service.ts:190`), which disposes
  every adapter and so kills each CLI (`adapters/process-lifetime.ts:24-28`, SIGTERM then SIGKILL).
- The unit sets no `KillMode`, so systemd also signals the whole cgroup. A Claude or Codex CLI the
  server launched, and every Bash command that CLI runs — including `bun run deploy` — are in it.
  The deploying agent dies before `waitForServerRelease` and the live check run.
- At boot, `recoverRuntime` (`apps/server/src/orchestration/engine.ts:726-758`) turns any runtime
  that was `starting`, `running` or `waiting`, and any turn `claimed` or `adopted`, into
  `session.runtime-recovered`: "The server restarted while this provider operation was in
  progress. The prompt was not resent." The projection marks runtime and turn `interrupted`
  (`projection-pipeline.ts:470-495`). An unanswered approval is lost the same way.
- Turns still `queued` survive: `scheduleQueuedStarts` (`engine.ts:761-768`, called from
  `startReactors` at `engine.ts:195`) starts them after boot.
- Idle sessions already resume. The binding keeps its cursor; the next send goes through
  `continuableBinding` (`provider-service.ts:292`, defined at `:1127`), which sets
  `resumeExisting` when a handle exists (`:1172`). Claude gets `resume: <sessionId>`, Codex
  `thread/resume`. The only cost is a cold spawn.
- The one place a turn becomes a provider call is `claimTurn`
  (`apps/server/src/orchestration/provider-command-reactor.ts:296-339`): it requires
  `providerStartState === 'queued'` and dispatches `session.provider-start.claim`. That is the
  admission gate this plan needs.
- The server serves `WEB_ROOT=/work/platform-production/current/web` through the symlink on every
  request (`apps/server/src/web/routes.ts:22-34`), while its own code was loaded at boot. Bun
  resolves the entry through the symlink, so `server.release` in `GET /release`
  (`web/routes.ts:23`, `releaseDescriptor`) names the bundle actually running.
- The unit template now carries `SuccessExitStatus=143` (added 2026-09-25), with
  `Restart=on-failure` and `RestartSec=3`.

## What the references do

| Reference | Behaviour                                                                                 | Path                                                |
| --------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Codex     | App-server daemon cold-resumes its loaded threads after a restart                         | `codex-rs/app-server/src/daemon_thread_recovery.rs` |
| T3 Code   | No drain; at boot it may continue an interrupted turn when a setting allows               | `apps/server/src/serverRuntimeStartup.ts`           |
| Orca      | Keeps PTYs in a daemon outside the service cgroup (the model for Plan 149, not this plan) | `docs/reference/orcad-operations.md`                |

None drains before restarting; Platform's event log already makes queued work durable, so a drain
is the cheap half.

## Scope

- A **staged release**: `deploy --server` stops short of `current` and writes
  `/work/platform-production/pending` instead.
- A **drain** in the server: on request it admits no new turns and exits once nothing is busy.
- **Promotion** at start: the unit swaps `pending` into `current` before the new server boots.
- A **post-restart live check** that runs outside the service and reports where the owner sees it.
- A **status item** in the web app: "Update waiting on N sessions", with "Restart now".
- The command's new contract, and the `AGENTS.md` text that describes it.

## Decisions

- **D1 — Where the old server's web comes from during the drain.** Recommended: the old server
  keeps serving the old web, because `current` is not swapped until promotion. Swapping first
  would serve a new web bundle against an old server for the whole drain; a protocol bump
  (`ORCHESTRATION_WS_PROTOCOL_VERSION`) would break every open tab. A web-only deploy made while a
  server release is pending builds on the pending server and replaces `pending`; with nothing
  pending it swaps `current` at once, as today.
- **D2 — What counts as busy.** Recommended: a runtime `starting`, `running` or `waiting`, a
  pending provider launch (`providerService` `pendingLaunches`), a turn `claimed` or `adopted`,
  and a pending rewind (`session.pendingRewindCommandId`). `waiting` counts: restarting under an
  open approval or question loses it. The first phase greps for other in-flight work (title and
  commit-message generation, worktree creation) and adds any that recovery cannot replay.
- **D3 — The maximum wait.** Recommended: 30 minutes, then restart anyway; the interruption
  message names the deploy. A drain that can wait forever means production never updates while an
  agent runs overnight. Register it as `server.restartMaxWaitMinutes` (`application` scope) in
  `packages/contracts/src/settings/keys.ts`, read by the drain in the same pass. **Owner: confirm
  the number, or say "never force".**
- **D4 — How the deploy signals the server.** Recommended: `systemctl --user kill
--kill-whom=main -s SIGUSR2 platform-prod.service`. No new route, no auth surface; only the
  owner's user can send it. The server answers by starting the drain and logging one wide event.
  "Restart now" from the UI is an authenticated route that ends the drain immediately.
- **D5 — How the server exits and comes back.** Recommended: exit code 75 after a normal
  `closeApp`, and in the unit template `SuccessExitStatus=143 75` plus `RestartForceExitStatus=75`,
  so the restart is clean in the journal. `ExecStartPre` runs a small promotion script (swap
  `pending` → `current` if present, atomically, the way `replaceLink` in
  `scripts/deploy/release.ts:230-235` does). A crash while pending therefore also promotes, which
  is what the deploy asked for.

`--rollback` keeps the immediate restart: it is the emergency path.

## Phases

### Phase 1: Stage instead of swap

1. `mesh.ts` `deploy()`: with `--server`, after `bootCandidate`, write `pending` and skip
   `swapCurrent`, `restartServer` and `waitForServerRelease`. A web-only deploy follows D1.
2. Unit template: D5's lines and `ExecStartPre=` for the promotion script
   (`scripts/deploy/promote.ts`). `installUnit` already restarts once when the template changes;
   that is the last old-style restart.
3. Signal the drain (D4). If the server is not running, promote and `systemctl --user start`.
4. The command prints, and returns 0:

   ```
   [deploy] <release> staged; the server restarts when no turn is running (N busy now, max 30 min).
   [deploy] Did it land: curl -s http://127.0.0.1:3301/release | jq .server.release
   ```

### Phase 2: Drain in the server

1. A `ServerDrain` owned next to `appCleanup`: states `serving | draining | exiting`, the reason,
   `since`, and the busy set from D2 recomputed on each runtime/turn event (no polling).
2. `claimTurn` returns `false` while draining, leaving the turn `queued`; boot starts it
   (`scheduleQueuedStarts`). New sends are accepted and queued, never refused.
3. When the busy set is empty, or D3's wait expires, exit 75 through `closeApp`.
4. One wide event per drain: release, busy count at start, wait, forced or clean, and the session
   ids that held it. Errors from the catalog carry `why` and `fix`.

### Phase 3: Live check after the restart, and what the owner sees

1. The deploy launches the live check with `systemd-run --user --unit=platform-live-check-<stamp>`,
   so it is outside the service cgroup and survives the restart it waits for. It waits for
   `server.release` to equal the staged release, runs `live-check.mjs` as today, and writes
   `live-check.json` into the release directory.
2. `GET /release` gains `pending: { release, since, busy } | null` and `liveCheck: { status, at }`
   for the served release.
3. Web: a status item reads that through a query (`staleTime` short, refetched on the shell
   stream's reconnect), shows "Update waiting on N sessions" with "Restart now" (a TanStack
   mutation, key in the owning feature's `mutation-keys.ts`, `OrbitLoader` from `useIsMutating`),
   and toasts a failed live check with the rollback command as its `fix`.

## `AGENTS.md` edit

In "Deployment: The Mesh", replace the `--server` bullet with: `--server` builds the server and
stages it; the running server stops starting turns and restarts itself when none is running (at
most `server.restartMaxWaitMinutes`). The command returns before the restart, so a server change is
verified on the dev server before deploying, and "did it land" is `GET /platform/release` in a
later turn or the live-check toast. Change "runs the headless live check" in the deploy bullet to
say it runs after the restart, outside the service. Delete "drops live terminal and agent sessions"
from `mesh.ts:39`; terminals still restart until Plan 149.

## Verification

- Server: a test over the in-process app with `MockProviderAdapter`: start a turn, request a
  drain, send a second message; the second stays `queued`, the exit fires only after the first
  settles, and a fresh app over the same database starts the queued turn. A second test for D3's
  forced exit and for `waiting` holding the drain.
- Deploy: `bun run deploy --server` from a Platform session running a real turn. The command
  returns, the turn completes, the journal shows one clean restart (status 75, no "Failed"),
  `current` equals the staged release, and the live-check unit's result reaches the toast.
- `bun run agent:browser look` on the status item while a drain is pending; name the evidence
  directory.

## Out of scope and not copied

- Blue/green. Rejected: the orchestration engine keeps its read model in memory over one SQLite
  event store, so two servers would both write it; the mesh route is pinned to 3301; and terminals
  never drain.
- Terminals. A shell is never idle, so the restart still ends it. Plan 149 moves PTYs into their
  own host so a dev server survives.
- Moving provider adapters into a separate host. Measure how long real drains take first.
- Plan 132 overlap: none in code. 132 states it "does not change the mesh deployment"; its
  Phase 3 terminal items touch `terminal/service.ts`, which Plan 149 also changes, not this plan.
