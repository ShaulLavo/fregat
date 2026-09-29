# E006 reclamation investigation

Measured 2026-09-22 against Editor `6656eb7113040f7489a15f4c6e2293e511a55edd`.
The initial working tree was clean. This records the first investigation and its rejected
tombstone-removal candidate. Its broad stop conclusion was corrected on 2026-09-23:
the [automatic text reclamation](e006-text-reclamation.md) preserves position metadata,
passes retained-anchor/snapshot checks and reduces measured heap in Bun and Chromium.
[Tombstone compaction](e006-tombstone-compaction.md) completed E006 on 2026-09-25 with an
equivalent compact representation, so the lifetime handles proposed below were not needed. The
rest of this report records the original observations and proposal.

## Reproduce

From the Editor root:

```sh
bun run --cwd packages/textbuffer build
bun run --cwd packages/editor bench:reclamation > examples/stress/results/reclamation/baseline.json
bun run --cwd packages/editor test test/reclamation-proof.node.test.ts test/pieceTable-anchors.test.ts test/pieceTable-snapshot.test.ts test/documentSession.test.ts
```

The [runner](../../packages/editor/bench/reclamation-run.ts) uses E001's seeded ordinary
document, three real view sessions, and the real buffer edit/history path. Each cycle inserts
and deletes a 1,024-code-unit paragraph at offset 7. This amplifies E001's four-code-unit
churn payload to expose text retention. An initial extra cycle supplies an external deleted
anchor and an inserted-state snapshot. Another snapshot is pinned every 100 cycles.

Every seed/workload runs in its own Bun subprocess after warmup. Each run checks retained
snapshot readability, deleted-anchor resolution, current text, and E005 invariants. It then
releases external snapshot references, clears history, and marks the current state clean.
The zero-history control never retains undo states in the first place.

[Raw results](../../examples/stress/results/reclamation/baseline.json) include all ten runs,
three seeds, GC heap readings, p50/p95/max edit-pair and 80-unit range-read durations, and
the experiment outputs. UTF-16 code units measure logical string extent, not physical heap
bytes. Chunk counts deduplicate buffer IDs that share a chunk. The line-index count and
capacity cover the backing store's shared map, which may include newer snapshot data.
The private append log can retain more text than an old snapshot's readable extent reveals.

These are headless storage/session measurements. No renderer was mounted, and the results
do not measure typing-to-paint, frame pauses, browser heap, or layout across multiple views.
Timing was rerun without concurrent test commands.

## Observations

Seed 60061, default 200 retained history states, after releasing pins, clearing history, and
marking clean:

| Churn cycles | Live code units | Tree nodes | Stored code units | Heap delta after GC | Edit-pair p95 | Range-read p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 4,469 | 103 | 107,893 | 613,009 B | 0.0234 ms | 0.0036 ms |
| 1,000 | 4,469 | 1,003 | 1,029,493 | 2,409,752 B | 0.0271 ms | 0.0071 ms |
| 5,000 | 4,469 | 5,003 | 5,125,493 | 11,611,050 B | 0.0216 ms | 0.0341 ms |

The other two seeds reproduce the same node and stored-text growth. At 5,000 cycles their
post-clear heap deltas are 11,637,386 B and 11,611,767 B. All runs have one history node after
clearing, no E005 issue, and 1,024 bytes of line-index capacity. GC deltas are approximate:
one small run's heap reading rises slightly after pin release, so a single delta is not a
reclamation assertion.

With history disabled from construction, the 5,000-cycle control still has 5,003 nodes,
5,125,493 stored code units, and an 11,601,712 B post-clear heap delta. The active root and
append log retain the obsolete pieces and text independently of undo retention.

With default history at 5,000 cycles, releasing 51 explicit snapshot pins reduces the
measured heap delta from 39,421,057 B to 15,609,571 B. Clearing history then reduces it to
11,611,050 B. Releasing readers helps but does not make current storage proportional to
live text. The 80-unit read also gets slower as the deleted pieces accumulate.

## Safety counterexamples

The [experiment module](../../packages/editor/bench/reclamation.ts) is outside production
entry points. Its deliberately unsafe candidate removes invisible pieces, builds a new
balanced tree and reverse index, and keeps the original buffers. It never publishes a root
to a session.

1. Insert `old` between `prefix ` and `suffix`. Hold left- and right-biased anchors inside
   `old`, delete it, and insert `NEW` at its former position. The current text is
   `prefix NEWsuffix`. The anchors resolve to deleted offsets **7 and 10**. After removing
   tombstones they both resolve to **0**. The visible text is identical, the original retained
   snapshot remains readable, and **E005 still reports no invariant issue**. Tree validity
   does not prove external-anchor validity. Keeping the buffer log also reclaims no text.
2. Fork twice from the same snapshot and insert `AAA` and `BBB` at the same position.
   Both anchors have identical public fields and both snapshots share `buffers.identity`,
   yet they refer to different strings. A protected-buffer set keyed by lineage identity
   and numeric buffer ID cannot distinguish these branches.
3. Give `acquireDocumentMutationLease` a shallow snapshot copy with the exact same tree,
   buffers, reverse index, and revision. It returns `stale`. The original snapshot succeeds.
   Source inspection confirms the same object-identity requirement in prepared commit,
   receipt reversal, and sequence continuation. A storage-only replacement can therefore
   invalidate work without changing text or logical revision.

The four experiment tests calibrate chunk counting and pin these counterexamples. The
existing anchor, snapshot, and document-session suites check the unchanged production
contracts, including transaction and history behavior. They do not certify reclamation.

## Retention owners

| Owner | What survives | Current release or identity contract |
| --- | --- | --- |
| [Textbuffer snapshots](../../packages/textbuffer/src/snapshot.ts) | Tree, reverse index, chunk-log view and line-index map | `retainPieceTableSnapshot` changes the mutation epoch. It does not register a reader or provide a release operation. |
| [Public anchors](../../packages/textbuffer/src/pieceTableTypes.ts) | Buffer number, offset and bias | Plain structural values. Callers can copy them. Neither creation nor loss of the last reference informs storage. |
| [Anchor resolution](../../packages/textbuffer/src/anchors.ts) | Original-piece coverage, inserted-buffer index, deleted-gap ordering | Tombstones preserve positions and the relative age of insertions. Removing an unlisted tombstone is unsafe. |
| [Buffer log](../../packages/textbuffer/src/buffers.ts) | Original string, appended chunks, ID-to-chunk mapping, line indexes | Earlier views retain the shared log. Forks can reuse numeric buffer IDs for different text. |
| [Document buffer](../../packages/editor/src/documentSession.ts) | Current history, clean snapshot, dirty-cache snapshot, text wrapper | Marking clean replaces the save baseline. The buffer interface has no disposal or reader-registration protocol. |
| [History graph](../../packages/editor/src/history.ts) | Node snapshots, before/after selections, transaction snapshots and inverse edit strings | Graph pruning caps states, not active-root tombstones. Exported graph snapshots may outlive their graph nodes. |
| [Views and selections](../../packages/editor/src/selections.ts) | Selection anchors, view-local state | Three view sessions may share one buffer. The buffer does not enumerate every externally held selection. |
| [Fold maps](../../packages/editor/src/foldMap.ts), [inline maps](../../packages/editor/src/inlineMap.ts) | Snapshot plus anchored ranges | Immutable maps can remain reachable outside the current view. |
| [Snippets](../../packages/editor/src/editor/snippetSession.ts), [linked editing](../../packages/editor/src/editor/linkedEditing.ts), [autoclose](../../packages/editor/src/editor/autoCloseStore.ts) | Anchored ranges or snapshot-keyed state | Feature reset/disposal is local. There is no common anchor-retention registry. |
| [Text snapshots](../../packages/editor/src/documentTextSnapshot.ts), syntax contributions and [worker client](../../packages/tree-sitter/src/treeSitter/workerClient.ts) | Raw snapshots behind wrappers and pending work | Async readers retain ordinary objects; no storage-lifetime acknowledgement accompanies release. |
| [Prepared transactions and receipts](../../packages/editor/src/documentSession.ts) | Before/after snapshots, inverse edits, prior history, sequence/barrier state | Preparation can happen before lease acquisition. Receipts have explicit release, but prepared snapshots and external copies do not. Exact snapshot identity is part of validity. |
| [Platform document service](../../../platform/apps/web/src/features/editor/state/workspace-document-service.ts), [WorkspaceEdit service](../../../platform/apps/web/src/features/editor/state/workspace-edit-service.ts) | Captured snapshots, prepared segments and receipts across awaited operations | Hosts acquire leases against captured snapshot objects and compare receipt snapshots to the active snapshot. A public lifetime change requires these callers to move too. |

## Design decision

Do not publish the visible-only candidate. It demonstrably breaks anchors, and retaining
the old log leaves the largest measured storage cost intact.

Keeping every deleted-position record can preserve structural anchor values, but the
records still grow with every distinct deleted insertion. Redacting text while keeping
all those records is a possible narrower improvement; it does not satisfy E006's bounded
piece-count outcome. It also needs a textless-piece representation because current piece
bounds, original-offset lookup, line indexes, and the inspector assume text-backed pieces.

The proposed route to full E006 is **explicit lifetime ownership**, including the host
callers. This is a proposed API direction, not a checked or implemented contract:

1. Give storage branches/generations opaque identities independent of dense numeric buffer
   IDs. Keep logical document revision separate from storage generation.
2. Replace freely copied durable anchor records with owned handles or owner-scoped anchor
   sets. All selections, maps, plugins and host consumers register and release through this
   contract. GC-only discovery cannot define deterministic maintenance eligibility.
3. Keep protected snapshots immutable and independently readable. Treat async reads,
   history nodes, save baselines, prepared work and receipts as explicit owners. A dropped
   history node is only one owner releasing its claim.
4. Define how an anchor resolves in both a retained historical generation and the active
   generation after maintenance. A one-time offset remap is insufficient: deleted-anchor
   bias must still span later insertions into the gap. Prove this on branched histories.
5. Separate transaction validity from physical snapshot object identity, or pin storage
   throughout preparation, commit and compensation. Pinning only acquired leases misses
   the preparation-to-acquisition window. Update Platform callers in the same change.
6. Only after those proofs, add session-owned incremental rebuilding, revision/generation
   checks between turns, atomic publication, and cancellation on replacement/disposal.

A piece is reclaimable only when no protected root requires its text or order and every
supported anchor retains equivalent resolution in every generation where it is valid.
A chunk is reclaimable only when all of its pieces and indexes meet that condition and
no protected snapshot/log reader still owns it. The current API cannot enumerate those
claims or establish their absence. Treating an unknown owner as absent is the unsafe step.

After that contract lands, the observed churn fixture supplies an initial memory target:
after releases, retained text and nodes must plateau as cycle count grows. Use a bound
derived from live pieces, explicitly protected records and chunk slack, rather than
historical edit count. These observations do not establish a browser pause budget.
Calibrate E001/E002 on the target browser before selecting a maintenance turn budget,
and retain the existing E002 p95 input limits.

No scheduler, maintenance API, production representation change, or new setting ships
from this investigation. Maintenance-boundary undo/redo, prepared-work preservation,
replacement/disposal cancellation, peak rebuild memory and browser input acceptance
remain unrun because there is no safe maintenance implementation to test.

## Verification recorded

- Textbuffer package build passed before measurements and tests.
- The focused command above passed 105 tests across four files.
- Core typecheck and repository formatting check passed.
- Repository lint exited successfully with four warnings in unchanged files.
- The backlog checker still reports broken links/status metadata in unchanged E030,
  E033, E036, E047 and E051 entries. E006's new local links resolve. Those unrelated
  backlog repairs are outside this investigation.
- Diff whitespace checks passed. There are no production source changes.
