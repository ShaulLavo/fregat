# Plan 282: Fast paired input-latency check

## Status and authorization

- Status: Approved; acceptance blocked. Authorized 2026-10-01 by the owner, who asked for a faster instrument with the same
  results after Plan 099 unit 0's calibration ran all night.
- Replaces the absolute-threshold calibration as the input-latency gate for Plan 099 units 2–7
  (still gated) and any other change that can slow typing.
- Starting evidence: PR #224 records the partial calibration (5 of 10 configurations accepted,
  `tree-sitter-shiki` holdout failed) and keeps its instrument and harness in
  `editor/examples/stress/`.

## Outcome

One command answers "did this change make typing slower?" in about 10–15 minutes on the default
matrix, and under 45 minutes on the full matrix. It gives the same verdicts as the old calibration
on the configurations that calibration accepted: unchanged candidates pass, and a deliberate 20 ms
input delay fails. It does not need exclusive CPUs or a quiet machine to stay correct.

## Why the old one was slow and fragile

- It froze absolute thresholds per configuration: 3 controls, a holdout and a delayed negative
  before any candidate could be judged, about 30 minutes per configuration, 10 configurations.
- Absolute thresholds move with machine state. The `tree-sitter-shiki` holdout failed on ~3 ms
  gaps from render work and GC between undo inputs, and the matrix was restarted six times.

## Design

1. **Paired and interleaved.** Load baseline and candidate package sets into the same browser
   session in key-local randomized AB/BA blocks. Every complete two-pair block runs each side
   first once. Stop after two only under the existing strict blocking guard, otherwise finish four.
   Earlier adaptive groups cannot change a later key's order. The verdict
   uses paired differences (candidate − baseline) per measure group, so load that hits both sides
   cancels out.
2. **Verdict.** For each blocking group, a regression is a median paired difference above the
   group's declared budget (reuse the 108 blocking / 36 advisory groups and budgets from the
   current instrument) with a bootstrap confidence interval that excludes zero. Report every
   group's difference and interval; advisory groups never fail the run.
3. **Sensitivity once per instrument version.** Two native candidate/candidate controls test a
   real 20 ms pause in separate stages. Before Editor handling, it must reject all 72 input keys;
   inside the rAF callback, it must reject 35 native frame keys. Native
   `ordinary/multiple/repeat/inputToFrame` retains its frozen 15.2 ms budget and separately
   measures its detection floor at 25 ms, then 30 ms only if needed, stopping at first rejection.
   The initial 20 ms pause measured 12.4 ms because it shifted input/frame phase; failure at
   30 ms blocks sensitivity. All other keys keep the 20 ms sensitivity requirement. Their raw results are cached together
   by measurement/dependency hash, recording their validation hash, and both verdicts are recomputed on reuse. Output-only predicate changes preserve controls and rerun acceptance for affected configurations. Input-handler delay
   is only partially visible in quantized warm frame timing; each stage tests delay in that stage.
4. **Matrix.** Default: Platform's real composition plus the configurations the change touches
   (declared by the caller or derived from changed packages). Full: all 10 configurations, for
   releases and for validating this instrument. Declared loaded default runs omit standalone
   Tree-sitter; `--full --loaded` includes it, and `--only tree-sitter --loaded` verifies it directly.
5. **Fixtures.** Ordinary code, 500,000 short lines and the one-megabyte line, capped at Platform's
   supported tier (analysis pauses above `editor.largeFile.analysisLimitMiCodeUnits`). Larger
   fixtures move to an opt-in stress mode.
6. **Machine.** Runs through `/work/tmp/wave-heavy/run.sh` like any heavy command. CPU pinning is
   optional, not required for a correct verdict.

## Steps

1. Build the paired runner on the existing input-latency suite (`run.mjs --suite input-latency`),
   reusing scenarios, measure groups and budgets. One command:
   `bun run bench:input:paired --baseline <packages> --candidate <packages> [--full]`.
2. **Validate against the old results** on native, disabled, tree-sitter, shiki and minimap: the
   unchanged candidate passes, the 20 ms delayed candidate fails in every group the old negative
   failed, on the same package sets PR #224 used.
3. **Validate robustness:** repeat step 2 with a background CPU load on the same cores; verdicts must
   not change.
4. **Measure the budget:** report wall time for the default and full matrices.
5. Point Plan 099's unit 2–7 gates and the stress README at the new command; delete the
   absolute-calibration commands and docs that it replaces.

## How to run it

One worker (Opus or Sol, high) in its own worktree off Fregat main, one independent Sol reviewer.
Validation runs are measurements: run them when no other heavy work is on the machine.

## Done when

- The paired command exists, with its sensitivity self-check stored per instrument hash.
- Steps 2 and 3 reproduce the old verdicts on all five accepted configurations, with and without
  background load.
- Default matrix ≤ 15 minutes and full matrix ≤ 45 minutes on this machine, measured.
- Plan 099 and the stress README use it, and the replaced calibration commands are gone.

## Execution checklist

- [x] Implement paired sampling, raw receipts, bootstrap comparison, and sensitivity caching.
- [x] Restore matching frozen products without changing historical evidence.
- [x] Replace the gate instructions and obsolete calibration commands.
- [x] Pass the real 20 ms sensitivity self-check for the final instrument.
- [x] Reproduce the frozen minimap undo failure on both products and check replay against its worker.
- [x] Include every affected consumer composition and package removal in matrix inference.
- [ ] Compare all five historical positive and negative verdicts without load.
- [ ] Repeat with background load on CPUs 8–15.
- [ ] Measure the default and full matrices.
- [x] Record completed native/disabled diagnostics and the blocked acceptance evidence.
- [x] Run final repository gates, typecheck, formatting, stress tests, and lint.
- [x] Commit by path, push, and open linked draft [PR #247](https://github.com/ShaulLavo/fregat/pull/247).

The owner requires this worker to do the implementation and review itself, so the independent
reviewer step above is skipped. Measurement artifacts are under `/work/tmp/plan-282/`.

## Follow-up checklist

The owner directed fixed historical budgets, temporary minimap exclusion, completed native/Tree-sitter/Shiki quiet and loaded checks, and measured default/full matrices. The frozen products stay unchanged.

- [x] Import exact accepted historical budgets with artifact hashes and explicit native inheritance for unaccepted compositions.
- [x] Require the self-check to reject all 47 historical native negative keys, including preedit-frame keys.
- [x] Add the explicit, scoped pending-minimap source exception while retaining Platform's runtime composition.
- [x] Measure per-sample wall phases and remove duplicate final source-receipt reconstruction.
- [x] Pass 285 stress contracts, including frozen thresholds, scoped source exceptions, adaptive stopping, and fixed-repetition completeness.
- [x] Pass the reduced-cost instrument's real self-check against all 47 historical native negative keys.
- [x] Pass native/disabled quiet positives with raw adaptive stopping counts.
- [x] Complete reduced-cost native/disabled quiet negatives against all 47 historical keys.
- [x] Rerun native/disabled with same-core background load and compare all historical keys. Current split-identity loaded positives and both 20 ms stages pass; every exact historical key rejects directly.
- [ ] Complete Tree-sitter quiet/loaded positive/negative checks on original frozen products.
- [ ] Complete Shiki quiet/loaded positive/negative checks on prerequisite frozen products.
- [x] Measure the fixed-three-pair Platform-plus-native default at 1,659.575 seconds; the 15-minute target fails.
- [x] Add raw-validated two-or-three pair stopping and ordinary-fixture warmups; keep every measured gating group and fixture.
- [x] Measure the reduced-cost Platform-plus-native default at 1,053.647 seconds, a 36.5% reduction; the 15-minute target still fails.
- [ ] Measure the ten-configuration full matrix against the 45-minute target.
- [ ] Run final adaptive-source repository gates, typecheck/build, formatting, stress tests, and lint.
- [ ] Update PR #247 with final evidence, commit by path, push, and remove the worktree.

New raw evidence is under `/work/tmp/plan-282/fixed-budgets/`. Fixed-budget native/disabled quiet positives pass and both negatives reject 47/47 historical keys. The real default passed but exceeded the timing target. Reduced-cost validation uses conditional stopping with nominal descriptive intervals and no sequential coverage guarantee, plus ordinary-fixture warmups that leave large-fixture allocation and analysis cold. Its real self-check rejects all 47 keys; delayed groups all collect three pairs. The reduced-cost matrices and loaded verdicts remain in progress. The initial draft's failed acceptance below remains historical evidence.

The first reduced-cost default attempt was interrupted at 17:09:36 on 2026-10-01. The system journal records a client-requested SIGKILL on its heavy-job slice, with a 6.1 GiB memory peak under an 8 GiB ceiling. The exact caller is unconfirmed. That attempt has no complete matrix or verdict; its logs are preserved in `/work/tmp/plan-282/fixed-budgets/adaptive-interrupted/`, with the journal receipt in `interrupted-journal.txt`. Completed native/disabled artifacts from the same job remain valid. Remaining quiet checks were restarted through the same admission wrapper with its supported `--slice-root heavyp282` option; loaded checks wait for quiet completion.

## Warm execution checklist

The owner approved two warm package pages, public Editor resets, retained fixture attachment,
120-second readiness-only bounds and separate input/frame controls. All budgets and 108 blocking
measures stay fixed. Archived pre-split evidence is `/work/tmp/plan-282/run-20261001T153544Z-sol/floor-controls/`;
current split-identity evidence is its sibling `split-controls/`.

- [x] Retain Editors and consumer owners across bursts and fixture changes; restore text/history/cursor/hidden view.
- [x] Preserve native's ordinary-only Tree-sitter policy at fixture transitions.
- [x] Record setup, attachment, reset, settlement, stable owner identities and final configuration cleanup.
- [x] Prove locator initialization adds 13 page listeners and one native worker adds two once; retain a disposed bootstrap receipt and strict final listener comparison.
- [x] Admit minimap reload only after an observed rejected short-lines undo receipt, outside captured input; current receipts automatically skip it.
- [x] Prove unchanged loaded Shiki starts can exceed 30 seconds; use a 120-second readiness-only deadline, leaving disposal at 30 seconds.
- [x] Preserve the failed three-pair and successful fixed-five old-control probes; choose stage controls rather than extra pairs or cold backlog.
- [x] Implement separate native-capture and rAF controls; pass 309 stress tests, typecheck and lint.
- [x] Prove all 72 input keys and 35 native frame keys reject their real 20 ms controls; record the single native repeat key’s bounded 25/30 ms detection floor. Final source rejected 72/72 and 36/36 at 20 ms; the separate floor rejected at 25 ms, so 30 ms was skipped. Raw controls took 424.655 seconds once.
- [x] Separate measurement and validation identities, with conservative default measurement coverage and assertion-only cache-reuse tests.
- [x] Correct plain-output validation for virtual chunks; prove complete/missing/partial/per-view coverage in Chromium and retain colour/range-accounting negatives.
- [x] Record the byte-identical transfer audit refusal and collect fresh controls under the final split identity. Seven of 81 measurement files differ; old evidence stays archived. Fresh input/frame controls reject 72/72 and 36/36; the named floor rejects at 25 ms and skips 30 ms. One-off collection is 436.559 seconds.
- [x] Pass native unchanged under the split identity: 108 blocking measures, 75.055 configuration seconds; first CLI 519.116 seconds includes controls/setup.
- [x] Complete Shiki quiet under the split identity: unchanged passes; 20 ms input/frame negatives reject 72/72 and 36/36, including all exact 47 historical keys. CLI times are 142.050 / 211.194 / 209.647 seconds.
- [x] Complete loaded native under the split identity: unchanged passes; input/frame negatives reject 72/72 and 36/36, including all exact 47 historical keys directly at 20 ms. CLI times are 92.291 / 158.865 / 157.731 seconds. Nineteen receipts show eight live same-core workers; all are stopped and awaited.
- [x] Complete loaded disabled under the split identity: unchanged passes; 20 ms stages reject 72/72 input, 36/36 frame and all exact 47 historical keys. CLI times are 105.490 / 168.375 / 169.533 seconds; 21 load receipts retain eight live workers and cleanup stops/awaits all.
- [x] Extract sixteen multi-chunk Shiki receipts from complete frozen acceptance and replay the old/new plain predicates on actual long-line paste output.
- [x] Preserve loaded Tree-sitter's three blocking undo rejections and strict worker cleanup; account for 1,126.549 seconds from this run's warmup, attachment and sample receipts. Opening/final readiness consumes 934.843 seconds.
- [x] Verify actual baseline/candidate bytes: 46 source/build files, including ten executable JavaScript files, differ. Preserve the historical products.
- [x] Run page-role swap first, then restricted baseline/baseline undo replay of the failed order. Swap passes all 108 in 1,149.188 seconds; A/A passes the three selected keys in 17.019 seconds. Separate diagnostic identities, no sensitivity transfer, no acceptance credit. Actual swap order changes because preceding adaptive groups consume different RNG counts.
- [x] Compare five restricted A/B and five restricted A/A loaded undo replays, alternating. All three A/B ranges overlap A/A; one A/B dispatch run rejects, every A/A passes. Preserve 165.893 CLI seconds and complete worker cleanup; the owner classifies this as noise/order conditioning.
- [x] Implement key-local randomized AB/BA blocks. Complete two pairs under the unchanged strict stopping guard and acceptance predicate, otherwise four; fixed runs require even complete blocks. Raw receipts verify the seeded order. The final proof passes all 334 stress tests, stress lint/typecheck and root gates.
- [x] Collect fresh counterbalanced controls under measurement `022dcd88…`: input 72/72 and frame 36/36 reject at 20 ms; the named floor rejects at 25 ms and skips 30 ms. One-off cost is 541.856 seconds (+105.297 seconds, +24.1%). Native unchanged passes all 108 in 73.157 configuration seconds; first CLI is 624.382 seconds. Earlier identities remain archived.
- [x] Run restricted loaded A/A ten times for each of nine selected near-budget/failed keys across native, disabled, Tree-sitter and Shiki. Every selected key is 0/10, with zero rejects across all 21 collected blocking keys. Forty CLI runs cost 666.212 seconds; 103 receipts retain all eight workers and final cleanup stops/awaits them with no live PIDs. No additional sampling/statistic change is required.
- [ ] Report counterbalanced default/full wall-time effects next to the fresh control costs.
- [ ] Complete remaining current-instrument quiet/loaded candidates and stage-specific historical negatives after diagnosis; keep minimap acceptance excluded pending correctness.
- [ ] Measure actual warm default/full wall times against 15/45 minutes and measured default-composition options; keep all current gating groups until an explicit decision changes them.
- [ ] Pass final root gates/typecheck/format checks; update PR #247 and push reviewed path-scoped commits.

Archived cold checklist results above are retained for their own instrument hashes. They do not
establish the warm instrument's acceptance. The original product bytes and historical artifacts
remain unchanged.

## Initial draft acceptance blocker

The supported short-lines fixture exposes a wrong-line-count minimap undo patch in both frozen
historical products. The worker replaces one summary with four and ends with 500,003 summaries
for a 500,000-line document. The final text length and accepted render are correct, so neither
proves source correctness. Raw isolated captures and the aborted quiet matrix are under
`/work/tmp/plan-282/`; [the validation record](../docs/document-contributions/paired-input-latency.md#initial-draft-validation)
records the exact patch, prior passes, and timing limits.

The final quiet native negative also misses one historical preedit-frame key: a 9.5 ms positive
effect passes a recomputed 14.1 ms budget, where the historical budget was 5.9 ms. Disabled matches
all 47 historical negative keys. Reusing the formula does not preserve every declared historical
budget or verdict. This remains an acceptance failure.

The required historical products stay frozen, and correctness checks stay strict. Native and
disabled quiet/loaded diagnostics are complete: both unchanged candidates pass, and both delayed
candidates reject all 36 dispatch keys. Native matches 46/47 historical negative keys without
load and 45/47 with load; disabled matches 47/47 in both cases. Both frozen minimap products
also reproduce the source failure under the same-core load. The remaining five-configuration
acceptance sequence and completed default/full timing measurements remain blocked. This plan
has not delivered an accepted gate. The implementation is published as a draft PR for follow-up.

## Delivery

Draft [PR #247](https://github.com/ShaulLavo/fregat/pull/247) contains the implementation and
blocked acceptance evidence. It remains unmerged. Final repository checks and 276 stress
contract tests pass. No deployment or app UI verification was needed for this benchmark/docs
change. The 15-minute default and 45-minute full targets remain unconfirmed.

## Split-identity checkpoint

- [x] Blocking first steps: output/cache contract tests, real Chromium coverage and frozen Shiki long-line paste proof before acceptance.
- [x] Independent workstreams: n/a; the owner requires one worker, and hashing, cache metadata and output receipts share contracts.
- [x] Shared mutable state: separate output predicates/readers from the conservative measurement source set; keep original evidence immutable.
- [x] Smallest safe decomposition: one worker, source/contract unit first, then stage controls, Shiki quiet, one loaded configuration per heavy job, and actual matrices.

Architect and independent-review agents are skipped under the explicit single-worker instruction.
The initial split changes mixed-purpose files; its byte-identical transfer audit refused the
old schema-3 cache. Fresh schema-4 controls pass under measurement `70f4f46f…` and validation
`9f0b9093…`. Existing native/disabled/Tree-sitter quiet historical-negative receipts remain archived
under `5929738e…`; the native unchanged candidate also passes under the split identity. The first
Shiki quiet run failed the one-range-per-line assertion before any timing verdict. The approved
rendered-chunk correction passes Chromium coverage contracts and complete Shiki quiet acceptance,
including all exact historical negative keys. Loaded agreement and actual matrix timing remain pending.
Final source contracts pass 328 stress tests, stress typecheck/lint and root gates; staged commit
hooks also pass repository typechecks. The inherited probe-only spread lint warning is retained.

## Declared loaded Tree-sitter gate

Approved 2026-10-02. `--loaded` declares externally applied CPU contention; the runner records
`loadProfile: loaded`. It starts no load workers. Standalone Tree-sitter runs under declared load
only in the full matrix or focused verification. Quiet default selection retains every inferred or
declared affected configuration. Every other loaded configuration retains its frozen budgets.

Every key stays blocking. For loaded standalone Tree-sitter, each blocking margin is
`max(frozen margin, 5 ms)`. Quiet Tree-sitter keeps the fine frozen margins. Per-key output records
the frozen margin, applied margin, reason and original artifact/hash provenance. Advisory timing
retains its original margin and has no acceptance or stopping influence. The unchanged strict
first-block guard uses the applied blocking margins; complete key-local AB/BA blocks, p95 statistic,
bootstrap and rejection predicate remain unchanged.

The evidence supports a declared contention gate at 5 ms, not a claim that pairing removes every
source of loaded noise. The archived five A/B and five A/A ordinary-undo cohort has overlapping
median ranges; A/A medians reached -2.4/+1.2 ms. The old three-pair full loaded run rejected three
ordinary undo keys in 1,126.549 seconds. The counterbalanced four-pair full loaded run instead
rejected short-lines/single undo: applied +0.95 ms against 0.70 ms, interval [0.40, 1.40]; dispatch
+0.90 ms against 0.60 ms, interval [0.30, 1.50]. It took 1,062.096 seconds, with all eight workers
live in 37 receipts and stopped/awaited afterward. These loaded measurements are new coverage;
the historical calibration never ran loaded configurations.

The completed restricted reliability cohort still establishes 0/10 for its nine selected keys,
not for every loaded undo key. It did not include the newly rejected short-lines/single keys.
A proposed ten A/A plus ten A/B all-undo cohort was estimated at 110–170 minutes from measured
burst/attachment costs. It was prepared but never launched: the coordinator rejected that cost.
The advisory alternative was also rejected because it would demote 20 keys, including 17 of the
historical 47 negatives, and lose their sensitivity requirement. The 5 ms floor preserves every
blocking key and requires real 20 ms negatives to reject all 72 input and 36 frame keys, including
every exact historical negative. A missed historical negative stops validation.

The threshold raises 61 of 108 loaded Tree-sitter margins. The 20 sub-ms keys are the rows marked
`sub-ms`; the remaining 41 have margins from 1 ms up to 5 ms. All 47 margins already at least
5 ms stay unchanged. The table rounds display values; raw frozen doubles and per-key provenance
remain in the comparison artifacts.

| Key                                                      | Frozen ms | Loaded ms | Sub-ms |
| -------------------------------------------------------- | --------: | --------: | ------ |
| `ordinary/single/typing/inputToApplied`                  |     1.700 |     5.000 |        |
| `ordinary/single/typing/dispatch`                        |     1.700 |     5.000 |        |
| `ordinary/single/repeat/inputToApplied`                  |     1.700 |     5.000 |        |
| `ordinary/single/repeat/dispatch`                        |     1.700 |     5.000 |        |
| `ordinary/single/composition-update/inputToApplied`      |     0.200 |     5.000 | sub-ms |
| `ordinary/single/composition-update/dispatch`            |     0.200 |     5.000 | sub-ms |
| `ordinary/single/composition-commit/inputToApplied`      |     1.700 |     5.000 |        |
| `ordinary/single/composition-commit/dispatch`            |     1.800 |     5.000 |        |
| `ordinary/single/undo/inputToApplied`                    |     0.700 |     5.000 | sub-ms |
| `ordinary/single/undo/dispatch`                          |     0.800 |     5.000 | sub-ms |
| `short-lines/single/typing/inputToApplied`               |     1.400 |     5.000 |        |
| `short-lines/single/typing/dispatch`                     |     1.400 |     5.000 |        |
| `short-lines/single/repeat/inputToApplied`               |     1.600 |     5.000 |        |
| `short-lines/single/repeat/dispatch`                     |     1.600 |     5.000 |        |
| `short-lines/single/composition-update/inputToApplied`   |     0.300 |     5.000 | sub-ms |
| `short-lines/single/composition-update/dispatch`         |     0.300 |     5.000 | sub-ms |
| `short-lines/single/composition-commit/inputToApplied`   |     0.800 |     5.000 | sub-ms |
| `short-lines/single/composition-commit/dispatch`         |     0.800 |     5.000 | sub-ms |
| `short-lines/single/undo/inputToApplied`                 |     0.700 |     5.000 | sub-ms |
| `short-lines/single/undo/dispatch`                       |     0.600 |     5.000 | sub-ms |
| `long-line/single/typing/inputToApplied`                 |     2.600 |     5.000 |        |
| `long-line/single/typing/dispatch`                       |     2.700 |     5.000 |        |
| `long-line/single/repeat/inputToApplied`                 |     2.200 |     5.000 |        |
| `long-line/single/repeat/dispatch`                       |     2.100 |     5.000 |        |
| `long-line/single/composition-update/inputToApplied`     |     0.100 |     5.000 | sub-ms |
| `long-line/single/composition-update/dispatch`           |     0.100 |     5.000 | sub-ms |
| `long-line/single/composition-commit/inputToApplied`     |     1.500 |     5.000 |        |
| `long-line/single/composition-commit/dispatch`           |     1.500 |     5.000 |        |
| `long-line/single/undo/inputToApplied`                   |     1.300 |     5.000 |        |
| `long-line/single/undo/dispatch`                         |     0.900 |     5.000 | sub-ms |
| `ordinary/multiple/typing/inputToApplied`                |     1.600 |     5.000 |        |
| `ordinary/multiple/typing/dispatch`                      |     1.600 |     5.000 |        |
| `ordinary/multiple/repeat/inputToApplied`                |     2.100 |     5.000 |        |
| `ordinary/multiple/repeat/dispatch`                      |     2.100 |     5.000 |        |
| `ordinary/multiple/composition-update/inputToApplied`    |     0.300 |     5.000 | sub-ms |
| `ordinary/multiple/composition-update/dispatch`          |     0.200 |     5.000 | sub-ms |
| `ordinary/multiple/composition-commit/inputToApplied`    |     1.400 |     5.000 |        |
| `ordinary/multiple/composition-commit/dispatch`          |     1.400 |     5.000 |        |
| `ordinary/multiple/paste/inputToApplied`                 |     4.900 |     5.000 |        |
| `ordinary/multiple/undo/inputToApplied`                  |     2.300 |     5.000 |        |
| `ordinary/multiple/undo/dispatch`                        |     0.800 |     5.000 | sub-ms |
| `short-lines/multiple/typing/inputToApplied`             |     2.100 |     5.000 |        |
| `short-lines/multiple/typing/dispatch`                   |     2.000 |     5.000 |        |
| `short-lines/multiple/repeat/inputToApplied`             |     1.600 |     5.000 |        |
| `short-lines/multiple/repeat/dispatch`                   |     1.600 |     5.000 |        |
| `short-lines/multiple/composition-update/inputToApplied` |     0.100 |     5.000 | sub-ms |
| `short-lines/multiple/composition-update/dispatch`       |     0.100 |     5.000 | sub-ms |
| `short-lines/multiple/composition-commit/inputToApplied` |     1.600 |     5.000 |        |
| `short-lines/multiple/composition-commit/dispatch`       |     1.600 |     5.000 |        |
| `short-lines/multiple/undo/inputToApplied`               |     1.700 |     5.000 |        |
| `short-lines/multiple/undo/dispatch`                     |     1.500 |     5.000 |        |
| `long-line/multiple/typing/inputToApplied`               |     2.300 |     5.000 |        |
| `long-line/multiple/typing/dispatch`                     |     2.300 |     5.000 |        |
| `long-line/multiple/repeat/inputToApplied`               |     2.700 |     5.000 |        |
| `long-line/multiple/repeat/dispatch`                     |     2.600 |     5.000 |        |
| `long-line/multiple/composition-update/inputToApplied`   |     0.300 |     5.000 | sub-ms |
| `long-line/multiple/composition-update/dispatch`         |     0.300 |     5.000 | sub-ms |
| `long-line/multiple/composition-commit/inputToApplied`   |     2.600 |     5.000 |        |
| `long-line/multiple/composition-commit/dispatch`         |     2.700 |     5.000 |        |
| `long-line/multiple/undo/inputToApplied`                 |     1.800 |     5.000 |        |
| `long-line/multiple/undo/dispatch`                       |     1.500 |     5.000 |        |

### Remaining checks for this policy

- [x] Explicit profile, loaded default selection and 61-key budget provenance implemented.
- [x] Narrow policy/paired receipt suite: 132 tests pass.
- [ ] Commit and push the counterbalance/policy checkpoint.
- [ ] Fresh controls under the new measurement identity; preserve the earlier controls.
- [ ] Loaded Tree-sitter positive, 20 ms input negative and 20 ms frame negative, each as its own heavy job.
- [ ] Quiet fine-budget agreement and remaining Shiki/minimap loaded checks.
- [ ] Actual inferred default, declared-composition option and full CLI wall times.

Raw failure and threshold audits live under
`/work/tmp/plan-282/run-20261001T153544Z-sol/counterbalanced/` in
`tree-loaded-failure-summary.json` and `proposed-loaded-tree-demotions.json`. The unlaunched cohort
preparation remains under `undo-cohort/` and earns no measurement or acceptance credit.
