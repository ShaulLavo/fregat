# Plan 190: Faster CI

## Status and authorization

- Status: APPROVED 2026-09-26 (owner: "make CI faster, it is painfully slow"). First queue item
  of wave 2's first lane, because every PR in the wave waits on it.
- Effort: M overall, as S slices that each land and are measured on their own.

## Where the time goes (measured 2026-09-26, `ci.yml`, successful runs)

- **Wall time 4.5–5.8 minutes per run**, of which up to 71 s is waiting for runners. The repository is
  public: 20 concurrent standard runners, and one run takes 10 jobs, so two runs fill them. Wave 2
  runs eight lanes and merges continuously, so queueing will grow.
- **`Setup` costs 64–85 s in every one of the 10 jobs**, about 12 runner-minutes per run. It installs
  Bun and Node, restores the Bun cache, installs search tools, clones and **builds** the Editor
  packages and ghostty-webgpu, and runs `bun install`. The composite action hides which of these
  dominates.
- **Longest steps after Setup:** server tests 175–182 s (one shard), web tests 138–193 s per shard
  (four shards), lint 100–107 s, feature boundaries 54–58 s, TUI tests 90–97 s, typecheck 27–36 s.
- Superseded runs are cancelled (`concurrency` with `cancel-in-progress`), on main too. Main takes a push
  every few minutes, so most main runs end `cancelled`. On 2026-09-26 the newest completed CI run
  on main was over 30 minutes and many commits old, so a broken main goes unnoticed.

## Phase 0: inside `Setup` (measured 2026-09-26, five green runs, 50 jobs)

Runs 36247125169, 36246218759, 36244928208, 36244474365, 36243710777 (four on main, one PR). The
composite action's sub-steps are visible as `##[group]Run …` markers in each job log, so this needed
no workflow change: each sub-step runs from its marker to the next, the last to the step's end.
Wall time 272–307 s; the longest wait for a runner was 3–10 s in these runs.

| Sub-step                                                                   | Median s | Range s   |
| -------------------------------------------------------------------------- | -------- | --------- |
| Build the Editor (`bun install` 0.6 s + `turbo build`, 20 tasks, 0 cached) | 31.2     | 18.1–33.9 |
| Restore the Bun cache (1,353 MB: ~14 s download, ~12 s extract)            | 22.8     | 18.1–36.6 |
| `apt-get update` + install `fd-find`, `ripgrep`                            | 10.9     | 9.4–21.5  |
| Clone the Editor                                                           | 1.9      | 1.1–3.1   |
| Setup Bun                                                                  | 1.5      | 0.7–2.4   |
| Clone ghostty-webgpu                                                       | 0.9      | 0.3–1.7   |
| `bun install` (repo, 1,008 packages; Bun reports 0.7 s)                    | < 1      | < 1–2.6   |
| Setup Node                                                                 | 0.7      | 0.4–4.1   |
| Build and link ghostty-webgpu                                              | 0.5      | 0.3–0.6   |
| git identity, link the Editor                                              | 0.1      | 0.0–0.1   |

`Setup` as a whole: median 74 s, 64–89 s, 744 runner-seconds per run. Three sub-steps are 87% of it:
the Editor build (phase 1 caches `dist/` by `editor-ref`), the Bun cache (1.35 GB restored for an
install that then takes under a second; a lockfile change saves the restored fallback plus the new
packages, so the cache only grows), and `apt-get update` (a pinned `fd`/`rg` release download
replaces it).

Per job (median wall s): lint 264, server 252, web shard 238, TUI 190, browser 163, typecheck 145,
packages 114. Steps over 5 s after `Setup`: server tests 172, web tests 150 per shard, TUI tests
101, lint 100, browser (web) 68, feature boundaries 54, typecheck 36, packages tests 27, the t3code
reference checkout 8 in each of seven jobs, first-load gate 8, benchmark gate 9, Chromium install 7.

## Where the Editor's time goes (measured 2026-09-26, singapore `ci.yml`, five green runs)

- **One serial `verify` job, 6.2–6.8 minutes.** Test 269–296 s, Playwright install 37–56 s
  (Chromium, headless shell, Firefox, WebKit, with OS deps), typecheck 34–36 s, tree-sitter browser
  worker 12–14 s. Typecheck builds all 20 packages first (34 s); Test reuses those builds.
- **Test is `turbo test --concurrency=1`,** one package at a time: core 112 s, textbuffer 61 s, find
  15 s, typescript-lsp 12 s, lsp-plugin 12 s, the other 15 packages 1–6 s each. `--concurrency=1`
  exists to cap browser processes, and it serialises the Node-only packages too.
- **The turbo cache starts empty every run** ("Remote caching disabled", every task a cache miss),
  so a change to one leaf package still re-tests all of them.
- **Same `cancel-in-progress` on main.** On 2026-09-26 the last green Editor CI on main was 10:11;
  every later run failed or was cancelled, so that afternoon's stale health baseline surfaced only
  through the separate Architecture Health workflow.

## Outcome

A PR that changes code gets a full verdict in about two minutes of wall time; a PR that changes only
plans or docs gets its checks in well under a minute. Each job spends seconds on setup, not a minute.
The Editor's CI gives a code PR its verdict in about three minutes and re-tests only the packages a
change can reach. The targets are confirmed or revised by phase 0's measurements.

## Phases

0. **Measure setup** (S). Time every step inside the composite action (a timestamp per step, or split
   it into visible steps) across five runs. Record the table here before changing anything.
   Done 2026-09-26: the table above, read from the job logs' group markers.
1. **Build the Editor and ghostty once per pinned ref** (S–M). Since `editor-ref` is pinned (2026-09-26),
   cache the built `dist/` of the Editor packages and ghostty-webgpu keyed by ref, toolchain and
   lockfile, or build them in one upfront job and hand them to the others as an artifact. Same for
   the search tools. Cache `node_modules` keyed by the lockfile if `bun install` still costs seconds
   after the cache restore.
   Done 2026-09-26 (wave 2 lane B): the Editor's `packages/*/dist` is cached by `editor-ref` and Bun
   version (12 MB; examples are no longer built); ghostty's build already took 0.5 s and stays;
   `fd` and `rg` are pinned release binaries checked by SHA-256; the t3code reference is cached by
   its pin and checked out only on a miss. The Bun cache is gone: restoring its 1.35 GB took 23 s,
   while a cold `bun install` from the registry takes 4–5 s on a runner (measured with the cache
   removed). Warm run 36249174610: `Setup` median 19 s (12–24 s), 180 runner-seconds per run,
   down from 74 s and 744. That run also waited up to 1,906 s for a runner while other lanes' runs
   held all 20, so queueing, not setup, is now the largest cost: phases 2 and 6.
2. **Skip what a change cannot affect** (S). A path filter job decides what runs: plan- and doc-only
   PRs run format and the doc checks only; a change confined to one app skips the other app's test
   shards. Branch protection keeps one required status that summarises the rest, so skipped jobs
   never block a merge.
   Done 2026-09-26 (wave 2 lane B): a `changes` job (dorny/paths-filter, pinned by SHA) classifies
   a PR. Plans, docs and root Markdown are not code (the two generated docs files are); a
   docs-only PR runs `Docs format` (oxfmt on the changed files) and nothing else. Web tests and
   the browser job skip when only `apps/tui`, `apps/desktop`, `apps/mac` or `apps/site` changed;
   server tests skip for `apps/web` or `apps/tui` alone; TUI tests skip for `apps/web` alone (web
   and TUI tests drive the real server, so a server change runs both). Lint, typecheck and package
   tests run for any code change. Pushes to main run everything. One job, `CI`, is red when any job
   failed or was cancelled and green when the rest passed or were skipped: it is the status to
   read. The repository has no branch protection, so nothing else changes.
3. **Balance the test shards** (S–M). Split server tests across shards (175–182 s in one job today),
   re-balance web and TUI shards by recorded durations instead of file count, and look for the
   slowest files in each (cold process spawns, real timers) before adding shards: shards cost
   runners, and runners are the queue.
   Done 2026-09-26 (wave 2 lane B). Web shards by recorded file duration: `apps/web/test/shard-sequencer.ts` deals files out longest first, each to the lightest shard (file time plus 0.5 s of import and setup), from `apps/web/test/shard-durations.json`; `bun run --cwd apps/web test:durations` refreshes it. Stale or missing entries cost only balance: every shard computes the same assignment, and a test proves each file lands in exactly one shard. Vitest's path-hash split had put 93 s of recorded test time on one shard and 36 s on another; locally the four shards now take 49, 50, 56 and 50 s. Server tests split in two by Vitest's own hash (207 s and 182 s of file time, close enough to skip a durations file). TUI stays one job. Slowest files, left as leads: web `settings/tests/page.test.tsx` 27 s and `keybinding-section.test.tsx` 10 s; server `fs/tests/workspace-edit.test.ts` 40 s, `lsp/tests/typescript-server.test.ts` 37 s, `machines/tests/update.test.ts` 32 s, `terminal/tests/service.test.ts` 26 s.

4. **Lint and boundaries** (S). Profile the 100 s lint and the 55 s feature-boundaries check: find out
   whether the time is the tool, a type-aware rule, or a whole-repo walk that could run once and feed
   both. Run them in parallel inside one job if they are independent.
5. **Main always ends with a verdict** (S, independent; land it first). Keep `cancel-in-progress` for PR
   branches, and turn it off for main: `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`.
   A running main run then finishes. GitHub keeps only the newest pending run per concurrency group,
   so pushes during a run collapse into one follow-up run of the latest commit, never a queue of
   ten. A pending run holds no runner, so main uses at most one run's jobs (10 of the 20 runners
   today) at a time, the same as before; what changes is that it keeps them for a whole run instead
   of releasing them at the next push. Measure how often PR runs wait behind main until phase 6
   cuts jobs per run. A red main run names a commit range (previous verdict to this one), and
   `flake-watch.yml` still covers the nightly full suite.
   Landed 2026-09-26 (wave 2 lane B): `ci.yml` sets
   `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`.
6. **Fewer jobs per run** (S, after 1–4). With setup down to seconds, merge small jobs (packages,
   parity, typecheck) so one run takes fewer of the 20 runners, and wave 2's eight lanes queue less.
   Done 2026-09-26 (wave 2 lane B): package tests (57 s job, 20 s of it setup) run as the last
   step of the typecheck job, which already prepares the Electrobun devkit they need. A full code
   run now holds 10 runners for real work (lint, typecheck + packages, four web shards, two server
   shards, TUI, browser) plus the seconds-long `Changes` and `CI` jobs; phase 3's second server
   shard took back the slot this saved. Merging further lengthens the run: TUI (136 s) and browser
   (109 s) together would outlast a web shard. Runs that touch one app or only docs use fewer
   (phase 2).

### Editor (singapore `ci.yml`)

Each slice lands in the Editor repository and is measured the same way. E1 is independent; land it
with phase 5.

- **E1. Main always ends with a verdict** (S). The phase 5 change in the Editor's `ci.yml`.
- **E2. Keep the turbo cache between runs** (S). Restore `.turbo/cache` with `actions/cache` keyed by
  the commit, falling back to the newest cache for the branch, then main. Turbo already hashes each
  task's inputs and its dependencies' builds, so an unchanged package's `build` and `test` replay from
  the cache. Before trusting hits, declare every env var and generated input a test reads
  (`globalEnv`, `inputs`) and prove a hit is stale-safe: change a textbuffer file and see core
  re-test.
- **E3. Split the job** (S). Three parallel jobs after one shared install: typecheck + lint + the
  language-catalog check; core's tests; everything else, with Node-only packages at turbo's default
  concurrency and only the browser projects serial. Core's 112 s then sets the wall time; shard core
  by file if it still dominates.
- **E4. Browsers on demand** (S). Cache `~/.cache/ms-playwright` keyed by the Playwright version, and
  install only the browsers the jobs that run need. Find which tests use Firefox and WebKit; if
  none do on CI, drop them from the install.
- **E5. Skip what a change cannot affect** (S). Phase 2's path filter for the Editor: plan- and
  doc-only changes run format and the doc checks only, behind one required summary status.
- Platform's side of the Editor (building it at `editor-ref` in every job) is phase 1.

A green PR is green against the `main` it was tested with. A `pull_request` run checks out GitHub's merge ref, the PR merged with `main` as it stood when the run started; #59 and #60 were each green that way and red together (2026-09-26). The fix is to test against the `main` a PR merges into: re-run (or rebase) a PR after anything else merges and merge only on that run, or let GitHub enforce it with branch protection on `main` requiring the one `CI` status (phase 2) and "Require branches to be up to date before merging". GitHub's merge queue would batch this but is not offered for a repository owned by a user account. Branch protection is a repository setting: owner decision. Main's own runs now always finish (phase 5), so a combination that slips through shows as a red `main` run naming its commit range.

Larger runners cost money, which is an owner decision; this plan does not buy them.

## Verification

Before and after for each phase: wall time and queue time of five runs, per-job and per-step times
from `gh run view --json jobs`. Coverage does not shrink: every test and check that ran before still
runs for the changes it can affect, and the nightly `flake-watch.yml` keeps running the full suites.
For the Editor, the same before and after from singapore's `ci.yml`, plus one run with a cold turbo
cache to show a miss still runs everything.

## October 2026 issue follow-ups

Status: Approved, retained by [Plan 336 closeout](issue-closeout-2026-10.md).
These are remaining execution items. Closing their tracker records does not certify a fix
or change acceptance of an earlier delivered milestone. Each original thread retains its
full reproduction, comments and historical artifacts. Source links below pin the reviewed
main revision; recheck them before implementation.

### Issue 582

Source: [#582: OpenSSH forwarding CI asks for the key secret again when reusing authentication](https://github.com/ShaulLavo/fregat/issues/582), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/582#issuecomment-5976379917).
Current owner: [apps/server/test/openssh-scenario.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/apps/server/test/openssh-scenario.ts).

Forward close/rebind prompted for a secret again once at historical merge fe637719c868aa0c8d81368031d34c3b1d5e8c4d. Twenty isolated Ubuntu controls and two authentic historical server shards passed. A verbose EOF observer caused its own 60-second ControlPersist expiry and was rejected as a reproduction. PR #619 added bounded redacted failing-only diagnostics without changing production. A fresh failure must retain master/control command, exit, EOF and elapsed facts with secrets removed. Do not start more blind retry loops or infer an authentication regression from a passing control.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 621

Source: [#621: Unconfirmed: isolated terminal host startup reached the connect bound in a Bun control](https://github.com/ShaulLavo/fregat/issues/621), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/621).
Current owner: [apps/server/src/terminal/host-client.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/apps/server/src/terminal/host-client.ts).

One real isolated Bun server control reached HOST_UNREACHABLE at the terminal connect bound. The original packet lacks host stderr, systemd/socket state and structured internal facts. A separate initial Node control used a Bun Node shim and was invalid, then corrected. Keep that tooling error distinct from the Bun startup failure. Capture server import, host launch, socket creation and connect phases using a genuine runtime and fixture provider before any timeout change.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 693

Source: [#693: Unconfirmed CI: cold Vite Settings startup never reaches app readiness](https://github.com/ShaulLavo/fregat/issues/693), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/693#issuecomment-5982644512).
Current owner: [scripts/agent/vite-cold-start.test.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/agent/vite-cold-start.test.ts).

The cold Vite Settings scenario reported app never became ready with empty error/reload arrays and no original screenshot artifact. An unchanged local control and failed-job rerun passed. There is no cause fix or source/deadline change. Add bounded failing-only boot phase, network, server and screenshot receipts to the actual Settings startup case, plus a known-good control. Locate the pending phase before tuning the readiness contract.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 766

Source: [#766: agent: unconfirmed fixture cleanup reports an intentionally killed terminal as failed](https://github.com/ShaulLavo/fregat/issues/766), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/766#issuecomment-6036061147).
Current owner: [scripts/agent/fixture-workspace.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/agent/fixture-workspace.ts).

Healthy Markdown and search Replace/Undo/Redo scenarios reported a failed terminal during fixture cleanup, exit 137/SIGKILL. createGitFixture exposes a path, releaseFixture accepts a path, and openFixtureWorkspace does not return an owned terminal/API disposer. Give the fixture owner a supported close operation and migrate callers before the final reaper. Verify teardown on success, error, timeout and cancellation. Avoid global terminal-ID maps or hiding the warning before distinguishing intended cleanup from an unexpected terminal death.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 820

Source: [#820: Loaded identical-build Undo comparisons produce false positives](https://github.com/ShaulLavo/fregat/issues/820), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/820).
Current owner: [editor/examples/stress/input-paired.mjs](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/editor/examples/stress/input-paired.mjs).

A loaded identical-build A/A Undo comparison used the same frozen candidate in both arms, 40 cases, 13 keys across 10 runs and 330 verdicts. Two selected and two auxiliary verdicts rejected unchanged budgets. Eight controlled busy/sleep workers had verified actual affinity and complete cleanup. This establishes false positives in that instrument, not a product regression. Qualify input-paired, stopping and budgets with frozen A/A plus deliberate regressions before changing acceptance. Keep failed windows, load profile and counters; do not chase zero rejections with retries.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 861

Source: [#861: Design faster performance feedback: qualified work counters, user-journey contracts, and tiered verification](https://github.com/ShaulLavo/fregat/issues/861), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/861).
Current owner: [scripts/agent/browser.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/agent/browser.ts).

Design faster feedback around user-journey contracts, qualified work counters and verification tiers. Counters complement timings and require deliberate-regression controls; native and physical-presentation qualification remain separate. Preserve specialized coverage, explicit failed/cancelled/missing/partial states and reviewed baseline re-pins. Start with one bounded end-to-end case under the #863 instrument inventory, rather than replacing all benchmark tools or weakening gates.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 862

Source: [#862: Explore region- and phase-aware layout stability checks with cross-browser geometry controls](https://github.com/ShaulLavo/fregat/issues/862), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/862).
Current owner: [scripts/agent/trace-summary.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/agent/trace-summary.ts).

Extend layout checks with named composer/sidebar/transcript/editor/toolbar regions and phase boundaries. Feature-detect LayoutShift; unsupported engines report unavailable, not zero. Add bounded cross-engine geometry controls for stable layout, injected shift, allowed movement, resize and unsupported instrumentation. Geometry and browser event callbacks do not replace physical terminal presentation. Record region/phase attribution without weakening existing layout assertions.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 863

Source: [#863: Research: make performance tooling trustworthy, faster, and coverage-preserving before redesigning it](https://github.com/ShaulLavo/fregat/issues/863), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/863#issuecomment-6047346339).
Current owner: [scripts/agent/browser.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/agent/browser.ts).

Before a performance-tool redesign, inventory scripts/agent, web scripts, editor stress and terminal comparison tools by unique coverage and cost. Measure queue/build/start/warmup/capture/report/cleanup, run frozen A/A and deliberate-regression controls, record identities and missing/cancelled/partial states, and quantify observer overhead. Reclassify historical evidence only for affected metrics. Begin with a small coverage-preserving workflow and a vertical streaming-highlighting case. Preserve #855–862, #820 and terminal qualification dependencies. The October 8 Canvas packet had 111,328 ghostty-web history rows versus 10,000 xterm and 8,841 native; the equal-history gate failed, so it remains diagnostic with no headline ratio.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 873

Source: [#873: CI: Git byte-cap control observes 1523712 bytes with a 1024-byte cap](https://github.com/ShaulLavo/fregat/issues/873), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/873#issuecomment-6034614108).
Current owner: [apps/server/src/git/tests/process.test.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/apps/server/src/git/tests/process.test.ts).

CI 37459899866 job 112256612017 observed 1,523,712 bytes for a real 2,000,000-byte Git blob with maxOutputBytes=1,024, failing the less-than-1,000,000 assertion. Output-limit and empty-stdout assertions passed. Local real-pipe and stalled-consumer controls did not reproduce that overshoot. Retain first chunk size, cumulative observed bytes, read/cancel phase and exit/signal in the next failing original composition. Do not clamp observedBytes or weaken the cap/overshoot assertion to make the test green.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

## Stale-claim follow-ups, 2026-10-08

Status: Approved. Plan 336 Track H's second pass released the inactive claims after checking open PRs, branch dates and worktree processes. [The close-out record](issue-closeout-2026-10.md#second-pass-stale-claims) records those checks. These failures still need cause evidence.

### Issue 563

Source: [#563](https://github.com/ShaulLavo/fregat/issues/563). Current owners are `apps/server/src/settings/store.ts`, `layer.ts`, `write-coordinator.ts` and `tests/write-concurrency.test.ts`.

The ordered dark, light, system test rejected with `settings.WRITE_CONTENDED` in PR #522's [job 111236444189](https://github.com/ShaulLavo/fregat/actions/runs/37134008428/job/111236444189), then on actual main `fd999a3f9a1b019a86fd115fadfd0d95ada1b815` in [job 112203877587](https://github.com/ShaulLavo/fregat/actions/runs/37443862823/job/112203877587). The latter ran for 62 ms. Both serialized failures omit attempts and coordinator wait. The fixture has a unique directory, `watch: false`, explicit stage gates and no injected external edit. Main retains the coordination test and bounded semantic attempts. A short elapsed time does not identify which bound failed.

The original reproduction owner worked on `backlog/503-20261003-131439`, head `8a7635ca8ad570ae890087fd4201ddb4c1464a49`, for the separate merged desktop PR #522. Its exact case and full-file 50-repeat controls passed on the PR and captured main. A two-attempt injected revision mismatch proved attempt and wait facts observable. Thirty loaded ordered-write iterations on each tree also passed with first-attempt revision agreement and zero remaining coordinators. The exact full-shard attempt expired in admission and never ran. Preserve these results as controls, not a cause proof.

The October 8 recurrence on PR #984's [job 113231059715](https://github.com/ShaulLavo/fregat/actions/runs/37753137148/job/113231059715) failed in 42 ms and again omitted attempts and coordinator wait. [The diagnostic PR](https://github.com/ShaulLavo/fregat/pull/997) puts the stop reason, attempts used, attempt limit, time budget, elapsed time, coordinator wait and last expected/observed keyed revision fingerprints into the product error's backend-only `internal` context. The existing settings request event retains those facts, and the ordered fixture prints them on rejection because error serialization omits backend-only context. Single-attempt raw and pruning paths identify their failed check too. The fingerprints use a random per-process HMAC key that stays out of logs. No setting values or file contents enter these facts.

CPU-loaded direct, parallel distinct-path and repeated ordered-case controls passed on tmpfs and SSD storage. These private diagnostic experiments did not reproduce the natural failure. One bounded original server shard ran and passed, 154 files and 1,901 tests with four existing skips. A known two-attempt revision mismatch remained observable; its new internal-context assertion failed before the diagnostic change. These are healthy and injected controls, not a naturally failing capture or a flake fix. Watchers are disabled in this fixture, and revision checks use content hashes, so watcher echoes and mtime comparisons remain unsupported explanations. The next natural recurrence will carry the stopping limit and last revision comparison. Keep both follow-ups open.

- [ ] Capture a natural failing ordered-write fixture's attempt count, coordinator wait, elapsed time, admitted owner and pending write IDs, and stage/read revision agreement. Use fixture-owned facts and the existing known-contention control. Run the original `bun run --cwd apps/server test --shard=1/2` only as a bounded hypothesis-directed capture. Compare an exact-source healthy control.
- [ ] Fix the demonstrated settings or fixture cause in its own change. Preserve admission order, the eight-attempt and 2000 ms bounds, and every assertion. Keep owner settings untouched. A passing rerun or larger timeout cannot close this follow-up.

### Issue 574

Source: [#574](https://github.com/ShaulLavo/fregat/issues/574). Current owners are `apps/web/src/features/editor/tests/file-sync-service.test.ts`, the real FileSyncService/query/watch lifecycle and `apps/web/test/fixtures.ts`.

The clean-buffer case `recreates a deleted file after failed refetch and retained-data remount (dirty: false)` exceeded its 5000 ms CI deadline. The actually executed historical source was synthetic merge `2e26940a8ce889af113ea025d963dc24c5334e25`, with parents `4b382fb46c9ac0f7f123dd1a721f6e5c3bb4fc21` and `ad6ee788c4234c57b7357f60c97b61749df7a1f6`. Current main still checks failed deletion refetch, retained buffer identity, orphan state, save recreation and cleanup. Runtime impact and cause remain unconfirmed.

The abandoned `backlog/574-20261003` head `4a292fcb92cc352a578bf88d1ad34b0db0a92e19` contains observation-only checkpoints and a historical Ubuntu capture harness. Its dispatch-only workflow replaces ordinary CI and must stay outside main. The [20-job capture](https://github.com/ShaulLavo/fregat/actions/runs/37158037955) ran ten unchanged and ten checkpoint cases once each at the original deadline, all passing. Every instrumented attempt showed all 32 checkpoints. Server import took 1.501–2.388 s, while the body through cache cleanup took 25.8–57.6 ms. Historical test, fixture, lock and configuration hashes and the observation-only AST comparison passed. This selected-case capture did not reproduce the original concurrent shard or establish import time as its cause.

- [ ] Reuse the branch's 32-checkpoint design for a bounded capture on the original failing shard composition. Record the first missing fixture-import, query, refetch, remount, save or teardown checkpoint with monotonic elapsed time. Compare the dirty-true positive control and recover actual checkout identity before interpreting a failure.
- [ ] Repair only the demonstrated lifecycle or fixture cause. Preserve the real in-process server, retry policy, buffer retention assertions and 5000 ms deadline. Do not transplant the diagnostic workflow, replay healthy jobs without a new hypothesis, or claim local passing controls fixed CI.

### Issue 665

Source: [#665](https://github.com/ShaulLavo/fregat/issues/665). Current owner is `apps/web/scripts/generate-preset-runtime.ts`, `registeredPresetCommandIds`, with `src/keymap/tests/preset-data.test.ts`.

The generator authority test took 20,993 ms against its 20,000 ms bound in [job 111433213599](https://github.com/ShaulLavo/fregat/actions/runs/37201240507/job/111433213599). The adjacent bare Bun check passed in 12,402 ms. A compiler lookup for 319 IDs loaded 6,922 source files and about 41.887 million UTF-16 source units. Exact controls passed on both the PR and main, with roughly 2 GB direct-probe RSS. A private 2 GiB ceiling control recorded two OOM kills, while normal 8 GiB controls passed. These observations do not identify the CI timeout cause.

The abandoned `docwave/presets665` head `83c2b949012b39d8030f916faecedc79bd448b5c` shipped in [PR #698](https://github.com/ShaulLavo/fregat/pull/698), squash `541ce4681ead968b58e0208181d481108c1c1b76`. Current main retains `host.jsDocParsingMode = ts.JSDocParsingMode.ParseForTypeErrors`. The branch's same-tree diagnostic reduced documentation AST work while keeping the full 6,923-file graph and exact 319-ID digest. Its one timing pair is diagnostic evidence, not a qualified speedup or proof the timeout was fixed. The full-graph cost and duplicate compiler construction in the adjacent CLI test remain.

- [ ] Capture the current graph and memory cost with an exact live-table control, then reproduce the resource or timing failure under a bounded comparable load. Separate command-ID authority from handler type imports if that preserves exact live authority, or remove duplicate compiler construction when the evidence supports it.
- [ ] Keep frozen inventories, binding reports, generated output and the silent bare Bun `--check` behavior exact. Run `bun run --cwd apps/web test src/keymap/tests/preset-data.test.ts` without timeout, retry or skip changes. Report paired qualified time and resource evidence before claiming an improvement.

### Issue 810

Source: [#810](https://github.com/ShaulLavo/fregat/issues/810). Current owners are `apps/web/src/features/chat/tests/mermaid-fence.browser.tsx` and the `delayRequest` browser command in `apps/web/vitest.browser.config.ts`.

At main `60313f9eae767694326b9b2e00bd398c549040af`, [job 111879139435](https://github.com/ShaulLavo/fregat/actions/runs/37344356134/job/111879139435) observed `held.face.status = loaded` where the stalled-face case expected `loading`. Three diagrams had painted and the earlier elapsed assertion was not reported as failed. The test uses a 1000 ms font wait, a 5000 ms held request, a 2500 ms paint bound and the original 30-second case deadline. Main still retains this contract. A request-hold failure, cache effect, setup delay or production font behavior has not been established.

The abandoned `docwave/main603-mermaid810` head `60313f9eae767694326b9b2e00bd398c549040af` has an uncommitted test-only observation patch, last modified 2026-10-05 17:29:56 UTC. It observes FontFace registration/status/load events, selected family, same-family faces and resource timing before disposal. Its optional `fontHoldObservation` command is absent from both that checkout's committed browser config and current main. The patch is an incomplete diagnostic sketch, not verified code to copy. Leave the original dirty tree untouched.

- [ ] First prove the selected face actually downloads under a known-good hold. On the exact stalled case, capture request identity, route match, hold start/release, FontFace and font-set events, resource timing and paint start on comparable clocks. Add the missing bounded command-side hold observation if needed. Freeze failure facts before disposal calls `face.load()`.
- [ ] Fix only a demonstrated route, fixture or font owner defect. Preserve all three diagrams, original wait/hold/elapsed bounds and the loading-face assertion. Keep this failure separate from #805's syntax readiness.

### Issue 833

Source: [#833](https://github.com/ShaulLavo/fregat/issues/833). Current owner is `scripts/agent/browser-doctor.test.ts`.

The real CLI healthy case exceeded 5000 ms in PR #808 head `06a2e9b02c4fdeeced48eaa1673aea9913858686`, [job 111986432965](https://github.com/ShaulLavo/fregat/actions/runs/37375811230/job/111986432965). The other 15 doctor cases passed. The failure preceded the feature suite and supplies no editor-product cause. One cold healthy and one deliberate 504 control passed at the original deadline with owned cleanup. Passing main runs also do not explain the failed phase.

The abandoned `docwave/browser-doctor-diagnostics200` source head `bfa82f30f1971de34066b7005a21b6cbca0fc05a`, published head `eab0a406946d465371ed2208e361d422aca04e92`, shipped in [PR #836](https://github.com/ShaulLavo/fregat/pull/836), squash `a4c772693f1fd557e22b711e6f639f5c5a4c3a84`. Main retains `doctor-fixture-failure`, with parent boundary, CLI PID/exit/signal, pipe bytes/completion and capped fixture request status/completion. The original case order, argv, predicates and deadline remain. This shipped observer is useful continuation work, not a timeout cure.

- [ ] On a bounded natural recurrence, retain that journal and identify the last completed child, pipe, browser or fixture-request phase before cleanup. Calibrate observability with the same healthy and deliberate 504 controls, and preserve the original job's exact source and command.
- [ ] Repair a demonstrated cause with a failing-first test. Keep the original 5000 ms deadline, predicates, argv and owned cleanup. Do not replay the 15 healthy cases without a cause-directed reason or add a generic retry.
