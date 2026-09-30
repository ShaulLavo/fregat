# Plan 099 unit 0: native input calibration over consumer configurations

Status: partial, 2026-09-30. The corrected instrument (`a5c0c82b6`) and its identity, admission and
receipt proofs are complete. The fresh ten-configuration matrix under it has not run. No earlier
matrix closes unit 0: all of them lack contemporaneous external-byte and per-view current-source
receipts, and several of their calibrations are invalid under the delayed-control rule below.

Evidence: `/work/tmp/fregat-evidence/foundations-documents/native-input/`, with a hashed snapshot of
every driver, adapter, patch and proof log in `method/` (`SHA256SUMS`). Checklist:
`/work/tmp/foundations-documents-calibration/progress.md`.

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
| Instrument           | `editor/examples/stress` at `a5c0c82b6`; each run records its source hash and refuses to compare across instruments                                                                                                                                            |
| Instrument externals | The stress page's own dependencies plus `@shikijs/langs` and `@shikijs/themes`, hashed file by file (receipt `79218baa…`, 7 packages)                                                                                                                          |
| Shiki configurations | `packages-{baseline,candidate}-prereq-213-215-x3`: pre-publication `2ac20743c` and post-publication `3a0f097d6`, each with the same hashed historical subsets of #213 (worker teardown) and #215 (Shiki line limit)                                            |
| Other configurations | `packages-{baseline,candidate}-x3`: the same original products as the first calibration, re-frozen with an external receipt                                                                                                                                    |
| Membership           | 20 Editor packages per set; `src`, `dist` and manifests hashed per package                                                                                                                                                                                     |
| External bytes       | Every package the frozen Editor packages resolve, transitively, hashed file by file: receipt `a71e25ff…`, 131 packages, none unresolved, identical in all four sets                                                                                            |
| Runtime graph        | Every module of the page and its workers, from the build's hidden source maps, must come from the instrument, the frozen set or a receipt-covered package; emitted binaries must be exact copies. The `all` build: 389 modules, none outside, no binary assets |
| Environment          | Headless Chromium 153, Node 26.7.0, i7-14700K. Each measured run holds all three wave slots and is pinned to CPUs 8–15; the sampled affinity of its processes is recorded                                                                                      |

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

## Historical results

These were measured before the corrections and stay as recorded. None counts toward unit 0.

| Run                                                   | Outcome under the current admission rule                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| First matrix, native, minimap, tree-sitter-minimap    | Valid calibration and candidate pass under the old instrument and environment                                        |
| First matrix, tree-sitter and platform                | Delayed control let a dispatch group pass; calibration invalid, candidate result void                                |
| First matrix, shiki, shiki-minimap, all               | Partial 72/24 shape (long-line excluded); not a full result                                                          |
| First and serialized tree-sitter-shiki                | Holdout failed twice; calibration rejected                                                                           |
| First disabled                                        | Holdout failed; calibration rejected                                                                                 |
| Serialized disabled                                   | Delayed control let a dispatch group pass; its 106/108 candidate failure was measured against an invalid calibration |
| Corrected-environment shiki control 1–2 (`5a31d0493`) | Superseded when the review findings stopped the matrix; incomplete                                                   |

The old Shiki long-line runs also record the pre-prerequisite product: the Shiki worker never
finished the one-megabyte line and its disposal stalled.

## Limits

- The fresh matrix has not run; no latency result exists for the corrected method yet.
- Build tools and the browser binary are identified by version, not by bytes.
- Tree-sitter above the analysis limit, language servers, worker and WASM memory, and pixel-level
  comparison of every token are not measured here.
- Headless Chromium input timing is not UI performance evidence.
