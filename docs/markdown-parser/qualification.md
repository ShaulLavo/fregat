# Run Markdown qualification

Install the checkout's dependencies and build its workspace libraries:

```sh
bun install --frozen-lockfile
bun run build:workspaces
```

Run each baseline suite with an evidence directory you own:

```sh
bun run markdown:parity --out <evidence>/parity
bun run markdown:stream --out <evidence>/stream
bun run markdown:visual --out <evidence>/visual
bun run markdown:bench --out <evidence>/bench
```

`parity` runs package correctness, safe-rendering, nonlocal edit, lifetime and reference checks.
`stream` runs package streaming and actual chat prefix/frame checks. `visual` captures 32 chat
stories at 390 and 1440 pixels in light and dark themes. It checks the expected content and geometry,
decodes the PNGs, rejects flat images and measures four repeated-capture calibration pairs.
`bench` combines native measurements with real chat browser observations for nine workload families.

The browser runs use the existing isolated fixture server and production React Compiler transform.
Each invocation selects free loopback ports. The runner records test failures, closes its owned
browser/server through the existing teardown and stops subsequent suites after interruption.
Screenshots are copied into the report's `images/` directory. Review the images before accepting
a visual baseline. Repeated-capture variance above 0.1% fails calibration; candidate pixel comparisons
remain a later gate.

Run all current checks and obtain the cutover verdict:

```sh
bun run markdown:qualify --out <evidence>/qualification
```

The current verdict is `NOT VERIFIED` and this command exits nonzero. The installed parser needs
a renderer-facing semantic adapter, paired candidate browser measurements and frozen independent
evaluation. Baseline commands exit successfully when their test runners and output controls pass,
while preserving independently recorded baseline defects in `baseline-checks.json`.

## Read the evidence

- `qualification.json` identifies the suite, source closure, lockfile, runtime, fixture/oracle pins,
  candidate capabilities, executed test counts and readiness gaps.
- `baseline-checks.json` contains each completed-message and named-prefix expectation, including
  failed desired behavior. Expected-failure tests cannot turn those rows into successful qualification.
- `raster.json` records image dimensions/content pixels, repeated-capture differences and blank/color
  negative controls. `images/` contains the exact captured baselines.
- `benchmark.json` names measured and missing fields for every workload family. `raw-samples.jsonl`
  preserves the samples. Development-browser and local native timings are exploratory.
- Test JSON and logs preserve failures and the exact invocations' counts. A runner with zero executed
  tests fails. The baseline's known nested-emphasis failure remains visible separately from test totals.

The fixture set has 102 owned completed cases and 56 small streaming cases. Package checks compare
every Unicode-scalar prefix, adversarial UTF-16 prefixes and eight seeded schedules. Transport checks
split UTF-8 bytes through a real decoder. Browser checks cover 32 explicit streaming stories,
frame palettes, held/released syntax, source replacement, selection/copy, activation and delayed stages.
The reference sets have all 652 CommonMark and 672 GFM examples plus the published 183-message
and 497-document regression corpora. Large repository streams use bounded chunk counts; dedicated
generated workloads measure pathological scaling.

The GFM reference includes older CommonMark behavior. Eighteen exact hashed discrepancies are
recorded in the reference ledger with their cause. They retain their original denominator and appear
as documented differences, rather than passing conformance. The safe product profile has its own tests.

## Run focused benchmarks

Use the standalone benchmark runner to filter families or workloads:

```sh
bun scripts/markdown/bench.ts --mode quick --family streaming-replay --out <evidence>/focused
bun scripts/markdown/bench.ts --mode promotion --family warm-completed --out <evidence>/promotion
```

Promotion uses at least 20 native trials and reports all raw samples. One-unit/eight-unit schedules
apply to inputs up to 8 KiB; omitted large-source cells stay visible. Browser logs can be supplied
with `--browser-log <file>`. Production-build paired latency, complete asset accounting, input/scroll
performance, JS live allocation and candidate WASM retention remain explicit missing measurements.
Follow the execution host's scheduling and measurement policy; contributor commands require no
owner-specific hosting or scheduling tool.

## Refresh the reference assets

Keep fixture provenance and licensing with the snapshots. Obtain the pinned public specification
sources and the published parser corpus, then extract them without accessing production state:

```sh
bun scripts/markdown/snapshot-reference.ts \
  --commonmark <commonmark-spec-0.31.2/spec.txt> \
  --gfm <pinned-gfm-spec.txt> \
  --parser-root <tree-sitter-md-checkout> \
  --revision e2ae3f735f614b3b618b5de71fc41644a180b9e7 \
  --out <owned-snapshot-directory>
```

Review the new bytes, counts and hashes before replacing committed fixtures. Preserve the license
and attribution in the [reference README](../../packages/markdown/test/reference/README.md).
Keep the [Approved qualification plan](../../plans/chat-markdown-qualification.md) current as each
producer, consumer and promotion gate lands.

## Bounded chat candidate check

```sh
bun run markdown:check
```

This runs the candidate's development correctness cases and Chromium chat semantics,
then exercises cold production initialization, explicit oracle overrides, split preview,
and selection across streaming appends. CI selects Markdown/chat source and their shared
runtime/test inputs. The browser fixture owns its server, browser and temporary state;
set `VITEST_BROWSER_PORT` and `VITEST_BROWSER_FILE_SERVER_PORT` to free explicit ports locally.

A passing check is a development regression result, never a `VERIFIED` verdict or a promotion
receipt. It does not open evaluation batches or run timing/resource/visual promotion jobs.
The existing `markdown:qualify` command still fails without complete trusted identity-bound
receipts. Independent evaluation, the full streaming/interaction/resource/native matrix, reviewed paired
visuals and quiet-host timing
remain required before the coordinator can complete Q5 and authorize delivery.

Production `AssistantMarkdown` selects tree-sitter through its local provider after the package
initializer loads the grammar, resolver and runtime URLs. Until that succeeds it shows a loading
state, then uses the existing transforms and safe HAST renderer. An explicit
`MarkdownSessionContext` factory takes precedence, keeping the remark oracle independent.
Unscoped `Markdown`, including the file split preview, retains remark. Production remark
packages remain installed for those consumers. This branch changes source wiring only; it does
not establish qualification, deploy the change or verify the served release.

## Broad nightly checks

The Markdown workflow runs broad checks at 02:23 UTC daily and on manual dispatch. PR and main
pushes retain the bounded `markdown:check`. Nightly jobs use only committed development/reference
fixtures and deterministic generated inputs. They do not open held-out evaluation batches.

Run the same checks locally with an owned output directory:

```sh
bun run markdown:nightly parity --out <evidence>/parity
bun run markdown:nightly stream --out <evidence>/stream
bun run markdown:nightly fuzz --out <evidence>/fuzz
bun run markdown:nightly visual --browser chromium --out <evidence>/chromium
bun run markdown:nightly visual --browser webkit --out <evidence>/webkit
bun run markdown:nightly bench --out <evidence>/diagnostic-native
bun run markdown:production:smoke --build <scratch>/build --directory <scratch>/build \
  --port 5399 --out <evidence>/diagnostic-production
```

The default engine scope is paired. Correctness includes the frozen official and published reference
sets and candidate cases, plus paired browser semantics, interactions, lifetime, hard-break layout
and production-boundary checks. Streaming runs the existing exhaustive/seeded package schedules and both
engines' real chat stream probes. Fuzzing runs seeds 176–239 with 64 insert/delete/undo operations per
seed, in completed and live modes. Each incremental projection must equal a fresh projection, and
candidate output must equal remark. Arbitrary UTF-16 edits are an adversarial API profile, separate
from the transport-decoder streaming tests. `seeded-fuzz.json` preserves the seed and operation prefix
through the first failure, with declared, executed and unexecuted revision counts. Further source/delimiter reduction remains an explicit gate.

Visual jobs run both engines separately on Chromium and WebKit, retaining calibrated paired rasters,
overlays, content assertions and the existing 128-state denominator on each browser. Automated raster
success does not replace human review, frame-transition qualification or real iOS interaction checks.

The diagnostic native job runs paired quick native trials and development-browser benchmark families.
Production smoke builds the real production probe, runs two independent pairs on its small stream
fixture with one warmup and negative controls, and retains traces and raw reports. It is not the full
production workload matrix. Both jobs preserve performance failures as nonzero exits. Shared CI-host
timings are diagnostic; no job runs the final twenty-pair qualification or creates promotion receipts.
Only the final frozen candidate on an identified quiet host can qualify timing.

`markdown:nightly` uses `--checks-only`. Its `qualification.json` has `reportScope: "checks-only"`
and a separate `checkExecution` status/exit code. Missing candidates, failed suites, absent reports
and partial or zero executed cases fail. Assertion rows and the declared-minus-accounted
difference preserve pending denominators after bail; the original test JSON stays unchanged. Baseline-only, inspection and promotion/evaluation evidence arguments
are rejected in this mode. Check success leaves the promotion verdict `NOT VERIFIED`; it cannot
set the candidate to verified. `markdown:qualify` retains its default requirement for all fourteen
trusted identity-bound gates. Frozen budgets and held-out batches are unchanged.

Jobs have bounded wall times, at most two concurrent correctness jobs, two Vitest workers, explicit
loopback ports and private temporary roots. Existing fixture helpers own browser/server/session
teardown. Shell traps remove task builds and temporary profiles on success, failure and signals;
the timeout sends TERM then kills the owned process group after 30 seconds. Always-run artifacts
retain logs, JSON, raster images and failure replays for fourteen days. A cancelled hosted runner
removes its remaining processes when the job ends. Setup failures remain failed jobs, even if no
suite artifact could be produced.
