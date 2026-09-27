# Plan 178: context menu

- Status: DONE 2026-09-27. Git/search, the session rail and the tree share `useListContextMenu`. Size S–M. After [app-owned-state](app-owned-state.md).
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

## Landed: the tree, 2026-09-27

- `TreeHost` owns one `useListContextMenu` over the tree and renders the caller's menu with its
  handle (`anchor`, `onOpenChange`, `returnFocusTo`); `TreeRowMenu` is a plain `MenuSurface` on it.
  Rows and the tree's keyboard ask the host to open (`openTreeRowMenu`, which still keeps a sticky
  row in place and focuses the row first); the view only reports the open row for its hover fill.
- Deleted: `use-tree-context-menu.ts` (435 lines), `tree-menu-trigger.tsx`, `use-tree-menu-trigger.ts`,
  the trigger zustand store, `tree-menu-trigger-style.ts`, `tree-context-menu-wash.tsx`, the tree's
  document Escape and outside-mousedown listeners, `markTreeOwnedEvent`, the button trigger mode
  (`triggerMode`, `buttonVisibility`, the `…` button, its hover tracking and action lane, the
  ellipsis glyph), the package's `composition` option and `FileTreeContextMenuOpenContext`,
  `CONTEXT_MENU_TRIGGER_TYPE`, and the menu-anchor CSS. The app ran right-click mode, so none of
  it drew.
- `useListContextMenu` takes `focusTargetOf`, so a closing tree menu gives focus to its row, not
  the list wrapper. Rows are keyed by slot, so a removed row's element can stay mounted: the host
  watches the model while a menu is open and closes it when its row goes.
- Rename, New File and New Folder are `takesFocus` items, run after the menu closes; the
  `close({ restoreFocus: false })` handoff is gone.
- Decided behaviour (Work 1): wheel input over the tree closes the menu and the list stays put;
  removing the row closes it. The parity tests say so now. Base UI ignores an outside press for
  500ms after a controlled open (`MenuRoot`); the outside-click test waits it out, as every app
  menu already behaves.
- Verification: tree browser 82 (the parity harness now renders a real Base UI context menu),
  `tree-pane.browser` 5, `use-list-context-menu` 11, workspace node/dom, gates. The
  `copy-feedback`, `file-tree-undo` and `search-file-actions` scenarios and the `menu-open` pixel
  capture were not run: `agent:browser` cannot open a workspace in this container (see
  app-owned-state, step 8 notes).
