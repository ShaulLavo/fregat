# @singapore-editor/textbuffer

## 0.2.9

No changes in this release.

## 0.2.8

No changes in this release.

## 0.2.7

### Patch Changes

- [#1078](https://github.com/ShaulLavo/fregat/pull/1078) [`0a40acf`](https://github.com/ShaulLavo/fregat/commit/0a40acfcea619490f086617466b60cff2f6a2dc3) - Keep collaborative undo branches in the editor history graph. Switch branches with one author-selective effect command, restore character-ID selections and jump locations, and persist history against its document and character identities. Continue allocating fresh edit and character IDs when a document reopens, including allocations preserved in rejected history records, and recover local history after rejected commands. Reconstruct restored history viewer change sizes from the live identity-space branch previews.

- [#952](https://github.com/ShaulLavo/fregat/pull/952) [`ed8e3ab`](https://github.com/ShaulLavo/fregat/commit/ed8e3ab264586714b15a2589e7c74cb7af241154) - Add opt-in stable UTF-16 character IDs, author-owned allocation, and atomic structural insert/delete edits that preserve hidden-character order and retained snapshots through text reclamation.

- [#967](https://github.com/ShaulLavo/fregat/pull/967) [`e39fb2f`](https://github.com/ShaulLavo/fregat/commit/e39fb2ff7be76068a4af41fc0907379d630ea619) - Add a persistent textbuffer-backed FugueMax engine with compact identity-run placement, exact remote edits and snapshot replay. Reuse the textbuffer character allocator for optimistic participants. Expose semantic character identity diagnostics for simulator convergence checks. Retain compact insertion/deletion provenance and deduplicated operation states for atomic undo and redo, including hidden overlapping deletions and same-ID revival. Protect undo-reachable payloads during reclamation and reject expired same-ID revival atomically with a clear host outcome.

- [#1010](https://github.com/ShaulLavo/fregat/pull/1010) [`ac0aae9`](https://github.com/ShaulLavo/fregat/commit/ac0aae9fb4fa9c76661c7640a0dbb88ac53871cc) - Index placement ancestry and structural successors so typing and pending replay stay bounded on fragmented histories. Publish effective edits through participant subscriptions and skip shared textbuffer subtrees during snapshot diffs.

  Breaking API changes: participant subscription callbacks now apply `change.edits` to their previous text projection and read metadata from the change. Callers requesting full text use `participant.text()` or `participant.state().text`. Custom engines must implement `changesBetween(snapshot)` with effective `{ from, to, text }` edits.

- [#961](https://github.com/ShaulLavo/fregat/pull/961) [`8604785`](https://github.com/ShaulLavo/fregat/commit/8604785002880294450acc2d86831b7d58bb51ad) - Compare the text buffer with CodeMirror 6 on the existing benchmark workloads, with shared oracle checks, rotated engine order and recorded dependency provenance.

## 0.2.6

No changes in this release.

## 0.2.5

No changes in this release.

## 0.2.3

No changes in this release.

## 0.2.2

No changes in this release.

## 0.2.1

No changes in this release.
