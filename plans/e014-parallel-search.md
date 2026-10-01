# E014: Search immutable snapshots across workers and stream results

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: Approved
- Kind: Implementation
- Owner: Cross-repo
- Priority: P2
- Effort: L
- Dependencies: [E001](../editor/examples/stress/README.md), [E008](../editor/docs/performance/e008-in-buffer-search.md)
- Inspected baseline: `9abb944f3a2b8d6516953fdec75e8df5e1a94811`, 2026-09-05.

## Outcome

Large find-all queries produce useful results and progress while the user can keep typing or cancel.
Workers search the same immutable document version and return results in deterministic order.
Platform can use the same engine for open buffers within its existing workspace-search flow.
The first implementation works without SharedArrayBuffer.

## Current code

- [Editor find](../editor/packages/find/src/search.ts) supplies synchronous query semantics and
  [FindController](../editor/packages/find/src/findController.ts) supplies scoped find and replacement behavior.
- [Document edit chains](../editor/packages/editor/src/editor/editChain.ts) already compose changes
  from an earlier sync point, with explicit gaps and segment changes.
- [Tree-sitter source transport](../editor/packages/tree-sitter/src/treeSitter/source.ts) offers
  an existing example of worker chunk mirrors. Its format is private to that package.
- [Platform search providers](../apps/web/src/features/search/utils/providers.ts)
  already combine disk and open-buffer search, preserve dirty-buffer precedence, and stream events.
- [Platform search batching](../apps/web/src/features/search/utils/buffer-runner.ts)
  already batches results into its UI. [Disk search](../apps/server/src/fs/search.ts)
  is an existing server concern. Cross-file search itself is not a missing Platform feature.

## Scope

Build a versioned snapshot-search job, a bounded worker pool, progressive result batches,
cooperative cancellation, and workload-based choice between synchronous and worker execution.
Integrate a Platform open-buffer provider without duplicating filesystem search or result chrome.
Platform retains chosen-root access, ignore rules, dirty-buffer precedence, limits, and path ordering.
Keep Replace All on the existing version-checked transaction path. Parallel mutation is excluded.

## Design

Propose a search job identity containing query identity, document identity, sync segment,
text version, and request generation. Every result batch repeats that identity.
Use E008's compiled-query classification and exact match semantics.
Partition provably line-local work at complete line boundaries, preserving each original scan domain.
For supported literals split within a scan domain, workers enumerate every raw candidate start,
including overlapping candidates. Required text overlap exposes boundary candidates, and each start
belongs to exactly one partition. Workers must not apply a local non-overlap filter or truncate candidates.
An ordered coordinator chooses the earliest candidate at or after the domain's carried search cursor,
advances by literal length, and then applies whole-word filtering, matching the existing scanner order.
It advances even for a raw match rejected by that filter. No later partition finalizes before its
predecessor's candidates and cursor are resolved. Bound queues with backpressure, not dropped candidates.
For `aa` in `aaaaaaaaaa`, partitioning at offset 4 must still produce `[0, 2, 4, 6, 8]`.
If candidate volume makes this reduction too costly, keep whole lines or ranges on one worker.
Send unbounded or unsupported regex to one worker over sufficient full context.
Do not split arbitrary regex into independent line ranges and silently lose matches.

Ordinary workers own mirrored immutable chunks updated through composed edit-chain changes.
A job pins its input version until completion or acknowledged cancellation.
Use E008's proven resynchronization rules before reusing a previous version's match suffix.
An inserted character can change the non-overlap phase throughout a self-overlapping literal run.
Rescan the full affected line or scoped range when no earlier matching scan state is proved.
If a mirror misses retained changes, resynchronize that document before scheduling a job.
E013 can later provide a shared reader under the same job protocol.
Extract only genuinely shared transport code after comparing Tree-sitter's lifecycle and search needs.

Stream bounded batches through a queue with backpressure and deterministic partition ordering.
Report completed work units, known total work, match count, and truncation separately.
Keep only visible or requested match details when a dense query would allocate millions of records.
Cancel ordinary workers between bounded chunks through messages and request generations.
Optional shared cancellation uses an epoch or flag, with E012 release acknowledgement before reuse.
Hard-cancel a worker running an uninterruptible regex when the declared timeout policy requires it.

Benchmark the main thread doing no search work against bounded participation during idle time.
Do not copy the wishlist's proposed double share onto the UI thread without input-latency evidence.
Record per-worker duration, queue time, startup, synchronization bytes, and straggler partitions.
Choose worker count and chunk size from measurements rather than hardware-thread count alone.

## Steps

1. Compare E008's synchronous engine with one worker using E001 stress fixtures.
   Establish the file and query sizes where dispatch and synchronization pay for themselves.
2. Implement ordinary chunk mirrors and a single versioned worker job with cancellation.
   Compare its exact results with E008's synchronous oracle.
3. Add partitioning, ordered raw-candidate reduction, bounded queues, progress, and worker timings.
   Prove global non-overlap equivalence before optimizing partition scheduling.
   Measure scaling with one, two, and more workers before selecting the pool policy.
4. Add an Editor demo that searches one buffer while edits and navigation continue.
   Verify old results cannot paint as results for the newly edited version.
5. Adapt Platform's open-buffer SearchProvider to immutable snapshots and the worker engine.
   Retain its disk provider, dirty overlays, chosen-root filtering, result limits, and batching.
6. Repeat combined typing-and-search measurements and document the synchronous crossover threshold.
   Treat E013 transport comparison as optional follow-up work, not a completion dependency.

## Verification

Use `bun run test test/search.test.ts test/findController.test.ts` from `packages/find` as the oracle control.
Add worker tests through that package's Vitest script and use actual browser workers for cancellation.
Test chunk-boundary matches, multiline literals, arbitrary regex fallback, Unicode offsets,
worker failure, out-of-order batches, empty results, truncation, and document disposal.
These cases catch duplicate matches, mixed versions, false completion, and retained cancelled snapshots.
Verify exact result equivalence across worker counts and the no-SAB environment.
Require `aa` over `aaaaaaaaaa` to return `[0, 2, 4, 6, 8]` when a partition owns starts at 4
and reads overlap beginning at 3. Reject a local greedy result of `[5, 7]` for that partition.
Repeat across every split with self-overlapping needles, rejected whole-word candidates, and scopes.
Insert and delete one leading `a` during a long-run query and compare the new job with a fresh scan.
Those tests must reject stale transformed suffixes even when the text far beyond the edit is unchanged.

Platform integration uses its focused search-provider and buffer-runner checks under its own test rules.
Test dirty text replacing disk results, chosen-root filtering, overlapping queries, file and match limits,
and navigation from a result after the underlying buffer changes.
Use a real browser to measure first useful result, completion, cancellation acknowledgement,
peak memory, and p95 input-to-paint latency during search.

Accept when worker execution improves the declared large-file target, small work stays on the cheaper
path, results remain exact, and cancellation releases the job's retained snapshot.
Require the existing Platform search behavior to pass unchanged before considering host integration done.

## Risks and decisions

Worker startup and mirror memory can exceed search cost on short files.
Dense results can dominate both transfer and rendering even when scanning parallelizes well.
A regex blocked inside native execution needs worker termination, not a flag it cannot poll.
Filesystem permissions and workspace policy stay entirely in Platform's existing search boundary.
