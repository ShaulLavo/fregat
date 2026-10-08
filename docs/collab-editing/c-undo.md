# Collaborative editing: undo across collaborators

## Scope and inspected revisions

Source inspection only; upstream tests were read, not executed.

| Repository         | Inspected commit                           |
| ------------------ | ------------------------------------------ |
| Fregat / Singapore | `1e066d38b6455b45d406fce175f902152a58295b` |
| Zed                | `dc3fb21676457b84d2233ac4c6bec5cebc698ec3` |
| Loro               | `c00c9fa501f8d32f68d6255eacb7035a67fb6ab6` |
| Yjs                | `d01eefc997cf12d29d5aabea804df5f69c659a79` |

Pinned upstream source roots:

- https://github.com/zed-industries/zed/tree/dc3fb21676457b84d2233ac4c6bec5cebc698ec3/crates/text
- https://github.com/loro-dev/loro/tree/c00c9fa501f8d32f68d6255eacb7035a67fb6ab6
- https://github.com/yjs/yjs/tree/d01eefc997cf12d29d5aabea804df5f69c659a79

### Main finding

**Stable character IDs solve targeting, but a single deleted/revived bit does not implement “undo only my operations.”**

Suppose Alice and Bob independently delete character ID `x`. If Alice’s undo simply sets `x.isDeleted = false`, it also cancels Bob’s deletion. The proposed model needs **deletion provenance**: undo withdraws Alice’s deletion effect, while Bob’s active deletion still hides `x`.

Zed supplies a particularly clear precedent: a fragment is visible only when its insertion is active **and every deletion affecting it is undone**. This is an operation-effect model, not indiscriminate character revival.

Evidence: `references/zed/crates/text/src/text.rs:3150–3160`.

This refinement fits host ordering: it needs stable operation IDs and host-ordered effect changes, without requiring a decentralized CRDT.

## 1. How Zed, Loro, and Yjs do it

### Zed: per-replica transactions and reversible operation effects

**History representation.** A transaction holds its ID, a list of edit IDs, and its starting version. The history has local undo and redo stacks, alongside a broader operation store.

Evidence: `references/zed/crates/text/src/text.rs:135–159`.

**Local versus remote ownership.** Local `edit` starts a transaction, applies the edit, stores the operation, and adds its timestamp to the transaction’s undo list. Incoming `apply_ops` stores and applies operations without calling `push_undo`. Thus receiving somebody else’s edit does not add that edit to the receiving replica’s normal undo stack.

Evidence: `references/zed/crates/text/src/text.rs:390–405,875–921`.

**Undo and redo on the wire.** Both operations use the same mechanism. For every edit ID in a transaction, Zed increments its undo count and emits an `UndoOperation` containing:

- a new Lamport timestamp;
- the current version;
- a map from original edit IDs to undo counts.

Odd counts mean undone; even counts mean active. The undo map takes the maximum recorded count for an edit. Historical visibility considers only undo records observed by the requested version.

Evidence:

- `references/zed/crates/text/src/text.rs:632–637,1352–1444`.
- `references/zed/crates/text/src/undo_map.rs:51–113`.

**Concurrent editing semantics.** Visibility is:

```text
insertion is active
AND every deletion of this fragment is inactive
```

Consequences, derived directly from that rule:

- Undoing Alice’s insertion hides Alice’s fragments.
- Bob’s independently inserted fragments are not hidden merely because they were placed inside Alice’s text.
- Undoing Alice’s deletion does not reveal a fragment that Bob still deletes.
- Redoing Alice’s insertion does not overcome Bob’s deletion of its characters.

Evidence: `references/zed/crates/text/src/text.rs:3150–3160`.

**Grouping and redo invalidation.** Nested transactions collect edit IDs. Empty outer transactions disappear. Completing a nonempty local transaction clears redo. Adjacent transactions group by time unless grouping is suppressed; the production default in this revision is 300 ms, while tests default to zero. Grouping joins operation IDs, not offset-space inverse scripts.

Evidence: `references/zed/crates/text/src/text.rs:217–325`.

**Important boundary.** The inspected `crates/text` transaction type contains no cursor/selection restoration data. Selection restoration above this layer was not researched sufficiently to claim Zed’s editor-level policy.

Evidence: `references/zed/crates/text/src/text.rs:135–139`.

### Loro: local operation spans, transformed inverse diffs, fresh operations

**Scope.** `UndoManager::new` subscribes at the document root and tracks the document peer’s local operation counter. Its history items cover counter spans. Origin-prefix exclusions and pausing prevent local edits from becoming undo steps while still incorporating their effects into history transformation.

This is a document/peer manager in the inspected implementation, not Yjs-style constructor scope over a chosen list of text types.

Evidence: `references/loro/crates/loro-internal/src/undo.rs:262–275,672–715`.

**How reversal works.** Loro splits the original operation span around external dependencies, calculates inverse diffs from historical versions, transforms those inverses over intervening changes, and applies the resulting diff as fresh local operations.

It does **not** generally revive the original deleted character IDs. Its cursor regression explicitly states that undo creates new `"Hello"` with different IDs.

Evidence:

- `references/loro/crates/loro-internal/src/undo.rs:1141–1223`.
- `references/loro/crates/loro-internal/src/loro.rs:1265–1365`.
- `references/loro/crates/loro/tests/integration_test/undo_test.rs:1719–1736`.

**Remote edits and grouping.** Imported changes compose into both undo and redo stacks. An import intersecting an explicit group ends that group; disjointness is checked through the group’s affected containers. Recorded local checkpoints merge through the configured interval or explicit grouping and clear redo.

Evidence: `references/loro/crates/loro-internal/src/undo.rs:596–665,718–746,780–805`.

**Selection restoration.** `on_push` captures metadata and cursors; `on_pop` receives transformed cursors. The implementation transforms cursor positions through remote changes and preserves selection metadata across repeated undo/redo, rather than blindly taking the user’s current caret on every reversal.

Evidence: `references/loro/crates/loro-internal/src/undo.rs:255–260,333–365,847–904,971–1019`.

**Text already removed by a collaborator.** The `undo_text_collab_delete` regression lets Bob remove `"fox "` from Alice’s text. Alice repeatedly undoes/redoes her remaining edits; `"fox "` stays removed throughout. The manager skips reversal items that produce no new local operations.

Evidence:

- `references/loro/crates/loro/tests/integration_test/undo_test.rs:751–784`.
- `references/loro/crates/loro-internal/src/undo.rs:993–1027`.

**Redo invalidation and identity changes.** New recorded local work clears redo; imported changes transform redo rather than clearing it. Checkout clears both stacks unless the manager is paused. Peer-ID changes also clear both stacks and update the peer being tracked, despite the earlier comment warning against changing PeerID during the manager’s lifetime.

Evidence: `references/loro/crates/loro-internal/src/undo.rs:660,718–766`.

### Yjs: scoped ID sets, origin tracking, redone-ID chains

**Scope and ownership.** The constructor accepts a document, one type and descendants, or an array of types. Transactions are captured only when they pass scope, `captureTransaction`, and `trackedOrigins` checks. The default tracked origin is `null`; the manager adds itself so its own undo/redo transactions can create opposite-stack entries.

Therefore “local-only” is an integration policy: assign distinct local and incoming origins. Tracking an incoming origin deliberately makes those operations undoable too.

Evidence: `references/yjs/src/utils/UndoManager.js:155–177,206–218`.

**History representation.** Each stack item stores inserted and deleted ID sets plus a metadata map. Undo deletes applicable inserted items, follows `redone` chains, and reconstructs applicable deleted items. IDs created and deleted within the same capture interval are excluded from restoration.

Evidence: `references/yjs/src/utils/UndoManager.js:16–28,55–109`.

**Restoration creates new IDs.** `redoItem` copies the old content into a new item under a fresh client ID/clock, records `item.redone`, and integrates the new item. This differs from same-ID tombstone revival.

Evidence: `references/yjs/src/utils/UndoManager.js:425–451,515–528`.

**Grouping and redo invalidation.** Capture timeout defaults to 500 ms; `stopCapturing()` breaks grouping. New captured forward work clears redo. Transactions rejected by the origin/scope filter return before clearing redo. Undo transactions produce redo entries; redo transactions produce undo entries.

Evidence: `references/yjs/src/utils/UndoManager.js:160–165,206–237,308–321`.

**Collaborator edits.** `testUndoText` demonstrates:

1. Alice inserts `"abc"` and another user inserts `"xyz"`.
2. Alice’s undo leaves `"xyz"`.
3. Redo restores `"abcxyz"`.
4. The other user deletes `"a"`.
5. Alice’s subsequent undo/redo yields `"bcxyz"`, not `"abcxyz"`.

The other user’s deletion remains effective.

Evidence: `references/yjs/tests/undo-redo.tests.js:72–85`.

**Attributes and embedded objects need additional policy.** The default attribute policy avoids overwriting remote attribute changes. Restoration can fail when a deleted parent cannot be restored. `deleteFilter` can veto deleting particular items. These mechanisms matter if collaboration later extends beyond plain text.

Evidence: `references/yjs/src/utils/UndoManager.js:126–135,442–446,494–507`.

**Selection restoration is caller-owned.** Stack metadata is explicitly intended for selection ranges; stack-item events provide the capture/pop boundary. The manager itself does not implement an editor cursor model.

Evidence: `references/yjs/src/utils/UndoManager.js:24–27,147–153,246–255`.

**Retention.** Deleted items referenced by history are kept from garbage collection; clearing entries releases that protection. The implementation warns that its keep property does not persist through database storage or transmission. Durable undo cannot be assumed merely from durable Yjs document state.

Evidence: `references/yjs/src/utils/UndoManager.js:35–40,239–244,531–535`.

## 2. Our current undo

### E017: branching snapshot graph

Singapore currently stores a **tree of document states**. Nodes contain:

- parent and child relationships;
- preferred redo child;
- immutable document snapshot;
- selections after and before the incoming edit;
- incoming transaction;
- sealing, sequence, revision, and visit metadata.

Undo moves to the parent; redo follows the preferred child. Editing after undo retains sibling branches. Checkout can move directly to any retained node.

Evidence:

- `editor/packages/editor/src/history.ts:3–37,211–246`.
- `editor/docs/editing/undo-graph.md:15–39`.

Transactions also contain offset-space `edits` and `inverseEdits`, before/after snapshots, before/after anchored selections, and metadata. `DocumentSession.undo` changes the history state and publishes the transaction’s inverse edits; redo publishes its forward edits.

Thus the answer to “offset-space inverse edits?” is **yes, but not exclusively**: the current authority is the snapshot graph, with inverse edit scripts carried for transactions/publication.

Evidence: `editor/packages/editor/src/documentSession.ts:351–358,784–846`.

**Collaboration consequence, inferred:** installing an old node snapshot as the live document would discard later remote edits. Updating only the current node for each remote edit would leave ancestor/sibling snapshots stale. Neither is a correct collaborative undo implementation.

The existing `replaceEditorHistoryState` updates only the current node, confirming why that helper alone is insufficient.

Evidence: `editor/packages/editor/src/history.ts:260–276`.

### E018: persisted undo

The serialized graph stores parent-relative forward/inverse `TextEdit` scripts, selection offsets, branch identity, and metadata. It does not serialize the snapshot objects. Selection anchors are resolved into numeric offsets when serializing.

Evidence: `editor/packages/editor/src/historySerialization.ts:28–63,79–99,120–145`.

Fregat stores history in IndexedDB and restores it when the newly opened document’s content hash matches. The actual adoption path checks `fileVersion` against `contentHash` before asking the buffer to restore the history.

Evidence:

- `editor/docs/editing/e018-persisted-undo.md:6–20`.
- `apps/web/src/features/editor/state/history-persistence.ts:88–95,126–136`.

**Collaboration consequence, inferred:** equal text is insufficient. Two collaborative documents can contain the same string with completely different character/operation IDs. Restoring ID-space history requires the matching document identity and retained identity universe.

### Cursor undo and E020 jump history

These are separate domains today:

- `CursorHistory` stores numeric selection ranges and pixel scroll positions, with undo/redo stacks capped at 50. Its contract discards the history when text changes.
- E020 jump history stores neighboring anchors for each endpoint and an anchored viewport. It survives edits, skips destinations whose primary endpoint has lost both neighboring anchors, and can revisit retained deleted destinations after undo.

Evidence:

- `editor/packages/editor/src/editor/cursorHistory.ts:7–67`.
- `editor/docs/editing/jump-history.md:25–37`.
- `editor/packages/editor/src/editor/jumpHistory.ts:37–99`.

**Design implication:** E020 provides the useful pattern for collaborative selection restoration, but its piece-table anchors must become transport/persistence-stable character-ID anchors. Cursor undo should remain separate; converting it to anchors is a distinct scope decision.

### Fregat server journal and Plan 172

Plan 172 explicitly preserves the editor’s branching model. It extracts reusable **linear** history for other domains, keeps focus-based command routing, and keeps file operations under server authority.

Evidence: `plans/172-shared-undo-stack.md:19–31,38–68`.

The durable file-operation system has guarded manifests, retention/staging limits, and a head-only reversal contract shared between windows. The source comment explicitly says reversing anything except the head would reorder shared history.

Evidence:

- `apps/server/src/fs/workspace-edit-journal.ts:34–36,184–213`.
- `apps/server/src/fs/workspace-edit.ts:736`.
- `apps/server/src/fs/tests/workspace-edit.test.ts:1550`.

**Conclusion:** reuse its durability, receipt, and recovery lessons, not its head-only undo semantics. Collaborative text undo must be selective by author and operation identity, even when newer remote operations exist.

The requested Plan 136 file is absent from the current `plans/` directory. Current journal code and Plan 172 were used instead; no historical Plan 136 implementation claims are made.

## 3. Proposed design

Everything in this section is a proposed design, not an existing implementation.

### 3.1 History belongs to an author stream; text belongs to the host

Use one text history per `(documentId, historyOwnerId)`, shared by that author stream’s split views. Define the owner stream explicitly: two devices logged into the same account should not accidentally consume each other’s undo without an intentional shared-history policy.

Remote edits update the shared text and anchors, but never become nodes in this local history.

Separate:

1. **Host-ordered document state**.
2. **Accepted operation log and deduplication state**.
3. **Client pending operation overlay**.
4. **Local author’s branching undo graph**.

Weidner’s article describes rollback/apply/replay of pending operations; that rollback is transport reconciliation, not user undo.

Source: https://mattweidner.com/2025/05/21/text-without-crdts.html, “Client Side” and “Some Corrections”.

### 3.2 Withdraw operation effects, not everybody’s tombstones

Minimum conceptual state:

```text
character:
  stable character ID
  retained payload and structural position
  insertion operation ID
  deletion operation IDs

operation:
  stable operation ID
  authenticated history owner
  operation payload
  active/inactive state
```

Visibility:

```text
active(insertionOp)
AND no active deletionOp targets this character
```

This borrows Zed’s semantics, but the host can maintain ordinary ordered active/inactive state instead of distributed max-count machinery.

Grounding: `references/zed/crates/text/src/text.rs:3150–3160`.

Suggested wire operations:

- `insert(opId, anchor, ids, text)`;
- `delete(opId, explicitIds)`;
- `setOperationEffects(commandId, [{ opId, active }])`.

`setOperationEffects` is an ordinary host-ordered ID-space command. The host validates ownership and applies a transaction’s effect changes atomically.

**Crucial requirement:** record a deletion’s provenance even when a targeted character is already hidden. Otherwise Alice’s undo can lose Bob’s concurrent delete that arrived second.

Undoing an insertion deactivates that insertion. Undoing a deletion deactivates only that deletion. Redo reactivates the original effect; it neither allocates new character IDs nor removes somebody else’s deletion.

### 3.3 Pending replay must not create history

Allocate operation and character IDs before optimistic application.

Record the user transaction once. On receiving host changes:

1. Rebuild from the acknowledged host state.
2. Apply the newly accepted host log.
3. Remove acknowledged pending commands by identity.
4. Replay the remaining commands, retaining their IDs.
5. Resolve view anchors against the rebuilt state.
6. Do not capture replay as new user history.

Use explicit desired effect states, not “toggle whatever the current state is.” Duplicate delivery must not turn one undo into a redo.

Undoing a pending insertion can enqueue its deactivation behind it. Preserve dependency order. Cancel an unsent insertion only if no pending operation or history/anchor reference depends on it; unconditional enqueueing is the simpler initial contract.

### 3.4 Preserve branching topology; replace snapshot restoration

Keep E017’s parent/child graph, preferred-child choice, grouping/sealing metadata, and retention UX. Change a node’s meaning from “complete historical document state” to:

> “This local author transaction is active along this branch.”

Each edge holds original operation IDs and before/after selection anchors.

- Undo deactivates the departing edge’s effects.
- Redo activates the selected child edge’s effects.
- New local work after undo creates a sibling and makes it preferred.
- Remote edits neither clear redo nor delete sibling branches.
- Branch checkout finds the lowest common ancestor, deactivates departing-path transactions, then activates target-path transactions in one host transaction.

Old snapshots may remain immutable inspection evidence, but must never replace live collaborative text. A historical snapshot and “this branch applied to today’s shared document” are different views.

Pruning must preserve the established baseline: advancing the graph root does not deactivate its former ancestors’ already accepted effects.

Grounding for preserved graph behavior: `editor/docs/editing/undo-graph.md:24–44`.

### 3.5 Grouping and redo

Preserve existing intent/typing-run boundaries, adding:

- explicit transaction boundaries for replacement, paste, IME, formatter, and multi-cursor batches;
- seal after undo/redo/checkout;
- seal a typing run when remote work intersects its edited region;
- allow unrelated remote edits to leave a run open.

Unlike the upstream linear managers, new work after undo must **retain the old sibling branch** because E017 already promises that behavior. Changing preferred redo is sufficient.

A semantically accepted effect change with zero visible text change remains meaningful history. Do not automatically copy Yjs/Loro’s “skip until visible change” rule: withdrawing one deletion can matter even while another deletion still hides the character.

### 3.6 Selection restoration through stable anchors

Store before/after selections as gaps:

```text
left character ID or document-start sentinel
right character ID or document-end sentinel
affinity / bias
```

Include all selections, primary selection identity, and an anchored viewport.

Resolve against the current accepted-plus-pending document after reversal/replay. Preserve endpoint identity while characters are hidden so restoration can improve when they return. When both neighbors are hidden, use a deterministic nearest-visible-gap fallback rather than stale numeric offsets.

Only the initiating view restores its captured selection. Other local views and collaborators keep their own anchors and observe text changes.

Grounding: `editor/packages/editor/src/editor/jumpHistory.ts:37–99` and `editor/docs/editing/jump-history.md:25–37`.

### 3.7 Persistence and host handoff

Client persisted history should include:

- document identity and identity-generation/checkpoint metadata;
- history owner and operation-ID allocation state;
- graph topology and preferred redo;
- original operation IDs, grouping metadata, selection anchors;
- pending commands and acknowledgement state.

Host durable state must retain:

- character identities, payloads, and ordering;
- insertion/deletion provenance;
- active/inactive effect state;
- accepted sequence/checkpoint;
- command deduplication records needed for reconnect.

A plain content hash cannot authorize restoration. Reject history for a different identity universe even when visible text matches.

Tombstone/history retention must be coordinated. Either retained history pins needed identities/payloads, or the host explicitly expires reversibility. A client graph cannot guarantee revival after the host has removed the relevant data.

For handoff, preserve the same document and operation identities, transfer effect state and deduplication state, fence the old sequencer, and reconnect from an agreed accepted checkpoint. A host epoch change alone need not destroy undo; loss of identity continuity does.

Host handoff and durable tombstone retention are not specified by Weidner’s article. These requirements remain proposed and unverified.

## 4. Hard cases

| Case                                                                      | Proposed behavior                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alice inserts `abc`; Bob inserts `X` between its characters; Alice undoes | Hide Alice’s IDs only. `X` survives in retained structural order. Redo reveals Alice’s IDs around it.                                                         |
| Bob deletes part of Alice’s insertion                                     | Alice’s redo cannot override Bob’s active deletion.                                                                                                           |
| Alice and Bob delete overlapping IDs                                      | Undo withdraws only the selected deletion’s provenance. The other active deletion continues hiding the overlap.                                               |
| Alice deletes text; Bob deletes both surroundings                         | Alice’s undo reveals eligible original IDs in their retained positions. Deleted neighboring IDs remain usable anchors; selection uses deterministic fallback. |
| Bob replaces Alice’s inserted text                                        | Bob’s replacement IDs survive Alice’s undo. Bob’s deletion effect continues hiding the original IDs when Alice redoes.                                        |
| Alice’s pending insertion is undone before acknowledgement                | Preserve command dependency order and replay the same identities; avoid dangling references from Bob’s or Alice’s dependent operations.                       |
| New local edit after undo                                                 | Create a sibling branch, preserving the old branch for explicit selection.                                                                                    |
| Remote work arrives during branch checkout                                | The host orders the atomic checkout command against remote commands; clients rollback/replay pending overlays without recapturing history.                    |
| Undo changes provenance but no visible characters                         | Advance history and persist the accepted effect change; do not report it as rejection.                                                                        |
| History restored against equal text with different IDs                    | Reject. Content equality is not identity continuity.                                                                                                          |
| Host handoff loses part of accepted history                               | Do not guess from text. Recover the identity checkpoint/log or explicitly declare affected history unavailable.                                               |
| Concurrent windows control the same author history                        | Define one serialized history controller or separate owner streams. Two independent graph pointers targeting the same effects are unsafe.                     |

These are proposed semantic outcomes, not tested results.

**Unresolved product choice:** same-ID revival can make an old anchored waypoint or annotation become live again. That is consistent with E020’s current deleted-waypoint behavior, but collaborative annotations and richer content need their own explicit policies.

Grounding: `editor/docs/editing/jump-history.md:29–31`.

## 5. Tests to port

Port semantic scenarios to the host-ordered model, not CRDT-specific clocks or implementation internals.

### Zed

From `references/zed/crates/text/src/tests.rs`:

- `test_undo_redo`, starting at line 668: basic reversal and grouping.
- `test_finalize_last_transaction`, line 771: sealed grouping boundaries.
- `test_concurrent_edits`, line 845: independent concurrent replacements.
- `test_edit_partially_intersecting_a_deleted_fragment`, line 876: targeting a partly tombstoned region.
- `test_random_concurrent_edits`, line 914: randomized edits, undo, and delivery.
- `test_edit_undo_after_split`, line 1160: undo across fragment splits.

Add direct assertions for Zed’s visibility rule: two deletions of one ID, undo each separately, redo either, and undo an insertion containing another author’s independently inserted character.

### Loro

From `references/loro/crates/loro-internal/tests/undo.rs`:

- `test_basic_undo_group_checkpoint`, line 8.
- `test_invalid_nested_group`, line 36.
- `test_simulate_intersecting_remote_undo`, line 57.
- `test_simulate_non_intersecting_remote_undo`, line 101.
- `test_undo_group_start_with_remote_ops`, line 137.
- `test_clear_redo`, line 170.
- `test_clear_undo`, line 202.

From `references/loro/crates/loro/tests/integration_test/undo_test.rs`:

- `undo_id_span_that_contains_remote_deps_inside`, line 313.
- `undo_id_span_that_contains_remote_deps_inside_many_times`, line 378.
- `undo_text_collab_delete`, line 751.
- `collab_undo`, line 808.
- `test_remote_merge_transform`, line 1127.
- `undo_redo_when_collab`, line 1348.
- `undo_transform_cursor_position`, line 1676.
- `undo_while_paused_does_not_leak_processing_flag`, line 1826.

For the cursor test, preserve its remote-edit/selection scenario but change the expected implementation contract: Singapore should restore the **same** IDs, whereas Loro explicitly creates new IDs.

### Yjs

From `references/yjs/tests/undo-redo.tests.js`:

- `testUndoText`, line 52: same-interval insert/delete; repeated reversal; collaborator deletion surviving redo.
- `testUndoEvents`, line 349: metadata capture/pop boundary.
- `testTrackClass`, line 374: origin selection.
- `testTypeScope`, line 389: domain scope.
- `testUndoDeleteFilter`, line 430: protected targets, if richer objects are introduced.
- `testUndoUntilChangePerformed`, line 447: inspect no-op handling, but do not automatically copy its skip policy.
- `testUndoNestedUndoIssue`, line 478.
- `testConsecutiveRedoBug`, line 530.
- `testSpecialDeletionCase`, line 743.
- `testUndoDoingStackItem`, line 802.

Attribute/formatting tests are useful later, outside the initial plain-text scope:

- `testUndoEmbeddedTypeAttribute`, line 245.
- `testUndoDeleteTextFormat`, line 686.
- `testBehaviorOfIgnoreRemoteAttributeChangesProperty`, line 720.

### Singapore/Fregat-specific additions

Grounded in E017, E018, and E020 contracts:

1. Undo B, create C, receive remote R, then switch back to B: R survives both branches.
2. Grouped replacement reverses insert and delete effects atomically.
3. Multi-cursor grouped undo restores only the initiating view’s selections.
4. Jump history remains valid through remote insert/delete and same-ID revival.
5. Replay with local edit, undo, redo, and remote insert pending does not duplicate graph nodes.
6. Duplicate acknowledgements and reconnect retransmission do not duplicate or invert effect changes.
7. A deletion arriving after another deletion still records provenance.
8. Save/close/reopen restores graph topology and anchors using matching collaborative identity.
9. Equal visible text with different IDs refuses restoration.
10. Retention/pruning does not deactivate baseline operations.
11. Host handoff preserves accepted undo and pending command identities.
12. Rejected host history commands preserve the recoverable client graph state.
13. A no-visible-change undo is acknowledged and durable.
14. File-tree shared-head undo remains separate from author-selective text undo.

Existing local contract sources:

- `editor/docs/editing/undo-graph.md:24–44`.
- `editor/docs/editing/e018-persisted-undo.md:6–23`.
- `editor/docs/editing/jump-history.md:25–44`.
- `plans/172-shared-undo-stack.md:59–68,121–135`.

## Verification and limitations

- Source and upstream test inspection completed.
- No tests, builds, provider calls, or implementation experiments were run.
- Shared checkout remained clean at the final status check.
- Zed’s reference was fast-forwarded and its sparse checkout expanded.
- Loro and Yjs were inspected at their existing recorded commits.
- Zed editor-level cursor restoration, runtime behavior of all upstream tests, and host-handoff guarantees remain unconfirmed.
- No requested report file was written because of the worker-level developer restriction.
