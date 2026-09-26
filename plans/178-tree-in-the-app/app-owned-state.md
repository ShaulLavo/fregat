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
2. **Name like the app.** Every file this pass moves or keeps is renamed to the app's convention in
   the same pass, with every import updated (AGENTS.md, Naming And Refactors):
   - kebab-case files: `FileTreeView.tsx` → `components/tree-view.tsx`, `FileTreeRow.tsx` →
     `components/tree-row.tsx`, `useFileTreeKeyboard.ts` → `hooks/use-tree-keyboard.ts`,
     `useFileTreeDrag.ts` → `hooks/use-tree-drag.ts`, `useFileTreeFocusSync.ts` →
     `hooks/use-tree-focus-sync.ts`, `rowClickPlan.ts` → `utils/row-click-plan.ts`, and so on
     through `utils/render/*`;
   - `tree` stays as a qualifier inside `features/workspace/` (it has other rows and views), but the
     `FileTree`/`file-tree` prefix goes from local symbols and files;
   - in `packages/tree`: `FileTreeController.ts` → `utils/model/controller.ts`, `publicTypes.ts` →
     `public-types.ts`, `internalTypes.ts`, `dragAndDrop.ts`, `inputResolution.ts`,
     `mutationEvents.ts`, `pathHelpers.ts`, `renameHelpers.ts`, `searchHelpers.ts`,
     `preparedInput.ts`, `getGitStatusSignature.ts`, `gitStatusPresentation.ts`,
     `renameFileTreePaths.ts` → kebab-case, `get`/`FileTree` prefixes dropped; the `./model`
     export in `package.json` follows;
   - exported symbols that cross a package boundary keep their domain name (`FileTreeController`,
     used by the app and the TUI); package-internal symbols drop the prefix;
   - a file a later sub-plan deletes is renamed only if it survives this one; nothing is renamed
     twice.
3. **Split the big files.** `FileTreeController.ts` is 2,115 lines and `FileTreeView.tsx` 1,479; both
   are split by concern as they move, as pure moves in their own commit before any behaviour change,
   so later sub-plans replace one concern at a time.
   - Controller: a thin coordinator over modules for the visible projection and sticky candidates
     (`getVisibleRows`, `getStickyRowCandidates`, `#rebuildVisibleProjection`, `#createVisibleRow*`),
     expansion, filter state (`setSearch` … `focusPreviousSearchMatch` and the dozen search
     privates, about 300 lines), rename (`startRenaming`, `getRenameView`, the rename privates), the
     drag session (`:835-983`), mutations (`add`, `remove`, `move`, `batch`, `resetPaths`,
     `#applyMutationState`), focus and scroll requests, and the known-path caches. Selection
     (`:692-831`) leaves in [keyboard-and-selection](keyboard-and-selection.md); item handles go in
     step 6.
   - View: layout state and scroll listeners, the sticky overlay, rename wiring and the row list
     become separate hooks and components, so [virtualization](virtualization.md),
     [rows](rows.md) and [chrome](chrome.md) each replace one file.
   - Target: no file over about 500 lines leaves this sub-plan. The model's unit tests and the TUI
     tree tests guard the controller split; the harness guards the view split.
4. **Props.** A `<FileTree>` component takes today's options as props: `flattenEmptyDirectories`,
   `stickyFolders`, filter settings, drag callbacks, `onSelectionChange`, rename callbacks. The
   frozen-options refs go.
5. **State into rows.** Rows read loading paths, git status and decorations from app state
   (query data and the workspace stores) through selectors. `refreshDecorations`,
   `setLoadingPaths`, `treeDecorationKey` and the decoration-as-data type go. The decoration becomes
   a component slot, and "Fix with AI" becomes an icon `Button` with `data-tooltip`.
6. **Imperative API.** Replace the facade with a feature store over the controller:
   - handles → selectors and actions (`expandPath`, `selectPaths`, `isExpanded`);
   - `startRenaming` → `editing = { path, kind: 'rename' | 'create' }`;
   - `openSearch` / `closeSearch` → a controlled query;
   - `getRowElements` → a ref per row registered with the intent-prefetch registry (measure the cost
     per row in `renders`).
7. **Controller feed.** Decide whether rows come straight from the app's `TreeModel`, removing
   `syncTreePaneState`, `changesAgainstLiveTree` and the 512-change reset. The flattened-chain
   expansion reconciliation (`tree-pane-state.ts:389`) must survive either way.
8. **Delete** the rest of `utils/render/FileTree.ts`, `components/FileTree.tsx`, `useFileTree`'s 1ms
   teardown timeout, and the portability options nobody passes: header composition, `unsafeCSS` as
   an option, `searchFakeFocus`, `initialVisibleRowCount`, density presets, icon sets.
9. **Package leftovers and ids.** What only a published package needed goes in the same pass:
   - `preparePresortedFileTreeInput` and the presorted input contract: no caller
     (`UPSTREAM.md`, "no dummy caller is maintained"). The prepared-input reuse stays.
   - `FLATTENED_PREFIX` (`'f::'`) and `getSelectionPath`: nothing produces an `f::` id any more;
     the strip in `renameFileTreePaths.ts:43` is dead.
   - `FileTreePublicId` (an alias of `string`): paths are the one identity; the drag model and
     events take the path type.
   - The public type surface in `index.ts` (about 35 types, many only for an outside consumer)
     shrinks to what the app and the TUI import; `tests/public-api.test.ts` shrinks with it.
   - `constants.ts` keeps only what the model reads; the tag name, style and slot constants go with
     [out-of-the-root](out-of-the-root.md), the attribute constants with [rows](rows.md).

## Parity

No visual change. Behaviour tests from the harness stay green. The TUI tree still builds and runs.

## Verification

- Harness: zero drift.
- `renders` on `tree-sticky-scroll` and `file-tree-hover-prefetch` against the baseline: moving
  state into rows must not re-render every row on a git patch or a loading change.
- TUI: `apps/tui` typecheck and its tree tests.
