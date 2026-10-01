# Repeatable Editor stress benchmarks

Run from the repository root with Node 26 and Bun installed:

```sh
bun install --frozen-lockfile
bun run bench:stress --output /work/tmp/editor-stress/control-1.json --verify-cancellation
bun run --cwd examples/stress test
```

`bench:stress` builds the public package exports first. The runner then builds this standalone
Vite entry into a temporary directory under `/work/tmp`, launches installed Playwright Chromium,
and serves the build through Playwright request routing. It opens no listening socket and starts
no dev server. It deletes the build and browser profile on success, failure, SIGINT, or SIGTERM.
No corpus download or fixture generation is part of a timing interval.

For interactive work, open this entry through an already running Vite server and supply its URL
with `--url`. That delivery mode is recorded and cannot be compared with the built runner.
Install Chromium separately if it is missing, with Playwright's browser cache on a data drive.

## Runner inventory

| Workload                        | Runner                                                 | Boundary / decision                                                                              |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Anchor resolution and insertion | `packages/editor` `bench:anchors`, `bench:piece-table` | Keep storage microbenchmarks and their distinct edit histories.                                  |
| Display transforms and folds    | `bench:transforms`, `bench:fold-map`                   | Keep focused algorithm workloads.                                                                |
| Row and long-line mounting      | `bench:virtualization`                                 | Keep happy-dom allocation/count checks; it does not measure browser paint.                       |
| Piece traversal                 | `bench:walker`                                         | Keep sequential/random-access comparisons.                                                       |
| Parsing, queries, injections    | `packages/tree-sitter` `bench:syntax`                  | Keep worker timing and process memory measurements.                                              |
| Application open / filesystem   | Platform `editor-open-benchmark.mjs`                   | Remains Platform-owned; this suite starts before `createEditorTextBuffer` and view construction. |
| Application typing              | Platform `editor-typing-benchmark.mjs`                 | Retain its trusted-key timestamp to applied-edit / next-frame definition here.                   |
| Full standalone scenarios       | `examples/stress` `bench`                              | Open, highlight, jump, typing, find-all, wheel sweeps, edit/delete retention.                    |

The older generators exercise different algorithms, sizes, and edit distributions. None is an
equivalent caller of the new corpus, so none was deleted or silently changed. Future users can
generate the common corpus with `bun run --cwd examples/stress fixtures /work/tmp/editor-fixtures`.
Without a directory argument, that command prints only the manifest. Generated documents do not
belong in Git. `results/manifest.json` pins the seed, generator version, UTF-8 bytes, UTF-16 length,
normalized line count, longest line, search count, and SHA-256 for every fixture.

## Full-text boundary workload (E033)

`node boundary.mjs --output /work/tmp/editor-e033/boundary/run.json` opens two views over a
document fragmented by 32 replacements at 65,536, 4,194,304 and 50,331,648 units. The content above
the filler is fixed, so the viewport, captures, caret and conflict stay the same as the size grows.
`plain` has no plugins. `contributions` adds Markdown (fixed captures), scope-lines, decode and the
merge-conflict plugin, with a conflict present and the caret typing inside it. Each configuration
runs 20 warm-up and 200 measured native keys, then the same for undo. It records open, steady-state,
export and disposal heap, and export time. `--diagnostics` adds read counters, taken before the
probe's own full-text correctness check. Run the same files from a worktree of the control commit and
alternate the two; `--configs` and `--sizes` narrow a rerun.

For large-file minimap work, `--configs minimap,folds` uses repeating indented functions, with
and without minimaps. `--key-delay 80` lets the minimap's delayed updates run during typing;
an unpaced burst can end before the first update. `--views 1` measures a single view, and the
default remains two shared views. These configurations wait five seconds after opening and
capture a screenshot before input. Their results also report each worker's post-GC CDP heap,
separately from the main renderer. Worker `backingStorageSize` includes ArrayBuffers and
external strings; it is not a measurement of live WASM trees alone.

## Row geometry workload (E036)

`node geometry.mjs --output /work/tmp/editor-e036/run.json` opens one 900x600 view over 3,000-line
fixtures: Go indented with tabs and the same text with four spaces, both again padded to 180 columns,
Markdown with inline replacements, and Unicode. Each fixture runs one counting pass (geometry
diagnostics and rect-read counters on) and `--repetitions` timing passes (both off), each in a fresh
context. Workloads are 60 clicks over three screens, 60 ArrowDown, 60 ArrowRight and 24 typed keys.
The summary reports mounted rows per geometry path, builds and sweeps per operation, rect reads,
CDP layout, script and task time, and dispatch-to-applied latency. `--font-check "a,b"` instead
hit-tests every third column of the space-indented fixture in each font and times a monospace probe.

`node blink.mjs --output /work/tmp/editor-e036/blink.json` measures whole-browser CPU from `/proc`
while a focused view sits idle: CSS blink, a JS interval, and no blink, interleaved per round.
Headless compositing is software; pass `--headed` for a GPU reading.

## Measurements and correctness

Every fixture runs every scenario. The ordinary open also enables the real TypeScript Tree-sitter
plugin and requires its authoritative highlighted generation and colored screenshot pixels. The
other scenarios use plain text rendering; syntax throughput already has its own worker benchmark.
These feature choices are part of the comparable configuration.

Each sample owns a fresh buffer and views, input listener, and frame callbacks. Churn uses two
visible views and one hidden view sharing one buffer, records 100 insert/delete cycles in history,
checks exact text in all three, and reveals the hidden view before releasing everything. The
runner also observes collection of the buffer and Editor objects through weak references after
forced GC. Cold samples use a fresh browser context; warm samples follow an unrecorded repetition
in the same context. Warm never means retaining the previous document or its event handlers.
Cold is a fresh JavaScript context, not a flushed OS cache or a restarted browser process.
Interaction setup waits for a captured text paint before issuing input, so initial viewport
measurement does not race a warm typing run. Churn checks the inserted Unicode prefix and all
200 document revisions. Two additional untimed probe edits prove visible and hidden views update.

Open/jump/scroll/burst paint values are **upper bounds ending at screenshot completion**, including
Playwright transport and capture cost. Pixel checks reject blank text and missing syntax color.
They prove captured browser output, not physical monitor presentation or the exact first painted
frame. `keyToFrame` preserves Platform's next-animation-frame observable and is explicitly not
pixel evidence. Screenshot costs do not enter `attach`, `keyToApplied`, or churn throughput.
Find uses trusted keyboard input and requires the exact expected match count with no truncation.
Scroll uses trusted wheel events and validates rendered rows against the generated document.

Latency arrays and throughput are separate. Chromium memory reports main-renderer CDP heap bytes and DOM/node/
listener counts after forced GC, plus live post-churn memory and released object counts. Process
RSS and `measureUserAgentSpecificMemory` are explicitly unsupported, never zero placeholders.
Worker heap bytes are not measured by the page CDP session. Language workers may keep their runtime
cache within a warm scenario group; closing its context releases them before the next scenario.
GC does not make heap usage a portable metric across engines. Chromium is the only reference
engine in version 1; other engines need their own implementation and control evidence.

Use `--diagnostics` to attach the existing `__EDITOR_PERFORMANCE_DIAGNOSTICS__` sink. Ordinary runs
leave it disabled. Diagnostic runs are separate configurations and cannot enter production
comparisons. No additional timing hooks were added to core subsystems.

## Controls and comparison

```sh
bun run bench:stress --output /work/tmp/editor-stress/control-1.json --verify-cancellation
bun run bench:stress --output /work/tmp/editor-stress/control-2.json
bun run bench:stress --output /work/tmp/editor-stress/control-3.json
bun run --cwd examples/stress compare calibrate /work/tmp/editor-stress/limits.json /work/tmp/editor-stress/control-1.json /work/tmp/editor-stress/control-2.json /work/tmp/editor-stress/control-3.json
bun run bench:stress --output /work/tmp/editor-stress/rerun.json
bun run --cwd examples/stress compare check /work/tmp/editor-stress/control-1.json /work/tmp/editor-stress/rerun.json /work/tmp/editor-stress/limits.json
```

The local envelope is derived separately for each fixture/scenario/state/metric. The p50 limit
is the largest control median plus the greater of three times the between-run median spread or
the observed within-run p95-minus-median spread. The p95 limit is the largest control p95 plus
three times the greater of the between-run median and p95 spreads. Raw controls and calculated
limits remain inspectable. These are exploratory local tolerances, not installed CI thresholds.
Choose stable reference hardware, increase repetitions, and measure control stability before
using a result to block CI. Do not claim an improvement until an unchanged rerun compares cleanly.
Resource limits use the largest control maximum plus three times the spread of control maxima,
separately for heap bytes, DOM nodes, listeners, tracked objects, and live post-churn heap bytes.

The comparator rejects missing/duplicate samples, invalid timings, fixture hash differences,
different browser/hardware/features, and missing calibration coverage. Tests prove unchanged
comparison, slowdown detection, deterministic fixtures, real Unicode edits, and mixed endings.
Memory capability must match for every fixture, scenario, state, and repetition. Supported churn
samples require post-churn memory and retained-object counts; dropping one measurement cannot
hide a retention regression. Unsupported memory remains explicit and requires a reason.
`--verify-cancellation` cancels a running asynchronous churn scenario and checks released resources.
After recording controls, `bun run --cwd examples/stress proof` replays the checked comparison,
verifies that limits derive from those controls, and proves rejection of missing samples, changed
hashes/options, and synthetic latency and memory regressions applied to the recorded raw samples.
Its `contractsPassed` field covers those verification checks; `calibrationStable` separately reports
the independent unchanged run. The checked developer-machine calibration is still noisy. See
[the local baseline](results/README.md) for both unchanged-run outcomes. Do not use its limits in CI.

Useful options: `--repetitions 3`, `--warmups 1`, `--seed 60061`, `--fixtures ordinary`,
`--diagnostics`, and `--output PATH`. A subset cannot compare against the complete fixture set.
Scenario failures write a structured event with fixture, state, observation, and error. A failed
or interrupted run does not replace the requested result file.

## First text and highlighted paint

Build the public packages, then run the E003 open matrix:

```sh
bun run stress:build
bun run --cwd examples/stress bench:first-paint --output /work/tmp/editor-e003/before.json
```

The runner opens the E001 ordinary and 500,000-line fixtures, with and without the real
TypeScript plugin, directly and through ready prepared documents. Each configuration has fresh
browser contexts for cold samples and one unrecorded open before warm samples. Prepared stages
use the existing one-shot transfer contract and an initial 4,096-character query. Preparation
includes the whole-document worker parse and is reported separately from the prepared open.

Buffer creation, constructor, attachment, and public paint callbacks have separate durations.
Visible text and highlighted text require screenshot pixels and remain screenshot-completion
upper bounds. Callback timestamps do not prove paint. Prepared opens may already have highlighted
pixels in the first text screenshot. The matrix uses a fixed four-space tab policy in both paths.
Asset request/response times use a runner wall-clock origin; browser durations use performance.now.
The artifact retains both clocks without treating them as interchangeable.

Use `--core-directory /work/tmp/editor-e003-baseline` for a preserved core package containing
matching `src`, `dist`, and `package.json`. Dependencies must remain resolvable from that directory.
Record baseline, unchanged control, and candidate with the same options. `--diagnostics` adds
the existing opt-in sink plus language asset, worker registration, parse, and range-query phases;
diagnostic timings are a separate configuration. `--repetitions 1 --fixtures ordinary` provides
a short smoke run. `--plugins none` and `--modes direct` select narrower investigations.

The entry is a Vite production build loaded through Playwright routing, with no server. Every
sample checks the full document, initial revision, authoritative paint events, screenshot ink,
and release of document/view objects after the worker's idle fence acknowledges disposal. It
also records retention immediately before that fence, when disposal RPCs may still be pending.
The final artifact records fixture hashes, browser and
hardware, source identity, asset requests, logs, diagnostics, and raw timing samples. It rejects
source changes during a run and writes the output only after every sample succeeds.

### Snapshot indentation folding

E034 adds `--fallback-cases` to exercise folding and 36 trusted keyboard inputs on the seeded
500,000-line document. The [implementation report](../../docs/performance/e034-snapshot-indentation-folds.md)
separates production latency from diagnostic work counts, ready preparation, and cold fold commands.

Freeze matching source and built core packages before comparing them. The Linux experiment runner
defaults to twelve blocks, with all six baseline/control/candidate orders twice. Each arm records five
documents for each direct/prepared and cold/warm group. It starts no server and refuses existing
capture outputs. Keep source and built dependencies unchanged until capture finishes.

Use an isolated checkout for a long comparison if other work may change the repository.
`--core-directory` freezes the selected core; the source hash still covers other workspace packages.
Copy their built outputs and point workspace dependency links at the isolated checkout too.

```sh
node examples/stress/fallback-validation-design.mjs /work/tmp/e034-design.json /work/tmp/e034-captures
node examples/stress/fallback-experiment.mjs --design /work/tmp/e034-design.json \
  --baseline-core /work/tmp/e034-baseline --candidate-core /work/tmp/e034-candidate \
  --cpu-affinity 8,10,12,14
node examples/stress/fallback-validation.mjs /work/tmp/e034-design.json /work/tmp/e034-report.json
```

For a larger declaration, append its block count after the capture directory, for example `24`.
The count must be an integer of at least twelve and divisible by six. The generator, runner, and
analyzer require every arm order to occur equally often. Choose the count before capture and use
new output paths for each declaration; changing the count does not relax any acceptance threshold.

Select available physical cores on the measurement machine before declaring the experiment.
The analyzer validates complete samples, matching artifacts and environments, text/fold/disposal
evidence, and input coverage. It resamples whole paired blocks and reports approximate, simultaneous
one-sided bounds for p95 input-to-change and initial text callbacks. Acceptance requires every primary
upper bound at or below zero and no detected unchanged-control drift. An unresolved result exits
nonzero. A clock-resolution envelope is explanatory and does not relax that requirement.
Frame and screenshot-completion times remain separate secondary measurements. The older
`fallback-compare.mjs` prints descriptive summaries; it is not the acceptance validator.

## Hidden retained views

Build the public packages, then run the focused E004 measurement:

```sh
bun run stress:build
bun run --cwd examples/stress bench:hidden --expect-suspended --output /work/tmp/editor-e004/result.json
```

The runner reuses E001 fixtures, document churn, and the browser entry. It records initial and
measured row counts, CSS ranges per view, retained memory, and reveal timing without a selection
or edit to force repaint. Three repetitions use one fresh context per fixture, followed by two
warm repetitions. `--core-dist PATH` measures a preserved build; its package dependencies must
remain resolvable from that directory. Omit `--expect-suspended` to measure the old behavior.
The [E004 results](results/hidden-rendering.md) include matching baseline, unchanged control, and
candidate artifacts. Their reveal measurements are separate from E001's original latency limits.

## CPU profiling

Use a fresh profile directory for each run:

```sh
bun run bench:stress --fixtures ordinary,long-line --repetitions 1 --profile-directory /work/tmp/editor-line-profile --output /work/tmp/editor-line-profile/result.json
bun run --cwd examples/stress profile:summary /work/tmp/editor-line-profile > /work/tmp/editor-line-profile/summary.jsonl
```

The runner records Chromium CPU profiles at a requested 1 ms sampling interval around typing and
churn, after initial text paint. Each recorded cold and warm repetition writes a `.cpuprofile`.
Warmup repetitions are not profiled. The saved `build/` includes readable JavaScript and composed
TypeScript source maps. Import a profile in Chrome DevTools Performance to explore its stacks,
or use `profile:summary` for source locations and weighted self and inclusive samples.

Profiles include interaction setup, correctness checks, screenshots, and churn's two probe edits.
They exclude fixture generation, initial attachment, and disposal. The summary removes idle samples
from active percentages and counts a recursive function only once per inclusive stack. Inclusive
percentages overlap across callers. Sampling weights are approximate, and native browser work is
not fully attributed by the JavaScript profiler.

Profiling disables minification and records a distinct configuration. Do not compare these timings
against the normal benchmark calibration. The existing-server `--url` mode is unsupported because
it cannot preserve the matching build. A profile directory must not already exist, preventing stale
traces from mixing with a new run. Profiles remain available after a failed scenario.

See [the long-line investigation](results/long-line-profile.md) for the measured hot paths and
[the implemented fixes](results/long-line-fix.md) for normal-build before/after measurements,
regression coverage, and the memory tradeoff.

## Native input layout profiles

Build the packages with `bun run stress:build` from the repository root. Capture layout stacks
around native typing and paste bursts with a new output directory:

```sh
bun run --cwd examples/stress profile:input --mode trace --repetitions 1 --output /work/tmp/editor-layout-trace
```

The default groups cover typing in ordinary and long-line documents, and paste in long-line and
short-line documents, with multiple views. Use `--groups long-line/multiple/typing` to select one.
Each group runs one warmup before the measured repetitions. The output includes raw Chromium
traces, CPU profiles, source maps, layout counts by callsite, and the full correctness samples.
Layouts without a JavaScript stack remain in the totals.

For latency measurements without profiling instrumentation, use `--mode timing`:

```sh
bun run --cwd examples/stress profile:input --mode timing --output /work/tmp/editor-layout-timing
```

Add `--core-directory /path/to/frozen/packages/editor` to compare a frozen core through the same
harness. Runs record the selected source hash and reject source changes during measurement.
Both modes reuse the native input suite's text, selection, rendering, and cleanup checks. These
focused artifacts are not budget acceptance runs; trace timings include instrumentation overhead.
Use the complete input suite below for budget comparisons.

## Input latency budgets

The absolute-threshold workflow below is the delivered historical instrument. Plan 282 replaces
its verdict with a paired A/B instrument. PR #224 closed the existing matrix as partial; these
commands document reusable collection and are not a request to repeat that matrix.

Run the following in Bash from the Editor workspace (`editor/` in Platform). Input runs require
all built public packages, their external-dependency receipt and a frozen fixture manifest. A
core-only directory cannot supply that identity. Before building or freezing, verify that `/work`
is mounted and has free space. Use a new, empty run directory for each collection:

```sh
findmnt --target /work
df -h /work
run_root=$(mktemp -d /work/tmp/editor-input-XXXXXX)
bun run build
node examples/stress/fixtures.mjs "$run_root/fixtures"

freeze_input_packages() {
  node examples/stress/package-set.mjs "$PWD/packages" "$run_root/$1" \
    "$(git rev-parse HEAD)" \
    "$(git diff HEAD --binary -- packages | sha256sum | cut -d ' ' -f 1)" \
    "$(sha256sum ../bun.lock | cut -d ' ' -f 1)"
}
freeze_input_packages baseline

run_input() {
  local packages=$1
  shift
  node examples/stress/run.mjs --suite input-latency \
    --packages-directory "$run_root/$packages" --fixture-directory "$run_root/fixtures" \
    --consumers native "$@"
}
run_input baseline --repetitions 1 --output "$run_root/before.json.gz"
run_input baseline --repetitions 3 --output "$run_root/control-1.json.gz"
run_input baseline --repetitions 3 --output "$run_root/control-2.json.gz"
run_input baseline --repetitions 3 --output "$run_root/control-3.json.gz"
run_input baseline --repetitions 3 --output "$run_root/rerun.json.gz"
```

The freeze command takes the source package directory, destination, product commit, dirty package
diff SHA-256 and workspace lock SHA-256. It copies every public package's matching `src`, `dist`
and `package.json`, and records the resolved external dependency bytes. Keep the frozen directories
and dependencies available. The runner validates the receipt before collection.

Keep the browser, hardware, instrument source, fixtures and consumer selection fixed. Run without
other benchmarks or builds competing for the CPU. All controls and the independent reference
holdout use the baseline package set. Calibrate and check that same-build holdout:

```sh
node examples/stress/input-compare.mjs calibrate "$run_root/calibration.json.gz" "$run_root/control-1.json.gz" "$run_root/control-2.json.gz" "$run_root/control-3.json.gz"
node examples/stress/input-compare.mjs check "$run_root/control-1.json.gz" "$run_root/rerun.json.gz" "$run_root/calibration.json.gz" --same-build
```

Each input limit is the largest control p95 plus the largest of three times the between-run p95
spread, three times the between-run median spread, or the widest observed within-run range
(maximum minus minimum). Calibration records each control's median, p95, minimum, and maximum.
This local envelope includes the observed timing variation across the full sample, including
arrival at different points in a frame. It is not a statistical confidence bound. Establish the
rule before collecting its independent unchanged holdout, and require the real delayed control
to fail before accepting the calibration.

The input comparison has **108 blocking groups**: input-to-applied, synchronous dispatch, and
input-to-next-frame for every fixture, view configuration, and scenario. Its **36 screenshot
groups are advisory**. Their burst-to-screenshot-completion upper bounds include input delivery,
Playwright transport, and capture overhead. Raw screenshot distributions and calibrated limits
remain in the report, but exceeding those timing limits alone does not fail acceptance.
Screenshot evidence, changed pixels, rendered text, and revision correctness remain mandatory.

Prove the gate catches a real 20 ms pause inside each measured input operation on the **baseline
build**, before changing the product:

```sh
run_input baseline --repetitions 3 --slowdown-ms 20 --output "$run_root/delayed.json.gz"
node examples/stress/input-compare.mjs check "$run_root/control-1.json.gz" "$run_root/delayed.json.gz" "$run_root/calibration.json.gz" --allow-slowdown > "$run_root/delayed-check.json"
node examples/stress/input-admission.mjs "$run_root/delayed-check.json" "$run_root/delayed.json.gz"
```

The delayed comparison must exit with status 1 and fail all 36 dispatch groups. Run admission after
that expected nonzero comparison; admission must exit with status 0 and report `admitted: true` and
`full: true`. `--allow-slowdown` permits the explicit delay while requiring baseline package identity.

After implementing the product change, rebuild the public packages and freeze a separate candidate
set. Keep the instrument and external dependencies unchanged. Check the candidate against the
preserved controls, then collect its diagnostic phase correlations separately:

```sh
bun run build
freeze_input_packages candidate
run_input candidate --repetitions 3 --output "$run_root/candidate.json.gz"
node examples/stress/input-compare.mjs check "$run_root/control-1.json.gz" "$run_root/candidate.json.gz" "$run_root/calibration.json.gz"
run_input candidate --repetitions 1 --diagnostics --output "$run_root/diagnostic.json.gz"
node examples/stress/test/verify-input-results.mjs "$run_root"
```

The delayed run stays on the baseline source and build; the diagnostic run stays on the candidate
source and build. The proof command checks saved before measurements, controls, same-build holdout,
candidate, full delayed admission and diagnostic records. It writes `verification.json` and
`calibration.json.gz`. It fails on missing or incomparable samples, incorrect text/revisions/paint,
malformed index ranges, listener growth, incomplete context closure, reused run identities, or a
candidate exceeding the established blocking limits. A valid run that exceeds blocking timing
limits still writes `verification.json` with `passed: false` and `candidateFailures`, then exits
with status 1. Screenshot timing excesses appear separately in `candidateAdvisories`. Malformed
evidence fails before the report is written. `.json.gz` stores the same raw records as `.json`
using gzip.

For a quick probe, add `--input-smoke`. That runs ordinary/single-view cases and marks the artifact
`smokeOnly`; the acceptance gate rejects it. Use the full suite to accept a change.
See [measurement boundaries and diagnostic fields](../../docs/performance/input-latency.md)
for what each duration proves and the CDP composition-commit limitation.
