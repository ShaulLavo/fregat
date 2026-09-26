# Plan 178: out of the root

- Status: PROPOSED. Size M. After [parity-harness](parity-harness.md).
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
  compound tests every element, 42 `:has()` rules). Compare `trace tree-sticky-scroll` against the
  baseline. A regression here is a [Plan 179](../179-isolating-foreign-content.md) finding about
  the global sheet, not a reason to restore the root.
- **Tooltips.** Tree tooltips become announced (`aria-describedby` now resolves).

## Verification

Harness: zero pixel and style drift across the matrix. Every tree scenario in the index passes.
