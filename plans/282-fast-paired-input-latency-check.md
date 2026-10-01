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
3. **Sensitivity once per instrument version.** A self-check runs the candidate with the injected
   20 ms delay on one configuration and must fail; it reruns only when the instrument changes, and
   its result is stored with the instrument hash.
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
- [x] Pass 281 stress contracts, including frozen-threshold and narrow-exception regressions.
- [ ] Complete new-instrument sensitivity and native/disabled quiet positive/negative checks.
- [ ] Rerun native/disabled with same-core background load and compare all historical keys.
- [ ] Complete Tree-sitter quiet/loaded positive/negative checks on original frozen products.
- [ ] Complete Shiki quiet/loaded positive/negative checks on prerequisite frozen products.
- [ ] Measure Platform plus one explicitly affected configuration; reduce cost if it exceeds 15 minutes.
- [ ] Measure the ten-configuration full matrix against the 45-minute target.
- [ ] Update PR #247 with final evidence, commit by path, push, and remove the worktree.

New raw evidence is under `/work/tmp/plan-282/fixed-budgets/`. The first pass is running native/disabled checks followed by Platform plus native; no new timing target is confirmed yet. The initial draft's failed acceptance below remains historical evidence.

## Initial draft acceptance blocker

The supported short-lines fixture exposes a wrong-line-count minimap undo patch in both frozen
historical products. The worker replaces one summary with four and ends with 500,003 summaries
for a 500,000-line document. The final text length and accepted render are correct, so neither
proves source correctness. Raw isolated captures and the aborted quiet matrix are under
`/work/tmp/plan-282/`; [the validation record](../docs/document-contributions/paired-input-latency.md#validation)
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
