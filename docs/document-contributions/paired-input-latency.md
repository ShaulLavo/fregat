# Paired native input latency

Plan 282 implements the paired replacement for Plan 099 units 2–7. The follow-up uses fixed historical budgets and temporarily excludes the known minimap undo source failure from acceptance, as directed by the owner. Validation and complete-matrix timing are in progress; those units remain gated and still require owner authorization. The runner compares two frozen Editor package sets in one Chromium session. Every complete two-pair block runs each side first once, with reproducible randomized order per key.

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

A blocking measure fails when its median paired difference exceeds its fixed budget and the confidence interval is entirely positive. `input-budgets.json` declares the exact `noiseMarginMs` values frozen by the accepted historical native, disabled, Tree-sitter, Shiki, and minimap calibrations. Baseline variability cannot widen these budgets. Each metric records its reference configuration, calibration artifact, SHA-256, and historical instrument hash. These fixed budgets require no new calibration or holdout runs.

The five combined and Platform configurations have no accepted historical calibration. They explicitly inherit all 144 frozen native budgets. Their full-matrix results establish new coverage under that declared reference; they cannot establish historical acceptance agreement. Incomplete or unadmitted archived calibrations are not used to fill missing keys. An unknown configuration or measure fails before interpretation.

Every report contains the raw baseline and candidate samples, paired differences, fixed budgets, confidence intervals, and schedule. Advisory timing never fails acceptance. Correctness checks remain required, subject only to the explicit pending-minimap exception below.

The paired path waits for actual consumer source and render receipts outside the captured input intervals. Undo priming also waits for the seeded worker source before input starts. A fixed 450 ms seed delay left a parse pending on the supported short-lines fixture; both frozen products then exposed a stale source on the final undo. The isolated Tree-sitter probe and its complete quiet comparison pass with seeded-source readiness, with the product bytes unchanged. The inherited absolute runner retains its original fixed waits.

The default maximum is four measured pairs after one warmup pair. Each group has its own deterministic order, derived from its seed, fixture/view/scenario key and block index. Every consecutive two-pair block runs each side first once. Earlier groups' adaptive counts cannot change a later group's order. After the first complete block, a group stops only when both paired p95 differences for every blocking measure lie within ± its frozen budget, and their two-point interval span is no larger than that budget. This strict guard also ensures the unchanged acceptance predicate passes on those two pairs. Otherwise the group completes a second block. Advisory screenshot timing does not affect stopping. The comparator revalidates every declared two-pair stop and every key-local order against the raw samples. Sensitivity and delayed candidates use this same rule.

Two- and four-pair bootstraps are coarse. The reported 95% intervals are nominal descriptive repetition-cluster intervals. Conditional early stopping has no adjusted sequential 95% coverage guarantee, and passing does not establish statistical equivalence. `--fixed-repetitions` disables stopping; requesting more than four repetitions also uses fixed sampling. Fixed sampling requires at least four pairs and complete even-sized blocks. More independent pairs improve resolution near a budget.

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

### Counterbalanced controls and reliability

Current measurement identity is `022dcd886d279cba935eeaa2178c918738ec8859aa978ee77cf8186f84ba33f2`; validation remains `9f0b90934c620bae2d7aeeab8565d11c1adb5c74a58a3d6805f09cb1ce7dc156`. Combined instrument is `dc37728b0a8ee28472b8a811439e1d0a98f2c6b6e90cc107fcf19fd04edb34b0`. The fresh raw cache is `../counterbalanced/sensitivity/022dcd886d279cba935eeaa2178c918738ec8859aa978ee77cf8186f84ba33f2.json.gz`. Earlier controls keep their original identities.

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

The one-off control cost rises by 105.297 seconds (24.1%). This is a measured collection-cost change. It is not a default/full matrix measurement. All 36 groups in every fresh stage control complete four pairs. The unchanged native run stops 35 groups at two pairs and completes four pairs for one group. Advisory timing remains excluded. All 334 stress tests, stress typecheck/lint and root gates pass; lint retains one inherited spread warning. Loaded reliability passes its zero-rejection gate. All nine selected keys reject zero times out of ten. All 21 blocking keys collected also have zero rejects. Forty restricted CLI runs total 666.212 seconds; 21 groups stop at two pairs and 49 complete four. The separately hashed diagnostic is `43577589069e62ee572ca9d73751df25dba50a0027e01f88b34fa444908f7e73`, with the current production identity recorded in every run. It collects or reuses no sensitivity controls and earns no full-matrix acceptance credit. All 103 load receipts show eight live same-core workers, which are stopped and awaited; the final PID check is empty. Evidence is `../counterbalanced/reliability/final-summary.json`. Ten runs per key are an empirical gate, without a family-wise error guarantee across all 108 keys. Full loaded Tree-sitter and its two 20 ms negative stages have resumed; matrix timings remain pending.

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

Actual default and full warm matrix wall times remain pending. The default still includes Platform plus declared/inferred affected configurations; full still executes all ten configurations. The owner requested measured default-composition options after the diagnosis because loaded Tree-sitter alone exceeds 15 minutes. No smaller gating matrix has been adopted.

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

Plan 282 lists all 61 affected margins and the evidence. Fresh controls, current-identity agreement
and default/full matrix wall times remain pending; earlier receipts earn no current-identity credit.
