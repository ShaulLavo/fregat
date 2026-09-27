# Plan 178: context menu

- Status: IN PROGRESS. Git/search and session rail share menu ownership; tree remains. Size S–M. After [app-owned-state](app-owned-state.md).
- Owns: one list-level context menu pattern, adopted by the tree first.

## Incremental delivery

The first PR adds `keymap/menus/hooks/use-list-context-menu.ts` and adopts it in Git changes
(file and group rows), compact search results, and the search editor. It owns pointer/keyboard
anchors, touch and `data-scrolling` suppression, scroll/row-removal dismissal, and list focus
return. Git no longer dispatches a synthetic keyboard event or mounts menus in each row.

The session rail uses the same list owner for session and project rows. Menu keys open it directly;
Space still forwards to the row for keyboard drag. Desktop touch menus remain suppressed, while the
standalone phone rail opts into native long-press context menus to retain its session actions.
`session-rail-menu`, `session-actions-surfaces` and `phone-context-menus` cover this adoption.

Remaining work is the tree. The tree code now lives under
`apps/web/src/features/workspace/`: `hooks/use-tree-context-menu.ts`,
`hooks/use-tree-menu-trigger.ts`, `components/tree-menu-trigger.tsx`,
`components/tree-context-menu-wash.tsx`, `state/tree-menu-trigger.ts`, and the corresponding
`utils/tree-context-menu-anchor.ts` / `utils/tree-menu-trigger-style.ts`. Its sticky-row,
viewport, keyboard and imperative composition integration must migrate together. The shared
hook is ready for those adopters; their legacy stores, wash and trigger files still exist.

## Outcome

Lists open row menus through one `useListContextMenu` over `MenuSurface`. The tree's menu trigger,
its wash overlay, its outside-click detection and its zustand store are gone. Git changes, the
session rail and search results drop their synthetic-keydown hacks.

## Today

- **Tree:** `use-context-menu.ts` (434), `contextMenuAnchor.ts` (128), `menu-trigger.tsx`,
  `use-menu-trigger.ts`, `state/menu-trigger.ts` (the package's only zustand store),
  `menu-trigger-style.ts`. The app runs right-click mode, so the "…" button never shows; the trigger
  is mounted only to host the slot. Closing: Escape captured on the document, mousedown outside, a
  transparent overlay over the tree that eats clicks, touches and wheel, a user scroll, row removal.
  Menu suppressed during scroll and 50ms after, and during touch.
- **App:** `row-menu.tsx` renders `MenuSurface` with `rectAnchor`; `use-row-menu.ts` targets one
  path. `MenuSurface` (`keymap/menus/components/surface.tsx`) has `returnFocusTo` and `takesFocus`.
  `useContextMenu` (`keymap/menus/hooks/use-context-menu.ts`) has `openAtEvent`, `openAtElement`,
  `openOnMenuKey`.
- **Other lists:** git opens one menu per row and dispatches a synthetic keydown
  (`changes-list.tsx:63-76`); the rail clones a menu per row (`session-menu.tsx`) and forwards keys
  (`lib/list-keyboard.ts:9-28`); search results use one list-level menu with `openAtElement(row)`
  (`results-view.tsx:108-115`), the cleanest of the three.

## Work

1. **`useListContextMenu`** in `keymap/menus/hooks/`: one menu per list; right-click anchors at the
   pointer, Shift+F10 and the ContextMenu key anchor at the cursor row's rect; the target is the
   right-clicked row, or the selection when that row is in it, per list (the tree keeps one row,
   Q2); `returnFocusTo` the list; suppressed while the list's `data-scrolling` is set
   and during touch; closes on user scroll and when its row is removed.
2. **Tree.** `row-menu.tsx` uses it. Rename from the menu keeps `takesFocus`. The menu row keeps its
   hover fill while open.
3. **Adopters.** Git changes, the session rail, search results.

## Parity

Parity spec "Menu": anchoring, one-row target (Q2), Escape restores focus, outside click,
scroll and row removal close it. The overlay that eats input goes; Base UI's modal handling covers
outside clicks. The harness test for "input under the menu is ignored" decides whether it needs a
replacement.

## Delete

The tree files listed above, the menu-anchor CSS in `style.css:1179-1249`, git's synthetic keydown,
the rail's per-row menu roots.

## Verification

Harness menu tests; `copy-feedback`, `file-tree-undo`, `search-file-actions` scenarios; git and rail
menu scenarios.
