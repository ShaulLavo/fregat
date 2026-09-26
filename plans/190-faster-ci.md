# Plan 190: Faster CI

## Status and authorization

- Status: PROPOSED 2026-09-26 (owner: "make CI faster, it is painfully slow"). Ready. First queue item
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

Larger runners cost money, which is an owner decision; this plan does not buy them.

## Verification

Before and after for each phase: wall time and queue time of five runs, per-job and per-step times
from `gh run view --json jobs`. Coverage does not shrink: every test and check that ran before still
runs for the changes it can affect, and the nightly `flake-watch.yml` keeps running the full suites.
For the Editor, the same before and after from singapore's `ci.yml`, plus one run with a cold turbo
cache to show a miss still runs everything.
