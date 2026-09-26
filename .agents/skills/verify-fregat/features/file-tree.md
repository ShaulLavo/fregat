# File tree

The workspace folder tree in the left rail: expand, create, rename, duplicate, delete, drag to move.

## Sub-features

Expand and collapse, filter box, create file or folder, rename, duplicate, delete with confirmation, drag-move, git status dots.

## How to get to it (user POV)

The Files side panel is open by default in a workspace. `aria-label="Folder tree"` names it.

## Driving it with agent:browser

`look --selector '[aria-label="Folder tree"]'` for a screenshot of the tree alone. Tree mutations are workspace-edit intents; a proof reads the disk afterwards and `caches` to see the tree query refresh.

## Gotchas

Mutations go through `runTreeIntent`, so the tree shows the change before the server confirms it. A refused change disappears from the projection; do not read the optimistic state as success.

Every create, rename, drag, duplicate and delete is a journaled `file-operation` workspace edit. `GET /fs/workspace-edit/history?category=file-operation&workspace=…` is the shared undo and redo list; the disk flips at undo-commit, before the client lands, so wait for the "Undid …" toast rather than the file. A second window needs its own browser context (see the connection limit in the skill's Drive section).

## Undo and redo

`bun run agent:browser scenario file-tree-undo` drags a folder holding a dirty file into another folder, undoes and redoes it with Ctrl+Z / Ctrl+Shift+Z in the tree, deletes a folder and undoes it from the toast with the editor focused, after a reload, and from a second window. The fixture is `/work/tmp/plan136-undo`.

## Sticky folders over wallpaper

`bun run agent:browser scenario tree-sticky-scroll --headed --width 1360 --height 840 --scale 2 --product-wallpaper apps/site/src/assets/garden.jpeg` opens nested source files and scrolls through partial rows and folder boundaries. Inspect the screenshot and JSON at each step. The first file row's covered portion and a sticky child pushed above its own slot must be clipped; making the folder background opaque hides the symptom by covering the wallpaper.

## File clicks during refresh

`bun run agent:browser scenario tree-file-clicks` opens two files in a disposable nested folder, creates files in its ancestors, and deletes a sibling. The new entries must appear and the deleted entry must disappear while the nested folder stays expanded and both files remain clickable.

## Hover prefetch

`bun run agent:browser scenario file-tree-hover-prefetch` moves the pointer onto a file row in a fixture workspace. It must see `/fs/read` for that file before any click, and no editor tab may open. The rows come from `FileTreeModel.getRowElements()`, so a tree change that stops registering rows shows up here.

## Large and unreadable folders

`bun run agent:browser scenario workspace-open-large-root` lowers `files.watchDirectoryLimit`, opens a fixture over it through the folder picker, and expects the "Live updates limited" header control with its tooltip, `no access` on an unreadable child after one 403 (no retry), a new top-level file appearing live, and no toast. `workspace-open-unreadable-child` opens the same shape under the limit: full watch, `no access`, no limited control; then it moves along the row to the gray sparkle beside `no access`, expects the "Fix with AI" tooltip and a chat prefilled with the failure. The large-root scenario also expands a folder again after a change inside it (a limited root re-reads on expand) and raises the limit back, expecting the limited control to go. The log carries `fs.workspace_index.build` (`off` with `watch-limit` for a limited root) and each attach's `watch.roots` with its directory count. Directory errors reach the rows through `FileTreeModel.refreshDecorations()`; without it a `no access` or `error` decoration waits for an unrelated repaint.

## Folder switches and the picker

`bun run agent:browser scenario workspace-switch-click-during-open` holds `/fs/workspace-root` for three seconds, expects the "Opening target" status, clicks a file in the old workspace (logged as `navigation.dropped`) and expects the switch to land. `file-picker-prefetch-bound` sweeps and scrolls a 600-folder list in the picker; scrolling under a still pointer must list at most four folders, and `file-picker.prefetch_intents` counts Foresight hits by predictor.

## Parity harness (Plan 178)

`bun run agent:browser scenario tree-parity` captures the tree in 15 states (rest, hover, keyboard and click focus, multi-select, menu, rename, drag, filter, long name, loading file and folder, folder error, sticky) across compact/cozy × light/dark at scale 2, and diffs each capture pixel by pixel and property by property against `scripts/agent/baselines/tree-parity/`. Drift fails the run; the diff images and style lines land in the evidence directory under `tree-parity/`. `TREE_PARITY_UPDATE=1` rewrites the baseline (commit it with the change that moves the look on purpose); `TREE_PARITY_STATES=rest,hover` limits a run. `tree-parity-behaviour` pins the app-only behaviours, and `packages/tree/src/tests/parity-*.browser.tsx` the rest, with real input.
