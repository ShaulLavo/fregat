# 002. Track positions with anchors into immutable buffers

Status: accepted
Date: 2026-10-24

The decision predates the 2026-09-29 monorepo import. This record is dated when it was written down from [Anchors](../positions/anchors.md) and the text reclamation reports.

## Context

Selections hold positions that must follow the text through edits. An offset means nothing after the next edit, so every consumer would otherwise rebase its positions by hand.

## Decision

A position that has to survive edits is an anchor: a buffer id, an offset inside that immutable buffer, and a bias (left or right) for insertions at its boundary. An anchor never changes. Resolving it against a snapshot returns a document offset and whether the text is live or deleted. The same anchor can be live in one snapshot and deleted in another, for example across undo and redo.

## Alternatives considered

- **Explicit rebasing, as CodeMirror does.** Every call site must remember to rebase, and a forgotten rebase is a subtle bug.
- **An interval tree, as VS Code does.** It costs central maintenance and a registration step for every tracked range.
- **Plain offsets.** Meaningless after any edit.

## Consequences

Call sites stop rebasing. Resolution is deterministic: the same anchor and snapshot always give the same offset and liveness.

To resolve a deleted anchor, the buffer keeps tombstones, pieces that are invisible but retain their identity. The tombstones forced follow-up work. Where an insert landed among tombstones used to depend on the tree's balance, so the same edits could resolve an anchor to different offsets in different trees. [text reclamation](../storage/e006-tombstone-compaction.md) fixed the landing rule, then compacted runs of tombstones into textless stand-ins that resolve every anchor as before. After 20,000 paragraph replacements the current tree holds 4 pieces instead of 20,002, and about 22 bytes per insertion remain, down from about 259.

Anchor bias is not caret affinity. Bias controls how a stored position resolves at an insertion boundary. Caret affinity controls which painted caret a selection head owns when one offset has two visual positions. See [Anchors](../positions/anchors.md#anchor-bias-is-not-caret-affinity).

See also [ADR 001](001-persistent-avl-piece-table.md).
