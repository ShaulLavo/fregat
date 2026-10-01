# Plan 099 unit 0: native input calibration over consumer configurations

Status: **partial, 5/10 configurations calibrated**, 2026-10-01, instrument `56c8e77fb`.
Five configurations have accepted controls, holdouts, delayed negatives and candidates.
`tree-sitter-shiki` failed its holdout; four configurations never ran. The owner ended the
absolute-threshold matrix rather than spending approximately three more hours finishing it.
The remaining matrix is superseded by **Plan 282's paired A/B instrument**. Unit 0 is not complete;
units 2–7 remain gated. PR [#224](https://github.com/ShaulLavo/fregat/pull/224) delivers the instrument,
harness and recorded partial result, without full-matrix acceptance.

The post-collection review repairs the reusable harness: readiness and cleanup deadlines, proof
payload release, hash-covered runtime paths, Platform analysis tiers, baseline delayed-control
pairing, optional host diagnostics and compressed admission reads. Those source edits create a
new instrument identity. The five accepted configurations below belong only to `56c8e77fb`;
they were not rerun or revalidated with the repaired harness. The archived graph check admitted
broader paths than its receipts hashed, and its readiness loop did not bound every awaited stage.
The preserved receipts record what the historical instrument checked, with those limits.
No calibration, matrix, browser diagnostic or timing measurement was run for the review repairs.

Evidence is preserved in the following locations:

- [Exclusive results at `56c8e77fb`](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/).
- [Exclusive matrix log](/work/tmp/foundations-documents-calibration/exclusive-matrix.log), including
  earlier stopped attempts; the accepted matrix starts at `2026-10-01T01:28:35Z`.
- [Progress record](/work/tmp/foundations-documents-calibration/progress.md).
- [Hashed method snapshot](/work/tmp/fregat-evidence/foundations-documents/native-input/method/SHA256SUMS)
  of drivers, adapters, prerequisite patches and proof logs. Earlier invalid and superseded runs
  remain under [the native-input evidence root](/work/tmp/fregat-evidence/foundations-documents/native-input/).
- [Causal and coordination reports](/work/reports/foundations-wave-2026-09-30/), linked below.

## Workload

The E002 input suite, unchanged: six native input scenarios (typing, repeat, composition update and
commit, paste, undo); single view and two-visible-plus-one-hidden; the original ordinary-code,
500,000-short-line and one-megabyte-line fixtures, frozen as files (seed 60061, hashes in
`fixtures/manifest.json`); 3 repetitions after 1 warmup; 108 blocking and 36 advisory comparisons per
configuration. Calibration and comparison formulas and limits are unchanged.

Ten consumer configurations: `native` (E002's own workload), `disabled`, `tree-sitter`, `shiki`,
`minimap`, `tree-sitter-shiki`, `tree-sitter-minimap`, `shiki-minimap`, `all`, and `platform`
(Platform's default editor composition: Tree-sitter and Shiki, minimap, Find, gutters, merge
conflicts, bracket match, occurrence highlight, document links, scope lines). Every configuration
applies Platform's large-file tiers: analysis consumers pause above 10 Mi UTF-16 units, the minimap
above 50 Mi.

## Identity

| Item                 | Value                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument           | `editor/examples/stress` at `56c8e77fb216232116c5acc714bd697d26633bb2`, git tree `3a1d8979f9dbffd50d37444541188cfced99faa7`; each run records its source hash and refuses to compare across instruments                                                        |
| Instrument externals | The stress page's own dependencies plus `@shikijs/langs` and `@shikijs/themes`, hashed file by file (receipt `79218baa…`, 7 packages)                                                                                                                          |
| Shiki configurations | `packages-{baseline,candidate}-prereq-213-215-x3`: pre-publication `2ac20743c` and post-publication `3a0f097d6`, each with the same hashed historical subsets of #213 (worker teardown) and #215 (Shiki line limit)                                            |
| Other configurations | `packages-{baseline,candidate}-x3`: the same original products as the first calibration, re-frozen with an external receipt                                                                                                                                    |
| Membership           | 20 Editor packages per set; `src`, `dist` and manifests hashed per package                                                                                                                                                                                     |
| External bytes       | Every package the frozen Editor packages resolve, transitively, hashed file by file: receipt `a71e25ff…`, 131 packages, none unresolved, identical in all four sets                                                                                            |
| Runtime graph        | Every module of the page and its workers, from the build's hidden source maps, must come from the instrument, the frozen set or a receipt-covered package; emitted binaries must be exact copies. The `all` build: 389 modules, none outside, no binary assets |
| Environment          | Headless Chromium 153, Node 26.7.0, i7-14700K. Each measured run holds all three wave slots and is pinned to CPUs 8–15; the sampled affinity of its processes is recorded                                                                                      |

The [exclusive driver](/work/tmp/foundations-documents-calibration/exclusive-matrix.sh) verifies
that the stress tree equals `56c8e77fb` and is clean; later documentation commits do not change the
instrument. Runs are serialized per configuration: three independent baseline controls, a frozen
calibration, an independent same-build holdout, a real `--slowdown-ms 20` negative, then the candidate.
The driver stops before the candidate if the holdout or delayed admission fails. Workload, fixtures,
limits and formulas stay fixed; no failed run was pooled, relabeled or retried for acceptance.

The [exclusive adapter](/work/tmp/foundations-documents-calibration/exclusive-run.sh) holds all three
wave-heavy slots in order for each run, executes the process tree pinned to CPUs 8–15 in a bounded
systemd scope, records sampled affinity and exit status, and releases the slots on exit. Child
processes close the lock descriptors so lingering children cannot retain them. Pauses happen between
runs with no slots held. Each `*.environment.txt` preserves the run's receipt; for example,
[native control 1](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/native/control-1.environment.txt).
The [launch receipt](/work/reports/foundations-wave-2026-09-30/calibration-launch-receipt.md) records
pre-launch identity and driver hash; its “NOT launched” status is historical, superseded by the matrix log.
Slots exclude other wrapped heavy jobs, not every process on the shared host. The per-group signed
CPU residual is an estimate for correlation, with no process attribution or admission role.

The #215 historical subset omits the `highlighting` package and three snippet-path hunks
(`highlightSnippet`, `ShikiWorkerOwner.highlight`, the snippet request type), which neither
historical commit has. One #213 test that needs the snippet API was adapted, identically on both
bases, to drive the same teardown through a document session. The full patches, both subsets and the
test-only patch are kept with their hashes. The prerequisites give deterministic plain fallback for
over-limit lines and bounded worker teardown; they do not make old highlighting faster or equal.

## Admission and readiness

A calibration is valid only when its independent holdout passes and its real 20 ms delayed control
fails every one of the 36 dispatch groups, with exactly 108 blocking and 36 advisory comparisons. A
candidate runs only after that, and may differ from the controls only in product source and build.

Before and after input, and after the hidden view is revealed, every sample proves:

- each live Shiki and Tree-sitter session's worker received text equal to the document (replayed
  from the real messages after the measured interval) and its last source request was answered;
- each live minimap worker, one per view, holds line summaries matching the text and rendered after
  its last source update;
- every visible view paints its own token ranges; over-limit lines are one plain range per view in
  the rendered text colour, and Shiki reports each plain line once per view;
- unconfigured consumers are absent, owners are quiet, and no owned worker survives disposal.

Real-browser negatives are rejected for the injected reason: a Tree-sitter edit carrying different
text, one view's ranges removed, and one minimap view missing an edit while the others advance.

## Exclusive matrix results at `56c8e77fb`

Each accepted configuration has three baseline controls of 108 samples each. Its holdout, delayed
negative and candidate also have 108 samples each. Counts below are passing blocking/advisory
comparisons, not input samples; overall acceptance is determined by the 108 blocking comparisons.
Advisory failures remain in the saved checks. Each accepted delayed negative has the exact full
108-blocking/36-advisory shape and rejects all 36 dispatch groups. It need not fail every blocking
metric: the injected dispatch delay does not lengthen every input-to-applied interval.

| Configuration and raw evidence                                                                                                | Controls | Holdout pass counts | Delayed negative                                                   | Candidate pass counts | Result              |
| ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------- | ------------------------------------------------------------------ | --------------------- | ------------------- |
| [native](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/native/)                       | 3 × 108  | 108/108; 32/36      | Full 108/36 admitted; 36/36 dispatch groups rejected               | 108/108; 35/36        | Accepted            |
| [disabled](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/disabled/)                   | 3 × 108  | 108/108; 35/36      | Full 108/36 admitted; 36/36 dispatch groups rejected               | 108/108; 32/36        | Accepted            |
| [tree-sitter](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/tree-sitter/)             | 3 × 108  | 108/108; 35/36      | Full 108/36 admitted; 36/36 dispatch groups rejected               | 108/108; 32/36        | Accepted            |
| [shiki](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/shiki/)                         | 3 × 108  | 108/108; 34/36      | Full 108/36 admitted; 36/36 dispatch groups rejected               | 108/108; 36/36        | Accepted            |
| [minimap](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/minimap/)                     | 3 × 108  | 108/108; 34/36      | Full 108/36 admitted; 36/36 dispatch groups rejected               | 108/108; 32/36        | Accepted            |
| [tree-sitter-shiki](/work/tmp/fregat-evidence/foundations-documents/native-input/runs-exclusive-56c8e77fb/tree-sitter-shiki/) | 3 × 108  | 107/108; 29/36      | Run and check saved; admission not evaluated after holdout failure | Not run               | Calibration invalid |
| shiki-minimap                                                                                                                 | Not run  | Not run             | Not run                                                            | Not run               | Unverified          |
| tree-sitter-minimap                                                                                                           | Not run  | Not run             | Not run                                                            | Not run               | Unverified          |
| all                                                                                                                           | Not run  | Not run             | Not run                                                            | Not run               | Unverified          |
| platform                                                                                                                      | Not run  | Not run             | Not run                                                            | Not run               | Unverified          |

Each directory contains `control-{1,2,3}.json`, `calibration.json`, raw holdout/delayed/candidate
results, `*-check.json`, and per-run environment receipts. Accepted configurations also contain
`delayed-admission.json`. `tree-sitter-shiki` contains no candidate or delayed-admission result:
the driver stopped at **`2026-10-01T04:39:01Z`** because the holdout failed.

### Holdout diagnosis and the unrun phase sweep

The sole blocking holdout failure is `ordinary/multiple/undo/inputToApplied`: p95 2.7 ms against
the unchanged 2.3 ms limit. Three inputs, one per repetition at undo #8 or #9, queued about 1.7 ms
before normal handlers. Controls show mid-burst inter-input gaps of roughly 3 ms; frame phase can
put main-thread work into an unmeasured gap or into measured input queueing.

The [causal report](/work/reports/foundations-wave-2026-09-30/calibration-ts-shiki-holdout-causal.md)
records the saved-run diagnosis and two already-completed diagnostic runs. Syntax-result application
was observable and outside the undo burst. In the diagnostic trace, 14/14 long gaps contain rendering
work (1.25–1.84 ms), and 2/14 also contain major GC (1.68–1.90 ms). The queued holdout case did not
recur under tracing, whose handlers were slower, so attribution of those specific queues remains
inferred. Diagnostic timings do not calibrate or accept any configuration. The host CPU estimate
was unremarkable; it does not establish contention as the cause.

The [phase-sweep method review](/work/reports/foundations-wave-2026-09-30/calibration-frame-phase-method-review.md),
[planned sweep](/work/reports/foundations-wave-2026-09-30/calibration-ts-shiki-phase-sweep-go.md)
and [scratch policy](/work/tmp/foundations-documents-calibration/phase-sweep/policy.json) are plans,
not results: the phase sweep was **not run**. It and the unfinished absolute-threshold matrix are
superseded by Plan 282. The five accepted configurations stand; this failure does not establish
combined-consumer or Platform acceptance.

## Product findings and disposition

- **Shiki one-megabyte line never settled.** Routed to
  [#213](https://github.com/ShaulLavo/fregat/pull/213) (worker teardown) and
  [#215](https://github.com/ShaulLavo/fregat/pull/215) (strict-greater-than 20,000 UTF-16-unit
  plain-line fallback). See [long-line steering](/work/reports/foundations-wave-2026-09-30/calibration-long-line-steering.md),
  [line-cap fix check](/work/reports/foundations-wave-2026-09-30/pr215-fix-check.md) and
  [paired historical prerequisites](/work/tmp/foundations-documents-calibration/prereq-patches/).
- **Shiki disposal stalled behind a busy worker.** Fixed through
  [#213](https://github.com/ShaulLavo/fregat/pull/213); see
  [the causal fix check](/work/reports/foundations-wave-2026-09-30/pr213-fix-check.md).
  Both baseline and candidate Shiki sets carry the same prerequisite subsets described above.
- **Tree-sitter over-limit Undo lost token ranges in multiple views.** The historical finding was
  queued in [the wave handoff](/work/reports/foundations-wave-2026-09-30/handoff.md).
  The owner's closeout reports it is not reproducible on current main. No fix or reproduction is
  claimed by this documentation-only closeout, and the paused over-limit path proves no unpaused
  Tree-sitter performance above the analysis bound.
- **Highlight-query `RangeError: Invalid array length`.** Under investigation separately;
  it is not resolved or accepted by this calibration PR.

The [wave handoff](/work/reports/foundations-wave-2026-09-30/handoff.md) records the owner decision
to land this partial result and move the remaining instrument gate to Plan 282.

## Historical results

These precede the accepted `56c8e77fb` matrix and stay as recorded. None contributes to its five
accepted configurations or closes unit 0. The earlier native failure's
[causal report](/work/reports/foundations-wave-2026-09-30/calibration-native-causal.md) and the
[proof-gap fix check](/work/reports/foundations-wave-2026-09-30/pr-calibration-root-fix-check.md)
remain part of the evidence.

| Run                                                   | Outcome under the current admission rule                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First matrix, native, minimap, tree-sitter-minimap    | Valid calibration and candidate pass under the old instrument and environment                                                                                                                                                                                             |
| First matrix, tree-sitter and platform                | Delayed control let a dispatch group pass; calibration invalid, candidate result void                                                                                                                                                                                     |
| First matrix, shiki, shiki-minimap, all               | Partial 72/24 shape (long-line excluded); not a full result                                                                                                                                                                                                               |
| First and serialized tree-sitter-shiki                | Holdout failed twice; calibration rejected                                                                                                                                                                                                                                |
| First disabled                                        | Holdout failed; calibration rejected                                                                                                                                                                                                                                      |
| Serialized disabled                                   | Delayed control let a dispatch group pass; its 106/108 candidate failure was measured against an invalid calibration                                                                                                                                                      |
| Corrected-environment shiki control 1–2 (`5a31d0493`) | Superseded when the review findings stopped the matrix; incomplete                                                                                                                                                                                                        |
| Fresh matrix, `native` (`983233763`)                  | Delayed control not admitted: long-line/multiple/paste dispatch p95 27.3 ms (max 28.1) under a limit of 37.5 ms, widened by control-3 (p95 14.1 ms against 6.3, 6.4 and holdout 6.7). Calibration invalid, candidate not run. Diagnosis in `calibration-native-causal.md` |

The old Shiki long-line runs also record the pre-prerequisite product: the Shiki worker never
finished the one-megabyte line and its disposal stalled.

## Limits

- Five configurations are calibrated and their candidates pass; this is partial acceptance, not
  full-matrix acceptance or a measured improvement claim. Combined-consumer and Platform latency
  acceptance remain unverified, with the remaining gate moved to Plan 282.
- Unwrapped peer jobs on the host are not excluded by the wave slots; while they run, measured runs share the host with them. Each run records a per-group CPU estimate for its pinned cores (correlation evidence only).
- Build tools and the browser binary are identified by version, not by bytes.
- Tree-sitter above the analysis limit, language servers, worker and WASM memory, and pixel-level
  comparison of every token are not measured here.
- Headless Chromium input timing is not UI performance evidence.
