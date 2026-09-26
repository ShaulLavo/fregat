# Plan 178: drag and drop on dnd-kit

- Status: PROPOSED. Size L. After [virtualization](virtualization.md) and [rows](rows.md). Starts
  with a spike (step 1).
- Owns: moving the tree's drag onto dnd-kit inside the window while it stays a native drag outside
  it, and one app-wide drag layer that every dnd-kit surface uses.

## Outcome

Inside the window, a tree drag is a dnd-kit drag: droppables, collision detection and drop handling
are the same machinery the editor tabs, the terminal list and the session rail use, through one
app-wide drag layer. Every dnd-kit drag in the app runs in that one context, so any surface can
later accept any kind of drag (a session into the composer, a file onto a machine) by registering a
droppable, with no context boundary in the way.
Once the pointer leaves the window, the same drag carries a native payload, so dropping on the
desktop or another app works as it does today. Thresholds, long-press, hover-to-expand, edge scroll
and the row-clone preview feel exactly as today. Sensors, drag data and edge scroll are shared.

## Owner direction (Q4)

"Inside the app it's always dnd-kit, and if you drag outside the window the native takes over."
No capability is lost. v6, no new drop behaviours beyond the Q2 bug fixes, no keyboard drag, the
row-clone preview.

2026-09-26, widening Q4: **one drag layer for everything.** Every surface that drags uses the same
context, the rail and the terminal list included, so the app is ready for drag integrations that are
not designed yet (anything into the chat, across machines). A draggable inside a nested
`DndContext` cannot reach a droppable in an outer one, so a surface left on a local context would
need rework the day it joins.

## Why the drag must start native

A browser starts a native drag only at `dragstart`, from a `draggable` element, as the gesture
begins. It cannot turn a pointer-driven drag into a native one partway through, so a dnd-kit
`PointerSensor` drag that reaches the window edge has no way to hand over. The reverse works: start
every mouse drag as a native drag and let dnd-kit consume its events.

- dnd-kit v6 accepts custom sensors: a class with static `activators` (React handler names, here
  `onDragStart`) that reports coordinates through `onMove`, `onEnd` and `onCancel`.
- A **native drag sensor** activates on `dragstart`, fills `dataTransfer`, sets the drag image, then
  follows document `dragover` for coordinates (Firefox reports zero coordinates on `drag` events),
  `drop` for the end, and `dragend` for cancel.
- Inside the window, dnd-kit sees an ordinary drag: collisions, droppables, `onDragOver`,
  `onDragEnd`. Outside it, `dragover` stops and the OS receives the `dataTransfer`. A `dragend` with
  no in-app drop ends the dnd-kit drag as cancelled.
- v6's `preventDefault` on window `dragstart` lives in `AbstractPointerSensor`, so it does not
  apply when the tree uses only this sensor (plus `TouchSensor`). Other surfaces keep theirs.
- During a native drag the browser fires no pointer or hover events. The hover suppression a
  pointer-driven drag would need (tooltips, Editor hovers) is not needed.
- The preview is the native drag image, which is today's row clone. `DragOverlay` is not used for
  the tree, because outside the window only the native image is visible.

This is the design to prove in the spike. dnd-kit documents no native sensor; the risks are that
v6 assumes pointer semantics somewhere in its measuring or auto-scroll, and that a `drop` handled by
a native-only target elsewhere in the app does not reach the sensor.

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
with 10px tolerance, a cloned-row preview, a `text/plain` path payload, `effectAllowed = 'move'`.
The controller owns the drag model (`startDrag`, `setDragTarget`, `completeDrag`, `cancelDrag`,
`dragAndDrop.ts`); the app's `canDrag`, `canDrop` and `onDropComplete` → `moveEntries` → journaled
file operation give the toast and undo (Plan 136).

**Native targets that stay native:** OS files into the composer and the wallpaper picker, the
editor's text drop. Pane resizing and editor sashes are pointer drags and unaffected.

**Bugs (Q2, fixed here):** the composer only accepts `${rootPath}/…` and the tree sends a
root-relative path (quirk 8); the editor's drop sets `dropEffect = 'copy'` against the tree's
`effectAllowed = 'move'`, so the browser refuses it (quirk 9).

## Work

1. **Spike.** The native drag sensor on the tree alone, in a `/dev` tab or behind the existing drag:
   drop into a folder, onto an editor group, onto the composer, onto the desktop and into another
   browser window, in Chromium and WebKit (the desktop shell). Measure frame times against the
   baseline. Go / no-go before the rest.
2. **Shared layer** (`apps/web/src/lib/dnd/`; the tree, workbench and chat are its consumers):
   - `utils/drag-data.ts`: a typed `DragData` union (`tree-paths`, `tab`, `session`, …) with a parser,
     generalizing `editorDropData`.
   - `utils/native-drag-sensor.ts`: the sensor above.
   - `hooks/use-drag-sensors.ts`: one sensor hook with distance, delay and tolerance parameters,
     replacing `use-rail-drag-sensors.ts` and `use-tab-strip-sensors.ts`.
   - `providers/drag-provider.tsx`: the one `DndContext`, at the app root above every layout (the
     workbench, chat mode, the sidebar and the composer); collision detection filtered by the active
     kind; composed announcements; the blur / Escape cancel from
     `editor-groups-drag-provider.tsx:96-123`. Surfaces subscribe to the drags they care about
     through `useDndMonitor` or a selector on the active `DragData` kind, not by reading the context
     on every move.
   - **One sensor set.** A context has one `sensors` list and every draggable receives every
     sensor's activators, so each sensor's activator checks the draggable's `DragData` kind (v6
     passes the active draggable node to the activator handler): the native sensor activates only
     for `tree-paths`, the pointer sensor only for tabs, sessions and terminals, each with the
     distance and delay its surface uses today.
   - `hooks/use-edge-auto-scroll.ts`: the tree's rAF edge scroll, fed by the sensor's coordinates;
     dnd-kit's own auto-scroll is excluded for the tree scroller with `canScroll`, as the editor strip
     already does.
3. **Tree.** One `useDraggable` on the scroller with delegated activation (the row comes from the
   activator event), so virtualization does not churn hooks. `onDragMove` resolves the target with
   `resolveDropTargetFromElement`, calls `setDragTarget`, feeds the hover-expand timer and the edge
   scroll. `onDragEnd` runs today's `onDropComplete`. The controller's drag model stays. Touch keeps
   the 400ms long-press through `TouchSensor { delay: 400, tolerance: 10 }`.
4. **Payload.** `dataTransfer` carries what leaves the window: `text/plain` with the absolute path
   (fixing quirk 8 for any native target) and `text/uri-list`. The in-app `DragData` carries every
   dragged path.
5. **In-app targets.** The composer registers a droppable and inserts mentions for the dragged paths
   (quirk 8); its string parser stays for OS files. An editor group accepts `tree-paths` and does
   what the editor's drop already intends, inserting the path text (quirk 9); opening the file there
   would be a new behaviour and is not in scope.
6. **Every surface joins.** The editor provider moves out of `code-panel.tsx`; the session rail
   (`session-rail.tsx:366`) and the terminal list (`terminal-list.tsx:63`) drop their local
   `DndContext`s. Each keeps its own sortable behaviour, preview and thresholds (6px rail, 8px
   tabs) as parameters of the shared sensor hook, and its `DragOverlay` renders only for its own
   kind. Rail and tab reordering must feel exactly as today.
7. **iOS.** Rows set `touch-callout: none` and `user-select: none` for long-press.

## Parity

Parity spec "Drag and drop" and the touch lines: the same targets, de-dup, 800ms hover-expand, the
40px / 18px-per-frame edge scroll, Escape, the row-clone preview, dragged rows at 0.5 (aligned to a
token, Q1). No drop-target highlight and the same `move` cursor on invalid targets (Q2 keeps both).
Drag-out to the OS works as today.

## Delete

`useFileTreeDrag.ts`, `dragPointer.ts` except `resolveDropTargetFromElement`,
`use-rail-drag-sensors.ts`, `use-tab-strip-sensors.ts`, the local `DndContext`s in
`session-rail.tsx`, `terminal-list.tsx` and `editor-groups-drag-provider.tsx`.

## Risks

- **The sensor.** Unproven; the spike decides. If dnd-kit fights a native source, the fallback is
  keeping the tree's native drag and publishing typed `DragData` to the workspace provider's
  droppables by hand, which keeps drag-out and still shares the targets.
- **Renders.** A v6 context re-renders every draggable and droppable consumer on each move, and one
  app-wide context puts the tree, tabs, rail and terminals in the same drag. Measure `renders` and
  `trace` on a tree drag, a rail reorder and `editor-split-drag`. If the cost shows, fix it inside
  the layer (kind-filtered subscriptions, stable droppable data, memo boundaries under the provider);
  splitting the context back up is not the fix.

## Verification

- Harness drag tests (all ✗ today): targets, de-dup, hover-expand, edge scroll, Escape, touch.
- A real row drag onto the composer (`chat-composer-insert` stops synthesizing the event), onto an
  editor group, and a drag-out (Playwright can assert the `dataTransfer` at the window edge).
- `file-tree-undo`, `editor-split-drag`, `editor-split-targets`, `session-ordering`, and the
  terminal list reorder (`session-rail-drag.test.tsx` and the terminal list tests).
- A grep finds one `DndContext` in `apps/web/src`.
- `renders` and `trace` as above.
