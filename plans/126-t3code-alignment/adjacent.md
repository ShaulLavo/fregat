# Adjacent product and verification audit

Two source passes, 2026-09-20. Platform `3c9b88c35784e571e706600b0cee8e95a2656f77`;
T3 Code `7445aa733ada33e45289e5aa5055f79142556513`. Upstream paths below are relative
to that commit, not to the older checked-out reference. No runtime equivalence is claimed.
EXT-14–18 come from the [2026-09-24 upstream delta](delta-2026-09-24.md).

## Coverage

| Area                                | Source result                                                                         | Execution evidence still required                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Git basics                          | Local branches, status, staging, commit generation, push and GitHub PR creation exist | Replay the same workflow and failures against both apps         |
| Forge integrations and PR workspace | Confirmed partial implementation                                                      | Accounts, provider-specific capability and cancellation matrix  |
| Project clone/publish/setup         | Confirmed missing upstream paths; manual project scripts exist                        | Real temporary repository and process lifecycle scenarios       |
| Terminal                            | Reconnect replay exists; durable history and restart contract differ                  | Restart, reconnect, multiple attachments and terminal ownership |
| Notifications                       | Upstream coordinator/settings have no local equivalent found                          | Foreground/background, permission denial and deduplication      |
| Browser/device tooling              | Upstream product subsystems missing locally                                           | Desktop-host and remote-device execution                        |
| Remote access                       | Both connect machines; pairing/session/relay model differs                            | Device revocation, reconnect, origin and environment isolation  |
| Desktop/mobile/distribution         | Upstream has additional clients and release/update workflows                          | Packaged platform matrix; not tested in this audit              |
| Background work/diagnostics         | Local observability exists; upstream power/lease and management APIs differ           | Measure before claiming a resource improvement                  |
| Default branch, submodules, drift   | Absent locally (2026-09-24 delta)                                                     | Real temporary repositories with a local remote                 |
| Load balancing, usage page          | Absent locally (2026-09-24 delta); usage implementation owned by Plan 141             | Two-machine and fixture-history scenarios                       |
| Verification                        | Local CI exists; no pinned cross-product conformance gate                             | Build the shared scenario corpus and replay it                  |

## Findings

### EXT-01: Match source-control provider capabilities

- Priority P2; confidence HIGH; effort L; risk HIGH, credentials and remote mutations.
- Upstream `packages/contracts/src/sourceControl.ts:5` lists GitHub, GitLab, Forgejo,
  Azure DevOps and Bitbucket. `apps/server/src/sourceControl/SourceControlProviderRegistry.ts:307`
  constructs all five implementations. This is implemented behavior, not an enum-only claim.
- Local `apps/server/src/git/pull-request.ts:47` and `:106` resolve support through `gh`
  and a GitHub remote. `apps/server/src/git/service.ts:647` exposes that narrower result.
- Impact: GitLab and other supported upstream forges cannot complete the equivalent workflow.
- Implement provider discovery/auth/status, capability-aware operations and URL resolution in
  `apps/server/src/git/`, contracts, then real UI consumers. Preserve existing GitHub behavior.
  Do not claim each forge supports every operation: copy the pinned implementation's support matrix.
- Acceptance: run lookup, existing/new change request, unsupported operation, expired auth and
  self-hosted URL cases against injected external HTTP/CLI boundaries for every registered forge.
  Model tests after `apps/server/src/git/tests/push-and-pull-request.test.ts`.

### EXT-02: Complete the pull-request workflow and session linkage

- Priority P2; confidence HIGH; effort L; risk HIGH, repository and remote mutations.
- Upstream `packages/contracts/src/rpc.ts:390` onward exposes PR list/detail/activity/review,
  comments/replies/resolution/reactions, reviewers/labels, viewed files and actions.
  `packages/contracts/src/git.ts:12` defines composed commit/push/PR operations;
  `:113` carries an action ID and thread ID; `:155` prepares a PR thread in local/worktree mode.
  Concrete consumers include `apps/web/src/components/PullRequestThreadDialog.tsx` and
  `apps/server/src/git/linkCreatedPullRequest.ts`.
- Local `apps/server/src/git/routes.ts:141`, `apps/server/src/git/pull-request.ts:60`, and
  `apps/web/src/features/git/components/branch-actions.tsx:32` expose branch PR state/create/open,
  not the upstream review workspace. Local diff comments already exist; do not replace them
  with a second unrelated comment system.
- Implement PR/session association, review sources and operations, refresh streams, and composed
  progress/failure outcomes through contracts, server, mutations and reachable panels.
- Reopened 2026-09-24: pinned `apps/web/src/pullRequestReference.ts` parses PR references
  (URLs, `#123`, forge-specific checkout forms) for `PullRequestThreadDialog.tsx` and
  `LinkPullRequestDialog.tsx`. The earlier `adjacent-pull-request-reference` rejection assumed no
  start-from-PR flow; this group plans that flow, so the parser belongs here.
- Acceptance: PR create reuses an existing PR; partial commit/push failure never reports full
  success; a PR opens a correctly scoped session/worktree; comments, viewed state and review
  survive refresh; external changes invalidate the appropriate queries. A pasted PR URL or
  reference opens the same session flow. Mock forge I/O only.

### EXT-03: Add clone and repository publication workflows

- Priority P2; confidence HIGH; effort L; risk HIGH, filesystem and remote changes.
- Upstream `packages/contracts/src/sourceControl.ts:65-109` defines lookup/clone/publish;
  `packages/contracts/src/rpc.ts:421-427` includes clone start/cancel/retry and a subscription.
  `apps/web/src/components/ProjectCloneToastCoordinator.tsx` consumes progress.
- Local `apps/server/src/git/routes.ts` and `apps/web/src/features/chat-mode/` support selecting
  local projects; bounded search for `clone|publish|projectClone` found tests that clone fixtures
  and **branch** publication, not a repository clone/publication user path. Publishing a branch
  to an existing origin is not creating a remote repository.
- Implement destination validation, progress, cancellation, retry and project registration as
  one owned lifecycle. Reuse existing worktree/process ownership rather than detached subprocesses.
- Acceptance: canceled clone leaves no registered half-project; failed clone can retry; existing
  destination is preserved; remote creation plus failed initial push reports the actual outcome.

### EXT-04: Match project configuration and worktree setup scripts

- Priority P1; confidence HIGH; effort L; risk HIGH, execution ordering.
- Upstream `packages/contracts/src/t3ProjectFile.ts:27-65` includes `runOnWorktreeCreate`,
  `async` (default true), `previewUrl`, and `autoOpenPreview`; `:83` adds project thread environment
  defaults. `apps/server/src/project/ProjectSetupScriptRunner.ts:288` resolves a project and
  runs its setup. `packages/contracts/src/worktreeSetup.ts` describes observable setup progress.
- Local `packages/contracts/src/chat-model.ts:157` stores only script name/command.
  `apps/web/src/features/chat-mode/utils/project-scripts.ts:57` combines saved and manifest
  scripts, and `packages/client-core/src/commands/workspace.ts:89` exposes a run command.
  Searches for `runOnWorktreeCreate|waitForSetup` across local packages/server/web found none.
- Extend the model and consumers, import project configuration, and make foreground setup gate
  agent admission while background setup does not. Expose cancel/failure/retry and preview launch.
  Map executable settings to application/machine authority; a cloned config must not silently
  become trusted execution. Upstream's `ProjectActionsSettings.ts:107-161` offers an explicit
  Import scripts action and maps `runOnWorktreeCreate && async === false` to `waitForSetup`; its runner reads saved
  server settings. Match that activation workflow and document it in the conformance scenario.
- Acceptance: foreground setup failure prevents the first turn; background setup permits it;
  retries do not duplicate terminals; cancel terminates the owned setup; switching worktrees
  cannot run the command in the previous directory. A fresh checkout never runs a script before
  import, and a later file edit cannot silently replace the imported command. Coordinate with
  worktree/runtime plans.

### EXT-05: Match terminal history, restart and attachment semantics

- Priority P1; confidence HIGH; effort M/L; risk HIGH, PTY/session ownership.
- Upstream `packages/contracts/src/terminal.ts:51-61` supports attach with restart policy;
  `:79` defines restart and `:100-115` includes history and sequence.
  `apps/server/src/terminal/Manager.ts:1542`, `:1709`, `:1776` persist and reload history;
  `:3019` implements restart.
- Local `apps/server/src/terminal/service.ts:52` retains 256 KiB in memory, `:445-460`
  replays it when attaching, and `:637` bounds retention. The public protocol at
  `packages/contracts/src/terminal.ts:30` has input/resize/dispose without restart or replay cursor.
  Local menus have clear/kill, not the upstream restart operation.
- Independent second review found a liveness difference: local `service.ts:53,612-617` kills
  a detached PTY after ten minutes; upstream `Manager.ts:2778-2782` unsubscribes the attach
  listener without that kill. Match the supported detached-lifetime behavior with controlled
  clocks and explicit close/cleanup ownership. Reconnecting after the local TTL must not
  silently replace a long-running job with a new shell.
- Add durable bounded history and explicit restart/attachment outcomes while retaining Ghostty.
  The missing persistence is raw PTY output; durable provider transcript recovery already exists
  in `apps/server/src/terminal/tests/agent-history-recovery.test.ts` and must remain intact.
  Audit thread-owned versus worktree-owned terminal mappings before changing keys. Restarting
  one shell must not restart another session's shell or provider-native terminal.
- Acceptance: process restart restores retained output without claiming the PTY survived;
  reconnect neither duplicates nor drops admitted output; clear removes persisted replay;
  restart resets the correct process; resize and multiple viewers remain correct. Clear affects
  other viewers and reconnect, not just the current emulator. Preserve raw-byte fidelity for
  invalid/split UTF-8. Upstream attach sequences order snapshot/live events; do not invent an
  upstream `afterSequence` input absent from its attach contract.
  Focus existing `apps/server/src/terminal/tests/service.test.ts` and local socket tests.

### EXT-06: Add input/completion notifications and sound behavior

- Priority P2; confidence HIGH; effort M; risk MED, duplicate or misrouted notifications.
- Upstream `apps/web/src/components/ThreadNotificationCoordinator.tsx:125-193` suppresses initial
  snapshots and archived threads, distinguishes input/completion, respects focus, plays sound,
  emits an optional in-app action or native notification, and opens the owning environment/thread.
  `packages/contracts/src/settings.ts:218` and `:291` define modes, defaulting to off.
- Local bounded searches for `new Notification|notificationMode|playNotificationSound|inAppNotifications`
  across web, desktop and the settings registry found no matching chat coordinator. Provider
  protocol notifications and generic toast/error helpers do not implement this behavior.
- Add a coordinator over canonical session summaries, registry settings with upstream defaults,
  browser/desktop delivery and environment-scoped navigation. Retain reload/reconnect deduplication.
- Acceptance: no notification for history hydration, archived sessions or replayed completion;
  one per new input/completion; permission refusal is harmless; click targets the correct machine;
  live settings changes take effect without duplicate listeners. Match sound and badge behavior
  per supported platform, not just the browser API call. Failures follow upstream input notice
  classification. Focus gates native/toast presentation but does not suppress configured sound.

### EXT-07: Add the integrated browser preview and device workflows

- Priority P2; confidence HIGH for missing subsystem, MED for complete platform mapping;
  effort L; risk HIGH, browser process, permissions and remote execution.
- Upstream `packages/contracts/src/rpc.ts:339-366` exposes preview, automation and device
  operations. Implementations include `apps/server/src/preview/Manager.ts`,
  `apps/server/src/device/DeviceService.ts`, `apps/web/src/browser/ElectronBrowserHost.tsx`,
  `apps/web/src/components/device/DevicePanel.tsx` and MCP preview/device toolkits.
- Local file inventories and bounded `previewAutomation|device.configure|BrowserProfile|DeviceService`
  searches across apps/contracts show no equivalent subsystem. An editor file preview or
  external link is not an interactive browser/device session.
- Map upstream browser profiles, navigation, device toolbar, screen/element capture, recording,
  annotations, crash recovery and device actions to the existing desktop host. The interaction
  report owns composer attachment/context rendering; this item owns its capture source.
- Acceptance: host unavailable gets the upstream capability outcome; session close releases
  resources; remote environment cannot accidentally address a local device; annotations retain
  target identity; reload/crash restores the correct tab; automation responds to its requesting
  environment only. Hardware/OS-specific paths remain unverified until executed on those hosts.

### EXT-08: Align remote pairing, access management and relay capabilities

- Priority P2; confidence HIGH for different contract, MED for full end-to-end gap;
  effort L; risk HIGH, security boundary.
- Upstream `packages/contracts/src/auth.ts:81-110` defines operation/admin scopes and
  `:213-337` pairing/access/revocation; `apps/server/src/auth/http.ts:401-444` implements access
  management. `packages/contracts/src/relay.ts`, `remoteAccess.ts` and RPC cloud methods expose
  relay/endpoint behavior.
- Local `apps/server/src/auth.ts:5-44` defines a local principal and origin admission;
  `apps/server/src/machines/authentication.ts` handles SSH prompts/forwards. Existing direct/SSH
  machine connections and mesh deployment are real, but are not the upstream pairing/session UI.
- Port pairing credentials, session-scoped revocation, endpoint advertising and supported relay
  lifecycle before presenting equivalent remote access. Preserve the mesh deployment and existing
  SSH path during the user-visible workflow replacement; do not weaken auth to match names.
- Acceptance: revoking a device removes HTTP/WebSocket access, expiring pairing cannot mint new
  sessions, scopes are checked server-side, reconnect preserves confirmed environment identity,
  and no credentials enter logs/settings exports. No security exploit or public-service claim
  was tested; this is a feature/authority comparison.

### EXT-09: Cover desktop/mobile and distribution instead of silently exempting them

- Priority P3; confidence HIGH for product breadth, MED for exact host behavior;
  effort L; risk HIGH, release/update and platform integration.
- Upstream tree contains `apps/mobile`, `apps/desktop`, `native` and release packaging.
  `packages/contracts/src/ipc.ts:77` onward includes update status, architecture/channel and
  capture support; `desktopAppActivation.ts`, `desktopBootstrap.ts` and `device.ts` add host APIs.
- Desktop capture includes SnapShots (`apps/desktop/src/snapShot/`, `docs/user/snap-shot.md`,
  present at the pin): a global shortcut captures the focused window with app name, title and,
  where available, accessibility data into the current draft; off by default; macOS, Windows and
  Linux on Wayland. Recorded by the [2026-09-24 delta](delta-2026-09-24.md).
- Platform has an Electrobun desktop host, a native Mac editor experiment and a TUI; there is no
  `apps/mobile` package. `apps/desktop/src/shared/rpc.ts:8-24` exposes only `pickEntry` through
  this bridge. Do not infer that every desktop integration is missing solely from that bridge.
- First enumerate upstream public client behavior by OS: deep links, activation, notifications,
  file/open integration, capture, updates/restart, offline/reconnect, mobile agent controls.
  Then implement the missing behavior using existing hosts where possible; a mobile app needs
  its own delivery plan. Signed update and distribution infrastructure are separate work from
  mesh deployment and remain open parity items until real packaged builds pass.
- Acceptance: a platform matrix with executed artifacts and install/update/rollback/deep-link
  evidence. A browser simulation cannot close native-client rows. No deployment or publishing
  was performed by this planning task.

### EXT-10: Match background policy and runtime management capabilities

- Priority P2; confidence HIGH for contract differences, MED for measured consequences;
  effort L; risk MED/HIGH, liveness and resource observability.
- Upstream `packages/contracts/src/background.ts:34-105` models host power, client activity
  leases and scopes. `apps/server/src/background/BackgroundPolicy.ts:147-205` evaluates suspended,
  constrained and foreground activity. RPC server methods include resource histories, process
  signaling, background policy and usage/rate refresh.
- Platform has structured logs and process ownership, but searches for
  `BackgroundPolicy|reportHostPowerState|reportClientActivity|thermalState` found no corresponding
  local protocol or policy. Do not claim it polls faster or uses more resources without a trace.
- Implement leases and scheduling policy at server boundaries, host/client reporters, management
  UI, resource histories and the referenced settings. Coordinate with Plan 125 rather than
  adding a competing metrics/log pipeline. Runtime report owns provider quota/model usage details.
- Acceptance: lease expiry, sleep/wake, battery constraints, zero viewers and active turn behavior
  match the pinned policy; traces measure background work before/after; no claim rests on count
  of timers or memoization calls alone.

### EXT-11: Install a conformance gate that catches a deliberate wrong test

- Priority P0; confidence HIGH; effort M/L; risk MED, false confidence if only names are compared.
- The archive exception is required by an existing local test. Ordinary green CI can therefore
  preserve a behavioral divergence. Existing `.github/workflows/ci.yml:1-85` already runs quality,
  tests and browser checks; the old claim that Platform has no CI is false.
- The pinned source census in `inventory.py` enumerates 47 contract modules and 146 RPC methods.
  It proves only that the comparison baseline has not moved. It does not prove mapped operations
  behave alike. Current prior parity documents have different dates/scopes and completion claims.
- Add a canonical, versioned scenario corpus with upstream expected results, explicit local
  operation mappings, capability guards, canonicalization of IDs/times/paths, and tests that
  execute real local paths. Keep expected outcomes reviewable and independently traceable to
  the upstream implementation/test. Where feasible run the same cases against the pinned
  upstream behavior; otherwise mark the row source-derived and require a live comparison.
- Acceptance: deliberately restoring the archived-needs-input exception fails; switching busy
  send from queue to steer fails; automatic restoreFiles fails; new upstream commands and
  settings have an unclassified inventory row that blocks a parity claim. Green local tests,
  a passing census, or one screenshot must never turn an unknown row into matched.

### EXT-12: Port automatic worktree and storage cleanup policy

- Priority P2; confidence HIGH; effort L; risk HIGH, destructive filesystem changes.
- Added by independent second review. Upstream `packages/contracts/src/settings.ts:1038-1047`
  defines worktree age/merge/delete/unchanged and log/browser-artifact retention controls.
  `apps/server/src/storageCleanup.ts:173-225,283-330` checks managed paths, active/archived
  references, deletion drain, dirty state and runtime owners, then revalidates before removal.
- Local bounded search for `storageCleanup|worktreeAfterDays|worktreeOnMerge|worktreeUnchanged|
logsAfterDays|browserArtifactsAfterDays|worktreeOnDelete` across server/contracts/web found no
  policy. Manual safe worktree removal already exists in `worktree-decider.ts:184-224` and
  `worktree-lifecycle-reactor.ts:271-330`; automatic settlement and manual delete are different.
- Implement the opt-in rules through that existing owned removal lifecycle, registry settings
  and settings UI. Never add an independent direct filesystem sweeper. Preserve pinned defaults
  and resolve nullable/inherited rules before assigning an effective meaning.
- Acceptance: main checkout, dirty state, changed HEAD, active terminal/provider, another
  surviving reference (including archived), a newly created reference, or incomplete deletion
  cleanup prevents removal. A sole eligible idle archived candidate is not automatically exempt
  from the configured policy. Unexpected ignored files also block removal; preserve upstream's
  narrow reproducible dependency-directory exception. Changing settings
  to disabled during a sweep cancels deletion. Retention never escapes its owned roots. Use
  real Git/filesystem fixtures, controlled time and external-forge boundary injection.
- Dependencies: LIFE-12 resource ownership, EXT-02 linked PR state and EXT-07 for browser
  artifact storage. Ship worktree/log portions without pretending browser retention is done.

### EXT-13: Preserve failed pull-request lookup as failure

- Priority P1; confidence HIGH; effort S/M; risk MED, changes an existing false-success branch.
- Added by independent second review. Local `apps/server/src/git/pull-request.ts:48-55` turns
  every nonzero `gh pr view` exit after support admission into an empty ready result. Its
  `:68-85` then permits create. Upstream `apps/server/src/sourceControl/GitHubSourceControlProvider.ts:125-149`
  propagates lookup failure; `GitHubCli.ts:524-555` distinguishes successful empty results and
  malformed responses, and `:464-505` tracks host/account rate-budget state.
- A timeout, expired auth or rate limit can therefore offer/attempt create without establishing
  absence. Do not fold this fix into the long multi-forge rollout; repair the existing path first.
- Implement an explicit successful not-found outcome, retain read errors and retry state, and
  allow creation only after proven absence. Use the feature's structured-error wrapper.
- Acceptance: existing, absent, auth-expired, rate-limited, timeout, malformed JSON and network
  failure are distinct; only absent permits create. Failed lookup performs no remote write.
  Extend `apps/server/src/git/tests/push-and-pull-request.test.ts` with injected CLI boundary.

### EXT-14: Keep the default-branch checkout current by fast-forward pull

- Priority P2; confidence HIGH; effort S/M; risk MED, an unattended write to a checkout.
- Missed at pin; see [delta record](delta-2026-09-24.md). Pinned `docs/user/project-settings.md:93`
  ("Keep the default branch current"): an environment default plus per-project override
  (`packages/contracts/src/orchestration.ts:532,850,1081` `autoPull`, `decider.ts:318`) makes the
  server pull the default-branch checkout only when it can fast-forward and the checkout has no
  changed, untracked or local-commit work. It skips other branches and checkouts without an
  upstream. Executor: `apps/server/src/vcs/VcsStatusBroadcaster.ts:152,222,420`.
- Local: a bounded search for `autoPull|fast-forward|ff-only` across `apps/server/src` and
  `packages/contracts/src` found nothing. New worktrees therefore branch from whatever the
  checkout last fetched.
- Implement as a registry setting (machine default, project override) consumed by the git
  status owner; run `git pull --ff-only` only after a fresh clean-status read, and publish the
  skip reason. Scope is `machine` or `application`: it writes to the filesystem and the network.
- Acceptance: clean default branch fast-forwards; dirty, untracked, ahead, diverged, detached,
  other-branch and no-upstream checkouts are skipped with a visible reason and no write; a pull
  failure never leaves a partial merge. Real temporary repositories with a local bare remote.

### EXT-15: Choose how new worktrees initialize submodules

- Priority P3; confidence HIGH; effort S; risk LOW.
- Post-pin (`0141bc2b`, `1262d2f3`); cited at `9383f4ad`. Upstream
  `packages/contracts/src/environment.ts:63` defines the mode (recursive by default, top level,
  or none), `packages/contracts/src/t3ProjectFile.ts:93` lets `t3.json` limit or disable it, and
  `apps/server/src/vcs/GitVcsDriverCore.ts` applies it when creating a worktree.
- Local `apps/server/src/git/worktrees.ts:202` runs `git worktree add` with no submodule step,
  so a repository with submodules gets an unpopulated worktree. `submodule` appears locally only
  in diff classification (`apps/server/src/git/history-format.ts:128`).
- Implement the setting with a project override, applied after `worktree add`; a failed
  submodule init reports failure without deleting the created worktree.
- Acceptance: recursive, top-level and none each produce the expected tree on a fixture with a
  nested submodule; the project override wins; failure is reported and retryable.

### EXT-16: Balance new sessions across connected machines

- Priority P3; confidence HIGH for the upstream feature; effort M; risk MED.
- Missed at pin; see [delta record](delta-2026-09-24.md). Pinned `docs/user/remote-access.md:65`
  ("Balance new threads across machines"): off by default; per-machine Prefer, Normal, Less
  often and Manual only; the composer picks an eligible machine by CPU and memory, then keeps
  that choice stable for the draft. Code: `apps/web/src/components/settings/LoadBalancingSettings.tsx`,
  `components/chat/useAutoBalanceUpdateBanner.tsx`, `composerDraftStore.ts`.
- Local connected machines exist (`environments.machines` setting, federated environments), but
  a bounded search for `balanc` found no machine selection policy.
- Depends on EXT-08 and LIFE-08/09 for multi-environment project groups. Preferences are
  per client upstream; decide the local settings scope before registering them.
- Acceptance: with two machines, auto balance picks the one with capacity and keeps it for the
  draft; Manual only is never chosen; choosing a branch or worktree pins the machine; resource
  checks failing asks the user to choose.

### EXT-17: Show a usage page with estimated cost and editable model prices

- Priority P2; confidence HIGH; effort M; risk LOW.
- Missed at pin; reopens the `adjacent-usage-analytics` rejection. See [delta record](delta-2026-09-24.md).
  Pinned `apps/web/src/routes/usage.tsx` and `docs/user/usage.md` show token use, cache
  savings, per-model breakdown and estimated API-equivalent cost per environment, built by
  scanning session history; users add or edit model prices, which answers the old "pricing
  tables go stale" objection. Post-pin `b954af60` adds model-ordering coverage.
- Local: `apps/web/src/features/chat/components/context-usage-ring.tsx` shows context occupancy
  only; RUNTIME-08 and INTERACTION-07 cover quota windows, not historical usage.
- **Implementation is owned by Plan 141 (usage and rate limits).** This row keeps the upstream
  acceptance cases so parity is still judged here; do not build a second usage pipeline.
- Acceptance: tokens, cache savings and cost per model and per environment match a fixture
  history; a new model without a price shows no cost rather than a wrong one; an edited price
  recomputes; refresh rescans recent sessions.

### EXT-18: Follow worktree branch drift so the session's branch stays true

- Priority P3; confidence MED for local impact; effort S/M; risk MED.
- Missed at pin; reopens the `git-branch-drift-follow` rejection, whose own condition ("revisit
  if PR affordances land") is met. Pinned `apps/server/src/orchestration/Layers/CheckpointReactor.ts:530,570–632`
  (`followWorktreeBranchDrift`): when a `git checkout` inside a thread's dedicated worktree
  changes the branch, the server adopts the checked-out branch as the thread's branch, only when
  the worktree belongs to that thread alone.
- Local: the session branch is recorded at worktree preparation
  (`apps/server/src/orchestration/worktree-command-preparation.ts`) and not refreshed from HEAD.
  The stage-header PR actions read the live checkout (`stage-header.tsx:41–48`), so the orphaned-PR
  symptom upstream describes does not occur there; the stale recorded branch still feeds the rail,
  gating and LIFE-14's badge. Runtime impact is unverified.
- Implement as a worktree-status observation that updates a dedicated worktree's session branch;
  shared checkouts keep strict matching.
- Acceptance: an agent's `git checkout -b` in a dedicated worktree updates the session branch and
  its PR state; the same checkout in a shared worktree changes nothing; a concurrent explicit
  branch change wins over a stale drift update.

## Second pass: corrections and remaining scope

- Rejected “add Jujutsu support.” Upstream contracts mention `jj`, but
  `apps/server/src/vcs/VcsDriverRegistry.ts:65-77` registers Git only. A schema value is not a
  working capability. Record its unsupported behavior in the contract map; do not build an
  invented upstream feature.
- Rejected “GitHub PR/push UI absent.” It is implemented in `branch-actions.tsx`, with tests.
  Missing review/provider/composed workflow behavior is narrower and stated above.
- Rejected “terminal replay/multiple sessions absent.” Local reconnect replay and session keys
  exist. The confirmed gap is persisted history and explicit restart/attach contract semantics.
- Rejected “project scripts absent.” Manual suggestions and the command exist. Setup triggers,
  foreground/background admission and shared configuration are the missing parts.
- Rejected “no CI.” Current quality and real-browser jobs exist. They lack a pinned parity oracle.
- Read-only runtime check in the preceding investigation: dev `localhost:5173` refused connection;
  mesh homepage loaded with no browser errors. Evidence:
  `/work/tmp/fregat-evidence/20260920T105844Z-look-platform-1440x1000/`.
  That is environment health evidence, not evidence for any behavior in this report.
- Unknown until further execution: native/mobile OS behavior, live forge-account capability
  differences, hosted relay/service policy, hardware capture/device control, exact terminal byte
  equivalence and power/resource outcomes. These remain backlog gates, not accepted exceptions.

## Verification commands for implementation

Run from the repository root. Choose the named file relevant to a changed behavior, not all suites.

```bash
python plans/126-t3code-alignment/inventory.py
bun run --cwd apps/server typecheck
bun run --cwd apps/web typecheck
cd apps/server
bun --bun vitest run src/git/tests/push-and-pull-request.test.ts
bun --bun vitest run src/terminal/tests/service.test.ts
```

New scenarios must be registered in `scripts/agent/scenarios/`, selectors centralized in
`scripts/agent/selectors.ts`, and the feature map updated. Then run the specific scenario with
`bun run agent:browser scenario <registered-name>` against the existing dev server, inspect its
screenshots and wide logs, and record the evidence path. The commands above were inspected,
not executed as tests during this read-only audit.
