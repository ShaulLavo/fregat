# Run Markdown qualification

Install the checkout's dependencies and build its workspace libraries:

```sh
bun install --frozen-lockfile
bun run build:workspaces
```

Run each suite with an evidence directory you own:

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
a visual comparison. Repeated-capture variance above 0.1% fails calibration. Paired comparisons require
both engines' captures and their content assertions.

Run all current checks and obtain the cutover verdict:

```sh
bun run markdown:qualify --out <evidence>/qualification
```

The current verdict is `NOT VERIFIED` and this command exits nonzero without complete trusted
receipts. The candidate adapter and evidence readers exist. Final identity-bound captures, independent
evaluation, reviewed visuals, and passing timing/resource budgets remain required. Baseline commands exit successfully when their test runners and output controls pass,
while preserving independently recorded baseline defects in `baseline-checks.json`.

## Native resource observations and independent checks

Both `correctness.resources` and measured `receipt.resources` are required arrays. Each row
contains exactly `name`, `kind`, `initiatorType`, `startTime`, `duration`, `transferSize`, and
`decodedBodySize`. Empty arrays remain valid. All numeric fields must be finite. `startTime`
and both byte fields remain nonnegative.

Native `duration` accepts finite signed numbers. The collector, callback, and writer retain every
original number, row, duplicate, and row order. The writer validates the original wire record
before serializing it. Reconciliation binds the original JSONL bytes, length, count, and EOF,
and compares each final resource array with its own oracle summary. Separate measured and
oracle runs may have different resource arrays.

`resourceTimingView` derives duration usability locally. A negative native duration is unusable
and has no `durationMs`. A nonnegative duration is usable with the identical value. Serialized
classification fields are rejected. Duration-dependent calculations require the usable view.

Independent eligibility allows otherwise complete evidence to pass its checks while retaining
unusable native durations. A negative observation alone adds no blocking finding or metric
exclusion. Every required clock, CPU, network, identity, and memory receipt remains required,
and paired comparisons retain their required denominators. All latency and memory budgets,
including native total-heap windows, remain unchanged.

Synthetic tests establish this contract only. They provide no native qualification and do not
repair or authorize historical evidence.

## Finish Q5 from a frozen candidate

Run development checks while disjoint writers work. Final captures require the coordinator's clean,
committed source freeze. Run each command through the execution host's shared queue with a two-hour
outer deadline and teardown. Keep evidence outside the checkout. Stop at failed suites or controls.

### Check the fourteen trusted gates

Every row needs matching evidence for the final candidate. The registry is `PROMOTION_GATES` in
`scripts/markdown/promotion.ts`. Current matrices contain 75 native cells and 86 production cells.

| Gate                            | Required evidence                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `candidate-capabilities`        | Eight capability probes and actual base grammar, CHAT grammar, and resolver bytes.                                 |
| `native-development-semantics`  | At least 652 CommonMark, 672 GFM, and 102 owned cases with raw assertions.                                         |
| `browser-development-semantics` | At least 102 real-component cases per engine.                                                                      |
| `native-heldout-semantics`      | Complete fresh 100-message batch, frozen candidate, and original stream denominators.                              |
| `browser-heldout-semantics`     | Same batch and schedules through the frozen build, attached to the native receipt.                                 |
| `streaming-correctness`         | 56 package and 32 browser cases per engine, with revision and completion receipts.                                 |
| `interactions`                  | Exact `FROZEN_SCENARIOS.interactions` names per engine, including selection, copy, and activation.                 |
| `safety`                        | Exact `FROZEN_SCENARIOS.safety` names per engine, including delayed-stage isolation.                               |
| `visual-states`                 | 128 calibrated paired states, actual images and overlays, and changed-image review. Include WebKit.                |
| `frame-probes`                  | All 32 named stories per engine, actual frame logs, zero flashes or settled-color drops.                           |
| `resources`                     | Browser 20/100/500-cycle windows and unmount assertions, repeated native windows, and actual native assets.        |
| `benchmark-coverage`            | All 86 production cells across nine families, with every required field measured.                                  |
| `native-paired`                 | All 75 cells, 20 independent pairs, three warmups, raw samples, invocation, and source/host records.               |
| `production-timing`             | All 86 cells, 20 independent pairs, three warmups, headed Mac Chromium, and raw oracle/CPU/paint/transfer records. |

### Prepare without opening sources

Run the metadata-only command before dispatching selection:

```sh
bun scripts/markdown/prepare-evaluation.ts --asset <pinned-archive> --license <license> \
    --out <new-receipt.json>
```

It hashes the compressed archive, checks the committed license and custody inventory, and counts
built-in development exclusions. It reads no evaluation payload and creates no selection or ledger.
Missing freeze or exclusions inputs produce `awaiting-inputs`; eligible capacity remains `null`.
Output files use exclusive creation. Add `--exclude-manifest <exclusions.json>` and
`--freeze-manifest <freeze.json>` to validate the metadata before the actual selection command.
`metadata-validated` means the supplied metadata passes the existing custody checks. It does not
establish historical exclusion completeness, unchanged candidate code, or 100 eligible messages.
Only the authorized selector measures capacity, after the coordinator supplies both final inputs.

Use a curator for selection and registration, then a separate evaluator with the frozen checkout
and build for native and browser capture. Keep selected payloads and `browser-input.json` away from
candidate developers until that evaluation ends. The ledger serializes exposure transitions; it
cannot establish that two operator names represent independent people or agent contexts. Record
that separation in the dispatch and retain every failed opening. Any informed fix retires the whole
batch. Do not treat preparation controls as qualification evidence.

### Register a prospective batch

Batches 001 through 003 have unknown historical exposure. `custody.json` permanently classifies
all 300 sources as `legacy-unknown`, with `eligible: false`. Keep those records and the original
manifest entries unchanged. The evaluator checks the sibling custody inventory before reserving
an opening and when trusting native or browser receipts.

After tuning and tooling review finish, record the parser freeze and close the development
exclusion inventory. Selection is automated curation access; it makes no claim about earlier
archive access. Supply these JSON inputs using actual UTC timestamps:

- `exclusions.json`: `schemaVersion: 1`, `complete: true`, `recordedAt`, and `groups`.
  Each group has `name` and `sourceSha256`, containing hashes of exact input strings.
  Include every group in `EXCLUSION_GROUPS`: `commonmark`, `gfm`, `chat`, `owned-cases`,
  `repositories`, `regressions`, `messages`, `stories`, and `workloads`.
  The selector verifies the five built-in sets and automatically excludes every prior batch.
  The curator owns collection of all subsequent regression, message, story, and workload inputs.
  `complete: true` declares a complete exact-hash collection. The tool cannot discover omitted historical inputs.
  Keep a partial collection at `complete: false` and supply `conservativeCoverage` with
  `reviewEvidenceSha256` and `unresolvedSources`. The review evidence must account for each known
  historical source through exact hashes or a proved conservative family. Selection and registration
  refuse any unresolved source. An empty list is a reviewed curator assertion, not automatic discovery.
  Metadata preparation reports unresolved sources without decoding. Never close a missing recipe merely
  because a later recipe, new execution receipt, or synthetic control passes.
- The committed `development-exclusion-policy.json` rejects five pinned generator families using exact
  prefix and suffix text around an arbitrary runtime string. Its immutable recipe provenance covers
  two file-link paths, both source-image user-ID variants, and the final warmup image recipe.
  False-positive exclusion is allowed. Every possible output of a covered generator must be rejected.
  Earlier warmup remote/data controls remain unresolved until their own recipes are covered.
  Keep unrelated missing historical inputs open. These five families do not establish global completeness.
- `freeze.json`: `developmentPolicySha256`, `curator`, `custodyStartedAt`, the canonical absolute `ledgerDirectory`, and
  `parserFreeze` with `commit`, `sourceSha256`, `artifactsSha256`, and `frozenAt`.
  Copy `developmentPolicySha256` from the preparation receipt. It binds the exact matcher bytes and
  canonical rules, including immutable source-recipe provenance. Registration and downstream evaluation
  require the same policy. Use the preselection candidate fingerprint. Hash its `artifacts` object as two-space JSON plus
  a trailing newline. The evaluator enforces that artifact digest. Verify the parser source remains
  unchanged when committing registration metadata. Record freeze, custody start, exclusion completion,
  and selection in that order. Preserve the authoritative ledger throughout later openings.

Run the prospective selector into an absent destination owned by this task:

```sh
bun scripts/markdown/snapshot-evaluation.ts --asset <pinned-archive> --license <license> \
    --expected-asset-sha256 <archive-sha256> --exclude-manifest <exclusions.json> \
    --freeze-manifest <freeze.json> --first-batch 4 --batches 1 --out <new-directory>
```

The command verifies the pinned archive and committed license before decoding. It keeps the fixed
ordering and filters and requires 100 eligible unique sources per batch. Duplicate sources keep
the attributable message with the lowest seeded priority, independently of archive row order.
Existing output paths, used batch names, duplicate message IDs, and insufficient capacity fail. It writes new assets,
appendable `manifest.json` and `custody.json`, the byte-exact `previous-manifest.json`, license,
and `selection.json` with eligibility, invocation, actual times, selector identity, and canonical
exclusions digest. The runtime policy filters sources before selection and ranking. Downstream evaluation
checks the decoded, digest-bound whole batch against both the exact hashes and runtime families after
reserving exposure, and repeats that check before trusting receipts. It presents counts without message previews and imports no candidate parser.

Preserve the previous manifest as historical evidence. Integrate only the new assets and appended
metadata, then commit before the final fingerprint and production build. Freeze the inventory
thereafter. Registration changes the source closure, so earlier captures need fresh identities.
An informed fix retires the whole batch and requires another complete selection. Never reset or
relocate its authoritative ledger to reopen it. Preserve failed receipts and all original denominators.
Ledger reservations, completion, attachment, and retirement serialize through an exclusive per-batch
lock. Completion and attachment compare the current ledger with their captured state before atomic
replacement. Retirement is terminal and keeps its first reason; original receipts remain on disk
when a later transition fails. A lock left by interruption fails closed. Preserve its ledger, receipt,
and pending-update bytes, establish that its writer has stopped, and record recovery before removing
that lock. Never remove an active writer's lock or reset an exposure to recover a failed capture.

### Capture in order

Set `E` to an owned evidence directory, `BUILD` to an owned production-build directory, and `PORT`
to a verified free loopback port. Set `LEDGER` to the coordinator's authoritative exposure ledger.
Select `BATCH` from that ledger. A manifest's `sealed` label alone does not establish independence.
Never initialize a new ledger to reuse exposed messages.

1. Check tooling now. Inspection exits 1 with `NOT VERIFIED` and executes no suites.

   ```sh
   bun --bun vitest run --config vitest.scripts.config.mjs --cache=false --maxWorkers=2 scripts/markdown
   bun x tsc --noEmit -p scripts/tsconfig.json --incremental false
   bun scripts/markdown/qualify.ts qualify --inspect-only --out "$E/inspection"
   ```

2. After the source freeze, run the smallest browser capture. Its two-pair timings are diagnostic.
   An oracle mismatch blocks the larger matrix. Preserve raw reports, traces, and cleanup records.

   ```sh
   test -z "$(git status --porcelain=v1 --untracked-files=all)"
   bun scripts/markdown/production-browser.ts --build "$BUILD" --directory "$BUILD" \
       --port "$PORT" --out "$E/smoke" --smoke --trials 2 --warmups 1 --negative-controls
   ```

3. Capture development correctness, visuals, resources, and timing. `qualify` remains nonzero until
   trusted receipts pass. Run timing on an identified quiet host. Set `HOST_EVIDENCE` to actual host
   observations. The production promotion collector requires macOS.

   ```sh
   bun scripts/markdown/qualify.ts qualify --out "$E/qualification"
   bun scripts/markdown/qualify.ts visual --browser webkit --out "$E/webkit"
   bun scripts/markdown/native-resources.ts --windows 4 --out "$E/native-resources"
   ```

   Capture native and production timing through the [bounded capture sequence](bounded-captures.md).
   It retains all 75 native and 86 browser cells, 20 measured pairs, three counted warmups, actual
   per-launch identity, and the exact 160-state promotion raster selection.

   Preserve full source closure, native invocation, WASM/lockfile/budget bytes, build files, browser
   arguments, and fonts. Host observations must cover before/during/after with gaps of at most five
   seconds. Collectors do not create every reconciliation sidecar. Missing records remain blockers.

4. After all tuning stops, evaluate the selected complete batch. Any fix informed by that batch
   retires the entire batch. Preserve its original failures before selecting another batch.

   ```sh
   test -z "$(git status --porcelain=v1 --untracked-files=all)"
   SHA=$(git rev-parse HEAD)
   bun scripts/markdown/evaluate-heldout.ts --fingerprint > "$E/candidate.json"
   bun scripts/markdown/evaluate-heldout.ts --candidate-commit "$SHA" \
       --artifact-manifest "$E/candidate.json" --batch "$BATCH" --ledger "$LEDGER" --out "$E/heldout"
   bun scripts/markdown/evaluate-heldout-browser.ts --input "$E/heldout/browser-input.json" \
       --build "$BUILD" --port "$PORT" --out "$E/heldout/browser-receipt.json"
   BUILD_SHA=$(bun -e 'console.log((await Bun.file(process.argv[1]).json()).productionBuildSha256)' "$E/heldout/browser-receipt.json")
   bun scripts/markdown/evaluate-heldout.ts --candidate-commit "$SHA" \
       --native-receipt "$E/heldout/heldout-native.json" --ledger "$LEDGER" \
       --attach-browser "$E/heldout/browser-receipt.json" --production-build-sha256 "$BUILD_SHA" \
       --out "$E/heldout/heldout-complete.json"
   ```

5. Populate `PromotionEvidenceAssemblyManifest` from actual captures. Include qualification, held-out,
   native, production, paired-raster, and native-resource reports, raw assertions, frame logs, artifacts,
   frozen provenance, fonts, and both timing manifests. Bind `trustedContext` to the clean checkout,
   completed evaluation receipt, and authoritative ledger. Keep artifact paths inside the evidence root.

   ```sh
   bun scripts/markdown/production-reconciliation.ts --manifest "$E/native-timing-manifest.json" --out "$E/native-reconciled.json"
   bun scripts/markdown/production-reconciliation.ts --manifest "$E/production-timing-manifest.json" --out "$E/production-reconciled.json"
   bun scripts/markdown/promotion-evidence.ts --manifest "$E/assembly.json" --out "$E/promotion.json" --report "$E/assembly-report.json"
   bun scripts/markdown/promotion.ts --input "$E/promotion.json" --root "$PWD" \
       --evaluation-receipt "$E/heldout/heldout-complete.json" --evaluation-ledger "$LEDGER" --out "$E/verdict.json"
   ```

Reuse evidence only when the clean commit, full source closure, lockfile, both grammars,
resolver/runtime/bindings, budgets, workloads, and unretired evaluation identity match. Rehash actual
raw files and captured assets. Preserve original counts, failed/skipped rows, warmups, capture bindings,
host/font/build records, and cleanup receipts. Dirty captures, summaries alone, missing bytes, and
synthetic fixtures cannot qualify. All fourteen gates and the plan's frozen budgets must pass.
The coordinator owns real iOS coverage, release verification, review, commits, and delivery.

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
initializer loads the base grammar, CHAT grammar, resolver and host runtime URLs. Until that succeeds it shows a loading
state, then uses the existing transforms and safe HAST renderer. An explicit
`MarkdownSessionContext` factory takes precedence, keeping the remark oracle independent.
Unscoped `Markdown`, including the file split preview, retains remark. Production remark
packages remain installed for those consumers. This branch changes source wiring only; it does
not establish qualification, deploy the change or verify the served release.

Qualification identities bind the base grammar as `grammarSha256` and CHAT independently as
`chatGrammarSha256`, alongside `resolverSha256` and the existing runtime, binding and source
hashes. Both grammar files must be captured and verified against their actual bytes. CHAT uses
the candidate artifact role `chatGrammar` and source-capture key `files.chatGrammar`. Missing or
malformed CHAT identities reject old receipts without changing their schema-version envelopes.

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
