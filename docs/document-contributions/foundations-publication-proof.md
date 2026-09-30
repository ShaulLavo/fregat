# Committed document publication and retained analysis

The 2026-09-30 foundations wave executes Plan 099 publication and the retained-analysis contract
checks from Plan 198. Source baseline: Platform `2ac20743c4402b1ee0cdb205e69260b60cb89283`.
Editor source and package exports now live in `editor/packages/` in that same commit. There is no
external Editor checkout, CI editor-ref, global Bun link or SAB text transport to reconcile.

## Current consumer inventory

The [complete current scan](consumer-inventory.tsv) contains 340 classified occurrences across
canonical Editor packages/examples and Platform apps/shared packages: 181 source reads, 59 worker
or protocol messages, 33 session factories, 29 synchronization cursors, 23 subscriptions/view
notifications and 15 publication points. Its owner column distinguishes mutation, contribution,
presentation, domain adapter and host policy. API declarations and example probes are included;
these counts describe source matches, not active worker or subscription counts.

The nine production raw buffer subscriptions are:

| Subscriber                                | Responsibility and frame admission                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Core `Editor.ts`                          | Synchronous view updates; text, sync point and skipped-change endpoint come from the committed frame.   |
| Core `documentAnalysis.ts`                | Retained provider sessions; queue each captured revision with its matching immutable text.              |
| Core `historyViewer.ts`                   | Current undo graph presentation; reads the latest graph and combines no edit frame with it.             |
| LSP `document.ts`                         | Document protocol synchronization; snapshots and bounded edit-chain reads use the dispatch frame.       |
| LSP `bufferSync.ts`                       | Headless protocol synchronization; uses the same captured frame boundary.                               |
| Platform `workspace-document-service.ts`  | Logical/text revision accounting and dirty state; uses captured revision and dirty state.               |
| Platform `language-server-documents.ts`   | Analysis-size admission; uses the captured source length.                                               |
| Platform `use-editor-visible-snapshot.ts` | Saved-paint invalidation; uses captured dirtiness.                                                      |
| Platform `markdown-preview-pane.tsx`      | Latest immutable snapshot via React external-store reads; combines no edit metadata with that snapshot. |

The stress `consumers.ts` subscription is an example-only LSP copy probe. Minimap uses view
contributions; its source delivery remains unit 3 work. Tree-sitter/Shiki delivery and worker
queues remain provider-owned until unit 2. Snippet tokens and search excerpts own temporary
provider sessions; their migration remains unit 5. Diff source acquisition/highlighting stays
with the separately owned highlighting lane. Prepared documents already borrow retained analysis
and use `.borrow()`, not the historical transfer-only `.take()` API; fallback fold-index `.take()`
is an unrelated handoff.

## Canonical publication

One buffer `publish` operation owns immutable snapshot adoption, revision advancement, edit-chain
recording, change construction, source-view selection acceptance, maintenance and queued fan-out.
History decisions and transaction barriers remain with their existing mutation paths. Dispatch
frames carry `revisionBefore`, `revisionAfter`, `textSnapshotBefore`, `syncPointAfter` and a
bounded `changesSinceDocumentSyncPoint` reader. Nested mutation can advance the head; an earlier
frame's reader still stops at its own endpoint. Exhausted history or segment replacement returns
`null`, preserving the existing reset boundary.

Logical-only commits keep the exact text snapshot, advance logical revision and preserve text
version. History clear/restore emit frames without advancing revision. Selection emits no text
publication. Segment rotation remains eventless. Undo, redo, checkout, prepared commits and
compensation continue publishing at their existing accepted local boundary.

## Reproduced failures and fixes

- Original publication omitted frame revision identity. Three new publication tests failed before
  consolidation; captured source/revision, history-only transitions and throwing nested listeners
  now pass. Prepared/logical/compensation identity has its own focused proof.
- Original retained analysis read the mutable head: a nested `ab` → `abc` commit applied only `ab`
  and labeled that result as revision 2. Its regression test now observes both exact changes and
  the current result/snapshot pair.
- Superseded interest previously waited for a held provider request until the test timed out.
  It now settles as `AbortError` immediately; the provider's serialized source updates continue,
  preserving work needed by another lease. Theme generations also invalidate previous interest.
- Original workspace revision accounting treated a nested text commit as an earlier logical
  revision and skipped dirtiness/content invalidation. A real retained-buffer/prepared-document
  test failed with zero dirty revisions; it now records one dirty text revision.
- LSP checks caught snapshot recreation for a logical-only commit during consolidation. Snapshot
  adoption now preserves an unchanged immutable source object; both originating/non-originating
  protocol-version checks pass.

Independent review found that the mounted editor kept a publication after dispatch, so an eventless
segment rotation left contribution cursors on the old segment. It also found that source readers
used the mutable buffer head during nested delivery. The publication now exists only within the
synchronous delivery scope, and public editor, edit, decoration and feature source readers use its
captured snapshot. Two mounted-plugin regressions failed at `1cbdeae7847f` and pass after the fix;
they verify source/cursor agreement and live segment rotation. Their raw logs are
`public-contributions-red.log` and `public-contributions-green.log` in the evidence directory.

Retained-analysis proofs cover equivalent/incompatible configurations, distinct ranges, source
shortening, stale range replies, edit supersession, hover cancellation with an active view,
owner disposal, theme refresh and 20 acquire/release cycles. Workspace eviction disposes clean
analysis exactly once while preserving dirty analysis, text and undo; undo to clean then eviction
releases it. Provider ownership remains independent of a document's borrowed sessions.

## Evidence and limits

Raw local evidence lives at `/work/tmp/fregat-evidence/foundations-documents/`: current inventory,
three unchanged headless publication controls, an independent holdout, candidate samples, frozen
64 KiB/4 MiB/32 MiB fixtures and hashes, plus failing original-analysis/workspace logs.
`prepared-open.png` captures the real prepared editor surface; the screenshot was read back. The headless
samples retain checkout's size-dependent snapshot diff as mutation work. They are diagnostic
samples, not a browser input-latency acceptance or a performance improvement claim.

Checks: 161 focused core tests, 20 LSP synchronization tests, 61 Platform document/retention/runtime
and language-server admission tests, and seven real-worker prepared-open browser tests. The latter
run against private ports 5219/33319 and cover query-ready first-frame attachment, prepared
promotion without duplicate requests, dirty retained text before a delayed read and independent
Shiki/Tree-sitter readiness. Canonical workspace builds and affected typechecks are required too.

Unit 0 remains partial. The full expanded consumer-matrix native-input calibration has not run. Chat/workbench pixel-level
comparison of every visible token, retained parser/WASM byte accounting, an independent inactive
analysis budget and full memory-pressure/first-frame matrix remain Plan 198 acceptance work. No
budget was invented from document text size alone. These limitations do not expand authorization
into Plan 099 units 2–7 or Plan 200's editor-service migration.
