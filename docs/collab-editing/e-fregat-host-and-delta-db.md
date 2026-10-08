# Fregat host and Delta DB revision

Sol research, 2026-10-08, Fregat main 1e066d38b. Read-only; nothing measured.

## Current document authority

### The live authority is currently client-side

The traced editing path has two authorities:

- **A client-owned `EditorTextBuffer` is authoritative for that client’s live, potentially unsaved document.**
- **The machine filesystem is authoritative for saved bytes.**

Creating an editor runtime creates its own document store; that store constructs a `WorkspaceDocumentService`. The service owns a map of document keys to live buffers and a separate map of tab IDs to views. This is client/runtime ownership, not a server-held collaborative document.

Evidence:

- `apps/web/src/features/editor/state/runtime.ts:70-90`
- `apps/web/src/features/editor/state/document-state.tsx:213-225`
- `apps/web/src/features/editor/state/workspace-document-service.ts:325-348`
- `apps/web/src/features/editor/state/history-buffer.ts:5-8`

Within that service, multiple editor tabs/views of a document share the same buffer. `ensureLiveDocument` looks up the existing document by file document key; attaching a new view creates an `EditorViewSession` over `document.buffer`. Selection and scroll belong to the view.

Evidence:

- `apps/web/src/features/editor/state/workspace-document-service.ts:888-915`
- `apps/web/src/features/editor/state/workspace-document-service.ts:1024-1055`

**Do not equate editor tabs with browser tabs.** The observed sharing is between views inside one document service. Independently created browser/desktop runtimes construct their own services. In the traced path, shared saved state travels through disk writes and filesystem events, not a live character-operation protocol. An exhaustive absence of all cross-window synchronization was not proven.

The server does retain another text representation for pooled LSP use. It is **not a collaborative editing authority**: a newly attached owner with different text replaces the backend document text, and an owner whose baseline is no longer synchronized sends a full replacement on its next change.

Evidence:

- `apps/server/src/lsp/proxy-session.ts:1260-1293`
- `apps/server/src/lsp/proxy-session.ts:1316-1362`

This is a particularly important migration boundary. A host-owned document must become the LSP text source; otherwise speculative client revisions can continue competing for the pooled backend’s text.

### Saves send whole document text to disk

`FileSyncService.save` captures the buffer snapshot, materializes visible text, obtains the disk-round-trip representation, and sends it with the file version and expected modification time. It issues a write ID for watcher-echo classification. On success, it updates the saved document revision and the file-snapshot query cache.

Evidence:

- `apps/web/src/features/editor/state/file-sync-service.ts:211-255`
- `apps/web/src/features/editor/utils/file-sync-ports.ts:18-26`

The server reads actual files through file handles. Writes check the existing version/time and write atomically with `fsync-all`.

Evidence:

- `apps/server/src/fs/read.ts:42-69`
- `apps/server/src/fs/write.ts:16-38`
- `apps/server/src/fs/write.ts:46-65`

Under host ordering, **saving should become a materialization request for an identified host revision**, not uploading a client’s whole speculative text as the authoritative replacement.

### External edits are detected and reconciled, not automatically merged

Open files have additional watch ownership, including real-path resolution and alias handling. The workspace watcher constructs `OpenFileWatches`, whose changes emit filesystem events. The watcher also contains a 20 ms native-event settling interval to avoid observing partial writes.

Evidence:

- `apps/server/src/fs/open-file-watches.ts:40-54`
- `apps/server/src/fs/open-file-watches.ts:66-84`
- `apps/server/src/fs/watch.ts:95-97`
- `apps/server/src/fs/watch.ts:147-155`

The client refresh path waits for pending saves, fetches a fresh disk snapshot, and compares the disk version/text with the live document. Its decision rule is:

1. Equal live and remote text: adopt the disk snapshot.
2. Dirty buffer with unchanged disk base version: retain the buffer.
3. Dirty buffer with changed disk version: show a conflict.
4. Clean buffer: replace from disk.

Evidence:

- `apps/web/src/features/workspace/hooks/use-events.ts:754-790`
- `apps/web/src/features/workspace/utils/event-model.ts:90-110`
- `apps/web/src/features/workspace/hooks/use-events.ts:793-810`

The existing conflict UI offers comparison/overwrite/adoption, including “Use the disk version.” It does not establish an automatic three-way merge of dirty local edits with external edits.

Evidence:

- `apps/web/src/features/editor/components/filesystem-conflict-toast.tsx:20-21`
- `apps/web/src/features/editor/components/filesystem-conflict-toast.tsx:58-93`

Reconnect and online transitions resynchronize open files. Dirty files are reread too, so changes missed during a gap can become conflicts.

Evidence:

- `apps/web/src/features/workspace/hooks/use-events.ts:253-285`
- `apps/web/src/features/workspace/utils/event-model.ts:67-87`

The available Plan 134 resolution record documents the earlier symlink, watched-dependency, and reconnect failures and their fixes. It should be read through its resolution section, not treated as an unresolved September audit.

Evidence:

- `docs/external-edit-lsp-findings.md:44-73`

### Plans 099 and 198 establish consumer ownership, not a machine host

Plan 099 is marked Delivered. Its common runtime routes document consumers through canonical publication and retained source delivery. Plan 198 assigns authoritative buffer/revision/undo/save identity to the live document and selection/layout to the view.

Evidence:

- `plans/099-document-contributions.md:1-14`
- `plans/198-document-owned-editor-analysis.md:89-110`
- `docs/document-contributions/ownership-boundaries.md:3-14`

The implementation publishes monotonic document revisions and an edit chain, then exposes captured reads and changes between revisions. This is the correct consumer-facing seam for collaborative reconciliation.

Evidence:

- `editor/packages/editor/src/documentSession.ts:1731-1769`
- `editor/packages/editor/src/editor/documentDelivery.ts:137-174`

**Recommended authority split:** the machine server owns the committed host revision; clients own optimistic projections and view state; disk owns a recorded materialization of a host revision.

## Agent edits

### Today’s providers execute native filesystem tools

Codex starts a native app-server process in the selected working directory. Its file-change notifications are converted into runtime output/activity, not document operations.

Evidence:

- `apps/server/src/provider/adapters/codex.ts:849-876`
- `apps/server/src/provider/adapters/codex.ts:1809-1820`

Claude starts its SDK query with the working directory and native tool-permission callback. Native `Edit`, `MultiEdit`, `NotebookEdit`, and `Write` tools are classified as file changes; `Bash` is classified as command execution. The permission callback allows tools in full-access mode rather than translating edits into a live-document commit.

Evidence:

- `apps/server/src/provider/adapters/claude.ts:907-935`
- `apps/server/src/provider/adapters/claude.ts:2267-2302`
- `apps/server/src/provider/adapters/claude.ts:3116-3128`

This supports the conclusion that ordinary provider edits reach the checkout through native filesystem execution. Exact behavior inside provider binaries was not independently exercised.

The existing Platform MCP bridge is useful infrastructure, but currently exposes only `workspace_info` and `read_file`. Its read tool opens a file and reads disk bytes, so it does not expose unsaved editor text.

Evidence:

- `apps/server/src/mcp/tool-names.ts:1-4`
- `apps/server/src/mcp/tools.ts:28-55`
- `apps/server/src/mcp/tools.ts:58-70`

### Options for disk↔live-document authority

| Option                                            | Advantages                                                                                                                                     | Trade-offs                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Host-native read/edit tools**                   | Reads include accepted unsaved text; edits carry an exact base revision, ID ranges, and trusted session/turn/tool provenance; no watcher delay | Requires provider integration and a strategy for native tools and arbitrary shell writes; registering MCP tools alone does not prevent bypass                      |
| **Import external disk diffs**                    | Works with existing providers, formatters, Git, shell commands, and external editors                                                           | Observes resulting bytes, not necessarily every edit; watcher events can combine changes; writer attribution is uncertain; stale-base edits require reconciliation |
| **Isolated agent worktree/snapshot, then import** | Gives the agent a stable read base; protects the shared working tree; allows a bounded, reviewable import                                      | Less immediately collaborative; requires branch/snapshot-to-host mapping; large rewrites can reduce identity preservation                                          |
| **Filesystem interception/virtualization**        | Potentially captures arbitrary reads and writes while exposing host text                                                                       | Highest complexity: atomic renames, symlinks, subprocesses, binaries, Git, watchers, permissions, and failure recovery                                             |

### Recommendation: host-native tools plus an external-writer bridge

Use host-native tools as the **precise path**, while retaining disk-diff ingestion as the **compatibility path**.

A host read should return document identity/epoch, host revision, requested text, and stable-ID mapping for the read region. An edit should reference that read revision or stable IDs and carry a deduplicatable operation ID. The server should attach trusted actor/session/turn/tool provenance.

For external disk writes:

1. Retain the exact last-materialized disk snapshot and its host revision.
2. Read a settled new disk snapshot.
3. Diff **old materialized disk text → new disk text**, not current live host text → new disk text.
4. Convert the diff’s old ranges into IDs from that materialized revision.
5. Submit the resulting edit intent to the same host ordering path.
6. Reconcile concurrent host edits and materialize the accepted result.

That baseline distinction prevents an external writer’s old whole-file snapshot from automatically deleting every unsaved host edit absent from disk.

**Important limitation:** the imported diff is inferred intent. A stale whole-file rewrite, ambiguous repeated text, or an overlapping transformation cannot always be safely reconstructed. The bridge needs conditional acceptance/review or isolated-worktree import for those cases. Host ordering guarantees a shared sequence; it does not prove the merged program expresses either writer’s intention.

Do not label a filesystem-derived change as a precise provider tool operation solely because it happened during a turn. Existing checkpoints capture worktree state at turn boundaries; they are not per-write causation receipts.

Evidence:

- `apps/server/src/orchestration/checkpoint-reactor.ts:45-56`
- `apps/server/src/git/checkpoint-store.ts:69-77`

Keep model account routing separate from this editing architecture. No direct-login fallback is needed or recommended.

## Server log fit

### Reuse event-sourcing principles, not the orchestration pipeline unchanged

The current event store offers valuable precedent:

- Unique event IDs.
- Aggregate stream versions.
- Actor, causation, correlation, and command metadata.
- Stream-version allocation inside the INSERT under the database write lock.

Evidence:

- `apps/server/src/db/schema.ts:176-204`
- `apps/server/src/orchestration/event-store.ts:51-75`
- `apps/server/src/orchestration/event-store.ts:253-267`

But adding a `document` aggregate is not sufficient. The current schema admits only project/worktree/session aggregate kinds. Normal orchestration commands append events, apply projections, and record command receipts in one transaction, then refresh the read model and publish.

Evidence:

- `apps/server/src/db/schema.ts:181`
- `apps/server/src/orchestration/engine.ts:748-761`
- `apps/server/src/orchestration/engine.ts:878-903`

The event store and stream delivery also emit multiple chat-pipeline logging operations. Applying that instrumentation literally to every text operation would need redesign, not simply an enum extension.

Evidence:

- `apps/server/src/orchestration/event-store.ts:44-47`
- `apps/server/src/orchestration/event-store.ts:78-81`
- `apps/server/src/orchestration/streams.ts:119-130`
- `apps/server/src/orchestration/streams.ts:364-375`

### Transport has a concrete per-message latency constraint

Server socket sends serialize immediately with `JSON.stringify`; there is no deliberate send delay in that helper.

However, the subscription pump:

1. Sends one `subscription.next`.
2. **Awaits its acknowledgement before sending the next item.**

The client acknowledges data after yielding it to the subscriber and resuming consumption.

Evidence:

- `apps/server/src/orchestration/ws-rpc.ts:381-402`
- `apps/server/src/orchestration/ws-rpc.ts:531-538`
- `packages/client-core/src/transport/orchestration-rpc-client.ts:1131-1143`

**Source-derived implication, not a benchmark:** sustained delivery on one subscription is gated by acknowledgement turnaround plus consumer processing. This stop-and-wait behavior is unsuitable to reuse unchanged for individually framed keystroke operations over a higher-latency connection.

There is also a **25 ms shell coalescing window**, but it belongs to the shell/sidebar stream. Session-detail delivery consumes event batches without that shell window. It would be inaccurate to claim every orchestration message incurs 25 ms.

Evidence:

- `apps/server/src/orchestration/streams.ts:82-88`
- `apps/server/src/orchestration/streams.ts:294-309`
- `apps/server/src/orchestration/streams.ts:330-355`

### Recommendation: a document-owned log and stream

Start with dedicated document tables/services in the existing SQLite setup, separate from chat projections and global chat-stream sequencing. A separate database should be justified by measurements; separate tables do not remove SQLite’s shared writer contention.

Suggested persisted data:

- Stable document ID and epoch.
- Per-document host sequence.
- Deduplicatable participant operation ID.
- ID-space insert/delete/replace intent.
- Trusted provenance and optional orchestration-event links.
- Snapshot/checkpoint records.
- Last materialized host revision and disk fingerprint.

Use bounded batches and cumulative acknowledgements or a bounded delivery window, not one network round trip per operation. Separate ephemeral presence from durable text/provenance. Scope subscriptions and replay to documents.

Persist before issuing a **durability acknowledgement**. If early acceptance acknowledgement is desired, distinguish it explicitly from durability.

Illustrative sizing only: 10 accepted operations/second is 36,000 operations/hour/document. Compressing contiguous insert runs and transport batches is therefore useful even before considering agents. No capacity or latency result was measured.

## Edit consumers

**Most named editor consumers already consume document changes without checking whether they originated from a keyboard.** Remote edits can use these paths if reconciliation publishes correct effective edits, snapshots, revisions, and reset boundaries.

| Consumer                 | Current evidence                                                                                                                                                                                                                           | Collaborative requirement                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Tree-sitter**          | Uses retained source reads and `changesBetween`; passes incremental edits against the previous analysed read. `editor/packages/tree-sitter/src/session.ts:120-159`                                                                         | Publish exact effective changes; reset/reparse when history cannot bridge a reconciliation                              |
| **LSP incremental sync** | Retained projection opens a snapshot when no baseline exists, otherwise updates it with canonical edits and logical revision count. `editor/packages/lsp-plugin/src/retainedSource.ts:210-260`                                             | Make accepted host text the pooled server source; version client speculative requests/results explicitly                |
| **Decorations**          | Editor flush projects every pending change’s edits; the store projects ranges with endpoint biases. `editor/packages/editor/src/editor/Editor.ts:4430-4434`; `editor/packages/editor/src/editor/decorationStore.ts:169-186`                | Feed the final reconciliation edits, not unrelated full-string replacements                                             |
| **Spellcheck**           | View contribution receives updates; document/content/token changes cause rechecking against current text. `editor/packages/spellcheck/src/plugin.ts:20-30`; `editor/packages/spellcheck/src/controller.ts:28-39,104-112`                   | Normal content publication suffices; no local-only edit filter found in inspected code                                  |
| **Minimap**              | Source protocol accepts full/reset summaries or incremental source patches with baseline identity checks. `editor/packages/minimap/src/sourceProtocol.ts:18-23,54-63`                                                                      | Preserve baseline identity and clipped projection behavior                                                              |
| **In-buffer find**       | Projects offscreen result ranges through canonical changes since its sync point. `editor/packages/find/src/plugin.ts:475-479`                                                                                                              | Retain effective history or trigger fresh query after a history gap                                                     |
| **Workspace search**     | Builds a dirty-buffer overlay from client live documents, then combines open-buffer results with disk search. `apps/web/src/features/search/state/dirty-documents.ts:7-22,25-47`; `apps/web/src/features/search/utils/providers.ts:79-113` | Extend search’s authoritative overlay to host-held unsaved documents, including documents edited by another participant |

### Ownership assumptions that need changes

- **View identity:** buffer changes from a different `sourceViewId` mark the attached view’s selections dirty and continue through the same publication path. This supports other-view edits; a remote participant should not impersonate a local source view.  
  `editor/packages/editor/src/editor/Editor.ts:3668-3687`

- **Mutation entry point:** the buffer accepts offset edits, normalizes/snaps them, and updates the piece table. It does not yet accept wire stable-ID operations.  
  `editor/packages/editor/src/documentSession.ts:697-717`

- **Origin metadata:** existing origin is only `'external' | 'view'`, with optional source view ID. This is insufficient provenance for participant, model, turn, tool, and host acknowledgement.  
  `editor/packages/editor/src/documentSession.ts:148-159`

- **Undo:** the existing buffer undo changes its history state and publishes inverse edits. Collaborative undo needs participant-scoped intent; restoring an old whole-document history state must not erase other participants’ later edits.  
  `editor/packages/editor/src/documentSession.ts:794-813`

- **External replacement:** the current filesystem refresh can replace the live document after fetching disk. That route must submit/import host operations instead of establishing a new competing text authority.  
  `apps/web/src/features/workspace/hooks/use-events.ts:782-810`

- **WorkspaceEdit coordination:** Plan 099 explicitly preserves local publication before server finalization and compensation afterwards. Host ordering must account for those committed segments/compensation, not pretend all multi-file edits are already atomic.  
  `plans/099-document-contributions.md:522-525`

During pending-local replay, do not expose rollback/apply/replay intermediate states to saves, LSP, search, or analysis. Publish a coherent reconciled transition, preserving logical-operation metadata even when final visible text is unchanged.

## Delta DB revision list

### Section 1 — Ground truth: correct stale implementation claims

The plan names an old `editor/src/pieceTable` location, a treap, immortal tombstones, and lifelong append-only text.

Plan claims:

- `plans/delta-db-implementation-plan.md:18-25`

Current implementation:

- Storage lives in `editor/packages/textbuffer`.
- `PieceBufferId` is a **branded number**, not a `'b7'` string.
- The sequence tree uses **persistent AVL join/balance**, not treap split/merge.
- Tombstones can compact into stand-ins.
- Text storage can reclaim unreferenced ranges.

Evidence:

- `editor/packages/textbuffer/src/pieceTableTypes.ts:6-12,52-70,107-112`
- `editor/packages/textbuffer/src/join.ts:4-6,83-92`
- `editor/packages/textbuffer/src/standIns.ts:3-6`
- `editor/packages/textbuffer/src/compaction.ts:430-463`
- `editor/packages/textbuffer/src/buffers.ts:107-125`

Existing anchors do preserve deleted liveness and resolve compacted pieces through stand-ins. That is valuable, but **does not by itself prove stand-ins preserve every deleted-character insertion position required by the wire protocol**.

Evidence:

- `editor/packages/textbuffer/src/anchors.ts:67-72,124-146`

The checkpoint reference claim is also stale. Current refs are `refs/platform/checkpoints/<encoded-session>/turn/<count>`, and the helper lives under orchestration.

Evidence:

- `plans/delta-db-implementation-plan.md:44-46`
- `apps/server/src/orchestration/checkpoint-refs.ts:1-4`

### Section 2 — The gaps

- **G1 remains:** local numeric insertion IDs are not participant-global wire identities. Introduce stable document/epoch and participant operation/run identity. Do not assume replacing numeric hot-path IDs with strings is the right implementation; a compact mapping/sidecar is an option requiring proof.  
  `plans/delta-db-implementation-plan.md:58-61`; `editor/packages/textbuffer/src/buffers.ts:496`

- **G2 disappears as a distributed-ordering requirement in hosted mode.** Fractional local order and normalization still exist, but can remain local indexes if wire ordering uses stable IDs and the host sequence. Never transmit those numeric order labels as collaborative authority.  
  `plans/delta-db-implementation-plan.md:63-73`; `editor/packages/textbuffer/src/orders.ts:18-38,50-69`

- **G3 remains:** offset edits must become ID-space intent at the submission boundary.  
  `plans/delta-db-implementation-plan.md:75-77`; `editor/packages/editor/src/documentSession.ts:697-717`

Add two missing gaps: **disk/live authority** and **optimistic pending reconciliation**.

### Section 3 — Architectural spine

Replace “CRDT machinery only at merge time” with:

> The host-ordered edit log owns accepted document history. A client materializes its accepted prefix plus pending local operations. Stable-ID ordering state is available during live collaboration; the textbuffer remains the efficient text/view representation.

The plan’s “typing hot path untouched” promise needs qualification: ID allocation/submission and optimistic reconciliation add work and need bounded measurements. Host collaboration is not a rare merge-only case.

Existing claims to revise:

- `plans/delta-db-implementation-plan.md:81-99`

### Phase revisions

| Phase                   | Revision                                                                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Instrumentation** | Keep baselines/fuzzing. Add pending replay, duplicate submission, reconnect, host restart, external writes, and crash-between-persist/ack scenarios. Measure reconciliation and consumer publication, not only primitive text edits                                                |
| **1 — Identity**        | Keep global wire IDs and anchor serialization. Define bootstrap IDs, document epochs, participant incarnations, retained tombstone positions, and mapping through compaction                                                                                                       |
| **2 — Op log**          | Keep provenance/blame/time travel. Replace “new orchestration aggregate, pipeline unchanged” with a document-owned log and stream linked to orchestration causes                                                                                                                   |
| **3 — Ordering**        | Replace Fugue implementation with host arrival ordering, atomic replace intent, idempotence, conditional acceptance, and client pending replay. Fugue becomes later optional host-free work                                                                                        |
| **4 — Replication**     | Replace version-vector synchronization with per-document epoch/host sequence plus participant operation IDs and pending queues. Keep presence and attribution. Standalone WebRTC remains separate                                                                                  |
| **5 — Trees/worktrees** | Keep file identity, tree operations, materialization, Git worktrees, and the measured virtualization decision. Move basic filesystem reconciliation earlier because agent participation depends on it. Hosted tree changes can be serialized; tree CRDT is optional host-free work |
| **6 — Annotations/git** | Keep span annotations, provenance, version↔Git mapping, and honest degraded anchors. Git amend/rebase does not inherently destroy log character IDs if lineage is preserved; loss occurs when imported replacement discards identity                                               |
| **7 — Compaction**      | Keep durable-log retention/compaction as a separate concern from already-shipped textbuffer reclamation. Establish replay snapshots and disconnect policy early; defer destructive GC until pending ops, annotations, retained versions, and stale participants are handled        |

Relevant existing phase text:

- `plans/delta-db-implementation-plan.md:117-170`
- `plans/delta-db-implementation-plan.md:172-238`

The cause-gated coalescing requirement should be reconsidered rather than copied mechanically. Current storage coalesces without cause metadata; a new log may retain separate provenance intervals even when storage shares a piece. The invariant is **preserve attributable character spans**, not necessarily “different causes require different storage pieces.”

Evidence:

- `plans/delta-db-implementation-plan.md:140-146`
- `editor/packages/textbuffer/src/tree.ts:34-51`

### Remaining sections

- **Risk register:** move disk reconciliation from “last phase” to an initial correctness risk. Add duplicate/rejected pending operations, host durability, replay publication, selective undo, and insufficient tombstone-position retention.  
  `plans/delta-db-implementation-plan.md:241-250`

- **Non-goals:** retain “no P2P in Fregat” while explicitly separating the standalone WebRTC plugin. Qualify “no WASM/web client,” because browser editor participants are central to this feature.  
  `plans/delta-db-implementation-plan.md:254-259`

- **D1:** remove the Loro-versus-own-Fugue decision from hosted mode. Replace it with a bounded identity-map/ID-list integration decision.  
  `plans/delta-db-implementation-plan.md:265-268`

- **D2:** keep the measured real-Git-worktrees-versus-virtualization decision. Real worktree infrastructure remains current.  
  `plans/delta-db-implementation-plan.md:270-272`; `apps/server/src/git/worktrees.ts:39-71`

- **Sequencing:** remove “nothing before phase 3 changes existing edit semantics” and “filesystem risk last.” Establish host authority and external-writer correctness before declaring shared-agent editing delivered.  
  `plans/delta-db-implementation-plan.md:276-280`

## Recommendation

Implement one host document service per machine server, with stable document identity distinct from path and epoch distinct from revision.

1. **Establish the identity/reconciliation model.** Preserve efficient local textbuffer storage; add stable wire insertion identities and enough deleted-position information for hosted operations.
2. **Build the document-owned host log and bounded stream.** Persist accepted order, deduplicate participant operations, and support snapshot-plus-tail reconnect.
3. **Bind client replicas at the buffer transaction boundary.** Local edits remain immediate. Host acknowledgement/reordering reconciles pending intent and publishes correct effective changes through Plan 099.
4. **Move pooled LSP synchronization to accepted host revisions.** Keep browser-local view/parser work responsive; explicitly version requests based on speculation.
5. **Add precise host read/edit tools for agents.** Return the revision and IDs used for edits, with trusted provenance.
6. **Implement disk-diff ingestion before enabling same-file agent collaboration.** Preserve a materialized baseline; review uncertain overlaps; retain isolated worktrees as the safe option for broad rewrites.
7. **Build Delta DB projections on that same log.** Provenance, annotations, time travel, and Git mappings should not invent a second edit history.

This follows Weidner’s programmable host model: clients create stable IDs, the server applies operations in receipt order, and clients reconcile their pending operations. The article also makes clear that host ordering is not the same as a host-free CRDT and does not guarantee all concurrent edits are semantically desirable.

External source: [Matthew Weidner, “Collaborative Text Editing without CRDTs”](https://mattweidner.com/2025/05/21/text-without-crdts.html).

## Open questions

1. **Unsaved text:** what does a compiler or shell command read while the host has accepted edits that have not been materialized?
2. **Agent policy:** are host-native tools required for shared-document sessions, or merely preferred with disk ingestion as fallback?
3. **Stale external rewrites:** which conditional-overlap failures require review versus automatic host application?
4. **Durability:** does an acknowledgement promise persisted recovery or only in-memory acceptance?
5. **Undo:** participant-scoped selective undo, and how should dependencies between participants’ edits behave?
6. **Compaction:** can E006 stand-ins retain exact insertion slots for remote operations, or must a separate ID-position structure retain them?
7. **Disconnects:** how long can a participant submit pending operations from an old epoch? What happens after history retirement?
8. **Document identity:** how are symlink aliases deduplicated while keeping distinct worktree files independent? How do rename/delete/recreate affect epochs?
9. **LSP speculation:** should results reflect only accepted host text, or may clients request analysis of explicitly speculative revisions?
10. **Multi-file atomicity:** retain ordered document/resource segments and compensation initially, or add a true host-wide transaction?
11. **Provenance confidence:** how is inferred filesystem attribution distinguished from exact host-native tool causation?
12. **Retention:** which versions, annotations, branch points, pending client queues, and agent reads pin IDs/history?
