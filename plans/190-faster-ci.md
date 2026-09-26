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

## Outcome

A PR that changes code gets a full verdict in about two minutes of wall time; a PR that changes only
plans or docs gets its checks in well under a minute. Each job spends seconds on setup, not a minute.
The targets are confirmed or revised by phase 0's measurements.

## Phases

0. **Measure setup** (S). Time every step inside the composite action (a timestamp per step, or split
   it into visible steps) across five runs. Record the table here before changing anything.
1. **Build the Editor and ghostty once per pinned ref** (S–M). Since `editor-ref` is pinned (2026-09-26),
   cache the built `dist/` of the Editor packages and ghostty-webgpu keyed by ref, toolchain and
   lockfile, or build them in one upfront job and hand them to the others as an artifact. Same for
   the search tools. Cache `node_modules` keyed by the lockfile if `bun install` still costs seconds
   after the cache restore.
2. **Skip what a change cannot affect** (S). A path filter job decides what runs: plan- and doc-only
   PRs run format and the doc checks only; a change confined to one app skips the other app's test
   shards. Branch protection keeps one required status that summarises the rest, so skipped jobs
   never block a merge.
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
   ten. Main then takes at most two runs (one running, one pending), or 20 of the 20 runners at
   today's 10 jobs, so it only fits once phase 6 cuts jobs per run. Until then, measure how often
   PR runs wait behind main. A red main run names a commit range (previous verdict to this one),
   and `flake-watch.yml` still covers the nightly full suite.
6. **Fewer jobs per run** (S, after 1–4). With setup down to seconds, merge small jobs (packages,
   parity, typecheck) so one run takes fewer of the 20 runners, and wave 2's eight lanes queue less.

Larger runners cost money, which is an owner decision; this plan does not buy them.

## Verification

Before and after for each phase: wall time and queue time of five runs, per-job and per-step times
from `gh run view --json jobs`. Coverage does not shrink: every test and check that ran before still
runs for the changes it can affect, and the nightly `flake-watch.yml` keeps running the full suites.
