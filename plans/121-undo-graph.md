# Undo as a graph

Status: **IMPLEMENTED 2026-09-16 — units 0 to 5 landed; see each unit's outcome.** Requested 2026-09-15.

Source: Cameron DaCamara, _Text Editor Data Structures: Rethinking Undo_ (the fred editor). Its
argument in one line: a purely functional text buffer makes every past state a free pointer, so the
undo stack should be a tree of states with a visual browser and a diff preview, not a linear list
that orphans the redo branch the moment you type. Our buffer is that data structure already. The
piece table is persistent, every history entry pins a snapshot, and switching states is an O(1)
root swap. We chose linear anyway, so today "undo three steps, type one letter" silently deletes
part of the timeline, and a workspace edit (rename, agent edit) empties the editor undo of every
file it touched.

The Editor backlog already holds the reusable half of this: [E017 branching
undo](../../Editor/plans/e017-branching-undo.md) (the graph model and checkout API), [E019 undo
graph viewer](../../Editor/plans/e019-undo-graph-viewer.md) (the browser and comparison, with a
demo) and [E018 persisted undo](../../Editor/plans/e018-persisted-undo.md) (restart survival).
Those plans stop at the Editor boundary on purpose. This plan is the Platform side: it schedules
E017 and E019, fixes the two history losses that need no graph at all, and builds the app panel,
commands, settings and verification E019 explicitly leaves to the host. E018 is a follow-up.

## What exists today

| Piece           | Current state                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor history  | `packages/editor/src/history.ts` in Editor: `EditorHistory { current, selections, undo, redo }`, two immutable linked lists, cap 200. `commitEditorHistory` and `amendEditorHistory` both set `redo: null`. Entries carry a `PieceTableSnapshot`, the `SelectionSet` and a `DocumentTransaction` with forward and inverse edits. No timestamp. |
| Coalescing      | `shouldAmendTypingRun` in `documentSession.ts`: same edit kind, single newline-free insert or single code point removal, continuing from the run's caret, word boundary rule. No time threshold. Selection changes, undo and redo, and prepared commits break the run.                                                                         |
| Barrier         | `commitPreparedHistory` with `kind: 'external-barrier'` stashes the old history in the barrier and replaces the buffer's history with an empty one. `undo()` walks back to the barrier and returns `'none'`. Only caller: `WorkspaceEditService` for `undoCategory: 'workspace'` groups.                                                       |
| Workspace undo  | `features/editor/state/workspace-edit-service.ts`: linear stacks of 20 groups, server journal in `apps/server/src/fs/workspace-edit.ts`, commands `workspace.undoWorkspaceEdit` and `redoWorkspaceEdit` with no default chord. Any ordinary edit in an affected file drops the group; every forward apply empties workspace redo.              |
| Buffer lifetime | `workspace-document-service.ts`: `ensureLiveDocument` rebuilds a clean buffer whenever the file version differs, without comparing text. `forceReplaceLiveDocument` compares text and keeps the buffer when equal. Dirty buffers are unevictable. Nothing persists history.                                                                    |
| Diff            | `@singapore-editor/diff` has `createTextDiff` (line hunks with inline annotation) and the render path used by `features/editor/components/diff-editor.tsx`. `compare-saved-view.tsx` diffs the live buffer against disk and is the pattern for "diff the current state against another state".                                                 |
| Graph drawing   | `features/git/utils/history-layout.ts` lays out a commit DAG into lanes with `layoutHistory`, `historyEdgePath` and `historyLaneColors`; `features/git/components/history-graph.tsx` draws one row. Vertical, newest first.                                                                                                                    |
| Keys            | The editor keymap is disabled in the app; preset rows become platform commands (`editor.undo`, `editor.redo`). Editor also has `cursorUndo` / `cursorRedo` (Mod+U), a separate 50-deep caret history.                                                                                                                                          |
| Verification    | `bun run agent:browser` with `look`, `scenario`, `trace`, `renders`, `caches`. No editor undo scenario exists.                                                                                                                                                                                                                                 |

## Decisions

| Decision                                    | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — Ctrl+Z and Ctrl+Y stay linear          | The graph does not change what the two keys do. Undo goes to the parent, redo follows the preferred child, which is the branch you most recently left or created. This is Vim's model (`u` and `Ctrl+R` are linear, `g-` and `g+` cross branches) and E017's design. Nobody navigates a tree with two keys. **Confirmed 2026-09-16.**                                                                                                                                                     |
| D2 — two chronological commands             | `editor.historyBack` and `editor.historyForward` step through every retained state in sequence order across branches, Vim's `g-` / `g+`. They are the keyboard way to reach an orphaned branch without opening the panel. Default chords proposed in Unit 4; the keymap census decides conflicts.                                                                                                                                                                                         |
| D3 — the panel is a Platform pane           | E019 ships a framework-neutral viewer model and an Editor demo. Platform renders it as a pane in the editor area, the way `compare-saved-view.tsx` is a pane, not a floating popover: the diff needs width, and the article's corner overlay hides the text it is diffing. Command `editor.showHistory`, also in the tab context menu.                                                                                                                                                    |
| D4 — horizontal, time on the x axis         | The article lays the tree out left to right like a git branch graph, with timestamps. We reuse `history-layout.ts` lane assignment, rotated: sequence order on x, lanes on y. Timestamps are wall clock, formatted relative ("4 min ago"), `tabular-nums`. E017 adds the timestamp to transaction metadata because this plan needs it. **Confirmed 2026-09-16**: the git-graph layout, with the diff preview of D5 beside it.                                                             |
| D5 — preview is a diff, restore is explicit | Selecting a node shows `createTextDiff(current, node)` in the pane's diff editor, current on the left. Nothing changes in the live buffer until Restore, which runs E017's checkout through the ordinary mutation boundary. Two selected nodes diff each other. This is E019's preview/restore split verbatim.                                                                                                                                                                            |
| D6 — the barrier becomes a node             | Today a workspace group empties the editor history of each affected buffer. After E017 the buffer keeps its history and records the group as a barrier node the native checkout cannot cross. Ctrl+Z at a barrier stops, and the panel shows the barrier with its reason and a Restore that runs `workspace.undoWorkspaceEdit`. Ctrl+Z at a barrier does not trigger workspace undo (**confirmed 2026-09-16**), because a workspace undo changes other files; the Unit 0 toast offers it. |
| D7 — retention is one setting               | `editor.history.retainedStates`, application scope, default 200, the same budget E017 measures across the whole graph. It replaces the `MAX_UNDO_DEPTH` constant as the host policy E017 asks for. No second knob until a measurement asks for one. A clear-history command exists because the graph keeps deleted text.                                                                                                                                                                  |
| D8 — no persistence in this plan            | E018 needs a codec, a digest scheme and a storage adapter with its own failure modes. It follows once the graph contract is stable. Until then history still dies with the buffer.                                                                                                                                                                                                                                                                                                        |
| D9 — no merges, no local history            | The graph is a tree. A cross-branch merge is a conflict design. VS Code's Local History (periodic on-disk snapshots outside undo) is a different feature with a different owner and is not this plan.                                                                                                                                                                                                                                                                                     |

## Unit 0 — stop losing history without a graph

Two losses today are bugs in Platform, not consequences of linear undo. Fix them first; they are
small and land before the Editor work.

1. `ensureLiveDocument` in `workspace-document-service.ts` rebuilds the buffer when the file version
   differs. Compare text the way `forceReplaceLiveDocument` already does through
   `replacementDocument`, and keep the buffer when the content is unchanged. A touched file with the
   same bytes must not drop the undo stack.
2. When Ctrl+Z stops at a barrier, say so. `applyHistoryCommand` returns false on `'none'` and the
   user sees nothing. Platform's `editor.undo` command checks the buffer's barrier state and shows a
   toast: "Undo stopped at a workspace edit" with an action that runs `workspace.undoWorkspaceEdit`.
   This is the interim for D6 and stays useful after it.

Verification: a document-service test for a version-only file change keeping `canUndo()`, and a
`look` of the toast after a rename followed by Ctrl+Z.

Outcome (2026-09-16): both landed. `ensureLiveDocument` now goes through `replacementDocument`
and skips the view rebind when the buffer survives; `notifyUndoBarrier` in
`keymap/state/undo-barrier.ts` toasts from `dispatchEditor` when `canUndo()` is false and
`WorkspaceEditService.hasHistoryBarrier(buffer)` finds an undoable group holding the buffer's
history. Proving the toast's action exposed a third loss: `reverseGroup` refused any group whose
query projection a refetch had replaced ("Workspace query projection is stale") and dropped it, so
`workspace.undoWorkspaceEdit` failed for every persisted edit once the watcher echo landed. A
superseded projection now reconciles the affected queries from disk instead, and the forward seal
does the same. Both paths log `workspace_edit.reverse` and `workspace_edit.history_evicted`.
Scenario `editor-undo-barrier` (workspace `work/tmp/plan121-undo`) is the browser proof.
Review follow-up (2026-09-17): a persisted group with no projection left reconciles the cache
from disk on every later transition, not only the one that discarded it, and the regression test
walks undo → redo → undo asserting cached file contents.

## Unit 1 — E017 in Editor

Execute [E017](../../Editor/plans/e017-branching-undo.md) as written, with two additions this plan
needs:

- Transaction metadata gains `committedAt` (wall clock, ms). Amending a typing run updates it, so a
  node's time is the last keystroke of the run.
- The retention budget is a buffer option supplied by the host, not a module constant, so D7 can
  feed it.

Rebuild the package with `bun run build` in `/work/projects/Editor` and restart the dev Vite so the
symlinked `packages/editor-core` picks it up. Platform's `WorkspaceEditService` and
`workspace-document-service.ts` are the consumers to typecheck; the barrier and receipt tests in
Editor are the contract that must not move.

Outcome (2026-09-16): landed in Editor as `docs/editing/undo-graph.md`. `history.ts` is a persistent
tree (map of nodes, preferred child per parent, `committedAt`, `revision`, retention across the
graph, prune least-recently-visited leaves then advance the root); the buffer gained
`getHistoryGraph()`, `checkoutHistoryState()` (one `'checkout'` change carrying a single
replacement edit) and `preferHistoryBranch()`, `createEditorTextBuffer(text, { retainedHistoryStates })`,
and `Editor.getBufferSession()`. Barrier and receipt tests passed unchanged; the full editor suite
(2446 tests) passed. A thousand commits at the cap cost 4.55 ms.

## Unit 2 — E019 model and demo in Editor

Execute [E019](../../Editor/plans/e019-undo-graph-viewer.md): the viewer model (focused node,
zero to two selected nodes, graph revision, pinned previews), the comparison request with
cancellation, and the `examples/app` demo. The layout comparison E019 asks for happens here on the
shared fixture and settles D4 before Platform draws anything.

Outcome (2026-09-16): landed as `docs/editing/undo-graph-viewer.md`. `historyViewer.ts` exports
`createHistoryViewer` (focus, two-way selection, cancellable comparison with generation checks,
`lostIds` on pruning, focus following the current state) and `layoutHistoryGraph` (sequence on x,
lanes on y). The demo's History panel is the fixture proof: `examples/app/test/history.spec.ts`
restores a sibling branch by keyboard and diffs two states in Chromium. D4 is settled on that
fixture: the graph strip plus a labelled list.

## Unit 3 — the History pane

`features/editor/components/history-pane.tsx`, opened by `editor.showHistory` for the active
editor tab. Structure:

- **Graph strip** along the top, `h-(--bar-height)` rows stacked per lane, drawn with SVG the way
  `history-graph.tsx` does, using `history-layout.ts` lane assignment (move it to `lib/` in the
  same pass, since it gains a second feature consumer). Current state is the filled circle, the
  saved state carries a mark, a barrier node is drawn hollow with a `title` naming the group.
- **Node row** under the strip: intent (`insert-text`, `format`, `completion`), source, relative
  time in `tabular-nums`, and the first changed line as the label. Values the app did not author
  are truncated with a `title`.
- **Diff body**: `DiffEditor` with `editor.diff.viewMode`, current on the left, selected node on
  the right. Two selected nodes diff each other. Pending comparison shows `LoadingState`, a
  pruned selection shows `EmptyState` with "This state is no longer retained".
- **Actions**: Restore (a `Button` with `Spinner` from the mutation's `useIsMutating`), Clear
  history (confirms, because it deletes recoverable text).

A node is a root pointer into the shared piece table, and holding it keeps every piece it
references alive, including text deleted since. The pane therefore pins nothing beyond the one
mounted preview view: a comparison materializes both texts, runs `createTextDiff`, and drops the
roots. Retention can prune a selected node while the diff is on screen; the pane shows the
"no longer retained" state instead of holding the root to keep the diff valid.

Restore and clear are mutations with keys in `features/editor/mutation-keys.ts`; a restore
settles the document's content revision the way an ordinary edit does. Keyboard: arrows move
focus along sequence order, Shift+arrows extend to a second selection, Enter restores, Escape
returns to the editor. Preview never touches the live buffer or its selections (E019's separate
view session).

Outcome (2026-09-16): landed as a `history` document kind (`h/<path>` address, storage and
codec entries, retained file document) rendered by `features/editor/components/history-view.tsx`
and `history-pane.tsx`: an SVG graph strip (`layoutHistoryGraph` from the Editor, sequence on x,
lanes on y, lane colors now in `lib/history-lane-colors.ts` shared with git), the node row
(summary, source, relative time in `tabular-nums`, first inserted line with a `title`), and a
`DiffEditor` body: current on the left, the focused state on the right; two Shift-selected states
diff each other; pending is `LoadingState`, a pruned focus is `EmptyState`. Restore and Clear
history are mutations in `state/history-mutations.ts` with keys in `utils/mutation-keys.ts`;
clear confirms in a dialog. Keys on the strip: Left/Right walk sequence order, Shift extends to
a second selection, Up/Down follow the tree, Enter restores, Escape clears then returns to the
file's tab through the surface action `showFile`. The viewer is owned by the subscription in
`use-history-viewer.ts` because the React Compiler caches method reads and StrictMode disposes
effects; the snapshot carries the viewer for that reason. The Editor gained `clearHistory()`.
Review follow-up (2026-09-17): the barrier is a state of its own in the strip, reachable by Left
from the root, whose body names the group's files and carries an "Undo workspace edit" action
(`WorkspaceEditService.historyBarrierGroup`), disabled with the reason when later groups must go
first. An explicit pick acknowledges a pruning notice, so a valid state previews again. Every
node has a transparent hit disc so a hollow ring is clickable at its centre.

## Unit 4 — commands, keys, settings

- Register `editor.showHistory`, `editor.historyBack`, `editor.historyForward` and
  `editor.clearHistory` in `keymap/editor-commands.ts` with metadata in `client-core`. Proposed
  chords: `Mod+Shift+Z` is taken on non-mac by redo, so `historyBack` / `historyForward` get
  `Mod+Alt+Z` / `Mod+Alt+Shift+Z` pending the census. `showHistory` has no default chord and lives
  in the palette and the tab menu.
- `editor.history.retainedStates` in `packages/contracts/src/settings/keys.ts`, wired to the buffer
  option in the same change, then `bun run settings:reference`.
- The workspace-edit preview dialog's "Undo this group with the separate workspace undo command"
  line links to the History pane instead of describing a chordless command.

Outcome (2026-09-16): `workspace.showHistory`, `workspace.historyBack` (`Mod+Alt+Z`) and
`workspace.historyForward` (`Mod+Alt+Shift+Z`), all `fileBackedTab`; the ids live under
`workspace.` because `editor.*` is the namespace of commands the Editor itself dispatches. No
clear-history command: a palette entry that deletes recoverable text without a confirmation is
what the pane's dialog exists to avoid. `editor.history.retainedStates` (application, default
200, 10 to 5000) is mirrored for module-scope reads and feeds `createHistoryBuffer` in
`state/history-buffer.ts`, which every live-document buffer goes through, including prepared
opens via the file-open-intent `createBuffer` dependency. The preview dialog line points at the
History tab.

## Unit 5 — verification and deploy

- Scenario `editor-undo-branch` under `scripts/agent/scenarios/`: type A, type B, undo, type C,
  open History, assert two children of A, select B, assert the diff shows B against C, restore B,
  assert the buffer text. Selectors in `scripts/agent/selectors.ts`. Feature map line in the
  `verify-fregat` skill.
- `look` on the pane with the fixture at every unit that touches it; the evidence directory goes
  in the report.
- `trace editor-type-burst` before Unit 1 and after Unit 4 with `--compare`. Branching must not
  change keystroke latency; E017's retention prune runs off the hot path.
- Memory: E017's baseline trace at the retention limit, repeated with the pane open and a
  comparison pinned, proves the pane releases its snapshot pins.
- `bun run deploy` after Unit 0 and after Unit 5. Web-only, no server restart.

Outcome (2026-09-16): scenario `editor-undo-branch` (fixture workspace `work/tmp/plan121-undo`)
types A, undoes, B, undoes, C, CC, opens History from the palette, checks five states, walks to B
by keyboard, compares B with C, clicks C with the pointer, restores B by Enter and reads B back in
the file tab. Unit tests cover the labels, the document kind in every codec, the commands in the
command table, and the pane in happy-dom under StrictMode. Trace of `editor-type-burst` on the mesh
before (`20260916T203326Z`) and after (`20260916T203623Z`): tasks over 16 ms 232 → 121, over 50 ms
43 → 2, so branching cost nothing on the keystroke path (shared-server variance applies to the
size of the gain, not its sign). Deployed web-only, last as `20260916T204100Z-63bc3a5d-plan-121-undo-graph` after a review pass (prepared-open claim kept on a content change, `clearHistory` reports no logical revision, pane ids scoped per pane);
the same scenario passed against the mesh.

## Risks and open questions

- E017 changes the representation under the barrier and receipt API. That API is what keeps a
  workspace group atomic across files. Stop if a native checkout can undo one file's leg of a group.
- The graph keeps deleted text alive by design. That is a privacy surface the linear cap already
  had, but the pane makes it visible; Clear history and the retention setting are the controls.
- A horizontal graph in a pane that is often narrow may be worse than a list. D4 is decided on the
  fixture, not on the article's screenshot.
- Persistence (E018) is where the feature becomes "never lose work". Without it the graph is
  session-scoped and a reload still forgets everything. Say so in the pane's empty state.
- The Emacs alternative, where undo is itself an edit so nothing is ever lost with no tree UI,
  was considered and rejected: it preserves data but users cannot find it, and it makes Ctrl+Z
  semantics depend on how many times you already pressed it.
