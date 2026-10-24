# @singapore-editor/collab

## 0.0.4

### Patch Changes

- Updated dependencies []:
  - @singapore-editor/textbuffer@0.2.9

## 0.0.3

### Patch Changes

- [#1112](https://github.com/ShaulLavo/fregat/pull/1112) [`378f5d9`](https://github.com/ShaulLavo/fregat/commit/378f5d9bb47e5a9188839e251c5c81f544d2e251) - Breaking: `DocumentEngine` implementations must provide `sequenceBatch` and `applyBatch`. Update custom session transports to carry `SUBMIT.payload.edits` and `CONFIRM.payload.records` arrays. Fixed repeated pending-edit replay during offline rejoin by advancing unchanged `Participant` acknowledgements without restoring or reapplying the optimistic document.

- [#1230](https://github.com/ShaulLavo/fregat/pull/1230) [`39cb0f4`](https://github.com/ShaulLavo/fregat/commit/39cb0f40cd2ad41d363ac4cb889fc4296d53a41e) - Added `ConfirmedWindow.editsAfter` to read retained text edits that causally follow every supplied edit identity. Improved merge-review mark publication performance for long confirmed histories without changing the marks.

- [#1167](https://github.com/ShaulLavo/fregat/pull/1167) [`2266ab2`](https://github.com/ShaulLavo/fregat/commit/2266ab2c0e61b400611528ce1fa6cdae73e3a516) - Improved `ConfirmedWindow.append` performance for confirmed batches that follow the retained suffix. Canonical retention, retries, and concurrent pair results stay the same.

- [#1178](https://github.com/ShaulLavo/fregat/pull/1178) [`958e7df`](https://github.com/ShaulLavo/fregat/commit/958e7df9bcab0ded8273b6dc00049a8642b87486) - Improved `ConfirmedWindow.pairs(batch)` and `MergeReviewDetector.detect()` to reduce the cost of reviewing confirmed edits. Added an optional base snapshot argument to `MergeReviewSyntax` so projected versions can reuse retained syntax.

  Added `TreeSitterWorkerOwner.projectMergeUnits()` and `createTreeSitterInputEdits()` to review projected versions with bounded parent-context parsing and incremental fallback. Fixed damaged-line error lookups scanning unrelated syntax while keeping highlighting trees unchanged.

  Fixed projected merge-unit requests retaining new syntax trees and sources after cancellation or query failure. Highlighting eviction now releases only projections of its own snapshot, so unrelated review sessions add no cleanup work.

- [#1164](https://github.com/ShaulLavo/fregat/pull/1164) [`9dc5a14`](https://github.com/ShaulLavo/fregat/commit/9dc5a14f8595f34a78af996f5fa665a880467ce7) - Added `MergeReviewDetector` through `@singapore-editor/collaboration/merge-review` with per-range syntax groups to report confirmed concurrent edits sharing syntax units, breaking a clean parse, duplicating a signature, or leaving stranded text. Added `TextbufferEngine.effectActive()` to identify active edits. Improved `TreeSitterWorkerOwner.mergeUnit()` with cancellable Markdown work, cached parent eligibility, and optional error/token analysis for review readers.

- [#1156](https://github.com/ShaulLavo/fregat/pull/1156) [`91001cd`](https://github.com/ShaulLavo/fregat/commit/91001cdd85b595c61f02f4991e2e87c28c261e7a) - Breaking: Custom `Engine` implementations must implement `projectEffects(effects)` to return a snapshot with the selected effect states while preserving live state. Added `projectEffects` to `ReferenceEngine` and `TextbufferEngine` for local review snapshots that preserve the edit log. Added `ConfirmedWindow` to find concurrent edits by different authors and their inserted and deleted character ID spans within a bounded confirmed history.

- [#1176](https://github.com/ShaulLavo/fregat/pull/1176) [`f0e5906`](https://github.com/ShaulLavo/fregat/commit/f0e59061c8d2b189d82f9bc8e52590ba98668da1) - Added `mergeReview` to `createCollaborationPlugin` for confirmed concurrent-edit highlights, author-version hovers, local dismissal and bounded resolutions that reach every peer. Added `onMergeReview(unit, versions)` for host actions.

  Added `createTreeSitterReviewSyntax` for demand-only review reads from immutable document snapshots, and `mergeUnit` touching selection for intersected syntax units. Author projections reuse the confirmed syntax tree through `projectMergeUnits` and preserve nested injected languages, including code fences. Added `createEditorSnapshotBuffer` and `DocumentDelivery` to the internal document-worker entry point for snapshot reader integrations.

  Fixed completed merge resolutions reappearing as new review actions. Added `ConfirmedWindow.isAfter` for retained causal ancestry, and restricted review detection to remote confirmations with deferred demand for concurrent pending acknowledgements.

  Added `TooltipPart.presentation: 'controls'` for content-sized shared hovers with pane-bounded placement and a visible button footer. Review actions remain visible while long version comparisons scroll. Fixed host focus outlines appearing around comparison content; keyboard focus remains visible on buttons, and content sections use tone-only separation.

- [#1112](https://github.com/ShaulLavo/fregat/pull/1112) [`378f5d9`](https://github.com/ShaulLavo/fregat/commit/378f5d9bb47e5a9188839e251c5c81f544d2e251) - Improved verification of collaborative merge ordering across concurrent insertions, deletions, replacements, selective undo, and offline branch replay.
- Updated dependencies []:
  - @singapore-editor/textbuffer@0.2.8

## 0.0.2

### Patch Changes

- [#1026](https://github.com/ShaulLavo/fregat/pull/1026) [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e) - Keep collaborative batches atomic, preserve native edit ordering and Unicode replacements, and defer remote reconciliation behind mutation leases. Respect skipped history and report selective Undo/Redo availability. Recover losing-branch origins before replay and retain shared immutable history records. Validate shared-buffer ownership before attachment and clean up example departures and failed setup.

- [#1024](https://github.com/ShaulLavo/fregat/pull/1024) [`17364d8`](https://github.com/ShaulLavo/fregat/commit/17364d8257268e13ddc09fab3866d0c8d9db860e) - Fixed `Host.submit()` delivery when a broadcast listener throws or reconnects during delivery. Healthy receivers get committed outcomes in host-sequence order, including reentrant submissions, and new `Host.subscribe()` registrations begin with the next broadcast. Host and Participant subscriptions rethrow the first callback failure unchanged and report multiple failures once with a count.

- [#950](https://github.com/ShaulLavo/fregat/pull/950) [`8ac6870`](https://github.com/ShaulLavo/fregat/commit/8ac68702af26ff596cd64549dcbb8644bb6e62b6) - Added `Host` and `Participant` APIs for collaborative text editing with immediate local edits and a shared host-defined order. `ReferenceEngine` provides the FugueMax reference implementation, and `simulate()` checks whether participants converge under delayed delivery.

- [#993](https://github.com/ShaulLavo/fregat/pull/993) [`e34b710`](https://github.com/ShaulLavo/fregat/commit/e34b7107a5170720c5212f1e6e56752dbaa416f4) - Fixed `UndoManager` retaining cleared transactions and caller metadata. Confirmed history actions now leave the replay journal while pending rejection recovery and caller-owned graph transactions remain usable. Synchronous emitter outcomes settle before observers run, and acknowledged traversal, backlog draining, and grouped rejection use linear work.

- [#1078](https://github.com/ShaulLavo/fregat/pull/1078) [`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3) - Keep collaborative undo branches in the editor history graph. Switch branches with one author-selective effect command, restore character-ID selections and jump locations, and persist history against its document and character identities. Continue allocating fresh edit and character IDs when a document reopens, including allocations preserved in rejected history records, and recover local history after rejected commands. Reconstruct restored history viewer change sizes from the live identity-space branch previews.

- [#1026](https://github.com/ShaulLavo/fregat/pull/1026) [`f389080`](https://github.com/ShaulLavo/fregat/commit/f389080aa2abcd039dba5eede0040b029180724e) - Bind collaborative sessions to native editor input, identity-aware snapshots, author-selective undo and atomic remote updates. Add an invitation-link example using encrypted same-origin and WebRTC transports.

- [#967](https://github.com/ShaulLavo/fregat/pull/967) [`e39fb2f`](https://github.com/ShaulLavo/fregat/commit/e39fb2ff7be76068a4af41fc0907379d630ea619) - Add a persistent textbuffer-backed FugueMax engine with compact identity-run placement, exact remote edits and snapshot replay. Reuse the textbuffer character allocator for optimistic participants. Expose semantic character identity diagnostics for simulator convergence checks. Retain compact insertion/deletion provenance and deduplicated operation states for atomic undo and redo, including hidden overlapping deletions and same-ID revival. Protect undo-reachable payloads during reclamation and reject expired same-ID revival atomically with a clear host outcome.

- [#1010](https://github.com/ShaulLavo/fregat/pull/1010) [`ac0aae9`](https://github.com/ShaulLavo/fregat/commit/ac0aae9fb4fa9c76661c7640a0dbb88ac53871cc) - Index placement ancestry and structural successors so typing and pending replay stay bounded on fragmented histories. Publish effective edits through participant subscriptions and skip shared textbuffer subtrees during snapshot diffs.

  Breaking API changes: participant subscription callbacks now apply `change.edits` to their previous text projection and read metadata from the change. Callers requesting full text use `participant.text()` or `participant.state().text`. Custom engines must implement `changesBetween(snapshot)` with effective `{ from, to, text }` edits.

- [#971](https://github.com/ShaulLavo/fregat/pull/971) [`c8727e2`](https://github.com/ShaulLavo/fregat/commit/c8727e2c743e54004b838f74063026c787294df0) - Add author-selective collaborative undo and redo with atomic effect commands, retained deletion provenance, transaction grouping, and pending replay.
- Updated dependencies [[`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3), [`ed8e3ab`](https://github.com/ShaulLavo/fregat/commit/ed8e3ab264586714b15a2589e7c74cb7af241154), [`e39fb2f`](https://github.com/ShaulLavo/fregat/commit/e39fb2ff7be76068a4af41fc0907379d630ea619), [`ac0aae9`](https://github.com/ShaulLavo/fregat/commit/ac0aae9fb4fa9c76661c7640a0dbb88ac53871cc), [`8604785`](https://github.com/ShaulLavo/fregat/commit/8604785002880294450acc2d86831b7d58bb51ad)]:
  - @singapore-editor/textbuffer@0.2.7
