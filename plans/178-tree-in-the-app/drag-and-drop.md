# Plan 178: drag and drop on dnd-kit

- Status: PROPOSED. Size L. After [virtualization](virtualization.md) and
  [rows](rows.md).
- Owns: moving the tree's drag onto dnd-kit, and a shared drag layer for the workspace.

## Outcome

The tree drags with dnd-kit through a workspace-level drag layer shared with the editor tabs and the
chat composer. A drag from the tree can drop into a folder, onto the composer as a typed mention,
and onto an editor group. The feel (thresholds, long-press, hover-to-expand, edge scroll) is the
tree's. Sensors, drag data, previews and edge scroll are shared primitives.

## Today

**dnd-kit in the app:** only `apps/web` depends on it, legacy v6 (`@dnd-kit/core` 6.3.1, `sortable`
10.0.0, `modifiers` 9.0.0, `utilities` 3.2.2). One context per surface, none at the root:

| Surface                | Context                                                   | Sensors                        | Preview              |
| ---------------------- | --------------------------------------------------------- | ------------------------------ | -------------------- |
| Session rail           | `chat-mode/components/session-rail.tsx:366`               | Pointer 6px; Keyboard on Space | `SessionDragPreview` |
| Editor tabs and groups | `workbench/providers/editor-groups-drag-provider.tsx:135` | Pointer 8px; Keyboard          | `EditorDragPreview`  |
| Terminal list          | `workbench/components/terminal-list.tsx:63`               | `useTabStripSensors()`         | none                 |

The two sensor hooks are near-duplicates. No context spans the sidebar and the editor, and the
composer has no droppable.

**The tree** drags natively (`useFileTreeDrag.ts`, 502; `dragPointer.ts`, 161): selection-aware
multi-drag, folder / parent / chain-segment targets, hover-to-expand at 800ms, rAF edge scroll (40px
band, up to 18px per frame) that refreshes the virtual window each step, touch long-press at 400ms
with 10px tolerance, a cloned-row preview, `text/plain` path payload, `effectAllowed = 'move'`. The
controller owns the drag model (`startDrag`, `setDragTarget`, `completeDrag`, `cancelDrag`,
`dragAndDrop.ts`); the app's `canDrag`, `canDrop` and `onDropComplete` → `moveEntries` → journaled
file operation give the toast and undo (Plan 136).

**Other drags stay native:** OS files into the composer and the wallpaper picker, editor text drop,
pane resizing, editor sashes.

## What dnd-kit can and cannot do

- Drop into folders without sortable: yes.
- Virtualized sources: v6 `PointerSensor` listens on the document, so an unmounted source keeps the
  drag; `DragOverlay` is the documented preview. `keepMounted` keeps the source row anyway.
- Auto-scroll: built in but 5ms steps inside 20% of the edge. To keep the tree's feel, exclude the
  tree scroller with `canScroll` (as the editor strip does) and drive the tree's loop from
  `onDragMove`.
- Hover-to-expand: not built in; the tree's timer is fed the resolved target.
- Long-press: `TouchSensor { delay: 400, tolerance: 10 }` matches. Pair with `MouseSensor`, since
  `PointerSensor` would also claim touch.
- Keyboard drag: a gain, with a custom coordinate getter; Space is taken by selection (Q4).
- **Leaving the window: no.** Neither v6 nor `@dnd-kit/dom` 0.5.0 produces a native `dataTransfer`.
  A dnd-kit source cannot drop onto the OS, another window, or a native-only target. v6 also
  `preventDefault`s window `dragstart` while pending, so one element cannot be both.

## Work

1. **Shared layer** (`apps/web/src/lib/dnd/`, qualifying for `lib/` with the tree, workbench and
   chat as consumers):
   - `utils/drag-data.ts`: a typed `DragData` union (`tree-paths`, `tab`, `session`, …) with a
     parser, generalizing `editorDropData`.
   - `hooks/use-drag-sensors.ts`: one sensor hook with distance, delay and tolerance parameters,
     replacing `use-rail-drag-sensors.ts` and `use-tab-strip-sensors.ts`.
   - `providers/workspace-drag-provider.tsx`: one context above the workbench and chat-mode
     layouts; collision detection filters by the active kind; composed announcements; the
     blur / Escape cancel from `editor-groups-drag-provider.tsx:96-123`.
   - `hooks/use-edge-auto-scroll.ts`: the tree's rAF edge scroll, usable by any `VirtualList`.
   - `packages/ui/src/patterns/drag-preview.tsx`: icon, label, count badge, move / copy mark, shared
     by the editor, session and tree previews (or a row clone, Q4).
2. **Tree.** One `useDraggable` on the scroller with delegated activation (the row comes from the
   activator event), so virtualization does not churn hooks. `onDragMove` resolves the target from
   the pointer with `resolveDropTargetFromElement`, calls `setDragTarget`, feeds the hover-expand
   timer and the edge scroll. `onDragEnd` runs today's `onDropComplete`. The controller's drag model
   stays.
3. **Targets.** The composer registers a droppable and inserts typed mentions for every dragged
   path; the string parser in `composer-drop.ts` stays for OS files only. An editor group accepts
   `tree-paths` and opens the file there, reusing the split-edge targets (Q4).
4. **Editor provider** moves out of `code-panel.tsx` into the workspace provider. The rail and the
   terminal list keep their local contexts.
5. **Hover suppression.** Pointer drags fire hovers that native drags do not: the tooltip layer and
   the Editor's hover and definition-link controllers stand down while a drag is active.
6. **iOS.** Rows set `touch-callout: none` and `user-select: none` for long-press.

## Parity

Parity spec "Drag and drop" and the touch lines. The drop-target highlight (quirk 6) and the
invalid-target cursor per Q2. Drag-out to the OS per Q4.

## Delete

`useFileTreeDrag.ts`, `dragPointer.ts` except `resolveDropTargetFromElement`, the tree's preview
code, `use-rail-drag-sensors.ts`, `use-tab-strip-sensors.ts`, the tree's `text/plain` payload (unless
Q4 keeps a native fallback).

## Risks

- **Renders.** A v6 context re-renders every draggable and droppable consumer on each move; one
  workspace context pulls editor tabs into tree drags. Measure `renders` and `trace` on a tree drag
  and on `editor-split-drag`.
- **Feel.** The native drag image is composited; `DragOverlay` is React. Compare frame times.
- **Lost capability.** Drag to the OS and other windows (Q4).

## Verification

- Harness drag tests (all ✗ today): targets, de-dup, hover-expand, edge scroll, Escape, touch,
  composer mention from a real drag.
- `file-tree-undo`, `chat-composer-insert` (now a real drag), `editor-split-drag`,
  `editor-split-targets`, `session-ordering`.
- `renders` and `trace` as above.
