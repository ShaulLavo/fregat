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

`bun run agent:browser scenario tree-file-clicks` opens two files in a disposable nested folder, creates files in its ancestors, and deletes a sibling. The new entries must appear and the deleted entry must disappear while the nested folder stays expanded and both files remain clickable. Pass `--url` to run against the mesh build.

## Hover prefetch

`bun run agent:browser scenario file-tree-hover-prefetch` moves the pointer onto a file row in a fixture workspace. It must see `/fs/read` for that file before any click, and no editor tab may open. The rows come from `FileTreeModel.getRowElements()`, so a tree change that stops registering rows shows up here.
