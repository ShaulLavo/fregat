# Plan 148: Server deploys stage an update; the app restarts it on a click

## Status and authorization

- Status: PROPOSED — D3 replaced by the owner on 2026-09-25 (completion wave, lane L4): nothing
  restarts until someone clicks Restart. D1, D2, D4 and D5 keep their recommendations.
- Priority: P1. It is the blocker for developing Platform from inside Platform.
- Effort: M (roughly 300–500 lines across `scripts/deploy/`, the server and one web status item).
- Risk: MED. A promotion that runs twice or not at all leaves `current` and the running bundle
  disagreeing; a confirmation that lists the wrong sessions interrupts work the owner meant to keep.
- Planned at: Platform `bf806401`, 2026-09-25. Origin: the 2026-09-25 daily-driver blocker review.
  The owner keeps the rule "every task ends with a deploy" and wants to run agents from Platform
  itself; killing a turn and resuming it is waste, not a fix.
- Lane L4 of `docs/completion-wave.md` builds it in `/work/worktrees/platform/L4` and delivers it
  in the lane's pull request. The owner deploys after merging.

## Outcome

`bun run deploy --server` never interrupts anything. It builds, verifies and stages the release,
then returns, so the agent that ran it finishes its turn normally. The app shows "Update
available" with a Restart button. Restart with nothing running restarts at once. Restart with
turns running first asks for confirmation and names the sessions it will interrupt. Queued sends
start on the new server. Nothing restarts until someone clicks.

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
- `SIGUSR2` has no handler, so its default action terminates the server. The deploy side and the
  server's handler (D4) must therefore land in one commit.

## What the references do

| Reference | Behaviour                                                                                 | Path                                                |
| --------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Codex     | App-server daemon cold-resumes its loaded threads after a restart                         | `codex-rs/app-server/src/daemon_thread_recovery.rs` |
| T3 Code   | No drain; at boot it may continue an interrupted turn when a setting allows               | `apps/server/src/serverRuntimeStartup.ts`           |
| Orca      | Keeps PTYs in a daemon outside the service cgroup (the model for Plan 149, not this plan) | `docs/reference/orcad-operations.md`                |

None asks before restarting. Platform's event log already makes queued work durable, so holding
new turns back during the restart is the cheap half.

## Scope

- A **staged release**: `deploy --server` stops short of `current` and writes
  `/work/platform-production/pending` instead, then tells the running server.
- An **update state** in the server: the staged release, and the busy set (D2) computed when asked.
- A **restart route**: it restarts at once when nothing is busy, and otherwise answers with the
  busy sessions so the app can ask. While it exits it admits no new turns.
- **Promotion** at start: the unit swaps `pending` into `current` before the new server boots.
- A **post-restart live check** that runs outside the service and reports where the owner sees it.
- A **status item** in the web app: "Update available" with "Restart", and the confirmation.
- The command's new contract, and the `AGENTS.md` text that describes it.

## Decisions

- **D1 — Where the old server's web comes from while an update waits.** Recommended: the old
  server keeps serving the old web, because `current` is not swapped until promotion. Swapping
  first would serve a new web bundle against an old server until someone clicks; a protocol bump
  (`ORCHESTRATION_WS_PROTOCOL_VERSION`) would break every open tab. A web-only deploy made while a
  server release is pending builds on the pending server and replaces `pending`; with nothing
  pending it swaps `current` at once, as today.
- **D2 — What counts as busy.** Recommended: a runtime `starting`, `running` or `waiting`, a
  pending provider launch (`providerService` `pendingLaunches`), a turn `claimed` or `adopted`,
  and a pending rewind (`session.pendingRewindCommandId`). `waiting` counts: restarting under an
  open approval or question loses it. The first phase greps for other in-flight work (title and
  commit-message generation, worktree creation) and adds any that recovery cannot replay. The
  busy set is what the confirmation names.
- **D3 — When the server restarts.** Decided by the owner, 2026-09-25 (completion wave): a
  `--server` deploy never restarts on a timer, and the server never restarts itself when it goes
  idle. The deploy stages the release and the app shows "Update available" with a Restart
  button. Restart with an empty busy set restarts at once. Restart with a non-empty busy set first
  asks for confirmation and names the sessions it will interrupt. Nothing restarts until someone
  clicks. There is no maximum wait and no `server.restartMaxWaitMinutes` setting.
- **D4 — How the deploy tells the server.** Recommended: `systemctl --user kill
--kill-whom=main -s SIGUSR2 platform-prod.service`. No new route, no auth surface; only the
  owner's user can send it. The server answers by re-reading `pending`, publishing the update
  state to open tabs and logging one wide event. It also reads `pending` at boot. Restart itself is
  an authenticated route behind the origin guard.
- **D5 — How the server exits and comes back.** Recommended: exit code 75 after a normal
  `closeApp`, and in the unit template `SuccessExitStatus=143 75` plus `RestartForceExitStatus=75`,
  so the restart is clean in the journal. `ExecStartPre` runs a small promotion step (swap
  `pending` → `current` if present, atomically, the way `replaceLink` in
  `scripts/deploy/release.ts:230-235` does). A crash while an update waits therefore also
  promotes: the process is already gone, and the staged release is what the deploy asked for.

`--rollback` keeps the immediate restart: it is the emergency path. It also deletes `pending`, so
the next restart cannot promote a release the owner just backed away from.

## Phases

### Phase 1: Stage instead of swap, and the server learns about it

1. `mesh.ts` `deploy()`: with `--server`, after `bootCandidate`, write `pending` and skip
   `swapCurrent`, `restartServer` and `waitForServerRelease`. A web-only deploy follows D1.
2. Unit template: D5's lines and `ExecStartPre=` for the promotion step. `installUnit` already
   restarts once when the template changes; that is the last old-style restart.
3. Tell the server (D4). If the server is not running, promote and `systemctl --user start`.
4. The server's `SIGUSR2` handler and boot read of `pending` land in the same commit (see What
   exists today).
5. The command prints, and returns 0:

   ```
   [deploy] <release> staged. The app shows "Update available"; the server restarts when someone clicks Restart.
   [deploy] Did it land: curl -s http://127.0.0.1:3301/release | jq '.server.release, .pending'
   ```

### Phase 2: Restart in the server

1. A `ServerUpdate` owned next to `appCleanup`: the staged release (`name`, `stagedAt`), a state
   `serving | restarting`, and the busy set from D2, computed from the read model and
   `providerService` when a restart is requested (no polling).
2. `POST /server/restart` with `{ interrupt: sessionId[] }`. When the busy set is a subset of
   `interrupt`, it answers `{ restarting: true }` and restarts. Otherwise it answers
   `{ restarting: false, busy: [{ sessionId, title, state }] }` and changes nothing. The app's
   first click sends an empty list, so an idle server restarts at once and a busy one names its
   sessions; a turn that starts while the dialog is open comes back as a new name instead of
   being interrupted unseen. With nothing staged it answers a catalog error (`NO_UPDATE_STAGED`).
3. While `restarting`, `claimTurn` returns `false`, leaving the turn `queued`; boot starts it
   (`scheduleQueuedStarts`). New sends are accepted and queued, never refused.
4. Exit 75 through `closeApp`. Interrupted turns go through boot recovery as today ("Turn
   interrupted").
5. One wide event per restart: release from and to, who asked (route or signal), the sessions it
   interrupted, and the time since the release was staged. Errors from the catalog carry `why` and
   `fix`.

### Phase 3: What the owner sees

1. `GET /release` gains `pending: { release, stagedAt } | null` and `liveCheck: { status, at }`
   for the served release.
2. Web: a status item reads that through a query (`staleTime` short, refetched when the server
   publishes a change and on the shell stream's reconnect) and shows "Update available" with a
   Restart button. Restart is a TanStack mutation (key in the owning feature's
   `mutation-keys.ts`, `Spinner` from `useIsMutating`). A `busy` answer opens a confirmation that
   lists the sessions by title, with "Restart" (destructive) and "Cancel". Confirming sends the
   listed ids; a second `busy` answer updates the list in place.
3. The promotion step launches the live check with `systemd-run --user
--unit=platform-live-check-<stamp>`, outside the service cgroup, so it survives the restart
   it waits for. It waits for `server.release` to equal the promoted release, runs
   `live-check.mjs` as today, and writes `live-check.json` into the release directory. The web
   toasts a failed live check with the rollback command as its `fix`.

## `AGENTS.md` edit

In "Deployment: The Mesh", replace the `--server` bullet with: `--server` builds the server and
stages it. The app then shows "Update available", and the server restarts only when someone
clicks Restart; with turns running, Restart first names the sessions it will interrupt. The
command returns before any restart, so a server change is verified on the dev server before
deploying, and "did it land" is `GET /platform/release` after the restart. Change "runs the
headless live check" in the deploy bullet to say it runs after the restart, outside the service.
Delete "drops live terminal and agent sessions" from `mesh.ts:39`; terminals still restart until
Plan 149.

## Verification

- Server: a test over the in-process app with `MockProviderAdapter`: start a turn, stage a
  release, call restart with an empty list and get the busy session back with nothing changed;
  call it with that session and get `restarting`, then send a second message and see it stay
  `queued`; a fresh app over the same database starts the queued turn. A second test: `waiting`
  counts as busy, and a session that became busy after the first answer blocks the restart.
- Deploy: `bun run deploy --server` from a Platform session running a real turn. The command
  returns, the turn completes, nothing restarts; clicking Restart gives one clean restart in the
  journal (status 75, no "Failed"), `current` equals the staged release, and the live-check
  unit's result reaches the toast.
- `bun run agent:browser look` on the status item with a staged release, and on the confirmation
  with a running turn; name the evidence directory.

## Out of scope and not copied

- A restart on a timer, or on idle. The owner decided nothing restarts until someone clicks (D3).
- Blue/green. Rejected: the orchestration engine keeps its read model in memory over one SQLite
  event store, so two servers would both write it; the mesh route is pinned to 3301; and terminals
  never drain.
- Terminals. A shell is never idle, so the restart still ends it. Plan 149 moves PTYs into their
  own host so a restart leaves them running.
- Moving provider adapters into a separate host. Measure how often the confirmation interrupts
  real work first.
- Plan 132 overlap: none in code. 132 states it "does not change the mesh deployment"; its
  Phase 3 terminal items touch `terminal/service.ts`, which Plan 149 also changes, not this plan.
