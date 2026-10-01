# Paired native input latency

Plan 282 implements the paired replacement for Plan 099 units 2–7. Acceptance is blocked by a frozen-product correctness failure and a historical negative-key disagreement. The command is available for diagnostics; those units remain gated and still require owner authorization. The runner compares two frozen Editor package sets in one Chromium session. It alternates the sides within each repetition and records the randomized order of every pair.

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

A blocking measure fails when its median paired difference exceeds its budget and the confidence interval is entirely positive. The old instrument derived and froze each group's millisecond budget from three control runs; it had no source-code budget registry. This implementation retains its noise-margin formula:

```text
max(3 × range(baseline p95), 3 × range(baseline p50), max(baseline maximum − baseline minimum))
```

The baseline repetitions supply a recomputed budget within the paired run. This does not preserve the historical frozen budget values, and the validation below exposes a resulting negative-key disagreement. There are no separate calibration controls or holdout runs. Every report contains the raw baseline and candidate samples, paired differences, budgets, confidence intervals, and schedule. Advisory timing never fails acceptance. Advisory correctness still does.

The paired path waits for actual consumer source and render receipts outside the captured input intervals. Undo priming also waits for the seeded worker source before input starts. A fixed 450 ms seed delay left a parse pending on the supported short-lines fixture; both frozen products then exposed a stale source on the final undo. The isolated Tree-sitter probe and its complete quiet comparison pass with seeded-source readiness, with the product bytes unchanged. The inherited absolute runner retains its original fixed waits.

Three measured pairs follow one warmup pair in each group. A three-pair bootstrap is coarse. Its interval cannot establish a narrow effect when a repetition changes sign. Use `--repetitions` to collect more independent pairs when the effect is close to the budget. A passing verdict establishes this regression rule, not statistical equivalence.

## Sensitivity and fixtures

The first run of an instrument injects a real 20 ms pause into the candidate's native inputs. Both sides use the candidate package set. Every one of the 36 dispatch groups must fail. The full raw self-check is stored under `/work/tmp/plan-282/sensitivity/<instrument-hash>.json.gz`. A later run recomputes its verdict from the saved raw evidence. Changes to instrument source or instrument dependency bytes require a new self-check.

Default fixtures are ordinary TypeScript, 500,000 short comment lines, and a one-megabyte line. Each fits Platform's 10 Mi UTF-16 analysis tier. `--stress` restores the original generated 500,000 declaration lines above that tier. Custom frozen fixtures above the tier require `--stress`. CPU affinity is optional. The heavy-job wrapper controls resource admission.

## Historical reference

PR [#224](https://github.com/ShaulLavo/fregat/pull/224) accepted five configurations at instrument `56c8e77fb216232116c5acc714bd697d26633bb2`. Its accepted candidates passed all 108 blocking groups. Each delayed negative failed 47 blocking groups, including all 36 dispatch groups. `tree-sitter-shiki` failed its independent holdout. Four other configurations were unrun. That record does not establish full-matrix acceptance.

The frozen products are `packages-{baseline,candidate}-x3` for native, disabled, Tree-sitter, and minimap. Shiki uses `packages-{baseline,candidate}-prereq-213-215-x3`, with identical historical worker-teardown and Shiki line-limit prerequisites on both sides. Their external receipt is `a71e25fffb81a474bf8eb5434213af2def69582fce1fa4ffeae9d71cdb0ab893`.

The original non-prerequisite package receipts resolve internal links through removed historical worktrees. Validation copies their unchanged product bytes to `/work/tmp/plan-282/` and relocates those links. External payloads come from the surviving prerequisite worktrees, with the same recorded external hash. The archived package sets are untouched.

Historical raw results, receipts, method snapshots, and stopped attempts remain under `/work/tmp/fregat-evidence/foundations-documents/native-input/` and `/work/tmp/foundations-documents-calibration/`. The accepted matrix is `/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/`. The old delayed-check files supply the exact 47 failed keys used for agreement checks.

### Historical limits and product prerequisites

The combined Tree-sitter/Shiki holdout missed one blocking key, `ordinary/multiple/undo/inputToApplied`: 2.7 ms against a 2.3 ms limit. The saved [causal report](/work/reports/foundations-wave-2026-09-30/calibration-ts-shiki-holdout-causal.md) attributes diagnostic gaps to rendering and occasional major GC; the specific queued holdout inputs were not reproduced under tracing. The planned phase sweep was never run.

Shiki’s historical long-line and busy-worker-disposal failures led to [#213](https://github.com/ShaulLavo/fregat/pull/213) and [#215](https://github.com/ShaulLavo/fregat/pull/215). The accepted Shiki package sets include the same prerequisite patches on both sides. The archived over-tier Tree-sitter undo finding and highlight-query range failure do not establish unpaused analysis performance or resolve those findings. The [wave handoff](/work/reports/foundations-wave-2026-09-30/handoff.md) retains their disposition.

Headless Chromium frame timing is an observable, not physical display latency. Worker/WASM memory and language-server performance are outside this instrument. The new supported-tier short-lines fixture activates analysis that the old over-tier fixture paused, so verdict agreement is not byte-identical-workload equivalence.

## Validation

Acceptance is blocked. Results and logs are written under `/work/tmp/plan-282/`.

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
