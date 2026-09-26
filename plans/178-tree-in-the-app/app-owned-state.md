# Plan 178: app-owned state

- Status: PROPOSED. Size L. After [out-of-the-root](out-of-the-root.md).
- Owns: moving the view into the app and replacing the imperative facade with props and state.

## Outcome

The tree view lives in `apps/web/src/features/workspace/` and renders app components. It reads app
state the way every other pane does. `@workspace/tree` exports the DOM-free model only
(`FileTreeController`, the path store, git status, mutation events, drag model), which the TUI
keeps using through `@workspace/tree/model`.

## Why first

Every later sub-plan swaps a piece of the view for an app primitive. That is only possible once the
view is app code: a package cannot import `@workspace/ui` patterns wired to `@/lib/*`, and rows
cannot render app components while options are frozen at construction.

## Today

- `useFileTree(options)` freezes options at construction (`tree-pane.tsx:216-217`); every callback
  reads a ref re-copied each render (`:295-304`).
- App state reaches rows through imperative calls: `refreshDecorations()` keyed on
  `treeDecorationKey`, `setLoadingPaths`, `applyGitStatusPatch`, `setIcons`.
- Decorations are data (`treeRowDecoration` returns text, title, action), because rows cannot render
  JSX from the app.
- The app calls `getItem(p)` handles 16 times (`isDirectory`, `isExpanded`, `expand`, `select`,
  `deselect`), plus `getSelectedPaths`, `getFocusedPath`, `subscribe`, `onMutation('*')`, `add`,
  `batch`, `resetPaths`, `startRenaming`, `openSearch`, `closeSearch`, `scrollToPath`,
  `focusNearestPath`, `focus`, `getRowElements`, `subscribeRowElements`.
- `syncTreePaneState` and `changesAgainstLiveTree` diff the app's `TreeModel` into the controller,
  with a reset past 512 changes.

## Work

1. **Move.** `FileTreeView`, `FileTreeRow`, `RenameInput`, the view hooks and render utils move into
   `features/workspace/` by kind (`components/`, `hooks/`, `utils/`). `packages/tree` keeps
   `utils/model/*`, `utils/path-store/*` and the pure helpers.
2. **Props.** A `<FileTree>` component takes today's options as props: `flattenEmptyDirectories`,
   `stickyFolders`, filter settings, drag callbacks, `onSelectionChange`, rename callbacks. The
   frozen-options refs go.
3. **State into rows.** Rows read loading paths, git status and decorations from app state
   (query data and the workspace stores) through selectors. `refreshDecorations`,
   `setLoadingPaths`, `treeDecorationKey` and the decoration-as-data type go. The decoration becomes
   a component slot, and "Fix with AI" becomes an icon `Button` with `data-tooltip`.
4. **Imperative API.** Replace the facade with a feature store over the controller:
   - handles → selectors and actions (`expandPath`, `selectPaths`, `isExpanded`);
   - `startRenaming` → `editing = { path, kind: 'rename' | 'create' }`;
   - `openSearch` / `closeSearch` → a controlled query;
   - `getRowElements` → a ref per row registered with the intent-prefetch registry (measure the cost
     per row in `renders`).
5. **Controller feed.** Decide whether rows come straight from the app's `TreeModel`, removing
   `syncTreePaneState`, `changesAgainstLiveTree` and the 512-change reset. The flattened-chain
   expansion reconciliation (`tree-pane-state.ts:389`) must survive either way.
6. **Delete** the rest of `utils/render/FileTree.ts`, `components/FileTree.tsx`, `useFileTree`'s 1ms
   teardown timeout, and the portability options nobody passes: header composition, `unsafeCSS` as
   an option, `searchFakeFocus`, `initialVisibleRowCount`, density presets, icon sets.

## Parity

No visual change. Behaviour tests from the harness stay green. The TUI tree still builds and runs.

## Verification

- Harness: zero drift.
- `renders` on `tree-sticky-scroll` and `file-tree-hover-prefetch` against the baseline: moving
  state into rows must not re-render every row on a git patch or a loading change.
- TUI: `apps/tui` typecheck and its tree tests.
