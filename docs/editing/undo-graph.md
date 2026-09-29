# E017 branching undo

E017 is complete on 2026-09-16. The text buffer's history is a bounded tree of states instead of
two stacks. Undoing B and typing C keeps B: A has two children, redo follows the one most recently
left or created, and any retained state can be checked out. The execution plan has been removed;
[selections-and-undo.md](selections-and-undo.md) still describes selection ownership, and this
document holds the contracts the graph adds. [undo-graph-viewer.md](undo-graph-viewer.md) is the
browser built on it (E019); persistence is [E018](e018-persisted-undo.md).

The inspected baseline was `9abb944f3a2b8d6516953fdec75e8df5e1a94811`; the work landed on top of
`b6a265a786b08c61318a3e02b666f17cb7ef50fc`.

## Contracts that remain

- `history.ts` is a persistent value. `EditorHistory` holds a `ReadonlyMap` of nodes, the root and
  current ids, a clock and the retention budget; every operation copies the map and returns a new
  value, so the barrier code can stash a history and restore it later exactly as before. The map
  never holds more than the budget, and a node is only ever re-set under its own key, so map order
  is creation order and `editorHistoryNodes` needs no sort.
- A node carries its `snapshot`, its `selections`, the `selectionsBefore` that undoing out of it
  restores, its incoming `transaction`, `sequence`, `revision`, `visitedAt`, `committedAt` and
  `sealed`. `undo` and `redo` on the history value are derived entries for the parent and the
  preferred child, which is what `canUndo()` and `canRedo()` read.
- Ctrl+Z and Ctrl+Y stay linear. Undo moves to the parent and marks the node it left as the
  parent's preferred child; redo follows the preferred child. A new edit becomes the preferred
  child of the state it was made from without discarding siblings. `checkoutEditorHistory` moves to
  any retained node and teaches every ancestor on the path its preferred child, so redo afterwards
  walks back down the same way; `preferEditorHistoryBranch` changes the choice without moving.
- A typing run amends only the unsealed leaf of the current node. Committing a child, undoing,
  redoing or checking out seals the node; an amend on a sealed node, a branch point or the root is
  a new node. An amend bumps `revision` and `committedAt`, so a summary computed from an earlier
  revision can tell it is stale. After an undo the next keystroke is a sibling: the session drops
  its typing run on every history move.
- Retention is `retainedStates`, the number of retained states other than the current one, across
  the whole graph; the default is 200 and the host supplies it through
  `createEditorTextBuffer(text, { retainedHistoryStates })`. Pruning removes the least recently
  visited inactive leaf first, then advances the root along the only path left. The current state
  is never pruned, a parent whose child was pruned loses that child as its preferred redo, and an
  advanced root drops its incoming transaction and the selections it would have undone into, so
  nothing dropped stays reachable.
- The barrier and receipt semantics did not move. A workspace group still stashes the buffer's
  history in the barrier and replaces it with a fresh one; sealing clears the stashed history's
  preferred redo instead of its redo stack, which keeps the branch in the graph while the two keys
  forget it. Every barrier test passed unchanged.
- The buffer exposes `getHistoryGraph()`: graph revision, root and current ids, the retention
  budget, one entry per node with `isCurrent`, its snapshot and its transaction, and the nearest
  installed workspace-edit `barrier` (group id, phase, segment count) beneath the root.
  `checkoutHistoryState(id, sourceView)` publishes one `'checkout'` change whose transaction holds
  the single replacement `diffPieceTableSnapshots` computed between the two states, so every
  attached view and the language client receive one consistent edit whatever the path was; it is
  refused while a mutation lease is held. `preferHistoryBranch(id)` is the branch selection, and
  `clearHistory()` forgets every state but the current one with a `'checkout'` change that carries
  no edits, so views learn that undo and redo went away without a revision moving.
- `Editor.getBufferSession()` hands a host the buffer and view behind an owned document, which is
  how a viewer reaches the graph and restores with the editor's own view as the source.

## Measured results

A history of typed states with a `{ id }` snapshot and a string transaction, on the retention
default of 200, run once under Bun:

| Operation                                     | Time    |
| --------------------------------------------- | ------- |
| 1000 commits, pruning from the 201st          | 4.55 ms |
| 200 undos                                     | 0.30 ms |
| 100 sibling commits, each followed by an undo | 0.91 ms |
| 200 checkouts across branches                 | 1.02 ms |

Each operation copies a map of at most 201 entries; a keystroke pays a few microseconds, off the
render path, and pruning runs inside the commit rather than on a timer. Memory stays bounded by the
same budget the stacks had: a retained node pins its snapshot exactly as a stack entry did, and the
reachability test in `history.test.ts` proves a pruned node's snapshot and selections are released.

## What is left

- E018 persists the graph across restarts. The graph has no codec; node ids are per buffer
  generation and `committedAt` is wall clock.
- The barrier is still a cut, not a node. The graph beneath a workspace group is stashed and
  invisible until the group is undone; the host shows the barrier from `getHistoryGraph().barrier`.
- Anchor and snapshot ownership across pruning still coordinates with E006 the way the stacks did.
