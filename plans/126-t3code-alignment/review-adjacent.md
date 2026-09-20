# Independent second-pass review of adjacent.md

Reviewer: lifecycle/sidebar audit agent, **not the author of adjacent.md**. Reviewed on 2026-09-20 against Platform `3c9b88c35784e571e706600b0cee8e95a2656f77` and pinned T3 Code `7445aa733ada33e45289e5aa5055f79142556513`. Read fresh upstream objects with `git show`, not the stale reference working tree. Application source remained read-only; no tests or runtime experiments were run in this review.

## Corrections required

### REVIEW-EXT-01 — Correct EXT-04's setup field and make import authority concrete

- **Verdict:** The missing feature is confirmed, but one claimed upstream field is wrong. HIGH confidence, P1 planning correction.
- **Evidence:** Upstream `packages/contracts/src/t3ProjectFile.ts:39–49` defines `runOnWorktreeCreate` and **`async`**, not `runInBackground`; `async` defaults behaviorally to true, with false holding the agent. `apps/web/src/components/settings/ProjectActionsSettings.tsx:107–119` imports the file script into saved actions and converts it to `waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false`. Lines `143–163` expose an explicit **Import scripts** action. `apps/server/src/project/ProjectSetupScriptRunner.ts:330–340` executes a script resolved from saved server settings and project state, not directly from a cloned JSON command on every worktree creation.
- **Required correction:** Replace `runInBackground` with the encoded `async` / stored `waitForSetup` mapping. Cite the actual import flow. Preserve application/machine authority in Platform, but do not invent an extra approval dialog and describe it as an upstream requirement: explicit script import is already the concrete activation path. Metadata defaults such as `defaultThreadEnvMode` are separately read from the file (`t3ProjectFile.ts:83–87`); do not confuse metadata read with script activation.
- **Acceptance addition:** A fresh checkout's script is visible for import but never auto-executed before import; importing an `async:false` setup causes the next new worktree to gate agent start, while omitted/true does not. Importing into a multi-environment logical project reports each owner's saved outcome. Later editing untrusted file content must not replace an already imported executable script silently.
- **Effort/risk:** S report correction; M/L implementation already included by EXT-04, HIGH execution-boundary risk.

### REVIEW-EXT-02 — Narrow “no terminal durable history” to raw PTY scrollback

- **Verdict:** EXT-05's PTY history gap is confirmed. Its wording must distinguish provider transcript recovery, which already exists. HIGH confidence.
- **Evidence supporting gap:** Local `apps/server/src/terminal/service.ts:445–460,628–660` replays bounded in-memory chunks. Upstream `apps/server/src/terminal/Manager.ts:1542–1547,1698–1715,1776–1793` names, persists, and reloads terminal output files. Local `packages/contracts/src/terminal.ts:31–41` has no restart or sequenced snapshot/attach outcome; upstream `packages/contracts/src/terminal.ts:51–61,79–115` does.
- **Counter-evidence against overbroad absence:** Local `apps/server/src/terminal/tests/agent-history-recovery.test.ts:7–40,50–79,87–110` exercises durable provider transcript recovery after reopening the database, retrying failed recovery, and preserving event identities. This is conversation history, not a replayable PTY screen; it must not be deleted or replaced by the new terminal history layer.
- **Required correction:** Say “raw PTY output history is not persisted,” and explicitly retain existing provider transcript/ownership recovery. Frame sequence support as snapshot/live-event ordering, not as an upstream reconnect-cursor argument: upstream `TerminalAttachInput:51–61` has no `afterSequence`/cursor parameter.
- **Acceptance refinement:** Validate snapshot-to-live overlap without duplicate admitted output, history clear persistence, startup recovery without claiming PTY survival, and preserved provider transcript recovery. Port upstream observable byte/text treatment carefully: local raw-byte tests deliberately preserve invalid/split UTF-8 (`service.test.ts:214–275`); do not silently regress Ghostty's byte fidelity for a JSON transport copy.

## Material additions

### REVIEW-EXT-03 — Add detached-terminal lifetime to EXT-05

- **Verdict:** Confirmed omission, HIGH confidence, P1. This affects running user jobs, not just restored scrollback.
- **Evidence:** Local `apps/server/src/terminal/service.ts:53` hardcodes a ten-minute detached TTL. Detaching the last viewer starts it (`467–470`), then expiration calls `dispose({ kill: true })` (`612–617`). `apps/server/src/terminal/tests/service.test.ts:404` explicitly requires this behavior. Upstream `apps/server/src/terminal/Manager.ts:2739–2782` attaches a listener and its returned cleanup only unsubscribes; retained-session eviction at `1958–1983` excludes `status === running`.
- **Impact:** Close the client or disconnect for more than ten minutes and Platform kills a terminal job that the upstream manager retains. Adding disk history alone does not align this path.
- **Implementation correction:** Remove viewer absence as implicit running-PTY kill policy when adopting upstream terminal lifetime. Keep explicit close/restart/server-shutdown and actual resource ownership release. If upstream background policy later imposes a separate documented lifecycle, map that actual policy, not the old local TTL.
- **Acceptance:** Start a long-running shell job, detach all viewers, advance an injected clock beyond ten minutes, and reattach to the same live process; explicitly closing still terminates it and releases its lease. A second viewer detaching cannot affect the first. This should be a focused real-service test with injected PTY/process boundary, plus live disconnect/reconnect proof; no ten-minute wall-clock sleep is necessary.
- **Effort/risk:** M / HIGH because process cleanup policy and worktree lease eligibility interact. Update the contrary TTL test rather than adding a second policy around it.

### REVIEW-EXT-04 — Add automatic worktree/storage cleanup policy as an explicit item

- **Verdict:** Confirmed omission beyond the manual delete-worktree offer in LIFE-12. HIGH confidence, P2.
- **Evidence:** Upstream `packages/contracts/src/settings.ts:1038–1047` defines opt-in worktree age/merge/delete/unchanged, browser-artifact retention and log retention defaults. `apps/server/src/storageCleanup.ts:49–53,173–225` implements worktree candidates, active+archived references, deletion drain, owned-root/realpath/main-checkout/dirty guards; `283–330` rechecks concurrent references, provider/terminal ownership, dirty state and HEAD before removal. Local bounded search for `storageCleanup|worktreeAfterDays|worktreeOnMerge|worktreeUnchanged|logsAfterDays|browserArtifactsAfterDays|worktreeOnDelete` across `apps/server/src`, `packages/contracts/src`, `apps/web/src` returned no counterpart. Local manual lifecycle exists at `orchestration/worktree-decider.ts:184–224` and `worktree-lifecycle-reactor.ts:271–330`.
- **Impact:** Automatic upstream storage policy does not follow from implementing auto-settle or the delete dialog. A task can satisfy both and still lack age/merge/unchanged cleanup and retention controls.
- **Implementation correction:** Give cleanup policy its own inventory row or expand EXT-10 with explicit scope. Reuse local worktree lease/lifecycle execution for safe removal rather than launching a second direct Git/filesystem remover. Preserve upstream opt-in defaults. Cross-reference LIFE-06 auto-settle and LIFE-12 manual deletion without conflating them.
- **Acceptance:** Each enabled rule cleans only eligible managed worktrees; main checkout, dirty files, changed HEAD, provider owner, active terminal, archived reference, newly created reference during Git I/O, or failed deletion resource release blocks removal. Settings changed to disabled during a sweep cancel removal. Owned log/artifact retention never crosses configured roots. Test real repositories/filesystem with injected external forge I/O and deterministic time.
- **Effort/risk:** L / HIGH, destructive filesystem behavior; requires positive ownership and revalidation tests.

### REVIEW-EXT-05 — Add GitHub lookup failure semantics to EXT-01/02

- **Verdict:** Confirmed existing behavior gap, HIGH confidence, P1 or P2 depending on workflow priority.
- **Evidence:** Local `apps/server/src/git/pull-request.ts:48–55` returns `{ pullRequest: null, support: ready }` for **every** nonzero `gh pr view` exit after support passes. `createPullRequest:68–85` consequently attempts creation when lookup actually failed. Upstream `apps/server/src/sourceControl/GitHubSourceControlProvider.ts:125–149` preserves lookup errors as `SourceControlProviderError`; `GitHubCli.ts:524–555` distinguishes successful empty list from malformed result, and `464–505` guards queries with host/credential-scoped rate-budget state.
- **Impact:** A network/auth/rate-limit failure can appear as “no PR” and offer/attempt creation. Supporting additional forges does not fix GitHub's existing false absence.
- **Implementation correction:** Make not-found an explicit successful result; preserve lookup failure and retry state, and never fall through to create on an indeterminate read. Map upstream forge-rate/capability outcomes as part of the provider contract rather than treating any CLI failure as unavailable CLI or signed-out.
- **Acceptance:** Existing PR, successful empty lookup, expired auth after cached support, rate limit, CLI timeout, malformed JSON and transport failure produce distinct outcomes; only successful absence permits creation. Failed read never mutates the remote. Extend `apps/server/src/git/tests/push-and-pull-request.test.ts` using external CLI boundary injection.
- **Effort/risk:** S/M / MED; changes branches previously reported as empty success.

## Claims independently confirmed or deliberately not expanded

- **Five forges confirmed:** Pinned `apps/server/src/sourceControl/SourceControlProviderRegistry.ts:306–335` constructs GitHub, GitLab, Azure DevOps, Bitbucket and Forgejo providers. This is not merely a contract union. EXT-01 correctly requires a per-forge capability matrix rather than promising every operation everywhere.
- **Jujutsu rejection confirmed:** `apps/server/src/vcs/VcsDriverRegistry.ts:63–79` registers Git only and produces `VcsUnsupportedOperationError` for unregistered kinds. Do not add jj implementation under alignment; cover its explicit unsupported response.
- **Notification gap/defaults confirmed:** Pinned `ThreadNotificationCoordinator.tsx:109–195` initializes previous state without notifying, skips archive, distinguishes failure/input/completion, plays sound before focused-app toast/native gating, and scopes click navigation. `settings.ts:291–294` defaults notification mode off and in-app notifications false. Add failure-as-input and sound-while-focused to acceptance; “respects focus” must not become “silence every channel whenever focused.”
- **Remote scope framed correctly:** Local `apps/server/src/auth.ts:43–86` is origin admission; it has no authenticated per-device principal/revocation. EXT-08 appropriately describes a feature/authority gap, not a demonstrated remote exploit. Keep mesh transport and user auth as distinct layers.
- **Clear versus Ctrl+L matters:** Local `apps/web/src/features/terminal/utils/commands.ts:41–51` sends form feed or resets only the emulator. Upstream `Manager.ts:2920–2938` clears persisted server history and publishes a sequenced clear event. EXT-05 already asks for durable clear; extend its test to a second attached viewer and reconnect so old output cannot return after clear.
- **Minor citation correction:** EXT-02's `rpc.ts:386` starts cloud methods; PR methods start at `390–391`. EXT-03 clone RPCs start at `421–427`; `425` is cancel. These are nearby but should be made exact.

## Completion and limits

This fresh cross-review is complete for the assigned high-risk claims. It adds three material gaps (detached PTY lifetime, automatic cleanup, indeterminate GitHub lookup), corrects the setup schema/import claim, and narrows terminal persistence language. It does not establish runtime equivalence, every forge operation, native-device behavior, or full upstream coverage. No secrets were reproduced and no application code or other report was modified.
