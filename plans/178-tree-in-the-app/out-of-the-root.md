# Plan 178: out of the root

- Status: DONE 2026-09-26 (wave 2, lane T). Size M. After [parity-harness](parity-harness.md).
- Owns: deleting the custom element, the shadow root and the second React root. Nothing changes on
  screen.

## Outcome

The tree renders as a plain component in the app's React root. `style.css` and the app's
`treeUnsafeCss` still paint it, now as ordinary global CSS scoped to a wrapper. The harness shows
zero drift.

## Delete

- `utils/render/web-components.ts`: custom element, adopted sheet, declarative shadow DOM adoption.
- `state/renderer.ts`: the second `createRoot`.
- `utils/render/slotHost.ts`, `HEADER_SLOT_NAME`, `CONTEXT_MENU_SLOT_NAME`, the `<slot>`s in
  `FileTreeView.tsx:1316`, `menu-trigger.tsx:88`, `components/FileTree.tsx:35-40`.
- `cssWrappers.ts` and `FILE_TREE_UNSAFE_CSS_ATTRIBUTE`.
- `utils/scrollbarGutter.ts` (the gutter probe publishing a `:host` variable).
- The host half of `utils/render/FileTree.ts`: `#prepareHost`, `#getOrCreateWrapper`, sprite
  injection, `#syncUnsafeCSS`, density host styles, `pst_ft_N` ids, server-rendering guards.
- Shadow branches: `focusHelpers.ts:17-37`, `useFileTreeDrag.ts:112-144`, `dragPointer.ts:12-50`
  (the geometry hit-test fallback), `use-context-menu.ts:272,299-300`, `contextMenuAnchor.ts:10-31`.
- App side: the `eventOrigin` patch in `packages/ui/src/patterns/use-tooltip-layer.ts` (landed in
  `c71a7cdd2`), `row-menu.tsx`'s `data-file-tree-context-menu-root` and `MenuSurface`'s
  `popupProps`, the focus service's host walk (`lib/focus/state/service.ts:201-250`) and its shadow
  test.

## Keep for now

- `style.css`, with `:host` rules rewritten to a `[data-file-tree]` wrapper, loaded in its own
  cascade layer ordered before Tailwind's utilities. Its `@layer base` would otherwise merge into
  Tailwind's `base`.
- `treeUnsafeCss` and the `--trees-*-override` map, moved from the host to the wrapper.
- The tree's own sprite, now one `<svg>` in the document instead of one per host.
- The tree's keyboard, drag, virtualizer and menu trigger, minus their shadow branches.

## Rewrite

- Tests: `FileTree.browser.tsx` helpers (`waitForShadowRoot`, `rowButton`, `activePath`,
  `virtualRoot`, `virtualScroll`, `expectRenameToRemainActive`), `tree-pane.browser.tsx`
  (`fileTreeShadowRoot()` and eight helpers), `FileTree.test.tsx` host detection.
- Scripts: `scripts/agent/tree-occlusion.ts:5-14`, `scenarios/workbench-list-focus.ts:70-78`,
  `scenarios/large-folder.ts:157`, `apps/web/scripts/verify-web-design.mjs:514-524`,
  `apps/web/scripts/workspace-reload-proof.mjs:483`. Selectors in `scripts/agent/selectors.ts` keep
  working as long as the roles and `aria-label='Folder tree'` stay.

## Risks

- **Cascade.** Global CSS now reaches the rows, and the tree's sheet now reaches the app. Every tree
  selector is attribute-scoped, but check for bare element selectors. The harness style diff is the
  proof.
- **Scroll cost.** Rows now match against the app's 159 KB sheet (about 133 selectors whose rightmost
  compound tests every element, 42 `:has()` rules). Compare `trace tree-sticky-scroll` and
  `trace tree-large-scroll` against main.
  Decided 2026-09-27: owner — #130 holds until scroll is at parity.
- **Tooltips.** Tree tooltips become announced (`aria-describedby` now resolves).

## Verification

Harness: zero pixel and style drift across the matrix. Every tree scenario in the index passes.

## Landed

- The tree is a `<div data-file-tree>` in the caller's React root: `FileTree` renders `FileTreeView`
  keyed by model, the sprites, and the caller's `renderContextMenu` output. The model notifies the
  component through `subscribeView`/`getViewProps(version)` where it used to call a second root.
  Deleted: `web-components.ts`, `state/renderer.ts`, `slotHost.ts`, `cssWrappers.ts`,
  `scrollbarGutter.ts`, the tag, slot, style and unsafe-CSS constants, `render()`/`unmount()`, the
  `id`, `unsafeCSS` and header composition options, and the host-density bookkeeping.
- `style.css` sits in `@layer file-tree`, nested under `[data-file-tree]` (`:host` became `&`),
  ordered after Tailwind's layers. The app's overrides moved from `treeUnsafeCss` into
  `features/workspace/components/tree-pane.css` in `@layer file-tree-app`.
- What light DOM changed, and the tree's sheet now undoes (the harness found each): Tailwind's
  preflight on the filter and rename inputs (`box-sizing`, `margin`, `padding`, `border-*` and
  `line-height` go back to the browser's with `revert`; no other tree element drifts), the app's `* { scrollbar-width: thin }` (the scroller
  sets `auto`) and `* { scrollbar-color }` (the scroller inherits it, as it did through the root).
  The scrollbar lane is measured from the laid-out scroller once, replacing the probe element.
- Shadow branches gone from `focusHelpers`, `useFileTreeDrag` (the preview mounts inside the
  wrapper), `dragPointer` (no geometry fallback), `use-context-menu` and `contextMenuAnchor`.
  A caller's portalled menu is recognised by marking the events React routes through the tree
  (`markTreeOwnedEvent`), so the outside-click listener runs in the bubble phase. The row menu's
  `data-file-tree-context-menu-root`, `MenuSurface`'s `popupProps`, the tooltip layer's
  `eventOrigin` and the focus service's composed walk are deleted with their shadow tests.
- The active-guide `<style>` is scoped to the tree's own id.
- Sprites render inside each tree's wrapper; their ids are document-wide now and identical per
  tree, so a second tree resolves the same symbols.

### Verification

- `tree-parity`: zero pixel and style drift across all 60 captures; `tree-parity-behaviour`
  green; `packages/tree` 241 tests (the parity tests unchanged); app `tree-pane` browser and dom
  tests, `use-fs-actions`, focus service and tooltip-layer tests green.
- Guarding scenarios: `files-tree`, `search-file-actions`, `editor-external-edit`,
  `chat-composer-insert`, `file-tree-hover-prefetch`, `tree-sticky-scroll`, `tree-file-clicks`
  pass. `workbench-list-focus`, `file-picker-navigation`, `copy-feedback`, `file-tree-undo`,
  `workspace-open-unreadable-child`, `workspace-switch-click-during-open` and
  `workspace-open-large-root` fail on `origin/main` at the same step (git panel, file picker,
  session rail and toolbar waits), unrelated to the tree.
- **Scroll cost.** The first light-DOM build scrolled slower than main: style recalculation over
  the `tree-large-scroll` wheel steps was 478 ms against main's 151. Two causes, both fixed here:
  - Each wheel step turned `pointer-events: none` on for the whole list and off 50 ms later.
    The property inherits, and Blink's inherited fast path skips any element whose style reads a
    `var()`; the app's base rule (`* { @apply border-border outline-ring/50 }`) gives every element one, so
    all ~1,500 row elements took a full restyle twice per step (852 in the shadow root). Hover now
    waits on the root's `data-is-scrolling` flag instead (`:not([data-is-scrolling]) &:hover`),
    which restyles the rows alone; the JS hover paths already check the same scrolling state.
  - The preflight revert was a universal rule; it now targets inputs only (style 478 → 411 ms).
- Scroll numbers, renderer main thread between the wheel marks, against `origin/main` a762e9880 on
  the same machine, three alternating runs each (medians):

  | scenario                          | build                     | style ms | paint ms | render per step ms | elements restyled |
  | --------------------------------- | ------------------------- | -------- | -------- | ------------------ | ----------------- |
  | `tree-large-scroll` (50k entries) | main                      | 162      | 129      | 16.0               | 56.2k             |
  |                                   | before the fix            | 478      | 119      | 27.2               | 86.8k             |
  |                                   | this branch               | 137      | 73       | 11.0               | 19.8k             |
  | `tree-sticky-scroll`              | main                      | 64       | 149      | 35.7               |                   |
  |                                   | before the fix (two runs) | 165, 248 | 132, 165 | 59.0               |                   |
  |                                   | this branch               | 49       | 130      | 28.2               |                   |

  React work is unchanged: `renders tree-large-scroll` counts 3,325 `FileTreeRow` renders here and
  3,357 on main. What remains per element is the app sheet's universal selectors (the `**:`
  variants, `space-y-*`, the spinner and view-transition rules); a follow-up can take the `var()`
  off the base rule to restore the fast path app-wide.
