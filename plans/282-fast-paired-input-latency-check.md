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
   session and alternate them per repetition (A B A B …, order randomized per pair). The verdict
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
   releases and for validating this instrument.
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
- [ ] Rerun native/disabled with same-core background load and compare all historical keys.
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
- [ ] Complete remaining current-instrument quiet/loaded candidates and stage-specific historical negatives; keep minimap acceptance excluded pending correctness.
- [ ] Measure actual warm default/full wall times against 15/45 minutes.
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
