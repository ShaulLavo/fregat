# Paired native input latency

Plan 282 implements the paired replacement for Plan 099 units 2–7. The follow-up uses fixed historical budgets and temporarily excludes the known minimap undo source failure from acceptance, as directed by the owner. Validation and complete-matrix timing are in progress; those units remain gated and still require owner authorization. The runner compares two frozen Editor package sets in one Chromium session. It alternates the sides within each repetition and records the randomized order of every pair.

## Run the comparison

From the Platform root, run:

```sh
export PATH=$HOME/.local/share/mise/shims:$PATH
bash /work/tmp/wave-heavy/run.sh p282-candidate -- env PATH="$PATH" \
  bun run bench:input:paired --baseline /work/tmp/plan-282/baseline \
  --candidate /work/tmp/plan-282/candidate
```

The default matrix includes `platform` and every consuming configuration inferred from changed package source or build hashes. Core or text-buffer changes select all ten configurations; Tree-sitter, minimap, and find changes include every composition that enables that consumer. Package removal also participates in inference. `--configurations tree-sitter,minimap` declares affected configurations explicitly. `--full` runs all ten configurations. `--only native,disabled` selects a focused diagnostic matrix and does not establish Platform acceptance.

Freeze matching `src`, `dist`, manifests, and external dependencies with `editor/examples/stress/package-set.mjs`. The [stress README](../../editor/examples/stress/README.md#input-latency-budgets) describes package freezing. The runner verifies source and build hashes, external receipts, and the bundled page and worker graph before collecting input.

## Verdict

Each configuration has 36 fixture, view, and scenario groups. Each group reports three blocking measures and one advisory screenshot-duration measure. The runner preserves the native-event capture boundaries, text and revision checks, changed pixels, consumer worker proofs, and context cleanup from PR #224.

For each repetition, the statistic is candidate p95 minus baseline p95. The reported difference is the median of these paired differences. A deterministic percentile bootstrap resamples whole repetitions 10,000 times and reports a 95% confidence interval. Input operations within one repetition remain together.

A blocking measure fails when its median paired difference exceeds its fixed budget and the confidence interval is entirely positive. `input-budgets.json` declares the exact `noiseMarginMs` values frozen by the accepted historical native, disabled, Tree-sitter, Shiki, and minimap calibrations. Baseline variability cannot widen these budgets. Each metric records its reference configuration, calibration artifact, SHA-256, and historical instrument hash. No controls, holdouts, or recalibration run before a comparison.

The five combined and Platform configurations have no accepted historical calibration. They explicitly inherit all 144 frozen native budgets. Their full-matrix results establish new coverage under that declared reference; they cannot establish historical acceptance agreement. Incomplete or unadmitted archived calibrations are not used to fill missing keys. An unknown configuration or measure fails before interpretation.

Every report contains the raw baseline and candidate samples, paired differences, fixed budgets, confidence intervals, and schedule. Advisory timing never fails acceptance. Correctness checks remain required, subject only to the explicit pending-minimap exception below.

The paired path waits for actual consumer source and render receipts outside the captured input intervals. Undo priming also waits for the seeded worker source before input starts. A fixed 450 ms seed delay left a parse pending on the supported short-lines fixture; both frozen products then exposed a stale source on the final undo. The isolated Tree-sitter probe and its complete quiet comparison pass with seeded-source readiness, with the product bytes unchanged. The inherited absolute runner retains its original fixed waits.

The default maximum is three measured pairs after one warmup pair. After two measured pairs, a group stops only when both paired p95 differences for every blocking measure lie within ± its frozen budget, and their two-point interval span is no larger than that budget. Otherwise it collects the third pair. Advisory screenshot timing does not affect stopping. The comparator revalidates every declared two-pair stop against the raw samples. Sensitivity and delayed candidates use this same rule.

Two- and three-pair bootstraps are coarse. The reported 95% intervals are nominal descriptive repetition-cluster intervals. Conditional early stopping has no adjusted sequential 95% coverage guarantee, and passing does not establish statistical equivalence. `--fixed-repetitions` disables stopping; requesting more than three repetitions also uses fixed sampling. More independent pairs improve resolution near a budget.

Each configuration retains two warm package pages in one Chromium browser. Every group runs one unrecorded warmup on its actual measured fixture. Between bursts, the Editor's public operations restore exact text, cursor, history and hidden-view state. `attachSession` swaps fixture buffers while retaining Editors and consumer owners. Native Tree-sitter remains enabled only on ordinary code. Initial setup, subsequent fixture attachment, reset and settlement durations are recorded outside the input intervals. Final configuration cleanup checks all released buffers and retained Editors; page contexts close after the configuration.

One initial ordinary-code lifecycle warms Playwright's two execution worlds and page-scoped worker owners. Its raw bootstrap receipt must show zero retained Editors/buffers, hosts, frames and tracked workers. The final listener count cannot exceed this disposed initialization receipt's count. A known-good probe observed 13 listeners before locator initialization, 26 afterward, and 28 after the first native Editor disposal. The second disposal stayed at 28. CDP identified the remaining two as Worker message/error listeners. No numerical listener allowance is added.

## Sensitivity and fixtures

The first run of a measurement instrument collects two named native candidate/candidate controls. A 20 ms pause before Editor handling must reject all 72 input-stage keys. A separate 20 ms pause inside each rAF callback must reject 35 frame-stage keys. Native `ordinary/multiple/repeat/inputToFrame` keeps its frozen 15.2 ms budget and records a separate detection-floor proof: test 25 ms, then 30 ms only if needed, and stop at the first rejection. A failure at 30 ms blocks the cache. Both full raw comparisons are stored under `/work/tmp/plan-282/sensitivity/<measurement-hash>.json.gz`. Later runs recompute both verdicts. All captured intervals remain blocking with their original budgets.

The instrument has two identities. The **measurement hash** covers every source except the two explicitly validation-only modules, plus external dependency bytes, Chromium version and runner version. It includes capture/marks/injection, sampling/order/stopping, bootstrap/statistics, budgets, fixtures/operations, consumer policy, readiness fences, worker interception and browser/runner launch. Unknown files belong to measurement. The **validation hash** covers `input-output.mjs` and `src/input-output.ts`: output/source correctness predicates and their post-interval receipt readers. A combined instrument hash records both identities in raw runs.

Schema-4 sensitivity caches key only on measurement identity and record the validation identity their controls used. A validation-only edit preserves those controls, with their original provenance; each configuration whose predicate changed reruns its positive and historical acceptance under the new validation identity. Tests change both assertion modules and prove reuse, then change capture, math, budgets, workload, launch and unknown sources and prove invalidation. The initial split changes mixed-purpose measurement files, so it requires fresh controls. A byte-by-byte transfer audit lists each original/current measurement-file hash and refuses transfer on any difference; the old schema-3 cache and quiet receipts stay archived under their original instrument.

Default fixtures are ordinary TypeScript, 500,000 short comment lines, and a one-megabyte line. Each fits Platform's 10 Mi UTF-16 analysis tier. `--stress` restores the original generated 500,000 declaration lines above that tier. Custom frozen fixtures above the tier require `--stress`. CPU affinity is optional. The heavy-job wrapper controls resource admission.

## Historical reference

PR [#224](https://github.com/ShaulLavo/fregat/pull/224) accepted five configurations at source revision `56c8e77fb216232116c5acc714bd697d26633bb2`. Their accepted calibration artifacts record instrument hash `b0feb67fd9ed6a23ed31cdf3da9dee8c812fce28de42e34e58be3624e79b8c82`. Its accepted candidates passed all 108 blocking groups. Each delayed negative failed 47 blocking groups, including all 36 dispatch groups. `tree-sitter-shiki` failed its independent holdout. Four other configurations were unrun. That record does not establish full-matrix acceptance.

The frozen products are `packages-{baseline,candidate}-x3` for native, disabled, Tree-sitter, and minimap. Shiki uses `packages-{baseline,candidate}-prereq-213-215-x3`, with identical historical worker-teardown and Shiki line-limit prerequisites on both sides. Their external receipt is `a71e25fffb81a474bf8eb5434213af2def69582fce1fa4ffeae9d71cdb0ab893`.

The original non-prerequisite package receipts resolve internal links through removed historical worktrees. Validation copies their unchanged product bytes to `/work/tmp/plan-282/` and relocates those links. External payloads come from the surviving prerequisite worktrees, with the same recorded external hash. The archived package sets are untouched.

Historical raw results, receipts, method snapshots, and stopped attempts remain under `/work/tmp/fregat-evidence/foundations-documents/native-input/` and `/work/tmp/foundations-documents-calibration/`. The accepted matrix is `/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/`. The old delayed-check files supply the exact 47 failed keys used for agreement checks.

### Historical limits and product prerequisites

The combined Tree-sitter/Shiki holdout missed one blocking key, `ordinary/multiple/undo/inputToApplied`: 2.7 ms against a 2.3 ms limit. The saved [causal report](/work/reports/foundations-wave-2026-09-30/calibration-ts-shiki-holdout-causal.md) attributes diagnostic gaps to rendering and occasional major GC; the specific queued holdout inputs were not reproduced under tracing. The planned phase sweep was never run.

Shiki’s historical long-line and busy-worker-disposal failures led to [#213](https://github.com/ShaulLavo/fregat/pull/213) and [#215](https://github.com/ShaulLavo/fregat/pull/215). The accepted Shiki package sets include the same prerequisite patches on both sides. The archived over-tier Tree-sitter undo finding and highlight-query range failure do not establish unpaused analysis performance or resolve those findings. The [wave handoff](/work/reports/foundations-wave-2026-09-30/handoff.md) retains their disposition.

Headless Chromium frame timing is an observable, not physical display latency. Worker/WASM memory and language-server performance are outside this instrument. The new supported-tier short-lines fixture activates analysis that the old over-tier fixture paused, so verdict agreement is not byte-identical-workload equivalence.

## Follow-up validation

Archived warm evidence for instrument `5929738e…` is under `/work/tmp/plan-282/run-20261001T153544Z-sol/floor-controls/`. New split-identity runs use `../split-controls/`. The frozen products and all budgets are unchanged. The owner selected separate controls for the input and frame stages on 2026-10-01. All 108 measures remain blocking.

### Stage sensitivity

The input control pauses once for 20 ms in native event capture, before Editor handling. Every `inputToApplied` and `dispatch` key must reject it, 72 keys in total. The separate frame control pauses once for 20 ms inside each existing rAF callback before its frame mark. Every frame key except native `ordinary/multiple/repeat/inputToFrame` must reject it. That key retains its frozen 15.2 ms budget and must reject a separate 25 ms control, or 30 ms if 25 ms does not reject. Both attempts are preserved when needed; the first rejecting delay is recorded as its measured detection floor. Both controls and the detection-floor attempts compare the same candidate bytes against themselves. Their raw samples are cached together under the measurement/dependency hash; every reuse recomputes both verdicts and verifies the stage's delay values and matching product bytes.

The first real warm frame control rejected 35/36 keys. Native `ordinary/multiple/repeat/inputToFrame` measured paired differences `[10.3, 14.5]` ms, median 12.4 ms, against its frozen 15.2 ms budget, with a positive `[10.3, 14.5]` ms interval. Its baseline p95 was `[15.0, 14.1]` ms and candidate p95 `[25.3, 28.6]` ms. The 20 ms callback pause shifts input/frame phase; it does not add 20 ms to this p95 difference. The owner authorized a separately recorded 25/30 ms detection-floor proof for this single native key. This changes sensitivity coverage only: the key remains blocking at 15.2 ms in every ordinary comparison. The first control's raw input evidence rejected all 72 synchronous keys. Both raw controls and the terminal log are preserved in `../stage-controls/initial-20ms-a401d944/`. Archived pre-split instrument `5929738efe629176f88be167890f27f88977b4c6ce3bf3d6e518df3f93264f05` now has a raw-verified schema-3 cache. The input control rejected 72/72 keys in 140.418 seconds; the frame control rejected 36/36 in 135.122 seconds. The separate 25 ms floor attempt rejected the named key, with paired differences `[41.8, 113.8, 64.5]` ms, median 64.5 ms, and interval `[41.8, 113.8]` ms. Its budget remains 15.2 ms. That attempt took 149.115 seconds; 30 ms was skipped because the first attempt rejected. Raw control collection totals 424.655 seconds, paid once for this instrument.

Its cached detection-floor statement is: **rejects frame-stage delays ≥25 ms; a 20 ms frame-callback pause measured ~12.4 ms in the initial missed-key run because it shifted input/frame phase.** This is the observed bounded control floor. Callback batching also varies: the final-source 20 ms run measured a 128.6 ms median for that key, with interval `[108.6, 129.9]` ms. Both outcomes are preserved; a callback pause can amplify through queued callbacks as well as change phase. The warm lifecycle and frame instrumentation are unchanged between these runs. The cache recomputes all raw controls and admits only this native key’s separate floor. All other keys retain their 20 ms requirement. The named floor key is outside the historical 47-key negative set, so every historical key still requires direct 20 ms rejection.

An input-handler delay reaches warm frame timing only partially because of refresh quantization. The prior post-applied control's three-pair warm probe rejected 46/47 historical keys. The missed multi-view short-lines preedit frame effect was 9.3 ms against a 9.4 ms budget, with a positive `[8.8, 10.3]` ms interval. The corresponding cold negative carried a 50.1 ms median effect from a larger frame backlog. A fixed five-pair probe rejected 47/47 in 209.264 seconds, but is preserved as a diagnostic rather than adopted as the fix. Its unchanged native comparison passed in 136.579 seconds. The input pause now precedes the applied mark, so it also exercises the 30 applied keys that the old post-applied pause could not test. Each stage is proven against a real delay in that stage; the frame control is explicitly separate from the input control.

`--slowdown-ms 20` selects an input-stage diagnostic. `--frame-slowdown-ms 20` selects a frame-stage diagnostic. The controls cannot be mixed in one comparison. Neither changes a budget or a measure's blocking status.

### Warm quiet and same-core loaded agreement

The current validation checks each historical key with the control for its stage, plus all 72 input keys and the 35 native 20 ms frame requirements. The remaining native frame key uses the separately cached detection-floor proof; other configurations still require every frame key at 20 ms. Minimap remains excluded while its historical source-correctness defect is admitted. Previous cold verdicts below apply only to their recorded instrument hashes.

| Configuration | Historical candidate / negative | Warm quiet candidate | Quiet input / frame controls                        | Warm loaded candidate | Loaded input / frame controls |
| ------------- | ------------------------------- | -------------------- | --------------------------------------------------- | --------------------- | ----------------------------- |
| native        | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Pending               | Pending                       |
| disabled      | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Pending               | Pending                       |
| tree-sitter   | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Pending               | Pending                       |
| shiki         | Pass / 47 keys                  | Pending              | Pending                                             | Pending               | Pending                       |
| minimap       | Pass / 47 keys                  | Excluded             | Diagnostic pending                                  | Excluded              | Diagnostic pending            |

The native, disabled and Tree-sitter quiet receipts in this table belong to pre-split instrument `5929738e…`. They remain archived with their original identity; the transfer audit requires byte-identical measurement files, and the initial split changes those files. New controls and remaining acceptance use the split identity.

Actual default and full warm matrix wall times remain pending. The default still includes Platform plus declared/inferred affected configurations; full still executes all ten configurations.

The quiet Tree-sitter unchanged comparison passed in 746.498 seconds, including 741.339 seconds inside the configuration. Its measured short-lines/multiple samples spent 425.123 seconds across both sides. Opening readiness consumed 225.517 seconds and final settlement 160.973 seconds; captured input and paint consumed 4.797 seconds. Reset itself took 0.441 seconds. These sums exclude warmups and fixture attachment. Frozen `syncText` already applies the minimal replacement, and source epochs remain fixed during these bursts. Three retained view sessions perform the supported-tier syntax work. Retaining owners removes construction cost, but it cannot remove source-current settlement or change the frozen syntax products.

### Shiki plain output and identity split

The first Shiki quiet positive stopped at `long-line/single/paste` before producing a timing verdict. Its one logical plain line had two mounted token ranges of the correct text colour, with current/answered worker source and no worker error. The old assertion equated plain lines with DOM ranges. Plain output now requires complete rendered-text coverage in each visible view, uniform text colour and aggregate range accounting. Plain-line counts and source receipts remain strict.

Real Chromium probes accept two fully covered chunks and reject a missing chunk, partial text coverage and ranges belonging only to another view. Contract tests also reject wrong colours and range-accounting mismatches. Frozen Shiki long-line paste passes strict opening/final checks in both single and multiple views; this isolated probe is separate from the pending complete quiet acceptance. Raw evidence is `../shiki-coverage-proof.json`. Measurement identity remains conservative: only the two extracted output modules are validation-only. Assertion-only changes keep future schema-4 controls valid; changed Shiki-bearing predicates require fresh acceptance.

### Readiness and the pending minimap reset

A controlled short-lines/multiple Shiki startup probe used unchanged prerequisite products. Four quiet starts settled in 12.580–13.714 seconds. Four same-core loaded starts settled in 31.227–31.947 seconds, with current source receipts and no page/worker errors. The 30-second readiness cap rejected valid loaded startup. Consumer settlement and awaited source polling now share a 120-second readiness-only deadline. Disposal retains its separate 30-second cap. Latency budgets are untouched. Raw progress is in `../startup-probe.json` and `../startup-progress.jsonl` relative to the current stage-control evidence directory. This establishes a valid loaded startup beyond the old cap; it does not identify the exact cause of the earlier quiet timeout.

With `--pending-minimap-source`, only an observed false final source receipt in short-lines undo triggers a document-session reload before the next burst. The reload retains Editor/consumer owners and happens outside captured input. Raw reset evidence includes the rejected receipt and reload duration. Correct final receipts automatically skip that reload. Fixture changes already attach a fresh document session. No product bytes or captured operation counts change.

## Archived cold follow-up validation

The owner directed three corrections after the first draft: freeze historical budgets, exclude minimap acceptance pending its separately owned correctness fix, and finish native/Tree-sitter/Shiki validation and default/full timing. New evidence is under `/work/tmp/plan-282/fixed-budgets/`; the initial draft evidence below is preserved.

### Quiet and same-core loaded agreement

Each historical unchanged candidate passed, and each historical negative rejected 47 blocking keys. The follow-up recomputes comparisons from raw samples and checks exact historical key membership.

| Configuration | Historical candidate / negative | Quiet candidate | Quiet historical keys rejected | Loaded candidate | Loaded historical keys rejected |
| ------------- | ------------------------------- | --------------- | ------------------------------ | ---------------- | ------------------------------- |
| native        | Pass / 47 rejected              | Pass            | 47/47                          | Pending          | Pending                         |
| disabled      | Pass / 47 rejected              | Pass            | 47/47                          | Pending          | Pending                         |
| tree-sitter   | Pass / 47 rejected              | Pass            | 47/47                          | Pending          | Pending                         |
| shiki         | Pass / 47 rejected              | Pass            | Readiness timeout; no verdict  | Pending          | Pending                         |
| minimap       | Pass / 47 rejected              | Excluded        | Excluded                       | Excluded         | Excluded                        |

Quiet Tree-sitter took 496.312 seconds unchanged and 828.079 seconds delayed. Quiet Shiki unchanged took 780.183 seconds. These focused comparisons are separate from the actual default and full timing commands.

### Pending minimap exception

Use `--pending-minimap-source` only while validating the historical products with the known undo bug. All ten configurations still run under `--full`; the standalone minimap configuration is excluded from aggregate acceptance. The sole relaxed consumer assertion is final source equality after `short-lines/{single,multiple}/undo`. Initial and seeded minimap source checks, worker counts, render-after-source receipts, visible output, final editor text, cursor, revisions, hidden-view reveal, and cleanup remain required. The exception and raw false source receipts are stored in the results. Platform and combined configurations retain their real minimap runtime cost. The products are unchanged, and minimap acceptance remains pending the separately owned fix.

### Cost evidence and receipt reuse

An isolated unchanged-product short-lines undo probe measured 3.8–4.4 seconds per sample. Input and paint took approximately 125 ms; opening consumers took 1.2–1.7 seconds, priming and its screenshot approximately 1.5 seconds, and final consumer settlement approximately 956–967 ms. Memory and cleanup took approximately 112–116 ms. The initial evidence is `/work/tmp/plan-282/profile-sample.log`.

The follow-up reuses the accepted final readiness receipt for the correctness assertions, removing a second full-source replay after polling. Per-sample phase durations are saved in raw results. The first fixed-three-pair default matrix passed with the pending minimap exception, but took 1,659.575 seconds (27 min 39.575 s), including 1,514.827 seconds for Platform. Sensitivity was cached. Multi-view short-lines samples spent about 13 seconds opening consumers and another 4–6 seconds settling them. Native input and paint took about 0.1–0.27 seconds. Repeated cold consumer setup and supported-tier analysis dominate the cost.

The bounded reduction above collects two pairs only for tightly within-budget groups and substitutes ordinary-fixture warmups. All measured fixtures, gating groups, advisory screenshot timing, pixel checks, source proofs, and per-sample cleanup remain. No product, worker pool, or owner lifecycle is changed. This trades independent pair count and large-fixture warmup coverage for less repeated cold setup.

The reduced-cost instrument `47f66e236f526a5de47909bea5ed76656926f5cadefea0b1bb1354a83b212008` passed its real sensitivity check in 191.758 seconds. It rejected all 47 historical native negative keys; all 36 delayed groups collected three pairs. Quiet unchanged native and disabled pass, with 36/36 groups each stopping after two pairs. Both quiet negatives also reject 47/47 historical keys, with three pairs in every delayed group. Tree-sitter/Shiki quiet and loaded validation, native/disabled loaded validation, and the full-matrix time are still being collected.

The completed reduced-cost default passed in 1,053.647 seconds (17 min 33.647 s), including 935.209 seconds for Platform and 114.424 seconds for native, with cached sensitivity. Platform used two pairs in 33 groups and three pairs in three groups; native used two pairs in 35 groups and three pairs in one group. The 36.5% reduction from the fixed-three-pair default does not meet the 15-minute target. All measured groups gate, and repeated cold supported-tier consumer setup remains the dominant cost; no gating group or lifecycle proof was removed to reach the target.

An earlier reduced-cost default attempt was terminated before completion. The system journal records a client-requested SIGKILL at 17:09:36 on 2026-10-01, with a 6.1 GiB memory peak under an 8 GiB ceiling. The exact caller is unconfirmed. Its logs are in `fixed-budgets/adaptive-interrupted/` and its journal receipt in `fixed-budgets/interrupted-journal.txt`; it has no complete matrix verdict or timing. Completed native/disabled artifacts survive. Remaining collection uses the same admission wrapper's supported `--slice-root heavyp282` invocation option.

The real default command is `--configurations native --pending-minimap-source`, using the historical Shiki prerequisite products on both sides so Platform's Shiki consumer can run. The supported-tier fixture activates analysis paused in the archived over-tier case; historical agreement remains a verdict comparison, not an identical workload comparison.

## Initial draft validation

The first draft was not accepted. Results and logs are written under `/work/tmp/plan-282/`.

### Frozen minimap undo blocker

Both historical minimap products reproduce a source mismatch in `short-lines/single/undo`.
The buffer correctly restores 1,499,999 UTF-16 units and 500,000 lines. The minimap worker accepts
its final render, but its source has 500,003 line summaries. The seeded source is known-good:
one summary is replaced with `xxxxxxxxxxxx//`. The final coalesced undo publishes `startLine: 8`,
`deleteCount: 1`, and four `//` summaries, while restoring the correct text length.

The frozen renderer's `applyMinimapDocumentSummaryPatch` concatenates those four summaries
between the unchanged prefix and suffix. It performs no line-count normalization. The receipt
replay follows that same operation, so this is a product payload failure, not an asynchronous
poll or replay discrepancy. The range builder evaluates sequential edit offsets against the final
line starts; its final patch is observably inconsistent with the restored document. The frozen
products and historical evidence are unchanged. The runner retains the failing source receipt.

Raw isolated captures are `minimap-undo-{baseline,candidate}-capture.json.gz`. The complete quiet
matrix attempt stopped after 1,576 seconds (26 min 16 s), after native, disabled, and Tree-sitter
passed. It produced three per-configuration artifacts, but no complete matrix verdict. Tree-sitter
alone took 923.913 seconds (15 min 23.913 s). These are diagnostic durations, not measurements of
a completed default or full run.

### Final-instrument checks

Instrument `9ed8eb4a1f07ad6b4ffabf892b0beccfcf2a6f0460979a865b14e868c840585c`
passed its native candidate/candidate 20 ms sensitivity check in 187.111 seconds. All 36 dispatch
groups rejected; 50 blocking groups rejected in total. This self-check also rejects all 47 keys
from the historical native negative, but it uses candidate/candidate products and is not the
required historical baseline/candidate comparison.

The final-instrument quiet native and disabled candidates both pass. Their focused two-configuration
matrix took 493 seconds, including the cold sensitivity check. This is a diagnostic matrix,
not the default or full matrix. The final stress contract suite passes 276 tests across 18 files.
Stress lint retains one existing `unicorn(no-useless-spread)` warning in `src/browser.ts`.

### Historical negative disagreement

The final-instrument quiet native comparison rejects 46 of the historical negative's 47 required
keys. `ordinary/single/composition-update/inputToFrame` passes with paired differences
`[9.0, 9.5, 14.0]` ms: median 9.5 ms, bootstrap interval `[9.0, 14.0]` ms, and recomputed baseline
budget 14.1 ms. The historical noise budget was 5.9 ms. The interval establishes a positive effect,
but the widened budget admits it. The delayed run rejects 47 blocking keys in total; a matching
count does not establish matching key coverage. The disabled negative rejects all 47 required
historical keys, and 49 blocking keys in total. Both reject all 36 dispatch keys.

Retaining the old formula while recomputing its baseline inputs does not preserve every old
negative verdict. This interpretation therefore remains an acceptance failure, independently of
the minimap blocker. No budgets have been adjusted after observing this disagreement.

### Quiet and same-core-load verdicts

The old reference passes unchanged candidates and rejects 47 blocking negative keys in each of
its five accepted configurations. The table compares those keys, not just overall pass/fail or
counts of new failures. Every completed new negative rejects all 36 dispatch groups.

| Configuration | Old candidate / negative | New quiet candidate        | Quiet historical negative keys rejected | New loaded candidate                       | Loaded historical negative keys rejected |
| ------------- | ------------------------ | -------------------------- | --------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| native        | Pass / 47 rejected       | Pass                       | 46/47                                   | Pass                                       | 45/47                                    |
| disabled      | Pass / 47 rejected       | Pass                       | 47/47                                   | Pass                                       | 47/47                                    |
| tree-sitter   | Pass / 47 rejected       | Pass, prior instrument     | Unrun                                   | Unrun                                      | Unrun                                    |
| shiki         | Pass / 47 rejected       | Unrun                      | Unrun                                   | Unrun                                      | Unrun                                    |
| minimap       | Pass / 47 rejected       | Source correctness failure | Unrun                                   | Source correctness failure, isolated probe | Unrun                                    |

The Tree-sitter pass belongs to instrument
`da83c8e5b5da95ca7d5bd96d7063501436bb2a82e95568ac363b246d9fbb6d77`, before the final
matrix-inference correction. The loaded minimap diagnostic is an isolated source reproduction,
not a complete timing comparison.

Eight owned CPU-load workers were pinned one per CPU 8–15, the same affinity as Chromium and
the benchmark. Each alternated approximately 5 ms arithmetic and 5 ms sleep. Their final measured
CPU use was 48.1–48.5% each. The heavy-job reservation held all three slots. All owned workers
were stopped after collection. Raw matrices, load receipts, exact-key comparison, and isolated
minimap captures are in `/work/tmp/plan-282/final-diagnostics/`.

The loaded native negative misses both `ordinary/{single,multiple}/composition-update/inputToFrame`
keys. The single-view effect is 12.0 ms with interval `[6.3, 29.5]` ms and budget 17.7 ms. The
multiple-view effect is 14.1 ms with interval `[7.1, 33.6]` ms and budget 21.0 ms. Both intervals
are positive; both effects pass the widened budgets. The respective historical budgets were
5.9 and 6.4 ms. Overall positive-pass/negative-fail verdicts stay the same, but required historical
key agreement does not. Disabled preserves all 47 required keys under load.

### Wall times and completion limits

| Run                                | Wall time             | Scope                                               |
| ---------------------------------- | --------------------- | --------------------------------------------------- |
| Cold final sensitivity             | 187.111 s             | Native candidate/candidate self-check               |
| Quiet unchanged                    | 493 s (8 min 13 s)    | Native + disabled, including cold sensitivity       |
| Quiet 20 ms negative               | 398 s (6 min 38 s)    | Native + disabled, cached sensitivity               |
| Loaded unchanged                   | 349 s (5 min 49 s)    | Native + disabled, cached sensitivity               |
| Loaded 20 ms negative              | 437 s (7 min 17 s)    | Native + disabled, cached sensitivity               |
| Earlier four-configuration attempt | 1,576 s (26 min 16 s) | Aborted on minimap correctness; no complete verdict |
| Default matrix                     | Unmeasured            | Blocked; 15-minute target unconfirmed               |
| Full ten-configuration matrix      | Unmeasured            | Blocked; 45-minute target unconfirmed               |

The complete-matrix timing targets are not established by these focused durations. The remaining
five-configuration acceptance sequence and default/full timing runs were stopped at the known
frozen-product correctness failure and historical budget-policy disagreement. Frozen products,
fixtures, correctness checks, and budgets were not changed to manufacture acceptance. Source
contract tests and repository checks do not substitute for this acceptance gate.

Final acceptance requires unchanged candidates to pass and delayed candidates to reject all
historical failed keys on native, disabled, Tree-sitter, Shiki, and minimap, both without background
load and with load on the benchmark's CPUs. Default and full wall times include package verification
and builds. Plan 099 units 2–7 remain gated. This implementation is delivered as a draft PR and is
not an accepted replacement gate. No app UI or server code changed; deployment and app `look`
verification were skipped.
