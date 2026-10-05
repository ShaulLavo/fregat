# Paired native input latency

## Current qualification, 2026-10-05

Plan 099 units 2–7 are Approved and integrated in [PR #787](https://github.com/ShaulLavo/fregat/pull/787).
The final comparison uses untouched main `51d2a71ae`, candidate `9e773c8fa`, measurement
`b615d5ab`, and validation `e76f680d`, with equal external dependencies. Fresh input, frame,
detection-floor, and native controls pass. The quiet default passes 216 blocking comparisons
in 566.201 seconds. The complete matrix passes 972 required and 1,080 raw comparisons, with
exact replay and complete cleanup.

The full command takes 2,798.161 seconds, exceeding its 2,700-second tooling target by 98.161.
The runtime miss remains a benchmark follow-up after the owner's cost concern. It does not
invalidate the completed comparisons or require a full rerun. App-only changes use affected
app checks while unchanged SDK evidence remains valid.

A separately observed Tree-sitter/Shiki short-lines, multiple-view paste experiment preserves
the production sampler, current-source checks, and complete cleanup. In its two counterbalanced
pairs, consumer readiness falls from 10,157 and 10,090.6 ms to 1,813.7 and 1,787 ms. Actual latest
Tree-sitter requests are sent about 8,868 ms after the last input in the baseline and about
16 ms afterward in the candidate. Matching worker replies and final current output pass in
both arms. Independent review accepts this bounded cross-domain readiness improvement.

The experiment keeps its separate diagnostic identity `7e2a4be7`; it does not replace production
input acceptance. Earliest source-tagged token application and visible-paint timing remain
unavailable. No general SDK speed or total-memory improvement is claimed. The
[source and ownership proof](source-ownership-proof.md) records measured payloads and lifetime
bounds, including the baseline restart failure and higher candidate main-renderer heap.

The load smoke passes, and the loaded native/disabled default passes all 216 keys in 231.822
seconds. Thirteen selected keys across eleven groups complete ten identical-candidate runs
each in 893.648 seconds. Two selected and two auxiliary native Undo verdicts reject identical
source, compiled bytes, and dependencies on both arms. The original zero-rejection predicate
remains false, with source/output, actual CPU-affinity, and cleanup checks passing. These are
benchmark reliability findings. They remain follow-ups rather than a Plan 099 delivery blocker;
the actual changed-code comparisons keep their original budgets and passing verdicts.

App typing passes after complete summary accounting fixes early-event eviction from its bounded
trace. Scroll timing limits pass, while its 270-range cap rejects the untouched baseline and
candidate at exactly 354 matching current ranges. No detached, foreign, or duplicated ranges
occur in the matched capture. [Issue #818](https://github.com/ShaulLavo/fregat/issues/818) preserves
that invalid reference and original failure. [Issue #820](https://github.com/ShaulLavo/fregat/issues/820)
preserves the four identical-build control flags. Final app revision `b20cf82db` completes the
shared-observer refresh: all three calibrations, derived open, typing, and scroll timing pass.
Its 120 measured prepared-300 samples begin no transferable work after activation. The known
range-count failure remains red. Broader loaded matrices and repeated historical negative
matrices remain follow-ups, with no credit for uncollected results.

## Archived qualification

Plan 282 implements the paired replacement for Plan 099 units 2–7. The follow-up uses historical budgets with a declared 5 ms loaded Tree-sitter blocking floor and temporarily excludes the known minimap undo source failure from acceptance, as directed by the owner. Corrected-identity controls pass; actual default completes in 855.026 seconds and passes 215/216 blocking keys. The one Platform applied-undo rejection remains unclassified: either a real #224 large-file undo cost or noise. The coordinator approves shipping this result with that open key and follow-ups recorded; the runner's failing verdict stays unchanged. Full timing and expanded loaded proofs remain follow-ups. The owner approved units 2–7 on 2026-10-04; their latency prerequisite remains pending. The runner compares two frozen Editor package sets in one Chromium session. Every complete two-pair block runs each side first once, with reproducible randomized order per key.

## Run the comparison

From the Fregat root, run the comparison with paths to your frozen baseline and candidate package sets. Follow the execution host's resource policy for the benchmark.

```sh
bun run bench:input:paired --baseline /path/to/frozen-baseline \
  --candidate /path/to/frozen-candidate
```

Quiet default is `platform,native`; loaded default is `native,disabled`. Package hashes do not
expand either scope. Platform includes the shipping Tree-sitter/Shiki/minimap composition.
`--full` measures all ten configurations for attribution. `--configurations shiki` extends the
default explicitly; worker-backed Tree-sitter requires loaded full or focused verification.
`--only native,disabled` is focused diagnostic coverage and does not establish Platform acceptance.
`--loaded` records externally applied CPU contention; the runner starts no CPU workers.

Freeze matching `src`, `dist`, manifests, and external dependencies with `editor/examples/stress/package-set.mjs`. The [stress README](../../editor/examples/stress/README.md#input-latency-budgets) describes package freezing. The runner verifies source and build hashes, external receipts, and the bundled page and worker graph before collecting input.

## Verdict

Each configuration has 36 fixture, view, and scenario groups. Each group reports three blocking measures and one advisory screenshot-duration measure. The runner preserves the native-event capture boundaries, text and revision checks, changed pixels, consumer worker proofs, and context cleanup from PR #224.

For each repetition, the statistic is candidate p95 minus baseline p95. The reported difference is the median of these paired differences. A deterministic percentile bootstrap resamples whole repetitions 10,000 times and reports a 95% confidence interval. Input operations within one repetition remain together.

A blocking measure fails when its median paired difference exceeds its applied budget and the confidence interval is entirely positive. `input-budgets.json` declares the exact `noiseMarginMs` values frozen by the accepted historical native, disabled, Tree-sitter, Shiki, and minimap calibrations. The five loaded worker-backed Tree-sitter configurations apply `max(frozen margin, 5 ms)` to blocking keys. Quiet, advisory and other configurations retain their frozen margins. Baseline variability cannot change either rule. Each metric records its reference configuration, calibration artifact, SHA-256, and historical instrument hash. These fixed budgets require no new calibration or holdout runs.

The five combined and Platform configurations have no accepted historical calibration. They explicitly inherit all 144 frozen native budgets. Their full-matrix results establish new coverage under that declared reference; they cannot establish historical acceptance agreement. Incomplete or unadmitted archived calibrations are not used to fill missing keys. An unknown configuration or measure fails before interpretation.

Every report contains the raw baseline and candidate samples, paired differences, frozen/applied budgets and reasons, confidence intervals, and schedule. Advisory timing never fails acceptance. Correctness checks remain required, subject only to the explicit pending-minimap exception below.

The paired path waits for actual consumer source and render receipts outside the captured input intervals. Undo priming also waits for the seeded worker source before input starts. A fixed 450 ms seed delay left a parse pending on the supported short-lines fixture; both frozen products then exposed a stale source on the final undo. The isolated Tree-sitter probe and its complete quiet comparison pass with seeded-source readiness, with the product bytes unchanged. The inherited absolute runner retains its original fixed waits.

The default maximum is four measured pairs after one warmup pair. Each group has its own deterministic order, derived from its seed, fixture/view/scenario key and block index. Every consecutive two-pair block runs each side first once. Earlier groups' adaptive counts cannot change a later group's order. After the first complete block, a group stops only when both paired p95 differences for every blocking measure lie within ± its applied budget, and their two-point interval span is no larger than that budget. This strict guard also ensures the unchanged acceptance predicate passes on those two pairs. Otherwise the group completes a second block. Advisory screenshot timing does not affect stopping. The comparator revalidates every declared two-pair stop and every key-local order against the raw samples. Sensitivity and delayed candidates use this same rule.

Two- and four-pair bootstraps are coarse. The reported 95% intervals are nominal descriptive repetition-cluster intervals. Conditional early stopping has no adjusted sequential 95% coverage guarantee, and passing does not establish statistical equivalence. `--fixed-repetitions` disables stopping; requesting more than four repetitions also uses fixed sampling. Fixed sampling requires at least four pairs and complete even-sized blocks. More independent pairs improve resolution near a budget.

Each configuration retains two warm package pages in one Chromium browser. Every group runs one unrecorded warmup on its actual measured fixture. Between bursts, the Editor's public operations restore exact text, cursor, history and hidden-view state. `attachSession` swaps fixture buffers while retaining Editors and consumer owners. One document-analysis owner is shared by the independent view sessions and replaced/disposed with its buffer. Native Tree-sitter remains enabled only on ordinary code. Initial setup, subsequent fixture attachment, reset and settlement durations are recorded outside the input intervals. Final configuration cleanup checks all released buffers and retained Editors; page contexts close after the configuration.

One initial ordinary-code lifecycle warms Playwright's two execution worlds and page-scoped worker owners. Its raw bootstrap receipt must show zero retained Editors/buffers, hosts, frames and tracked workers. The final listener count cannot exceed this disposed initialization receipt's count. A known-good probe observed 13 listeners before locator initialization, 26 afterward, and 28 after the first native Editor disposal. The second disposal stayed at 28. CDP identified the remaining two as Worker message/error listeners. No numerical listener allowance is added.

## Sensitivity and fixtures

The first run of a measurement instrument collects two named native candidate/candidate controls. A 20 ms pause before Editor handling must reject all 72 input-stage keys. A separate 20 ms pause inside each rAF callback must reject 35 frame-stage keys. Native `ordinary/multiple/repeat/inputToFrame` keeps its frozen 15.2 ms budget and records a separate detection-floor proof: test 25 ms, then 30 ms only if needed, and stop at the first rejection. A failure at 30 ms blocks the cache. Both full raw comparisons are stored under `/work/tmp/plan-282/sensitivity/<measurement-hash>.json.gz`. Later runs recompute both verdicts. Every native control interval remains blocking with its original budget.

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

### Archived counterbalanced controls and reliability

Archived measurement identity is `022dcd886d279cba935eeaa2178c918738ec8859aa978ee77cf8186f84ba33f2`; validation remains `9f0b90934c620bae2d7aeeab8565d11c1adb5c74a58a3d6805f09cb1ce7dc156`. Combined instrument is `dc37728b0a8ee28472b8a811439e1d0a98f2c6b6e90cc107fcf19fd04edb34b0`. The fresh raw cache is `../counterbalanced/sensitivity/022dcd886d279cba935eeaa2178c918738ec8859aa978ee77cf8186f84ba33f2.json.gz`. Earlier controls keep their original identities.

| Wall-time receipt                                         |      Previous split policy (s) | Counterbalanced policy (s) |
| --------------------------------------------------------- | -----------------------------: | -------------------------: |
| Real 20 ms input control, 72/72 required keys             |                        143.650 |                    175.876 |
| Real 20 ms frame control, 36/36 frame keys                |                        140.254 |                    175.005 |
| Named 25 ms floor, first rejection; 30 ms skipped         |                        152.655 |                    190.975 |
| One-off control collection total                          |                        436.559 |                    541.856 |
| Native unchanged configuration, 108 passing blocking keys |                         75.055 |                     73.157 |
| First native CLI including controls/setup                 |                        519.116 |                    624.382 |
| Actual default matrix                                     | Unmeasured for the warm policy |                    Pending |
| Actual full matrix                                        |                     Unmeasured |                    Pending |

The one-off control cost rises by 105.297 seconds (24.1%). This is a measured collection-cost change. It is not a default/full matrix measurement. All 36 groups in every fresh stage control complete four pairs. The unchanged native run stops 35 groups at two pairs and completes four pairs for one group. Advisory timing remains excluded. All 334 stress tests, stress typecheck/lint and root gates pass; lint retains one inherited spread warning. Loaded reliability passes its zero-rejection gate. All nine selected keys reject zero times out of ten. All 21 blocking keys collected also have zero rejects. Forty restricted CLI runs total 666.212 seconds; 21 groups stop at two pairs and 49 complete four. The separately hashed diagnostic is `43577589069e62ee572ca9d73751df25dba50a0027e01f88b34fa444908f7e73`, with the current production identity recorded in every run. It collects or reuses no sensitivity controls and earns no full-matrix acceptance credit. All 103 load receipts show eight live same-core workers, which are stopped and awaited; the final PID check is empty. Evidence is `../counterbalanced/reliability/final-summary.json`. Ten runs per key are an empirical gate, without a family-wise error guarantee across all 108 keys. The subsequent full loaded Tree-sitter positive rejected two newly observed short-lines/single undo keys. Its negatives stopped before collection; the declared loaded-floor section below records the revised gate. Matrix timings remain pending.

| Loaded A/A selected key                          | Rejects / runs |
| ------------------------------------------------ | -------------: |
| Native ordinary/single/undo/dispatch             |         0 / 10 |
| Disabled short-lines/multiple/undo/dispatch      |         0 / 10 |
| Shiki ordinary/multiple/repeat/inputToApplied    |         0 / 10 |
| Shiki ordinary/multiple/repeat/dispatch          |         0 / 10 |
| Tree-sitter ordinary/single/undo/inputToApplied  |         0 / 10 |
| Tree-sitter ordinary/single/undo/dispatch        |         0 / 10 |
| Tree-sitter ordinary/multiple/undo/dispatch      |         0 / 10 |
| Tree-sitter long-line/single/undo/inputToApplied |         0 / 10 |
| Tree-sitter long-line/multiple/undo/dispatch     |         0 / 10 |

### Stage sensitivity

The input control pauses once for 20 ms in native event capture, before Editor handling. Every `inputToApplied` and `dispatch` key must reject it, 72 keys in total. The separate frame control pauses once for 20 ms inside each existing rAF callback before its frame mark. Every frame key except native `ordinary/multiple/repeat/inputToFrame` must reject it. That key retains its frozen 15.2 ms budget and must reject a separate 25 ms control, or 30 ms if 25 ms does not reject. Both attempts are preserved when needed; the first rejecting delay is recorded as its measured detection floor. Both controls and the detection-floor attempts compare the same candidate bytes against themselves. Their raw samples are cached together under the measurement/dependency hash; every reuse recomputes both verdicts and verifies the stage's delay values and matching product bytes.

The first real warm frame control rejected 35/36 keys. Native `ordinary/multiple/repeat/inputToFrame` measured paired differences `[10.3, 14.5]` ms, median 12.4 ms, against its frozen 15.2 ms budget, with a positive `[10.3, 14.5]` ms interval. Its baseline p95 was `[15.0, 14.1]` ms and candidate p95 `[25.3, 28.6]` ms. The 20 ms callback pause shifts input/frame phase; it does not add 20 ms to this p95 difference. The owner authorized a separately recorded 25/30 ms detection-floor proof for this single native key. This changes sensitivity coverage only: the key remains blocking at 15.2 ms in every ordinary comparison. The first control's raw input evidence rejected all 72 synchronous keys. Both raw controls and the terminal log are preserved in `../stage-controls/initial-20ms-a401d944/`. Archived pre-split instrument `5929738efe629176f88be167890f27f88977b4c6ce3bf3d6e518df3f93264f05` now has a raw-verified schema-3 cache. The input control rejected 72/72 keys in 140.418 seconds; the frame control rejected 36/36 in 135.122 seconds. The separate 25 ms floor attempt rejected the named key, with paired differences `[41.8, 113.8, 64.5]` ms, median 64.5 ms, and interval `[41.8, 113.8]` ms. Its budget remains 15.2 ms. That attempt took 149.115 seconds; 30 ms was skipped because the first attempt rejected. Raw control collection totals 424.655 seconds, paid once for this instrument.

Its cached detection-floor statement is: **rejects frame-stage delays ≥25 ms; a 20 ms frame-callback pause measured ~12.4 ms in the initial missed-key run because it shifted input/frame phase.** This is the observed bounded control floor. Callback batching also varies: the final-source 20 ms run measured a 128.6 ms median for that key, with interval `[108.6, 129.9]` ms. Both outcomes are preserved; a callback pause can amplify through queued callbacks as well as change phase. The warm lifecycle and frame instrumentation are unchanged between these runs. The cache recomputes all raw controls and admits only this native key’s separate floor. All other keys retain their 20 ms requirement. The named floor key is outside the historical 47-key negative set, so every historical key still requires direct 20 ms rejection.

An input-handler delay reaches warm frame timing only partially because of refresh quantization. The prior post-applied control's three-pair warm probe rejected 46/47 historical keys. The missed multi-view short-lines preedit frame effect was 9.3 ms against a 9.4 ms budget, with a positive `[8.8, 10.3]` ms interval. The corresponding cold negative carried a 50.1 ms median effect from a larger frame backlog. A fixed five-pair probe rejected 47/47 in 209.264 seconds, but is preserved as a diagnostic rather than adopted as the fix. Its unchanged native comparison passed in 136.579 seconds. The input pause now precedes the applied mark, so it also exercises the 30 applied keys that the old post-applied pause could not test. Each stage is proven against a real delay in that stage; the frame control is explicitly separate from the input control.

`--slowdown-ms 20` selects an input-stage diagnostic. `--frame-slowdown-ms 20` selects a frame-stage diagnostic. The controls cannot be mixed in one comparison. Neither changes a budget or a measure's blocking status.

### Archived split-identity controls

The transfer audit recomputed the original instrument exactly and listed both hashes for all 81 current measurement files. Seven changed files caused transfer refusal; external bytes matched. The old controls and quiet receipts remain untouched. The refused receipt is `../split-controls/identity-transfer-refused.json`.

Fresh controls use measurement `70f4f46ffdbbcf8519dfc0c46b636d9c998ee4a639f0277d47528a8f4c35ada6` and validation `9f0b90934c620bae2d7aeeab8565d11c1adb5c74a58a3d6805f09cb1ce7dc156`, combined instrument `59bd3d69ba35d40c610614887e841580ae2fe6293f35af18a977d0014ecdb101`.

| Fresh split run             | Verdict                                   |                                  Raw collection / CLI seconds |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------------: |
| Input-stage 20 ms           | 72/72 synchronous keys reject             |                                                       143.650 |
| Frame-stage 20 ms           | 36/36 frame keys reject                   |                                                       140.254 |
| Named native floor at 25 ms | Rejects; 30 ms skipped                    |                                                       152.655 |
| One-off controls total      | Schema-4 cache verified from raw controls |                                                       436.559 |
| Native unchanged            | All 108 blocking measures pass            | 519.116 including controls/setup; 75.055 inside configuration |

The named repeat-frame key measured a 68.4 ms median with `[48.1, 69.0]` ms interval in the fresh 20 ms frame control. Its 25 ms floor attempt measured 113.2 ms, interval `[64.4, 114.3]` ms. The exact fixed budget remains `15.200000002980232` ms. Together with the archived 12.4 ms missed-key run and later 128.6 ms run, these observations show phase/batching variability; they do not establish a stable or monotonic pause-to-p95 effect. These are focused runs, not default/full matrix wall times.

### Archived warm quiet and same-core loaded agreement

The current validation checks each historical key with the control for its stage, plus all 72 input keys and the 35 native 20 ms frame requirements. The remaining native frame key uses the separately cached detection-floor proof; other configurations still require every frame key at 20 ms. Minimap remains excluded while its historical source-correctness defect is admitted. Previous cold verdicts below apply only to their recorded instrument hashes.

| Configuration | Historical candidate / negative | Warm quiet candidate | Quiet input / frame controls                        | Warm loaded candidate                    | Loaded input / frame controls                       |
| ------------- | ------------------------------- | -------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| native        | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Pass                                     | 72/72 input; 36/36 frame; 47/47 historical at 20 ms |
| disabled      | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Pass                                     | 72/72 input; 36/36 frame; 47/47 historical at 20 ms |
| tree-sitter   | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Three undo rejections; diagnosis pending | Held while diagnosing                               |
| shiki         | Pass / 47 keys                  | Pass                 | 72/72 input; 36/36 frame; 47/47 historical at 20 ms | Pending                                  | Pending                                             |
| minimap       | Pass / 47 keys                  | Excluded             | Diagnostic pending                                  | Excluded                                 | Diagnostic pending                                  |

The native, disabled and Tree-sitter quiet historical-negative receipts in this table belong to pre-split instrument `5929738e…`. They remain archived with their original identity; the transfer audit requires byte-identical measurement files, and the initial split changes those files. Native's unchanged candidate also passes under the split identity. Shiki's complete quiet acceptance uses the split identity: unchanged passes in 142.050 CLI seconds (135.273 configuration seconds); the input negative takes 211.194 seconds and rejects 72/72 input keys plus all exact 42 historical synchronous keys; the frame negative takes 209.647 seconds and rejects 36/36 frame keys plus all exact five historical frame keys. Every historical key rejects directly at 20 ms. The raw receipt is `../split-controls/validation-quiet-shiki.json`. Loaded jobs pin the CLI/browser and eight owned workers to the same CPUs 8–15, record periodic worker liveness/CPU receipts and await worker termination in cleanup.

Loaded native preserves the unchanged verdict and all exact historical negative keys under the split identity. CLI times are 92.291 seconds unchanged, 158.865 seconds input-negative and 157.731 seconds frame-negative. All 72 input and 36 frame keys reject directly at 20 ms; its named floor was unused. Nineteen start/periodic/end receipts show all eight owned workers live throughout. Final `workersStopped` is true, and a post-run PID check found no remaining owned worker. Evidence is `../split-controls/validation-loaded-native.json`.

Loaded disabled also passes unchanged and rejects all 72 input, 36 frame and exact 47 historical keys directly at 20 ms. CLI times are 105.490 / 168.375 / 169.533 seconds. Twenty-one receipts retain eight live workers; cleanup stops and awaits every worker, and a direct PID check finds none remaining. Evidence is `../split-controls/validation-loaded-disabled.json`.

Loaded Tree-sitter rejects three blocking undo measures after 1,126.549 CLI seconds: ordinary/single applied median +1.3 ms against 0.7 ms, interval `[1.2, 1.5]`; ordinary/single dispatch +1.3 ms against 0.8 ms, interval `[0.000000015, 1.4]`; ordinary/multiple dispatch +1.3 ms against 0.8 ms, interval `[0.3, 1.4]`. Four advisory rejections do not gate. Thirty-nine receipts show eight live workers, all stopped and awaited. The positive artifact is preserved in `../split-controls/tree-sitter-warm-loaded.json.gz`; negatives and remaining configurations are held while diagnosing it. Historical quiet accepts do not establish a verdict on this same-core loaded configuration.

The failed run's measured single/undo order is candidate-first in all three pairs; multiple/undo is baseline-first, candidate-first, baseline-first. A shared RNG also makes a later key's order depend on how many pairs earlier adaptive groups collected. The owner requested a candidate-first page-creation swap, followed by baseline/baseline undo-only replay of the failed order. Both diagnostics have separate identities and explicitly exclude acceptance; they collect or reuse no sensitivity controls.

The full page-creation swap passes all 108 blocking measures in 1,149.188 CLI seconds. The three affected medians become +0.9 ms applied with `[0, 1.0]`, +0.1 ms single-view dispatch with `[-0.1, 0.3]`, and -0.4 ms multiple-view dispatch with `[-3.4, 0.7]`. Its actual single-view undo order changes to baseline-first, baseline-first, candidate-first because preceding adaptive groups consume different RNG counts. The result does not isolate creation order from pair order. Forty receipts retain eight live workers; cleanup stops and awaits every worker, and the direct PID check finds none. Measurement identity is `b1b6170bbbacaffbaa188a2a763b174fbeaa2bcb32b290767c5ffaee4129096e`. Raw comparison is `../swap-diagnostic/swap-comparison.json`.

The restricted baseline/baseline replay passes all three selected keys in 17.019 CLI seconds. With the original failed orders and three fixed pairs, its medians are +0.7 ms applied with `[-1.1, 1.3]`, +0.2 ms single-view dispatch with `[-0.1, 1.4]`, and -0.2 ms multiple-view dispatch with `[-0.4, 1.1]`. Worker cleanup is complete. Its measurement identity is `752858f9953e1aaff78c3fdbde7dfc7eeeba27abbc823a2c059d715dabec82d2`; evidence is `../aa-diagnostic/validation-loaded-aa.json`.

The alternating five-A/B, five-A/A cohort completed in 165.893 CLI seconds. It retained the failed orders, fixed budgets, three pairs and same-core load. All three A/B median ranges overlap their A/A ranges. The single-view applied medians are A/B `[-0.1, -0.6, -0.3, 0.1, -0.1]` and A/A `[-0.3, 1.2, -0.2, 0, -2.4]` ms. Single-view dispatch gives A/B `[-0.1, 0.1, -0.2, 0, -0.3]` and A/A `[-0.1, 0, -0.1, -0.1, -0.4]`; multiple-view dispatch gives A/B `[0, 1.9, 0.2, -0.3, -0.1]` and A/A `[-0.3, 0, -0.8, 0.7, -0.2]`. One A/B multiple-view dispatch run rejects at +1.9 ms with `[1.5, 2.2]`; every A/A passes. This does not demonstrate a consistent product cost. The owner classified the evidence as noise/order conditioning and approved the key-local balanced-block sampler. All owned workers stopped; the final PID check is empty. Cohort evidence is `../undo-cohort/summary.json`.

The counterbalanced measurement change invalidates the earlier controls and acceptance receipts. Fresh native controls pass under the new identity, with the costs recorded above. The additional reliability gate runs loaded A/A ten times per selected configuration, retaining the production two-or-four policy. Selection includes the three failed undo keys and every saved positive blocking difference at least 75% of its budget. The eight audited quiet/loaded receipts select nine keys across native, disabled, Tree-sitter and Shiki. Selection and per-file diagnostic source identities are preserved under `../counterbalanced/`. Zero rejects out of ten per selected key is required. Any rejection requires a measured or explicitly estimated pair-count/statistic cost report before another sampling change. Default/full matrix wall-time effects remain unmeasured.

A direct product audit confirms that the required historical baseline/candidate are different products: 46 source/build files differ, including ten executable JavaScript files. Core `Editor.js`, `documentSession.js`, `documentAnalysis.js`, `editChain.js` and `syntaxController.js` differ. “Unchanged candidate” means the historical candidate without injected delay. It does not mean baseline and candidate bytes are identical. Per-file hashes are in `../swap-diagnostic/frozen-product-byte-comparison.json`.

The 1,126.549 seconds includes 240 bursts, comprising 168 measured and 72 warmup samples. Opening readiness consumes 517.270 seconds, final consumer/source settlement 417.573 seconds, priming/source readiness/screenshots 102.904 seconds, and input/paint 36.821 seconds. Fixture attachment is 35.684 seconds, bootstrap 1.632, memory/release 3.464, other configuration overhead 1.688, and outer CLI setup 9.512. Short-lines/multiple alone contributes 463.848 seconds opening and 328.065 seconds final settlement; its undo group totals 280.451 seconds. Measured reset calls themselves total 1.970 seconds. These are repeated readiness fences, with no terminal readiness timeout or CLI retry. The accounting includes warmups and is saved in `../split-controls/tree-sitter-loaded-wall-accounting.json`.

Actual default and full warm matrix wall times remain pending. At this archived checkpoint the default still included Platform plus declared/inferred affected configurations; full executed all ten configurations. The owner requested measured default-composition options after the diagnosis because loaded Tree-sitter alone exceeds 15 minutes. The smaller defaults are subsequently adopted in the shared-analysis checkpoint below.

The quiet Tree-sitter unchanged comparison passed in 746.498 seconds, including 741.339 seconds inside the configuration. Its measured short-lines/multiple samples spent 425.123 seconds across both sides. Opening readiness consumed 225.517 seconds and final settlement 160.973 seconds; captured input and paint consumed 4.797 seconds. Reset itself took 0.441 seconds. These sums exclude warmups and fixture attachment. Frozen `syncText` already applies the minimal replacement, and source epochs remain fixed during these bursts. Three retained view sessions perform the supported-tier syntax work. Retaining owners removes construction cost, but it cannot remove source-current settlement or change the frozen syntax products.

### Shiki plain output and identity split

The first Shiki quiet positive stopped at `long-line/single/paste` before producing a timing verdict. Its one logical plain line had two mounted token ranges of the correct text colour, with current/answered worker source and no worker error. The old assertion equated plain lines with DOM ranges. Plain output now requires complete rendered-text coverage in each visible view, uniform text colour and aggregate range accounting. Plain-line counts and source receipts remain strict.

Real Chromium probes accept two fully covered chunks and reject a missing chunk, partial text coverage and ranges belonging only to another view. Contract tests also reject wrong colours and range-accounting mismatches. Frozen Shiki long-line paste passes strict opening/final checks in both single and multiple views; this isolated probe is separate from the subsequently completed quiet acceptance. Raw evidence is `../shiki-coverage-proof.json`. The complete quiet run additionally contains sixteen opening/final receipts with multiple mounted chunks. Actual long-line/single/paste output from both products has one logical plain line, one highlight with two ranges, complete `2/2` chunk coverage, uniform colour and strict correct source. The old predicate rejects that saved output; the corrected predicate accepts it. These receipts and predicate replay are `../split-controls/shiki-actual-multiple-chunk-coverage.json` and `../split-controls/shiki-old-new-predicate-proof.json`. Measurement identity remains conservative: only the two extracted output modules are validation-only. Assertion-only changes keep future schema-4 controls valid; changed Shiki-bearing predicates require fresh acceptance.

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

### Declared loaded Tree-sitter policy, 2026-10-02

Standalone-floor measurement identity is `5e2248eadf511656241334bc7c7e832272a3b72c4fa0f3c838a1656fab7c3307`; validation remains `9f0b90934c620bae2d7aeeab8565d11c1adb5c74a58a3d6805f09cb1ce7dc156`. Combined instrument is `50bfd3256776ead9960a495cc09b7d1be6b92d110c4c3fbe3b2c4aa5be84c51e`. New evidence is under `../loaded-floor/`.

The new `--loaded` declaration records external CPU contention. Loaded default selection omits
standalone Tree-sitter; full and focused verification include it. Its blocking budgets become
`max(frozen budget, 5 ms)`, with frozen/applied values, reason and original provenance on every
metric. This raises 61 margins, including 20 sub-ms margins. Every key remains blocking. Quiet
Tree-sitter and every other loaded configuration retain their frozen budgets. The strict two-pair
stopping guard uses the applied margins, with the same complete AB/BA blocks and statistic.

The previous counterbalanced identity is now archived. Its full loaded Tree-sitter run rejected
short-lines/single undo applied (+0.95 ms versus 0.70 ms, interval [0.40, 1.40]) and dispatch
(+0.90 ms versus 0.60 ms, interval [0.30, 1.50]). CLI wall time was 1,062.096 seconds. All eight
workers remained live through 37 receipts, then were stopped and awaited; a direct PID check found
none remaining. The original ordinary undo failures passed in this run. This and the earlier
A/A spread motivate a separately declared 5 ms contention gate. They do not establish a product
undo regression. The historical instrument never measured loaded configurations.

The nine-key 0/10 reliability table remains valid for its listed keys and archived measurement
identity. It excludes these newly rejected short-lines/single keys. The all-undo 20-run cohort
was prepared but never launched after its estimated 110–170-minute cost was rejected. An advisory
rule was rejected because its 20 demotions included 17 historical negatives. All 47 historical
negative keys remain blocking and must reject their real 20 ms stage delay under the new floor.

Plan 282 lists all 61 affected margins and the evidence. Fresh native controls pass under this
identity. The real input delay rejects 72/72 synchronous keys at 20 ms; the real frame delay rejects
36/36 frame keys at 20 ms. The named frame key also rejects at 25 ms, so 30 ms is skipped. Its
20 ms frame median is 87.8 ms, interval [68.3, 89.8], against the unchanged 15.2 ms budget.
The 25 ms median is 125.6 ms, interval [88.3, 163.0]. These are observed effects, without a
monotonic pause-to-p95 guarantee.

| Current measurement                           | Wall time |
| --------------------------------------------- | --------: |
| Input 20 ms control                           | 172.291 s |
| Frame 20 ms control                           | 167.741 s |
| Named 25 ms frame check                       | 182.896 s |
| One-off control collection total              | 522.928 s |
| Native positive configuration                 |  73.727 s |
| First native CLI including controls and setup | 604.707 s |

The current control collection costs 18.928 seconds less than the archived counterbalanced run,
3.5%. No sampling rule changed between those runs, so this is a timing observation, not a claimed
speedup. The native positive passes all 108 blocking keys. Thirty-four groups stop at two pairs;
two complete four. The CLI wall time measures the child command through exit; the inner runner
reports 604.346 seconds. Raw cache verification recomputes all comparisons. Evidence is
`../loaded-floor/fresh-controls-summary.json` and `validation-quiet-native-positive.json`.
The loaded standalone Tree-sitter positive passes all 108 blocking keys with 61 applied floors.
Actual CLI wall time is 1,001.178 seconds, inner 1,000.660, configuration 989.817. Thirty-five
groups stop at two pairs and one completes four. All eight same-core load workers stay live
through 35 receipts, then are stopped and awaited; the direct remaining PID list is empty.
Evidence is `../loaded-floor/tree-positive-summary.json`. Its real 20 ms input negative rejects
72/72 synchronous keys and 42/42 exact historical input-stage keys. Actual CLI wall time is
1,975.166 seconds, inner 1,974.592, configuration 1,963.592. All eight workers stay live through
67 receipts, then stop and are awaited; direct remaining PID list is empty. Evidence is
`../loaded-floor/tree-input-summary.json`. The delayed groups finish four pairs, accounting for
more collection work than the positive. The real 20 ms frame negative rejects 36/36 frame keys
and all five exact historical frame-stage keys. Actual CLI wall time is 1,908.500 seconds, inner
1,908.009, configuration 1,897.511. All eight workers stay live through 65 receipts, then stop
and are awaited; the direct remaining PID list is empty. Evidence is
`../loaded-floor/tree-frame-summary.json`. Together the two negative stages preserve 47/47 exact
historical negatives directly at 20 ms, including the 17 keys in the earlier sub-ms audit.
The three actual CLI stages total 4,884.844 seconds (81.4 minutes). Remaining current-identity
agreement and default/full matrix wall times are pending; earlier receipts earn no current-identity
credit.

The approved next policy extends loaded floor/default omission to `tree-sitter-shiki`,
`tree-sitter-minimap`, `all` and `platform` after the current standalone stages. Each inherits
native budgets and raises 62 blocking margins, including 17 sub-ms margins. All 540 keys across
the five configurations remain blocking, with 309 raised margins. Platform remains in quiet
default with frozen budgets and in loaded full. Omitting it from loaded default supersedes its
previous mandatory loaded inclusion because it carries Tree-sitter readiness work and sub-ms
contention noise. Standalone runs have cost about 18 minutes; individual composition costs are
unmeasured. Source changes will require fresh sensitivity controls under a new identity.

The frozen prerequisite #224 pair changes executable core products used by every configuration.
Its actual quiet default therefore selects all ten configurations. The 15-minute target applies
to this matrix, and a miss requires measured cut variants. Selecting only configurations with
differing products removes none. The runtime-dependency audit records the public import chain
and changed executable hashes; raw runtime graph receipts contain module counts and an escape
audit, not per-module paths. Evidence is `../loaded-floor/runtime-product-dependency-audit.json`.

### Composition floor and pre-input source readiness

The composition policy is implemented for all five worker-backed Tree-sitter configurations.
Loaded default is now native, disabled, Shiki, minimap and Shiki/minimap for the #224 core pair.
Quiet default and full membership remain all ten. The narrow paired/policy suite passes 140 tests.

The first actual inferred-default attempt failed before completing its first Platform group.
Its pre-input ordinary typing receipt saw a current document of 4,469 UTF-16 units while minimap
held 4,493 units, including the prior burst's 24 characters. This is outside the short-lines undo
exception, and the exact equality check was preserved. A focused baseline/candidate reproduction
shows late convergence: source updates advance 3→4 and accepted render 37→46; exact equality then
returns. The harness had accepted the previous render before reset published its current source.
The diagnostic takes 11.279 seconds, with observed post-failure convergence in 0.639/0.649 seconds.
Raw evidence is `../loaded-floor/platform-minimap-reproduction.json` and its log.

Pre-input readiness now waits on the same current-source and accepted-render receipt as post-input.
There is no fixed reset wait or new exception. Focused verification runs warmup plus four
repetitions on each frozen side; every reset, opened and settled source is current, and both
contexts close. It takes 12.824 diagnostic seconds. Evidence is
`../loaded-floor/platform-minimap-readiness-verification.json`. The failed default produced no
outer artifact and supplies no completed matrix wall time or acceptance verdict.

Consolidated measurement identity is
`3c9a18ed47822568315cc513dd51b54d16cfd12a8091742fb5a7f2f168dcb203`; validation remains
`9f0b90934c620bae2d7aeeab8565d11c1adb5c74a58a3d6805f09cb1ce7dc156`, combined instrument is
`f4126d66e9d2da847266c5c1ba761ae21f559f463875be8ea287abf580101fa0`. Source checkpoint
`26b4c99b195c4424240e3e75dd755911c001e762` is pushed to draft PR #247. All commit hooks pass;
recomputing identity after their fixes confirms unchanged measurement and validation hashes.

Fresh controls pass under `../composition-floor/`. Input 20 ms rejects 72/72 synchronous keys in
171.980 collection seconds; frame 20 ms rejects 36/36 frame keys in 169.471 seconds. The named
frame key rejects 25 ms in 183.980 seconds, so 30 ms is skipped. Its 25 ms paired median is
114.05 ms, interval [88.3, 138.2], against the unchanged 15.2 ms budget. Control collection totals
525.431 seconds. Quiet native positive passes all 108 blocking keys in 80.075 configuration
seconds; 31 groups stop at two pairs and five complete four. Actual first CLI wall time is
610.989 seconds, inner 610.696. The source checkpoint's hooks ran alongside this one-off
collection, so these costs are observations rather than quiet-machine speed comparisons.
A preceding tool run stopped at its two-minute background limit and earned no sensitivity or
acceptance credit; its partial logs are preserved with `interrupted-time-limit` names. Final
cache verification recomputes all raw comparisons. Evidence is `fresh-controls-summary.json`,
`fresh-controls-details.json` and `validation-quiet-native-positive.json` in `../composition-floor/`.

After complete cache, receipt and source-identity verification, the actual quiet inferred default
started at 2026-10-02T00:51:56.382Z. It used the #224 prerequisite pair, all ten inferred
configurations, no configuration override, unpinned affinity and no intentional CPU workers.
The coordinator stopped it after three completed configurations, already over 15 minutes.
Platform, native and disabled each pass all 108 blocking keys in 694.244, 77.516 and 84.219
configuration seconds. Tree-sitter is partial. Last log activity is 1,247.493 seconds after
launch; this is a stopped-run observation, not a completed CLI wall time. No outer matrix or
full verdict exists. Owned driver/CLI/load-worker process lookup is empty. Evidence is
`../composition-floor/default-stopped.json` and the complete per-configuration raw artifacts.
Earlier controls and Tree-sitter acceptance retain their original measurement identities and
earn no consolidated-identity acceptance credit.

Platform's 694.244 seconds includes 236 samples, 72 of them warmups. Phase accounting gives
251.219 seconds pre-input open/readiness, 206.172 post-input settlement, 83.919 priming/screenshots,
73.476 forced pre-sample GC, 37.755 input/paint, 0.954 release, 35.988 fixture startup and 4.761
remainder. Native's corresponding totals are 2.142, 0.0003, 37.295, 2.901, 32.333, 0.310, 0.484
and 2.051 seconds. Both have 164 measured samples and cover the same keys. For measured
short-lines/multiple samples, inner consumer owner settlement accounts for 136.852 of 142.022
opening seconds and 86.963 of 90.641 post-input seconds. Thus the dominant readiness cost is
inside owner settlement; full-source proof replay is a smaller residual. Evidence is
`default-complete-phase-accounting.json` and `platform-readiness-owner-vs-wall.json`.

The approved next sequence is to identify what those owner waits block on and report the cause
before changing measurement code, then measure the actual declared Platform+native CLI as the
candidate default. Platform includes the shipping Tree-sitter/Shiki/minimap composition; the
other compositions supply attribution in full. No timing for that candidate scope is projected
from individual configuration costs.

#### Readiness cause and harness fidelity

Diagnostic-only compiled timing hooks separate the stages on both frozen sides. Measured
short-lines/multiple/typing opening spends 2.50–2.58 seconds waiting for Tree-sitter client tasks;
post-input spends 3.62–3.92 seconds. The worker's final idle-fence request takes 0.2–0.4 ms.
Shiki fences total 0.1–0.4 ms, the two follow-up delays total about 100 ms, and minimap acceptance
adds at most 16 ms in warmup. The multi-second cost drains real worker edit/parse requests,
not a debounce, idle callback or long polling interval. Compiled timing hooks are diagnostic,
not acceptance evidence. Production measurement sources and frozen products are unchanged.
Both contexts close and frozen hashes are revalidated. Evidence is
`../composition-floor/platform-readiness-profile.json` and `platform-fence-details.json`.

A real-app ownership audit identifies a harness fidelity mismatch. Split commands copy a tab.
`workspace-document-service.ts` creates one analysis owner on the live document and a separate
view per tab; its view projection carries that same analysis owner. `components/editor.tsx`
passes the shared analysis through the React adapter's `attachSession` options. The adapter
caches a separate buffer session for each buffer/view pair. In contrast, stress `src/browser.ts`
attaches separate buffer sessions without a shared analysis option, creating three independent
Tree-sitter runtime sessions. Matching the app requires one analysis owner per harness buffer,
passed to every view, while keeping view sessions independent. This changes measurement
identity and must be consolidated before fresh controls and final scope timing.

#### Editor product finding: full-document injection discovery

On the supported 500,000-line `//` fixture, each frozen Tree-sitter session's reset edit/parse
costs 689–820 ms, including 621–743 ms in full-document injection discovery and only 30–40 ms
in root parsing. A 24-character typing burst's delivered edit/parse costs 1,061–1,222 ms,
including 920–1,025 ms in injection discovery and 106–118 ms in root parsing. Each of the
three harness sessions repeats this work. Range-query compute costs another 111–114 ms;
its larger wall time includes queuing behind those parses. These observations measure a
coalesced burst, not one second per individual keystroke.

The frozen worker's `editDocument` builds updated parsed-document layers through injection
discovery before returning the edit acknowledgement; timing is recorded as
`treeSitter.injectionDiscovery`. Locations are the prerequisite products' `tree-sitter/dist/assets/
treeSitter.worker-BpGck7-d.js`, around `editDocument` (line 4218), the updated-layer construction,
and injection query matches (lines 4807–4813). Evidence is
`/work/tmp/plan-282/run-20261001T153544Z-sol/composition-floor/platform-fence-details.json`
and `platform-fence-details-summary.json`. This is separately owned Editor work; Plan 282
will preserve the frozen product bytes.

### Shared-analysis and default-scope checkpoint

The coordinator approved one analysis owner per harness buffer, independent view sessions,
quiet default Platform+native and loaded default native+disabled on 2026-10-02. The old
`3c9a18ed…` declared Platform+native run was stopped before a complete matrix: its Platform
configuration rejects in 583.851 seconds and native is partial. There is no completed CLI wall
receipt or aggregate verdict. Evidence is `../composition-floor/declared-native-stopped.json`.
That run, earlier sensitivity controls and loaded Tree-sitter evidence earn no acceptance credit
for the changed measurement. Fresh controls are collected once after the consolidated edits.
The loaded 5 ms floor remains unchanged. Full timing remains unconfirmed.

The ownership/default-policy unit suite passes 136 tests and stress TypeScript passes. A compiled
diagnostic passes on both frozen products: three independent views share one Tree runtime
session; Shiki retains three sessions. Source/render receipts pass, replacement keeps one Tree
session, final disposal leaves zero runtime sessions and live workers, and both contexts close.
Evidence is under `/work/tmp/plan-282/run-20261001T153544Z-sol/shared-analysis/`.

#### Strict shared-analysis accounting and quiet reliability gate

The first new-identity collection fails before publishing controls: its bootstrap validator still
expected two tracked objects (buffer and Editor), while disposal correctly tracks three including
shared analysis. Both sides execute the same ownership path. Isolated multiple tracks five
objects; a full six-subject warm lifetime tracks at least fifteen (six buffers, six analyses and
three retained Editors). These exact counts are corrected, with regression tests that reject
missing/extra bootstrap owners and a fourteen-object final receipt. Zero retained bootstrap
objects, listener limits, worker cleanup and context closure remain strict. The failed attempt
stays archived; it publishes no sensitivity cache and earns no final acceptance credit.

The old stopped Platform comparison rejects ordinary/multiple typing applied (+1.900 ms vs
1.700 ms, interval [1.300, 2.800]), typing dispatch (+1.950 vs 1.700, same interval), and undo
dispatch (+1.300 vs 1.200, interval [0.100, 1.700]). There is no blocking composition rejection.
Exact raw paired differences are in `../composition-floor/declared-native-platform-rejections.json`.
After fresh controls pass, ten restricted quiet Platform A/A runs check these three keys.
The completed cohort has zero rejects out of ten for each requested key and zero across all six
collected blocking keys. Actual cohort wall is 209.683 seconds, well within its thirty-minute cap;
no reduction to five is needed. Each complete raw comparison is independently recomputed.
Its diagnostic measurement is `7e0e60ea235e0017108a63698c48b05d073c197aebefd442214fb7247e1a5245`,
with the production identity recorded separately. The only scoped changes are group selection
and receipt coverage; production capture, AB/BA stopping, budgets, statistic and bootstrap remain.
It is marked acceptance-ineligible and establishes reliability for those selected keys, without
full-matrix or family-wise guarantees. Evidence is `../shared-analysis/accounted/aa-summary.json`
and the ten `aa-run-*/paired.json.gz` artifacts.

Shared-analysis query serialization is a separate product finding. Frozen `AnalysisEntry.query`
waits for `current()` and chains each query onto its `tail`; `StructuralEntry.range` deduplicates
identical revision/range keys, while distinct keys use that queue. Stored shared-owner diagnostics
show thirty fence/follow-up cycles per measured reset+typing sample, with Tree pending 1→1
through most cycles and 1.50 seconds in follow-up yields. Earlier independent owners need two
follow-up checks (~100 ms). New post-input settlement is 4.85–5.23 seconds. Exact new query
identities and compute attribution were not captured; these receipts do not prove that three
views each issue exactly one query. The harness's getter/poll/fence paths do not issue range
queries: `getState` reads snapshot/selections/status, inspect and render checks read receipts,
source validation replays captured messages, and idle fences send only fence requests. The
queued range work comes from Editor runtime requests. Plan 282 does not alter that product.

### Shared-analysis controls and approved finish line (2026-10-02)

The pre-compaction shared-analysis measurement is `4cd4f6f3f6903d78dc6ea820ede32cdcc2d3a869ba6e8e12f68d86f89cbaaf61`;
validation is `9f0b90934c620bae2d7aeeab8565d11c1adb5c74a58a3d6805f09cb1ce7dc156`;
combined instrument is `521f225056fd5f2881e1b3c9949c93a58de872018fba22901bb1898be003cf30`.
Evidence is `/work/tmp/plan-282/run-20261001T153544Z-sol/shared-analysis/accounted/`.
The failed stale-count collection under the preceding shared-analysis identity earns no credit.

| Final-identity receipt                 | Verdict                       | Actual seconds |
| -------------------------------------- | ----------------------------- | -------------: |
| Input-stage 20 ms control              | 72/72 synchronous keys reject |        172.783 |
| Frame-stage 20 ms control              | 36/36 frame keys reject       |        168.970 |
| Named native frame at 25 ms            | Rejects; 30 ms skipped        |        183.204 |
| One-off collection                     | Raw schema-4 cache verified   |        524.956 |
| Native unchanged configuration         | 108/108 blocking keys pass    |         76.939 |
| First native CLI with fresh controls   | Pass                          |        608.682 |
| Ten restricted quiet Platform A/A runs | 0/10 per selected key         |        209.683 |

The named 25 ms frame comparison measures median 113.350 ms, interval [87.700, 163.700], against
its unchanged `15.200000002980232` ms budget. Callback batching and phase remain variable;
this is sensitivity evidence, without a monotonic pause-to-p95 guarantee. Native's unchanged
historical candidate stops 32 groups at two pairs and finishes four pairs in four groups. The
actual first CLI measures through child exit; its inner runner is 608.386 seconds. Both controls,
the floor proof and raw native comparison are independently recomputed. The cache, controls
summary and `validation-quiet-native-positive.json` retain full receipts. Affinity is unpinned,
and these quiet runs start no CPU-load workers. Stress contracts pass 347 tests across twenty files;
stress TypeScript, commit formatting/lint, repository gates and typechecks pass.

The coordinator's bounded finish line requires these fresh controls, zero restricted quiet A/A
rejects and an actual passing Platform+native default within 900 seconds. Then collection stops,
#247 becomes ready and the coordinator arranges independent review. A rejection or overrun is
reported with one smallest proposed fix before another proof round. The first actual default exits after 549.473 seconds with Chromium `page.evaluate: Target crashed`
during cleanup after short-lines/multiple composition commit. No outer matrix artifact or aggregate
verdict is published. This failed attempt establishes neither a passing default nor a fifteen-minute
timing result. The following retention proof and authorized rerun supersede that attempt.

Outside this PR's finish line: final-identity loaded Tree-sitter, Tree compositions and loaded
Platform positive/real-negative re-proofs; remaining expanded historical agreement; and actual
full-matrix timing against 2,700 seconds. These are explicit Plan 282 follow-ups, unconfirmed
under the final identity. Archived quiet/loaded receipts retain their original identities and
earn no shared-analysis acceptance credit. The loaded 5 ms floor, all 540 blocking keys and the
standalone minimap exclusion remain unchanged. Plan 099 units 2–7 still need implementation
authorization. No further loaded or full runs are launched for this finish line.

### Minimap proof retention correction

The default's renderer PID 1734023 receives SIGTRAP at 02:25:36Z; its core is recorded by
02:25:56Z. The stripped `coredumpctl info` stack gives offsets on ThreadPoolForeg, without a
heap-limit or CHECK message. Browser stderr was not captured. The interval's journal has no
kernel OOM kill; the enclosing job reports 9G memory peak and 1.8G swap peak. These observations
do not establish the renderer's fatal cause. Receipts are `default-coredump-info.txt`,
`default-runtime-journal.txt`, `default-warm.log` and `validation-matrices-default.json` under
`../shared-analysis/accounted/`.

The concrete harness memory problem is captured-data layout: minimap proof logs retain every
full source across fixture replacements, until worker termination. The released analysis/buffer
list contains WeakRefs; disposing prior analysis clears its structural/highlighter entries. The
minimap protocol has no `disposeDocument`: retained workers receive authoritative `openDocument`
or `replaceDocument`, and their disposal already clears logs. The approved minimal correction
keeps the latest full document and all subsequent patches, releasing its superseded prefix.
Render freshness now uses monotonic `sourceUpdates` on capture and predicate; log compaction
cannot make an older accepted render current. No product, budget, sampling or heap flag changes.

A real Chromium diagnostic runs nine multiple-view minimap subject swaps on the unchanged
prerequisite candidate. Both arms use the production `waitForConsumerSource` fence and forced
GC/CDP heap reads after each subject. Current source and accepted render pass on every swap.

| Same fixture, repeated cycle | Before retained heap (MiB) | After retained heap (MiB) |
| ---------------------------- | -------------------------: | ------------------------: |
| Short-lines, first           |                    121.992 |                   122.447 |
| Short-lines, second          |                    186.628 |                   122.768 |
| Short-lines, third           |                    250.516 |                   122.685 |
| Long-line, first             |                     70.024 |                     6.150 |
| Long-line, second            |                    134.244 |                     6.437 |
| Long-line, third             |                    198.263 |                     6.582 |

Captured full line summaries after short-lines grow 1,500,603 → 3,001,206 → 4,501,809 before;
after they stay at exactly 1,500,000, three current 500,000-line documents. Each minimap keeps
one full snapshot after compaction. Both final cleanups track 21 lifetime owners and retain zero,
with zero live workers and closed contexts; final heap is about 5.11 MiB. This proves removal of
cumulative capture retention, without independently proving that it caused the SIGTRAP. Evidence
is `../shared-analysis/accounted/heap-proof/before.json` and `after.json`. An initial post-fix
diagnostic omitted the production source-current fence and observed a late-source window;
that failed probe and the initial before arm are preserved separately. The equal-fence comparison
is the accepted heap proof. Eight focused proof tests, 349 full stress tests, stress TypeScript,
lint, commit gates and repository typechecks pass. One inherited spread lint warning remains.

Source checkpoint `b59abf6b1e42b81e7f1c4ec595eadbc1d42e8ef0` is committed and pushed.
New measurement is `523635b39d32d14c2a539404a834a5164dab1c63fd5f686e6ab5fd68e59a8eb2`;
validation is `4e7e4d4a62ab85c561c5d0760ed3d367127ae2d2f7e637765cc39463d4411482`;
combined instrument is `380423a053c280713dc5cf2bef9a8edd685e1e16b10c6d74acc0d4ee8b7e36ea`.
Fresh controls and the one authorized actual default rerun write to
`/work/tmp/plan-282/run-20261001T153544Z-sol/shared-analysis/minimap-compacted/`.
The coordinator retains the completed restricted A/A as directed, with its original `4cd4f6f3…`
production identity and diagnostic stamp; it is not presented as a newly collected A/A. No extra
A/A, loaded or full matrix runs are authorized. Fresh controls and the native quiet positive
complete under the corrected identity:

| Receipt                                    | Actual collection wall (seconds) | Result                                      |
| ------------------------------------------ | -------------------------------: | ------------------------------------------- |
| Injected input 20 ms                       |                          170.879 | Rejects all 72 synchronous blocking keys    |
| Injected frame 20 ms                       |                          167.764 | Rejects all 36 frame blocking keys          |
| Named native frame 25 ms                   |                          182.193 | Rejects the named key; 30 ms is unnecessary |
| Native quiet historical positive           |                           70.626 | Passes all 108 blocking keys                |
| First native CLI, including fresh controls |                          598.565 | Exits 0, independently validated            |

The named ordinary/multiple/repeat frame difference is +89.000 ms against its unchanged
15.200 ms budget, nominal 95% interval [40.400, 113.700]. The three control collections total
520.837 seconds. Native stops 35 groups at two pairs and one at four; advisory timing does
not affect stopping. Cache identity and raw comparisons are independently recomputed by the
validation driver.

The single actual public default completes without a renderer crash in **855.026 seconds**
(14 minutes 15 seconds), below the 900-second target. Its complete matrix is exactly
`platform,native`; inner reported wall is 854.668 seconds. **Acceptance fails**: Platform passes
107/108 blocking keys in 776.693 seconds; native passes 108/108 in 71.643 seconds. Platform stops
31 groups at two pairs and five at four; native stops 34 at two and two at four. CLI exit 1 is the
published blocking verdict, not a missing-artifact or renderer failure.

The only reject is Platform `short-lines/multiple/undo/inputToApplied`: median candidate −
baseline p95 difference **+1.000 ms** versus unchanged **0.800000011920929 ms** budget; nominal
95% interval **[0.20000000298023224, 2.0999999940395355]**. Four paired differences are
`[0.9000000059604645, 0.20000000298023224, 2.0999999940395355, 1.0999999940395355]`.
Baseline p95s are `[2.100, 1.600, 1.700, 1.600]` ms; candidate p95s are
`[3.000, 1.800, 3.800, 2.700]` ms. This key is outside the retained three-key A/A selection.
That cohort cannot establish reliability for this newly rejecting key. All complete raw
comparisons and sensitivity-cache identities independently recompute. Receipts are
`default-warm.json.gz`, `validation-matrices-default.json` and `default-summary.json` in the
corrected-identity directory above.

### Final delivery decision and one open undo key

The coordinator approves shipping Plan 282 on 2026-10-02 with this result recorded honestly:
**855.026 seconds actual default, 215/216 blocking keys pass, one unclassified rejection**.
The runner's `passed: false`, exit 1 and exact budget remain unchanged. The open key is either
a real #224 undo cost on large files or noise; current evidence cannot distinguish them. Full
agreement with historical verdicts is not established.

Evidence for the open key:

- This quiet Platform run: multiple-view short-lines applied undo +1.000 ms versus 0.800 ms,
  four positive paired differences and a positive nominal interval.
- The earlier archived loaded Tree-sitter run: single-view short-lines applied undo +0.95 ms
  versus 0.70 ms, interval [0.40, 1.40], and dispatch +0.90 ms versus 0.60 ms, interval
  [0.30, 1.50]. Its 1,062.096-second receipt is recorded in the loaded-floor section. Different
  load, view and measurement identity make this supporting evidence, without a causal claim.
- Retained quiet Platform A/A: 0/10 rejects on each selected ordinary/multiple key. The clean
  cohort excludes this short-lines key and cannot classify it. #224 changed `editChain` and
  `documentSession`; this does not independently attribute the observed cost to either change.

The authorized restricted alternating A/A and A/B undo cohort stops after **195.706 seconds**
before publishing its first valid A/A artifact. Primary failure is the scoped diagnostic
validator's `Incomparable selected retained objects`; the missing-artifact ENOENT is secondary.
The reused ordinary-only count accounts for subject buffers/analyses and Editors, while the
pending-minimap short-lines undo reset can replace its document and add buffer/analysis lifetime
owners. Ten bursts finish, but no validated A/A or A/B comparison exists: rejects/10 and A/B median
of medians are **unconfirmed**, not zero. Logs and the incomplete receipt are preserved under
`undo-cohort/` in the corrected-identity directory. No repair or rerun is performed, as directed.

Follow-up: count reset replacement generations in the scoped diagnostic, retaining strict
source/render, zero-retained-object, worker and context checks; then run the restricted A/A and
A/B cohort on this key with unchanged production statistic, budgets and stopping. A/A uses the
same prerequisite candidate, A/B the original frozen prerequisite pair. Report rejects per arm,
A/B median of medians and actual wall. These measurements do not justify changing a budget or
sampling rule. Loaded Tree, compositions, loaded Platform and full-matrix wall proofs remain
explicit follow-ups. Collection stops; #247 is handed ready to the coordinator for independent
review, without merging.

### Current-identity undo repair, 2026-10-04

The owner approved the repair, its proof rounds and Plan 099 units 2–7. The performance
prerequisite remains pending. The old 855.026-second default retains its failing verdict and
original identity; the failed 195.706-second diagnostic remains archived.

The restricted count omitted replaced buffers and analysis owners. Full and restricted receipts
now share an exact lifetime validator. Each subject attachment and admitted document reload
contributes one buffer and one analysis owner; the final Editor count is one or three. Warmup
reset receipts cover every warmup, including reloads outside measured samples. Zero retained
objects, current reset source, accepted render, listener limits, worker shutdown, bootstrap
disposal and context closure remain required. Six targeted regressions fail before the repair;
all 21 focused lifecycle checks and 368 full stress tests pass afterward. Stress TypeScript and
lint pass, with the inherited `src/input-output.ts` spread warning.

The restricted diagnostic pilot uses five alternating A/A and A/B runs on exactly
`short-lines/multiple/undo/inputToApplied`. A/A uses the unchanged prerequisite candidate on
both sides. A/B uses the original prerequisite baseline and candidate. Their source hashes are
`5e2b88cd7caaa770b279513956e666c44ceac8489a370a1d71366744966d1618` and
`e5c6046921524097a47c5dcf38fd2d5c34fbc1eb4384e9cf5c9d9cfe5245fb6e`; both retain external
receipt `a71e25fffb81a474bf8eb5434213af2def69582fce1fa4ffeae9d71cdb0ab893`.
The applied budget stays `0.800000011920929` ms. The production p95 statistic, nominal
bootstrap intervals, key-local AB/BA order and strict two-or-four stopping policy are unchanged.
Five pilot runs per arm bound the first checkpoint. The requested final reliability follow-up
remains ten runs per arm; the pilot earns no rejects/10 or expanded acceptance credit.

Current proof artifacts are under `/work/tmp/plan282-undo-20261004/`. Failing-before and passing
contract logs are under `/work/reports/plan099-unblock-20261004/latency-proof/`.

Measurement `8127db7f5778b19c6e0543defeefefbde388572e176bddf09e1130391be97c25`, validation
`0620138886cf2eb6f5c4f1e382fdfefd643f1d45668c680468566296fff9de8c`, and combined instrument
`ba80c486f66dabf93af876e6b5fcf64df0c8b6be6aad700ebb094b3bdedd1228` include the independent
review repairs and this lifecycle repair. The public runner automatically writes a fresh cache.
Its raw controls independently recompute:

| Control                 | Actual collection seconds | Result                                |
| ----------------------- | ------------------------: | ------------------------------------- |
| Input 20 ms             |                   170.212 | 72/72 synchronous keys reject         |
| Frame 20 ms             |                   168.333 | 36/36 frame keys reject               |
| Named frame floor 25 ms |                   183.308 | Named key rejects; 30 ms skipped      |
| Total collection        |                   521.854 | Schema-4 cache independently verified |

All six control-arm cleanup receipts retain zero objects, zero live workers, zero hosts and zero
pending frames; both contexts close in each control. Bootstrap disposal and listener limits pass.
The host stops the following native positive at its 600-second quiet execution limit. The actual
child CLI spans 600.082 seconds and exits 1 after cancellation; the heavy runner reports its
75 timeout verdict. No complete native matrix or positive verdict exists. The failed command
and all completed raw controls remain in `controls.log`, `controls-timing.json`,
`sensitivity-{input,frame,frame-25ms}.json.gz` and the aggregate `sensitivity/` cache.
The cached positive subsequently passes in a separate bounded run. This stop changes neither a statistical verdict
nor a budget, and the incomplete positive earns no acceptance credit.

### Minimap readiness return race

The subsequent complete quiet default passes Platform and native, 216/216, in 801.845 actual CLI
seconds. Loaded native+disabled passes 216/216 in 209.253 seconds with eight declared load workers
and complete stop/await cleanup. The ten selected loaded A/A keys each reject 0/10. One unselected
native ordinary/single applied-undo rejection is preserved separately. The exact quiet undo pilot
rejects 1/5 per A/A and original A/B arm, with median of medians -0.250 and +0.150 ms respectively;
its sign reversal does not demonstrate a stable A/B-only cost. These are receipts under
measurement `8127db7f`, with unchanged budgets. A separate predeclared cohort of ten fresh runs
per arm is required under repaired measurement `34109579`. Report the preserved five-per-arm
`8127db7f` pilot separately, including both rejections; different identities cannot form one cohort.

The first predeclared full CLI aborts at 782.141 seconds during minimap short-lines/single typing
setup. Native, disabled, Tree-sitter and Shiki each pass all 108 blocking keys first. The excluded
minimap configuration still requires source/render readiness: source is current, source generation
33 matches the latest requested render, and render 395 is pending while 393 is accepted. The
full artifact is absent, so neither remaining positives nor the 2,700-second full target is proved.
The exact error, CLI receipt and four complete raw artifacts remain under
`/work/tmp/plan282-undo-20261004/full-window-01*`; `full-checkpoint.json` records the incomplete window.
The failed minimap arm publishes no strict object-cleanup receipt. Its owned processes exit after
the awaited session-close attempts and outer browser/runtime cleanup; the four completed
configurations retain their strict cleanup receipts.

The readiness loop waits for minimap acceptance, yields 50 ms, then tests only syntax readiness.
A follow-up render can become pending during that yield. Its minimap predicate also accepts an
old render after the source generation advances. Real settlement-function probes and two
deterministic failing-before regressions reproduce these early returns. The repair checks both
source generation and latest accepted sequence, then rechecks after the yield. The existing
120-second deadline, final source equality and pending-undo exception remain in force. All
372 stress tests, stress TypeScript and lint pass after repair; lint retains the existing spread warning.

The actual manifest classifies `src/inputConsumers.ts` as measurement-owned. Repaired-identity
controls, required matrix timings, selected loaded A/A and affected minimap-backed proofs remain
to collect after independent review. The source audit finds no change to capture, sampling,
statistics, workload, interception, package products or budgets. With minimap disabled, the added
predicate short-circuits and the prior readiness logic is unchanged. Any coordinator-approved reuse
of unaffected reference evidence will retain its explicit old identity. No repaired-identity
acceptance is claimed here.

## Runtime qualification: effectful reader and live admission partition

The new runtime instrument hashes live source admission in `input-source-current.mjs` as
measurement. The frontend `src/input-output.ts` also belongs to measurement: after actual
source-byte and opaque-buffer identity validation it records the bounded prior-current
attestation used by subsequent live dormant admission. Only `input-output.mjs`, which checks
postcapture receipts, remains validation-only. This is a new identity partition; archived
controls, failures and earlier two-reader partitions retain their original hashes and scope.

Warm resets physically hide the third view with explicit display state. A dormant canonical
worker retains `current=false`; admission requires mapped physical invisibility, zero pending
source/render/domain requests, valid source/render tuples and prior actual-current attestation.
Reveal requires the latest actual source point and changed rendered output. Registered
`renderSkipped` is terminal cancellation, retires its pending sequence and never counts as an
accepted render. A later valid current frame can restore freshness after known cancellation.
Unknown/stale responses and true errors fail closed for both active and dormant admission.

Raw sides and schedule are archived after cleanup and before comparison. Capture or cleanup
failures retain available receipts and explicitly incomplete schedule status. Every measurement
change requires fresh controls and current-identity matrix, timing and reliability proofs.
