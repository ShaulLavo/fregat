# Remaining issue resolution, October 3, 2026

Status: Approved

The owner requested tackling all issues left after the plan-conversion pass. The
opening snapshot contains 17 issues. Seven are closed at the current checkpoint. This pass implements confirmed defects,
measures performance changes, verifies existing fixes, and retains concrete
evidence when an external condition prevents resolution. Closing an issue
requires a shipped fix or evidence that its report is resolved.

## Execution checklist

- [x] Refresh all six enabled trackers and retain complete issue comments.
- [x] Check current main CI and open PRs before assigning overlapping work.
- [x] Create separate writer worktrees and launch three Sol workers.
- [ ] Independently review each implementation PR at its recorded head.
- [ ] Merge verified work on explicit green check rollups.
- [ ] Verify main CI and deploy each completed batch.
- [ ] Update source issues with the actual outcome and evidence.
- [ ] Reconcile the 17 opening issues and any blocking discoveries.
- [ ] Remove this pass's disposable worktrees and scratch.

## Issue ledger

| Issue                                                         | Work                            | State                                                          | Delivery                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Mesh #117](https://github.com/ShaulLavo/mesh/issues/117)     | Maintained action runtimes      | Merged and closed; main CI and publication passed              | [PR #119](https://github.com/ShaulLavo/mesh/pull/119), squash `3fe1f9d`                                                                                                                                                                                                                    |
| [Mesh #115](https://github.com/ShaulLavo/mesh/issues/115)     | Worker child EPERM              | Not reproduced in bounded probe; open                          | Pinned Go 1.27.0 transition probe passed; original failed syscall unrecorded                                                                                                                                                                                                               |
| [Mesh #78](https://github.com/ShaulLavo/mesh/issues/78)       | Benchmark fixture SIGKILL       | Not reproduced in bounded probe; open                          | Pinned Go 1.27.0 profile probe and signal controls passed; historical sender unknown                                                                                                                                                                                                       |
| [Mesh #77](https://github.com/ShaulLavo/mesh/issues/77)       | Fixture worker cleanup          | Current leak merged; historical report open                    | [PR #123](https://github.com/ShaulLavo/mesh/pull/123), squash `34ed2bf45`; main CI and publication passed                                                                                                                                                                                  |
| [Mesh #76](https://github.com/ShaulLavo/mesh/issues/76)       | Worker readiness timeout        | Not reproduced in bounded probes; open                         | Original Bash recovery and on-demand fixtures passed; zsh unavailable                                                                                                                                                                                                                      |
| [Fregat #400](https://github.com/ShaulLavo/fregat/issues/400) | Terminal browser CI hang        | Cleanup guard merged; historical trigger open                  | [PR #412](https://github.com/ShaulLavo/fregat/pull/412), squash `1c1eeeafe`; stalled stages bounded, browser closed, main CI passed                                                                                                                                                        |
| [Fregat #398](https://github.com/ShaulLavo/fregat/issues/398) | Extra native builds and uploads | Accounting attribution proved; counters implementing           | Eight frozen extra frames contain two sibling builds inside one draw, one upload and one submit; 24 writes are one full 12×40 upload. Historical glyph trigger remains unrecorded                                                                                                          |
| [Fregat #395](https://github.com/ShaulLavo/fregat/issues/395) | Unknown quota duration          | Merged and closed; main CI passed                              | [PR #407](https://github.com/ShaulLavo/fregat/pull/407), squash `1fcf1a7f8`; gateway payload installed atomically, active requests retain the old process until safe reload                                                                                                                |
| [Fregat #391](https://github.com/ShaulLavo/fregat/issues/391) | GPU sampling qualification      | Sampler and integer deadline fixes merged; original cause open | [PR #397](https://github.com/ShaulLavo/fregat/pull/397), squash `99f405fd6`, main CI passed; [PR #421](https://github.com/ShaulLavo/fregat/pull/421), squash `45f22aa0b`; trace-budget #401 is retargeted and awaiting final CI                                                            |
| [Fregat #390](https://github.com/ShaulLavo/fregat/issues/390) | Tooltip accessibility semantics | Closed as expected upstream behavior                           | Plain/composed controls and positive ARIA control verified in Chromium; screen-reader announcement order remains untested                                                                                                                                                                  |
| [Fregat #368](https://github.com/ShaulLavo/fregat/issues/368) | Callback delivery after resize  | Reviewed final integration awaits CI                           | [PR #431](https://github.com/ShaulLavo/fregat/pull/431), head `26e0bf919`, contains the unchanged approved scheduler plus 0.3.2 canonical metadata. #416 and #428 are superseded. External fd downloads and a separately fixed pruning fixture blocked CI                                  |
| [Fregat #364](https://github.com/ShaulLavo/fregat/issues/364) | Bun build diagnostic            | Merged and closed; main CI passed and deployed                 | [PR #414](https://github.com/ShaulLavo/fregat/pull/414), squash `bd5cf47a3`; configured JSX and external core verified; live client/server `dc3d81592` passed release checks                                                                                                               |
| [Fregat #363](https://github.com/ShaulLavo/fregat/issues/363) | Legacy Unicode diagnostic crash | Reproduced; containment review corrections implementing        | [PR #432](https://github.com/ShaulLavo/fregat/pull/432) retains the unchanged probe in its own browser and completes later instrumentation, with overall exit 1. Review found late-acquisition cleanup and crash-status boundaries that need correction. Upstream crash remains open       |
| [Fregat #360](https://github.com/ShaulLavo/fregat/issues/360) | ZWJ grapheme width              | Closed as a provider/configuration difference                  | [PR #433](https://github.com/ShaulLavo/fregat/pull/433), squash `f0bbbeb1a`, commits raw controls and screenshot. Legacy native matches xterm Unicode 11; clustered native matches Unicode 15-graphemes. Consistent policy remains Approved in Plan 283                                    |
| [Fregat #358](https://github.com/ShaulLavo/fregat/issues/358) | Atlas residency and eviction    | Merged and closed; batch rollout pending                       | [PR #425](https://github.com/ShaulLavo/fregat/pull/425), squash `0a2ff0126`. All 19 checks passed. Bounded cold insertion needs one eviction/upload instead of two, with pixel parity and no warm scan. PR #399 ownership fix preserved                                                    |
| [Fregat #352](https://github.com/ShaulLavo/fregat/issues/352) | Sustained non-ASCII measurement | Merged and closed                                              | [PR #399](https://github.com/ShaulLavo/fregat/pull/399), squash `9dbcc63a9`, adds the selector and artifact identity; exact PR CI passed; main checks pending                                                                                                                              |
| [Fregat #349](https://github.com/ShaulLavo/fregat/issues/349) | Prompt cache rebuild visibility | Factual cache history merged; warning calibration open         | [PR #419](https://github.com/ShaulLavo/fregat/pull/419), squash `41634c0f3`, preserves nullable reported counters and shows five recent turns. All 20 checks passed. Baseline has 10 Codex turns with unknown writes stored as zero; detector calibration remains an Approved prerequisite |

## Standing orders

- The pass ends after reconciling these 17 issues. Newly discovered work is filed
  separately; a defect blocking verification receives an owner in this pass.
- Keep three workers at a time within the runtime's four slots, including this
  coordinator. Refill slots with independent reviews and the next ready unit.
- Use Sol and inherit the current runtime model. Heavy operations use the shared
  admission wrapper. Quiet measurements respect other active measurements.
- Every writer and reviewer owns a separate worktree. Shared checkouts preserve
  other sessions' changes.
- One concern per implementation PR. The coordinator owns merges and deployment.
- Preserve existing approved plans and the work of other active PRs. Never claim
  a benchmark receipt or instrumentation change proves an unidentified cause.
- Performance work needs a bounded baseline and before/after evidence. Lack of
  measurements alone does not justify dropping it.
- Tests stay portable and focused. No retries, deadline increases, skips, or
  broad repeated suites to conceal an unresolved defect.
- No automatic agent launch, provider login changes, private data publication,
  live gateway restart, or changes to the owner's stored data.

## Evidence and coordination

The complete opening snapshot and per-issue source records are retained in
`/work/tmp/fregat-evidence/20261003-remaining-issues/`. Each unit retains its
baseline, final check, and review receipts there. The coordinator's event ledger
is `/work/reports/remaining-issues-20261003/events.tsv`.

Main at launch: Fregat `0e440ec26`, with the previous `28b73e2e8` CI green and
current Ghostty CI green; the current Editor job was still running. Mesh's
`a68c4d8` CI passed before the `7d400c6` cask-only successor. No red main was
observed at launch.

Existing PR #399 claims to close #352 and contains #398's trace evidence. PR #397
contains #391's stricter sampler receipts; its failed check reports an unrelated
quiet-lifecycle test. Stacked PR #401 passed CI. Their original authors retain
their branches while this pass assesses overlap and unresolved behavior.

## Blocking discoveries

- [Fregat #402](https://github.com/ShaulLavo/fregat/issues/402) records PR #397's
  quiet fixture failure before the production runner executes. The transient
  empty slice returned no `active` stdout. Its setup result and lifecycle need
  attribution; no production quiet-admission defect is established. [PR #409](https://github.com/ShaulLavo/fregat/pull/409) merged as `95cb29f68` and the issue closed. The fixture now explicitly starts its owned empty slice and checks setup; historical cause remains unconfirmed.

- [Fregat #410](https://github.com/ShaulLavo/fregat/issues/410) retains PR #407's folder-move undo event failure. A failed-job rerun passed, enabling #407 to land; a contended baseline reproduced interleaved native watcher echoes. The test isolation repair merged in [PR #415](https://github.com/ShaulLavo/fregat/pull/415), squash `dc3d81592`, and #410 closed. Production event semantics were preserved.

- [Fregat #422](https://github.com/ShaulLavo/fregat/issues/422) records the terminal patch version's stale native resolver provenance. Main's `83a0cf56f` changed the package and lockfile without updating the canonical package-input and bootstrap hashes. The Ghostty metadata guard failed in job `111082793144`. A peer corrected the 0.3.1 metadata in `5e8bf33e5`; independent structural/hash review passed. The #368 integration updates the final 0.3.2 closure separately. PR #425 and the final scheduler's Ghostty job passed against the corrected native closure. Main checks are still queued.

- [Fregat #424](https://github.com/ShaulLavo/fregat/issues/424) records formatter failure on a commit containing only formatter-excluded generated files. A peer added `--no-error-on-unmatched-pattern` to the two formatter hooks in `fc8a0ca3a`; ordinary formatter failures still propagate. This pass's final scheduler integration runs the corrected normal hooks.

## Current decisions

Keep the remaining reports. Negative reproduction alone does not justify dropping the four historical Mesh failures, the original GPU sampling trigger, or the terminal CI hang. Their source issues retain the exact missing observation. The legacy Unicode crash remains an upstream dependency problem after benchmark containment. Cache rebuild warnings remain Approved work after provider-counter calibration. No performance request is dropped.

Merged source and live delivery are recorded separately. The gateway payload is installed, but its busy process still serves the previous code. The final client/server batch and source-issue reconciliation remain execution work in this pass.
