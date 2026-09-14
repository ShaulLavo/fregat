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

## Sticky folders over wallpaper

`bun run agent:browser scenario tree-sticky-scroll --headed --width 1360 --height 840 --scale 2 --product-wallpaper apps/site/src/assets/garden.jpeg` opens nested source files and scrolls through partial rows and folder boundaries. Inspect the screenshot and JSON at each step. The first file row's covered portion and a sticky child pushed above its own slot must be clipped; making the folder background opaque hides the symptom by covering the wallpaper.
