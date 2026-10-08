# Lane A: Weidner's model on the Singapore textbuffer

Sol research, 2026-10-08, Fregat main 1e066d38b. Articulated at 2332042a240327c7ade5fd1ba1a367f230b539c1.

## Findings

### 1. Weidner’s model is simple, but our anchor API is not its character-order API

The algorithm maintains an ordered list of **all known characters**, including deleted characters. Insertions splice immediately after a named character in that complete order; deletion changes visibility without removing identity. Consequently, two insertions after the same ID appear in reverse processing order. The authority supplies the processing order; the operations themselves are not commutative.

Clients retain the last confirmed state. Upon receiving an authoritative operation, they restore that state, apply the operation, remove acknowledged pending operations, and replay remaining pending operations. Persistent snapshots make restoration cheap; they do not make replay free.

Sources:

- [Weidner’s article](https://mattweidner.com/2025/05/21/text-without-crdts.html).
- Articulated inspected at commit `2332042a240327c7ade5fd1ba1a367f230b539c1`.
- [IdListSimple insertion](https://github.com/mweidner037/articulated/blob/2332042a240327c7ade5fd1ba1a367f230b539c1/packages/articulated/test/id_list_simple.ts#L62-L130).

**IdListSimple** is an array of `{id, isDeleted}` plus a visible-length count. It searches the full array for an origin and splices beside it, including when that origin is deleted. It intentionally omits persistence and compression.

**IdList** uses a persistent, keyless B+tree whose traversal defines sequence order. Leaves compress consecutive `{bunchId, counter}` IDs into ranges; a run-length sparse presence structure records which counters remain visible. Internal nodes summarize visible and known counts. Persistent maps connect leaves to parent sequence numbers and inner sequence numbers to their parents, permitting ID-to-tree-path lookup without mutable parent pointers.

Insertion either extends a compatible leaf, adds a leaf beside it, or splits the origin’s leaf around the insertion point. Deleted origins follow exactly the same structural placement path. Deletion updates presence ranges. Saving emits ordered `{bunchId, startCounter, count, isDeleted}` runs; loading reconstructs balanced trees and indexes. Rollback can restore a retained IdList object; `uninsert` is an exact insertion inverse, unlike deletion.

Sources:

- [Structure](https://github.com/mweidner037/articulated/blob/2332042a240327c7ade5fd1ba1a367f230b539c1/packages/articulated/src/id_list.ts#L12-L43).
- [Insertion](https://github.com/mweidner037/articulated/blob/2332042a240327c7ade5fd1ba1a367f230b539c1/packages/articulated/src/id_list.ts#L285-L379).
- [Deletion](https://github.com/mweidner037/articulated/blob/2332042a240327c7ade5fd1ba1a367f230b539c1/packages/articulated/src/id_list.ts#L585-L619).
- [Persistence format and loading](https://github.com/mweidner037/articulated/blob/2332042a240327c7ade5fd1ba1a367f230b539c1/packages/articulated/src/id_list.ts#L1032-L1093).
- [Generator](https://github.com/mweidner037/articulated/blob/2332042a240327c7ade5fd1ba1a367f230b539c1/packages/articulated/src/element_id_generator.ts#L34-L51).

The generator extends its own bunch only when inserting immediately after its last reserved counter; otherwise it allocates a fresh globally unique bunch. This is the useful compression principle to borrow. Adopting Articulated wholesale would introduce a second sequence tree and its indexes.

### 2. `(buffer, offset)` is a useful local storage identity, not a global character identity

A piece references an insertion buffer and a **chunk-relative UTF-16 offset**. Multiple insertion buffers can share a chunk; a large insertion can span several buffers. Sequential typing can extend an existing buffer without allocating another buffer ID.

Sources:

- `editor/packages/textbuffer/src/pieceTableTypes.ts:6–12`
- `editor/packages/textbuffer/src/buffers.ts:792–848`
- `editor/packages/textbuffer/src/buffers.ts:851–863`

Within an unreordered insertion span, this pair is usable as the identity of a code unit, provided membership and snapshot extent are checked. It is not necessarily a Unicode character, nor is an anchor necessarily a character ID: left-biased anchors refer to the preceding unit.

Sources:

- `editor/packages/textbuffer/src/reverseIndex.ts:522–536`
- `editor/packages/textbuffer/src/anchors.ts:30–42`

**G1 remains real and has an additional branch-replay implication.** Buffer numbering starts at one and is derived from snapshot-local `nextBufferSequence`. Two replicas—and two divergent edits of the same retained snapshot—can allocate the same pair for different text.

Sources:

- `editor/packages/textbuffer/src/buffers.ts:815–845`
- `editor/packages/textbuffer/src/buffers.ts:893–905`

Simply adding a replica name to today’s buffer sequence is insufficient if speculative replay reallocates sequence numbers or changes coalescing. Global IDs must be allocated once when authoring an operation, outside rollback state, and survive every replay.

### 3. E006 preserves anchor behavior, not exact deleted-character order

Before compaction, tombstone pieces retain their buffer ranges. Those ranges could support exact structural placement with a new tree primitive. The existing APIs do not provide it:

- Deleted-anchor resolution returns a visible gap edge selected through bias and buffer-age scans.
- Visible-offset insertion explicitly avoids placement between two tombstones.

Sources:

- `editor/packages/textbuffer/src/anchors.ts:67–86`
- `editor/packages/textbuffer/src/anchors.ts:228–238`
- `editor/packages/textbuffer/src/tree.ts:250–255`

Therefore, `resolveAnchor(X)` followed by `insertIntoPieceTable(offset, text)` cannot implement Weidner’s exact “insert after deleted X” semantics. Distinct deleted characters can resolve to the same visible offset while defining different known-order insertion boundaries.

**Compaction makes the distinction stronger.** It groups tombstones by their anchor-gap scan behavior, redirects their reverse-index entries, and replaces groups with zero-length stand-ins. Multiple historical identities can fold into one stand-in. This intentionally discards distinctions invisible to today’s anchor contract.

Sources:

- `editor/packages/textbuffer/src/compaction.ts:8–11`
- `editor/packages/textbuffer/src/compaction.ts:171–189`
- `editor/packages/textbuffer/src/compaction.ts:303–340`
- `editor/packages/textbuffer/src/standIns.ts:94–118`

Original-buffer tombstones retain actual ranges, but inserted tombstones do not universally retain enough information for arbitrary future insert-after/before operations.

Source:

- `editor/packages/textbuffer/src/compaction.ts:158–167`

Reclamation is a different concern: it retains visible text ranges across supplied snapshots and can free deleted text. It does not itself erase piece ordering, but exact collaborative ordering must not require reading reclaimed character contents.

Sources:

- `editor/packages/textbuffer/src/reclamation.ts:30–58`
- `editor/packages/textbuffer/src/buffers.ts:132–146`

**Recommendation:** collaborative lineages initially keep exact tombstone ranges and disable lossy stand-in compaction. Keep physical text reclamation, retaining all confirmed/speculative snapshots that may still need their visible text. Later compact identity metadata only under a proven protocol rule; acknowledgement alone does not prove that future operations cannot reference old deleted IDs.

### 4. Host ordering removes distributed G2, not local relabeling cost

`order` is a local piece-tree navigation label. Interior insertions allocate fractions between neighboring labels. Exhausted gaps trigger an in-order relabel of the tree and corresponding reverse-index updates.

Sources:

- `editor/packages/textbuffer/src/orders.ts:18–47`
- `editor/packages/textbuffer/src/snapshot.ts:72–94`
- `editor/packages/textbuffer/src/tree.ts:855–869`

With an authoritative sequence and ID-space operations, these labels need not be shared across replicas. Relabeling can remain a local implementation detail. Replicas may even have different piece fragmentation and labels while agreeing on global character order.

Thus the old plan’s **distributed fractional-index conflict is avoided without replacing `order`**. Its occasional whole-tree normalization cost still exists and must be measured.

### 5. Coalescing and replace must respect authored identity

Current coalescing extends the newest inserted piece when its text ends at the chunk tail and room remains; it then extends the backing chunk. It does not allocate a new insertion buffer.

Sources:

- `editor/packages/textbuffer/src/tree.ts:34–51`
- `editor/packages/textbuffer/src/tree.ts:108–114`
- `editor/packages/textbuffer/src/edits.ts:202–212`

Retain that fast path only when the new global IDs are the next counters of the same identity run and placement/provenance metadata remains representable. Consecutive physical storage alone cannot justify merging distinct global runs.

Current replace already hides the selected range and places replacement text in one edit transaction and tree descent. It is not necessarily two public edits.

Sources:

- `editor/packages/textbuffer/src/edits.ts:215–249`
- `editor/packages/textbuffer/src/edits.ts:159–182`

Wire-level replace should nevertheless decompose into explicit delete-ID spans plus an insertion, carried in **one atomic operation envelope**. A remote concurrent insertion inside the original selected range must survive unless its ID was explicitly selected for deletion.

## Op format proposal

```ts
type OpId = { actor: string; seq: number }
type CharId = { bunch: string; counter: number }
type IdSpan = { start: CharId; count: number }

type EditOp = {
  document: string
  epoch: string
  id: OpId
  lamport: number
  deps: readonly OpId[]
  change:
    | {
        kind: 'insert'
        start: CharId
        after: CharId | 'START'
        before: CharId | 'END'
        text: string
      }
    | {
        kind: 'delete'
        spans: readonly IdSpan[]
      }
    | {
        kind: 'replace'
        spans: readonly IdSpan[]
        insert: {
          start: CharId
          after: CharId | 'START'
          before: CharId | 'END'
          text: string
        }
      }
}
```

Proposal details:

- Each insertion reserves `text.length` UTF-16 code-unit IDs; a fresh bunch uses an actor/session namespace plus monotonic run sequence. Reserve counters once, outside snapshots.
- `after` and `before` are the **author’s** neighboring IDs before applying that operation. Do not rewrite them during replay.
- `deps` is a causal frontier of operation IDs, not an unrelated scalar revision. Host messages additionally carry authority epoch and sequence.
- Normalize ingestion before ID allocation. Snap local editor selections once before extracting IDs. Exact remote deletion must not invoke offset-based surrogate repair that expands deletion onto unrelated IDs.
- Reject unknown origins or defer until dependencies arrive. Do not silently turn missing IDs into offset zero.
- Duplicate operation delivery is deduplicated by `OpId`; deleting already-deleted IDs is harmless.
- Persist identity runs, ordering metadata, causal frontier and authoritative sequence alongside visible text. A text-only checkpoint is insufficient.

### Fugue caveat

Adding `before` does **not** itself implement Fugue.

Weidner’s Fugue description uses an immutable parent/side tree: for neighbors `a,b`, insert as a right child of `a` when `a` is not an ancestor of `b`; otherwise insert as a left child of `b`. Traversal is left children, node, right children; same-side siblings are sorted by causal dots. Deleted positions remain in the tree.

Source: [Fugue semantics and tree implementation](https://mattweidner.com/2022/10/21/basic-list-crdt.html).

A Fugue-derived host therefore needs retained ancestry/side information, compressed for straight runs, and a specified deterministic sibling comparator. Whether to derive parent/side at the author or authority must be fixed before implementation. For future host-free Fugue, author-context parent/side or sufficient causal reconstruction must survive in the log.

**Unconfirmed:** correctness of a custom host-arrival-order variant for nonadjacent origins after concurrent edits. The inspected article supplies Fugue’s construction, not a proof of that adaptation. Keep the ordering policy versioned and test this separately.

### Host application and pending replay

Maintain `{confirmedSnapshot, orderingMetadata, frontier, authoritySequence}` as one logical state.

1. Validate causal dependencies and operation identity.
2. Locate exact known-order insertion boundaries or deletion fragments.
3. Apply one atomic persistent edit and publish its metadata together.
4. Broadcast the accepted operation and authority sequence.

Clients maintain confirmed state plus a pending queue and derived visible state. Restore confirmed state by reference; consume authoritative operations in sequence; remove acknowledged pending operations; replay remaining operations with unchanged IDs and origins.

Retain confirmed and exposed speculative snapshots explicitly when using transient mode. Maintenance currently republishes roots/indexes in place, so retaining a snapshot does not protect collaborative ordering metadata from lossy compaction.

Sources:

- `editor/packages/textbuffer/src/snapshot.ts:56–69`
- `editor/packages/textbuffer/src/snapshot.ts:97–115`
- `editor/packages/textbuffer/src/compaction.ts:430–462`

## Required textbuffer changes

1. **Global identity runs separate from storage buffers.** Add snapshot-consistent run mappings between global counters and local buffer/chunk spans. Keep numeric storage IDs on existing hot paths. Provide the reverse mapping for authoring selections and origins. Relevant contracts are in `editor/packages/textbuffer/src/pieceTableTypes.ts:39–50,63–88,150–175`.

2. **Exact structural insertion.** Add insertion beside a located piece/code-unit boundary, including hidden pieces; split hidden ranges where necessary. Reuse AVL joins and local order labels. Do not round-trip through visible offsets. Existing landing behavior is at `editor/packages/textbuffer/src/tree.ts:235–288`.

3. **ID-span deletion.** Enumerate every matching fragment, hide only visible targeted IDs, and publish one transaction. A counter span may have concurrent text between its fragments; its two visible endpoints cannot define a safe ordinary range delete. Existing hide/split machinery is at `editor/packages/textbuffer/src/tree.ts:354–435`.

4. **Reuse the reverse index.** It already maps local buffer plus unit to piece order, followed by an order-tree lookup accumulating visible length. It can serve the local half of global-ID lookup while exact tombstones remain. Entries contain no lengths, so callers must check membership. Sources:
   - `editor/packages/textbuffer/src/reverseIndex.ts:149–170,527–541`
   - `editor/packages/textbuffer/src/tree.ts:719–764`

5. **Collaboration-aware maintenance and coalescing.** Preserve exact deleted identity order; coalesce only compatible global runs. Relevant implementations are `editor/packages/textbuffer/src/compaction.ts:303–340` and `editor/packages/textbuffer/src/tree.ts:34–51`.

## Risks and hot-path estimate

These are structural estimates, **not measured latency claims**:

- Offset-to-ID: one AVL descent plus run lookup.
- ID-to-offset: global run/interval lookup, persistent reverse-vector lookup, split-tree lookup, then one AVL descent. Approximately logarithmic in identity runs, fragments and pieces.
- Straight typing: existing insertion descent plus origin extraction and a small identity-run extension. Avoid per-character objects, copying a full metadata map, or maintaining a second sequence tree.
- Delete/replace: proportional to targeted fragmented spans plus tree work; large selections must stream spans.
- Replay: proportional to pending operations and affected fragments. A long offline queue is the main latency risk.
- Keeping exact tombstones grows retained ordering metadata. Reclaimed text can remain small while ordering history grows.

No evidence yet proves the proposed design meets **8.3 ms per keystroke**. Measure straight typing, remote arrival with varying pending depths, heavily fragmented deletions, normalization, and long collaboration histories. Keeping the AVL and reverse index is the least-complex plausible path; adding an independent Articulated tree would require justification.

## Verification and open questions

A bounded scratch prototype (not kept in the repository) ran successfully.

It demonstrated:

- Two independent snapshots applying the same ordered, live-origin ID operations both produce `aXqY`.
- Divergent snapshots assign `(buffer=1, offset=0)` to different characters.
- Distinct deleted IDs resolve to the same visible offset.
- Four adjacent deleted inserted units compact to three zero-length stand-ins while anchor resolution remains unchanged.
- The retained empty base remains unchanged after divergent edits.

This prototype deliberately **does not prove deleted-ID insertion, Fugue placement, convergence under reordering, or performance**.

Open questions:

1. Fix the exact Fugue/Fugue-derived ordering rule, tie-breaker, and author-versus-host parent/side derivation.
2. Confirm UTF-16 code-unit identity and the policy for concurrent surrogate edits.
3. Define document reset/authority epochs and original-text IDs.
4. Define reconnect retention and checkpoint rules for offline origins.
5. Separate protocol rollback from user undo; user undo must become new operations.
6. Determine how much pending replay can run synchronously before exceeding the typing budget.
