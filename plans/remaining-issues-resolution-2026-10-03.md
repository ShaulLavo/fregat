# Remaining issue resolution, October 3, 2026

Status: Approved

This pass covered the 17 issues left after the plan-conversion pass: **nine closed,
eight retained**. Confirmed fixes landed; unresolved causes stay visible with the
specific evidence still needed. No performance request was dropped.

## What to keep

- **Mesh #115, #78 and #76:** keep the historical worker failures. The bounded
  probes passed, but they did not identify the failed syscall, the SIGKILL sender,
  or the readiness condition that caused the original timeout.
- **Mesh #77:** keep the historical cleanup report. We fixed a current fixture
  worker leak, but have not identified the creator of the original leftover state.
- **Fregat #400:** keep the intermittent browser hang. The test runner now bounds
  the stalled stages and closes its browser; the original trigger remains unknown.
- **Fregat #391:** keep the NVIDIA sampling report. The sampler retains better
  receipts and uses a correct integer deadline and explicit trace budget. Those
  fixes do not explain the historical empty GPU list.
- **Fregat #363:** keep the reproducible legacy Unicode WASM crash. The benchmark
  now contains it in a separate browser, records failure, finishes later
  diagnostics and exits 1. The upstream crash itself still needs a fix.
- **Fregat #349:** keep cache rebuild warning calibration. The app now shows the
  provider's nullable counters and five recent turns. We still need a trustworthy
  baseline before declaring that a cache was rebuilt.

Close the nine resolved reports in the ledger below. Two closures need no product
change: #390 describes expected tooltip behavior; #360 compares different Unicode
providers/configurations. A consistent grapheme policy remains Approved in
Plan 283. #398's extra native builds have an accounting explanation and new
instrumentation; cold glyph-range costs also remain Approved in Plan 283.

## Issue ledger

| Issue                                                         | Outcome                  | What landed or remains                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Mesh #117](https://github.com/ShaulLavo/mesh/issues/117)     | Closed                   | [PR #119](https://github.com/ShaulLavo/mesh/pull/119), `3fe1f9d`: maintained action runtimes; main CI and publication passed.                                                                                                                                                                  |
| [Mesh #115](https://github.com/ShaulLavo/mesh/issues/115)     | Keep                     | Go 1.27.0 child-transition probe passed; original EPERM syscall unrecorded.                                                                                                                                                                                                                    |
| [Mesh #78](https://github.com/ShaulLavo/mesh/issues/78)       | Keep                     | Go 1.27.0 profile probe and signal controls passed; historical SIGKILL sender unknown.                                                                                                                                                                                                         |
| [Mesh #77](https://github.com/ShaulLavo/mesh/issues/77)       | Keep; partial fix        | [PR #123](https://github.com/ShaulLavo/mesh/pull/123), `34ed2bf45`: current fixture cleanup fixed; main CI and publication passed. Historical state creator unknown.                                                                                                                           |
| [Mesh #76](https://github.com/ShaulLavo/mesh/issues/76)       | Keep                     | Bash recovery and on-demand fixtures passed; original readiness timeout unconfirmed; zsh unavailable.                                                                                                                                                                                          |
| [Fregat #400](https://github.com/ShaulLavo/fregat/issues/400) | Keep; partial fix        | [PR #412](https://github.com/ShaulLavo/fregat/pull/412), `1c1eeeafe`: bounded runner cleanup; main CI passed. Historical hang trigger unknown.                                                                                                                                                 |
| [Fregat #398](https://github.com/ShaulLavo/fregat/issues/398) | Closed                   | [PR #434](https://github.com/ShaulLavo/fregat/pull/434), `e5d196741`: distinguish native retry outcomes, upload batches and submissions. Accounting reconciled; exact historical glyph unrecorded.                                                                                             |
| [Fregat #395](https://github.com/ShaulLavo/fregat/issues/395) | Closed; reload pending   | [PR #407](https://github.com/ShaulLavo/fregat/pull/407), `1fcf1a7f8`: require observed Weekly duration. Main CI passed; gateway payload installed, busy process still uses old code.                                                                                                           |
| [Fregat #391](https://github.com/ShaulLavo/fregat/issues/391) | Keep; partial fixes      | [PR #397](https://github.com/ShaulLavo/fregat/pull/397), `99f405fd6`; [PR #421](https://github.com/ShaulLavo/fregat/pull/421), `45f22aa0b`; [PR #401](https://github.com/ShaulLavo/fregat/pull/401), `4ff2280d3`. Sampler receipts and deadline/budget fixes landed; historical cause unknown. |
| [Fregat #390](https://github.com/ShaulLavo/fregat/issues/390) | Closed                   | Expected upstream tooltip semantics, checked against plain/composed controls and a positive ARIA control in Chromium. Screen-reader announcement order untested.                                                                                                                               |
| [Fregat #368](https://github.com/ShaulLavo/fregat/issues/368) | Closed; deployed         | [PR #431](https://github.com/ShaulLavo/fregat/pull/431), `80f759c30`: complete frame callbacks before nested resize repaint; canonical 0.3.2 metadata; all 23 checks passed. #416/#428 superseded.                                                                                             |
| [Fregat #364](https://github.com/ShaulLavo/fregat/issues/364) | Closed; deployed         | [PR #414](https://github.com/ShaulLavo/fregat/pull/414), `bd5cf47a3`: build Hotkeys with configured JSX and external core; main CI and live checks passed.                                                                                                                                     |
| [Fregat #363](https://github.com/ShaulLavo/fregat/issues/363) | Keep; containment landed | [PR #432](https://github.com/ShaulLavo/fregat/pull/432), `f4f007507`: separate owned diagnostic browser and failure-preserving teardown. Original call-23 crash remains reproducible.                                                                                                          |
| [Fregat #360](https://github.com/ShaulLavo/fregat/issues/360) | Closed                   | [PR #433](https://github.com/ShaulLavo/fregat/pull/433), `f0bbbeb1a`: raw provider controls and screenshot. Legacy native matches xterm Unicode 11; clustered native matches Unicode 15-graphemes.                                                                                             |
| [Fregat #358](https://github.com/ShaulLavo/fregat/issues/358) | Closed; deployed         | [PR #425](https://github.com/ShaulLavo/fregat/pull/425), `0a2ff0126`: preserve active atlas pages. Cold insertion drops from two evictions/uploads to one; pixels match and warm scans stay absent. No CPU speedup claimed.                                                                    |
| [Fregat #352](https://github.com/ShaulLavo/fregat/issues/352) | Closed; deployed         | [PR #399](https://github.com/ShaulLavo/fregat/pull/399), `9dbcc63a9`: sustained non-ASCII selector, differential Zig frame ownership and artifact identity; exact PR CI passed.                                                                                                                |
| [Fregat #349](https://github.com/ShaulLavo/fregat/issues/349) | Keep; history deployed   | [PR #419](https://github.com/ShaulLavo/fregat/pull/419), `41634c0f3`: reported cache counters and recent-turn history. All 20 checks and the real context-popover scenario passed. Warning calibration remains Approved.                                                                       |

## Final verification

Every implementation received an independent source/evidence review at its recorded
head. The coordinator mapped corrections and integration changes to that review.
GitHub rejected formal approval of #441 because the separate writer and reviewer
use the same owner account; the independent review is retained as a PR comment.

The final three code PRs each passed all 19 exact-head checks, including aggregate
CI. Main then changed shared benchmark and dependency contracts. Each author
verified an automatic combined tree in an owned checkout, without changing the
green PR head or restarting full PR CI:

- **#441:** 19 navigation tests passed on the supported Pi runner after a fresh
  frozen install and mapped reuse of the author's own unchanged workspace outputs.
  Its focused regression first reproduced the two escaped HTTP reads; four nearby
  files had already passed 34 tests. It changes two test files.
- **#432:** 64 benchmark contracts passed after main's cadence change. The earlier
  clean three-case smoke recorded the original Unicode crash, completed later
  instrumentation and exited 1. The probe and diagnostic module stayed unchanged;
  pending launches are owned and late browser acquisition is cleaned up.
- **#434:** six recorder/provenance checks passed. Native renderer/core/atlas,
  instance and WASM blobs match the green head. Direct controls choose `zigFrame`
  explicitly and never perform nested scheduler flush. The old `clearGlyphs`
  fixture correction passed all 154 comparison cases and normal hooks.

#398's eight frozen extra frames contain two sibling builds inside one draw, one
upload batch and one submit. Their 24 writes form a full 12×40 upload of 76,800
bytes. The sequence supports a missing-glyph retry inference; the exact historical
glyph is unrecorded. Real native/JS browser controls check pixel parity. This is an
accounting resolution, with no new CPU improvement claim.

The subsequent main change #443 touched seven server-update/gallery/scenario
paths, with no relevant shared contract changes. Full main CI at `0555da0d`
passed in run `37089355186`. The coordinator merged original green #441 first
(`2553320ce`), then #432 and #434. Post-merge main CI at `e5d196741`
passed in [run 37090469976](https://github.com/ShaulLavo/fregat/actions/runs/37090469976).

## Live delivery

This pass deployed `20261003T012143Z-80f759c3-main-a41e4362`: client and server
`80f759c30`, zero dirty files, no staged update, live check passed at 01:22:18Z.
The production shell screenshot was read back and the post-restart warning/error
window was empty. The real context-popover dev scenario passed with zero browser
problems before deployment.

Other sessions subsequently delivered web-only updates. The latest observed client
is `0555da0d` (two dirty files reported); the server remains the clean `80f759c30`
release. Its live check passed at 02:27:12Z, there is no staged update, and the
refreshed production shell screenshot was read back. Both include this pass's
runtime fixes. The final test/benchmark-tool changes require no app rebuild.

**Gateway delivery remains incomplete:** #395's payload was installed atomically,
but the busy process still uses its previous code. A safe reload and live check
remain necessary. No active requests, credentials or stored data were disturbed.

## Discoveries outside the opening 17

Verification blockers were assigned in this pass. Other findings retain separate
issues so the review remains bounded:

- [#402](https://github.com/ShaulLavo/fregat/issues/402): quiet empty-slice fixture
  setup failed before the production runner. [PR #409](https://github.com/ShaulLavo/fregat/pull/409),
  `95cb29f68`, starts/checks its owned slice; closed. Historical cause unconfirmed.
- [#410](https://github.com/ShaulLavo/fregat/issues/410): folder-move undo test mixed
  semantic events with native watcher echoes. [PR #415](https://github.com/ShaulLavo/fregat/pull/415),
  `dc3d81592`, isolated the fixture; closed. Production semantics preserved.
- [#422](https://github.com/ShaulLavo/fregat/issues/422): stale native package hashes
  after a patch bump. Corrected canonical metadata and final 0.3.2 closure passed;
  closed on #431 merge.
- [#424](https://github.com/ShaulLavo/fregat/issues/424): formatter rejected a commit
  containing only excluded generated files. Peer fix `fc8a0ca3a` allows unmatched
  paths while preserving ordinary formatter failures.
- [#435](https://github.com/ShaulLavo/fregat/issues/435): pinned fd setup downloads
  returned HTTP 500/502. A bounded failed-job rerun passed. Separate pruning fixture
  repair #427 had landed before its assertion passed.
- [#437](https://github.com/ShaulLavo/fregat/issues/437): main's strict MSW check saw
  `lsp/match` and `fs/read` requests from the preceding navigation fixture. #441
  now disposes its owned application before restoring transport/query bindings;
  closed. Production navigation and strict MSW unchanged.
- [#444](https://github.com/ShaulLavo/fregat/issues/444): older main `59587bb8` failed
  the Pi lane child-stdin test with EPIPE. Later `2a3d8ca0` full main CI passed;
  follow-up retains the original failure, with no established product cause.
- [#446](https://github.com/ShaulLavo/fregat/issues/446): main `9e921d18` timed out
  installing Editor browser dependencies after Ubuntu APT mirror retries, before
  tests. Later `0555da0d` full main CI passed; exact blocked subprocess unknown.

A possible long-lived server/browser admission cycle was recorded on existing
[#405](https://github.com/ShaulLavo/fregat/issues/405), alongside memory-admission
facts. The foreign server later exited and normal admission resumed. No other
session's process was stopped and no quiet measurement was bypassed.

## Evidence, cleanup and audit

Complete opening comments, baseline/final checks, reviews and integration receipts
are retained in `/work/tmp/fregat-evidence/20261003-remaining-issues/`. The canonical
append-only decision ledger is `/work/reports/remaining-issues-20261003/decisions.tsv`;
`events.tsv` records only the initial worker launches.

The original preflight had green main before launch: Editor finished at 22:42:11Z,
aggregate CI at 22:42:17Z, workers launched at 22:43:06Z. Earlier apparent CI,
publication and scheduler-state contradictions were reconciled with primary
receipts. Subsequent failed setup/test runs remain recorded separately from later
passing runs.

Completed disposable worktrees are removed only when clean; evidence and branch
checkpoints remain. `/work/worktrees/platform/issues-deploy-20261003` stays because
the retained server release and rollback dependencies point into it. Those links
must be replaced before its removal.

Claude Haiku 4.5 audited the decision ledger against a bounded excerpt of this
active transcript and the report checkpoint. Bulk tool outputs were omitted;
this was a trail audit, not a second code review. Four apparent contradictions
were resolved against current merge, publication, CI and issue receipts. Its
remaining attention item is the gateway's safe reload/live verification.

## Execution checklist

- [x] Collect the opening backlog and complete comments across the review scope.
- [x] Reproduce confirmed bugs, use separate writers and independently review fixes.
- [x] Merge explicit green heads and map relevant changes when main moves.
- [x] Deploy the completed app batch and inspect live evidence.
- [x] Update source issues; close nine and retain eight with precise missing evidence.
- [x] File separate follow-ups for newly observed failures.
- [x] Confirm the final post-merge main CI result.
- [x] Validate final report formatting and the plan inventory.
- [x] Remove clean implementation checkouts and audit registered code PRs.

The report is published through [PR #436](https://github.com/ShaulLavo/fregat/pull/436).
Its own checks and merge state are visible there. The report checkout is removed
after publication; the deployment dependency checkout remains as described above.

Recurring issue collection remains ordinary API/script work. Starting another
agent requires the owner's instruction or an explicit opt-in rule. Approved plans
from the prior pass remain the implementation backlog.
