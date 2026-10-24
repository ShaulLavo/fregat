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
