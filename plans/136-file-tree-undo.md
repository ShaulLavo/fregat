# 136: Undo and redo for file tree operations

Status: implemented 2026-09-23, all three phases. D1 and D2 decided 2026-09-23. See "As built" at the end for where the implementation departs from the text below.

## Outcome

A user drags a folder into the wrong place, deletes the wrong file, or renames something by accident. They press Ctrl+Z with the tree focused and the operation reverses: files, folders, open tabs, unsaved buffers and the tree all return to where they were. Ctrl+Shift+Z replays it. A drag shows a "Moved X into Y · Undo" toast so the undo is visible even when the tree is not focused.

Deleting a folder and undoing it restores the folder with every file inside it. Nothing the user can do in the tree is irreversible within the retention window, and when an operation is too large to keep, the app says so before it runs, not after.

## What VS Code does

Read from `references/vscode` at `e81ea68fc02`. Its design is the baseline to beat, not to copy.

| Aspect        | VS Code                                                                                                                                                                                     | Where                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Routing       | The global Undo command has an Explorer implementation at priority 110 that runs only when the Explorer view has focus, over its own `UndoRedoSource`.                                      | `contrib/files/browser/files.contribution.ts:653`     |
| Recording     | Each operation returns its inverse when it runs: rename → rename back, create and copy → delete, delete → create. Stored in memory as one workspace undo element.                           | `contrib/bulkEdit/browser/bulkFileEdits.ts`           |
| Delete        | Reads file bytes into memory before deleting so undo can recreate them. Files over 5 MB are skipped and silently not restored. Also moves to the OS trash when `files.enableTrash` is on.   | `fileActions.ts:78`, `bulkFileEdits.ts:250-275`       |
| Folder delete | Contents are never captured (`!edit.options.folder`). Undo recreates an **empty** folder; the files survive only in the OS trash.                                                           | `bulkFileEdits.ts:262`                                |
| Safety        | Refuses the undo when a later text edit touched an affected file ("Could not undo 'Move' because changes were made to X").                                                                  | `platform/undoRedo/common/undoRedoService.ts:855-900` |
| Settings      | `explorer.enableUndo`; `explorer.confirmUndo` (verbose / default / light — default prompts before an undo that deletes); `explorer.confirmDragAndDrop` (default on: a modal on every drag). | `files.contribution.ts:484-515`                       |
| Lifetime      | In memory. A reload loses the history.                                                                                                                                                      |                                                       |

## What Platform has

Tree operations are one-way today.

- Ctrl+Z in the `file-tree` pane matches no binding. `undoCategory: 'file-operation'` on `fileTree.newFile`/`newFolder` is a log label only (`keymap/state/command-bus.ts:504`).
- Delete is `rm(abs, { recursive, force: false })` (`apps/server/src/fs/delete.ts:15`). The dialog warns there is nothing to undo (`features/workspace/components/delete-entry-dialog.tsx:10`).
- Tree operations reach `/fs/{create-file,create-folder,rename,copy,delete}` through `runTreeIntent` (`features/workspace/state/tree-intents.ts:76`) inside `WorkspaceEditService.runWorkspaceMutation` (`features/editor/state/workspace-edit-service.ts:568`). That wrapper records nothing and **evicts** journaled undo groups touching the same paths (`invalidateHistoryForForward`, `:1258`).
- Drag-and-drop calls `renamePath` per item (`features/workspace/components/tree-pane.tsx:552-576`) and skips `renameEditorPaths`, which the inline rename calls (`hooks/use-fs-actions.ts:124-149`). A dirty tab under a dragged path gets a `renamed-conflict` toast instead of following its file (`utils/event-model.ts:122-157`).

A journaled transaction system already exists for LSP and computed-text workspace edits, and it is the right foundation:

- Server: `/fs/workspace-edit/{prepare,commit,finalize,undo,redo,rollback,recover,release}` (`apps/server/src/fs/routes.ts:116-151`), implemented in `workspace-edit.ts` and `workspace-edit-journal.ts`. Operations are `write | create | rename | delete` (`contracts.ts:264-301`). A delete moves the resource into `stage/` inside the journal, so it is recoverable and crash-safe. Limits: 128 MB per operation, 512 MB per journal, 24 h retention (`workspace-edit-journal.ts:29-31`).
- Client: `WorkspaceEditService` builds and commits edits, moves open documents with `transitionDocumentUri` (`:2901`), projects the tree with `utils/workspace-edit-tree-projection.ts`, and keeps one strict-LIFO history of 20 groups (`:83`, `reverseGroup` `:1286`). Commands `workspace.undoWorkspaceEdit`/`redoWorkspaceEdit` exist with no default key.

Three gaps stop the tree from using it as-is:

1. **Files only.** `readActual` rejects anything that is not a regular file (`workspace-edit.ts:1035`), so no folder can be renamed, moved, deleted or created through it. It also reads and hashes every resource's full contents, which is wasted work for a rename or delete.
2. **The journal must share a device with the resource.** `assertResourceDevice` (`:1101`) runs for renames as well as deletes. The journal is `~/.platform/workspace-edit-journals` on the `/home` SSD; workspaces live on `/work`. By the code, every journaled rename or delete under `/work` fails with `WORKSPACE_EDIT_DEVICE_UNSUPPORTED`. Not yet reproduced: no log line carries that code, so nothing has exercised the path.
3. **No copy operation and no folder create.** Duplicate and New Folder have no journaled form.

## Decisions

D1 and D2 were decided by the owner on 2026-09-23. The rest carry a recommendation that stands unless overruled.

- **D1 — where the journal lives. Decided: one hidden journal per drive.** The journal for a resource is `.platform-journal-<uid>` at the top of that resource's mount (the freedesktop trash spec's `$topdir/.Trash-$uid` precedent; `/work` is owned by the user, so `/work/.platform-journal-1000`). When the mount top is not writable, fall back to the home journal with copy-then-remove staging.
- **D2 — undo survives a reload. Decided: yes, and the server owns the list.** The journal already survives a reload and a server restart; the undo list does not. It lives in the tab's `undoStack`, `/recovery` lists only `partial` manifests (`workspace-edit.ts:280`), manifests carry no label or category, and `handleServerEpoch` clears history on purpose (`workspace-edit-service.ts:383`). So the server keeps the ordered undo and redo list per workspace, and every window reads the same list. Retention stays 24 h.
- **D3 — one history or two.** Separate. Tree operations carry `undoCategory: 'file-operation'`; Ctrl+Z in the tree undoes the newest file-operation group, and `workspace.undoWorkspaceEdit` keeps undoing LSP edits. Both live in the same journal and the same path-intersection eviction, so an LSP rename after a tree move still invalidates the move correctly.
- **D4 — drag confirmation.** No modal. An undo toast after every drag and every delete. A modal on every drag taxes the common case to guard the rare one; the toast costs nothing until it is needed.
- **D5 — over-quota deletes.** Staging by rename on the same device copies nothing, but it holds disk space for the retention window. Count staged directory bytes against the journal quota. When a delete would exceed it, the delete dialog says the delete cannot be undone and asks for explicit confirmation, before anything runs. No OS trash integration.
- **D6 — guards.** Rename, move and delete guard on identity (`dev`, `ino`, file type), not a content hash. Content hashes stay for `write` legs, where the bytes are the precondition. An undo whose target path is now occupied fails with a catalog error naming the path; it never overwrites.

## Phase 1: Journal accepts directories and any device

Server only. `apps/server/src/fs/workspace-edit.ts`, `workspace-edit-journal.ts`, `contracts.ts`, `service.ts`.

1. Reproduce gap 2 first: an LSP file rename in a `/work` workspace, with the log line that shows the failure.
2. Implement D1: resolve the journal for a resource by its device, create it on first use, and route staging through it. Keep `assertResourceDevice` only for the fallback path, where it selects copy-then-remove instead of throwing. Log the chosen journal root and staging mode on the operation's wide event.
3. Accept directories in `readActual` / `virtualResource` for `rename` and `delete`, guarded per D6. Symlinks stay rejected. Reject a directory under `write`.
4. Add `create` with `folder: true`, and a `copy` operation whose inverse is a staged delete of the destination. Every inverse is itself a staged operation, so undoing a copy never loses edits made to the copy since.
5. Count directory bytes toward the quota per D5, measured once during prepare with a bounded walk. Report the measured size in `internal` on a quota failure.
6. Crash recovery: extend the existing recovery tests to a directory delete interrupted after staging and before finalize.
7. Implement D2's server half: store `label` and `category` in the manifest, keep an ordered undo and redo list per workspace and category, and expose it on a `GET /fs/workspace-edit/history` read. A new forward operation clears that category's redo list. Undo and redo of anything but the list's head fail with a catalog error, so two windows cannot reverse out of order.

Exit: server tests cover folder rename, move, delete and create, cross-device staging under a fixture where the journal is on another filesystem (journal on `/dev/shm`, workspace under `/work/tmp`), guard failure on an occupied target, and recovery. `bun run errors:census` passes with the new catalog entries.

## Phase 2: Tree operations go through the journal

1. Add a `file-operation` request kind to `WorkspaceEditService.applyOperation` (`workspace-edit-service.ts:428`) beside `language-server` and `computed-text`, with no preview step.
2. Move create, rename, drag-move (multi-item as one group), duplicate and delete in `use-fs-actions.ts` and `tree-pane.tsx` onto it. Each gets a label: "Move 3 items into src", "Delete utils", "Rename a.ts to b.ts".
3. Open documents move through `transitionDocumentUri`. Before deleting `renameEditorPaths`, diff what each covers — open tabs, editor history, recently closed tabs, live documents — and add a test per consumer so nothing it re-keys today is lost. This also fixes the drag path's dirty-tab conflict.
4. The tree projection comes from `workspace-edit-tree-projection.ts`. Once no tree caller uses them, delete the `move`, `duplicate` and `delete` `TreePatch` kinds and whatever of `runTreeIntent` is left (coordinate with Plan 113).
5. After this phase the only `runWorkspaceMutation` caller is the save path (`features/editor/state/save-service.ts:80`), and every save evicts journaled groups touching the saved file. Narrow that eviction to groups with `write` legs: a file-operation group is guarded on identity (D6), so saving a file after moving it must not cost the move's undo.

Exit: every tree operation produces one journal group with the right label, open and dirty tabs follow moved files, and `bun run gates` passes.

## Phase 3: Commands, keys and feedback

1. Split history per D3: `reverseGroup` pops the newest group of the requested category. Add `fileTree.undo` / `fileTree.redo` in `packages/client-core/src/commands/`, bound to `Mod+Z` / `Mod+Shift+Z` with `pane: 'file-tree'`, gated on the category's stacks.
2. Toast after drag and delete (D4) with an Undo action that runs the same command, and a toast after every undo naming what was reversed. Failures render the catalog `why`/`fix`.
3. Delete dialog: replace the "nothing to undo" copy; show the D5 warning only when the delete exceeds the quota.
4. The client reads the file-operation undo and redo list from the server (Phase 1 step 7) on boot, on server-epoch change and after each transition, instead of keeping its own stack. Delete the file-operation half of `clearHistory` on epoch change (`workspace-edit-service.ts:383-394`). A second window's Ctrl+Z undoes the same newest group.

Exit: the scenario below passes on the dev server and on the mesh.

## Verification

- New scenario `scripts/agent/scenarios/file-tree-undo.ts` over a fixture in `/work/tmp/plan136-undo`: drag a folder with an open dirty file into another folder, Ctrl+Z, assert the tree, the tab path and the unsaved text; Ctrl+Shift+Z and assert again; delete a folder with nested files, undo, assert every file's contents; toast Undo with focus in the editor. Add selectors to `scripts/agent/selectors.ts` and a line to the feature map.
- Reload between the delete and the undo, and undo from a second window, to prove D2.
- Read the `file-tree` and `workspace-edit` log events for each step and confirm the journal root and staging mode are recorded.
- Deploy with `bun run deploy --server`: the server changes.

## Out of scope

- OS trash integration.
- Undo for operations made outside Platform (a terminal `mv`, another editor).
- Undo for git discard. It already has its own confirmation, and its inverse is a patch, not a file operation.

## As built

- **Journal per drive.** `apps/server/src/fs/workspace-edit-journals.ts` places each operation's journal by the workspace's device: `<mount top>/.platform-journal-<uid>` when writable, else the home journal. A resource on another device than its journal is staged by copy-then-remove (`copyIntoPlace`, rename into place, then remove). Drive journals are on by default and off whenever a journal root is injected (tests). The journal name is hidden from tree, search and watch by segment.
- **Entry guards.** `present` preconditions and `category: 'file-operation'` manifests read entries without their bytes and guard on type only: a save replaces a file's inode and a restore across drives replaces a folder's, and an undo only moves or parks, so an inode check could only strand history. Per-step intent guards keep `dev`/`ino` within a drive; writes keep content hashes.
- **Undo slots.** An undone create or copy is parked in the journal, not deleted, and a redo moves it back, so edits made in between survive.
- **Server-owned history.** Manifests carry `category`, `label`, `stagedBytes` and `historySequence`; `GET /fs/workspace-edit/history` returns both lists newest first. Only the head can be reversed (`WORKSPACE_EDIT_NOT_HEAD`); a new operation clears its category's redo list; a language-server operation with resource legs evicts the file operations it touches, transitively. File-operation manifests survive a server restart within the 24 h retention.
- **Quota.** Counted from each manifest's `stagedBytes`, which is re-measured from the operation's stage after every transition. A delete measures its tree at prepare; an undo or redo measures what it is about to move into the journal and refuses with `WORKSPACE_EDIT_QUOTA` rather than park more than the journal allows.
- **Crash recovery.** An undo or redo interrupted after commit is rolled back at startup to the stable state it started from and stays in the history with its journal; only a never-finalized first forward is discarded.
- **Events.** File operations publish one event per leg in the direction that landed, a move as `renamed`, with writer id `operationId#generation`. The window that ran a transition claims that id before finalizing and ignores its own events, including a late one from its own earlier undo, and orphans or restores its documents itself; another window follows the rename. Any journaled event, and every stream reconnect, invalidates the cached file history, and an undo whose history read is cancelled by that refresh joins the fresh read. Transaction barriers hold native events under a moved or deleted folder.
- **Client.** `WorkspaceEditService.applyFileOperation` / `reverseFileOperation` run the journaled transport inside `runWorkspaceMutation`, moving documents between commit and finalize. Documents move through the existing `renameEditorPaths` logic (now `fileOperationDocuments` in `features/workspace/state/file-operations.ts`), not `transitionDocumentUri`: it already re-keys open tabs, editor history, recently closed tabs, live documents and the definition and reference panels, and a re-keyed view re-opens under its new URI. The drag path uses it too, which removes the `renamed-conflict` toast for a dirty dragged file.
- **Tree projection.** `runTreeIntent` and the `move`, `duplicate` and `delete` `TreePatch` kinds stay as the optimistic layer over the journaled transport; Phase 2 step 4 was not done.
- **Commands.** `fileTree.undo` (Mod+Z) and `fileTree.redo` (Mod+Shift+Z) in the `file-tree` pane, with a new `yieldsToTextEntry` key flag so the rename box and filter keep their own undo. Until the history has loaded the commands stay enabled and the handler, which always reads the server's list first, decides.
- **Save eviction (Phase 2 step 5).** The client no longer holds file-operation groups, and the server evicts them only on resource legs, so a save never costs a move's undo.
