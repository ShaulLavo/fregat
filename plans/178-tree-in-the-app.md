# Plan 178: The file tree in the app

## Status and authorization

- Status: PROPOSED. Requested 2026-09-26 (owner). Research is done (below); the decisions D1–D6
  need owner answers before Phase 1. Nothing here authorizes implementation.
- Planned at: Platform `d103638de`, 2026-09-26.
- Wait for the in-flight "Fix with AI on a folder that failed to load" work to land. It edits
  `FileTreeRow.tsx`, `style.css`, `publicTypes.ts`, `tree-decoration.ts`, `tree-pane.tsx`,
  `use-tooltip-layer.ts` and `scenarios/large-folder.ts`, and its tooltip patch exists only
  because of the shadow root.
- Companion: [Plan 179](179-isolating-foreign-content.md) looks at where a shadow root does help.

## Outcome

The file tree is an ordinary part of the app. It renders in the app's React root, is styled with
Tailwind, theme tokens and `@workspace/ui` primitives, is gated by the design census like every
other surface, and reads app state directly. `packages/tree` keeps the DOM-free model (controller
and path store) that the TUI also uses. The custom element, the shadow root, the second React root,
the `--trees-*` bridge, `unsafeCSS` and the tree's own stylesheet are gone.

## Owner direction

- 2026-09-26: the shadow root has no reason to exist for us. The tree is a core part of the app,
  and sharing styles and state with it takes constant work. Integrate it the way it should have
  been from the start.

## Why the boundary exists

`packages/tree` is Pierre's `packages/trees` plus `packages/path-store`, vendored in `ed75f3c55`
(2026-06-06) as a product-owned fork (`packages/tree/UPSTREAM.md`). Pierre ships it into pages it
knows nothing about, so it isolates itself. Since vendoring, 46 commits rewrote about 36% of its
lines. The docs give three reasons to keep it as is: its own keyboard model, a single roving row,
and its own windowing (`AGENTS.md:80`, `docs/pattern-layer.md:61`, `docs/web-design-language.md:43`).
None of them needs a shadow root. No document argues for style isolation.

## What the boundary costs today

### Inside the package (~5k of ~21k lines)

- **Host:** `utils/render/web-components.ts` (custom element, adopted sheet, declarative shadow DOM
  adoption), `state/renderer.ts` (a second `createRoot` per host), `utils/render/slotHost.ts`
  (header and context-menu slots), `cssWrappers.ts` (`@layer unsafe`), `scrollbarGutter.ts`
  (a probe inside the root publishing a `:host` variable), and the host half of
  `utils/render/FileTree.ts` (785): shadow attach, wrapper lookup, sprite injection, unsafe CSS,
  density host styles, `pst_ft_N` ids.
- **Shadow branches:** `focusHelpers.ts:17-37` (`ShadowRoot.activeElement`), `useFileTreeDrag.ts:112-144`
  (preview appended into the root, point root), `dragPointer.ts:12-50` (a manual rect hit-test
  because `elementFromPoint` stops at the host), `use-context-menu.ts:272,299-300`,
  `contextMenuAnchor.ts:10-31` (`composedPath` walk), `FileTreeView.tsx:172-180,1311-1316`
  (an injected guide `<style>` and a header `<slot>`), `menu-trigger.tsx:88`.
- **Stylesheet:** `styles/style.css` (1,484 lines). About 390 are theme plumbing: 95
  `--trees-*-override` variables falling back to a `--trees-theme-*` chain nothing sets, then to hex.
  About 234 are truncation grid CSS. About 150 are per-icon colour rules in raw hex.
- **Icons:** `builtInIcons.ts` (781, generated), `iconResolver`, `Icon.tsx`, `iconConfig`, `sprite.ts`.
  `<use href="#id">` only resolves inside the root, so sprites are injected per host.
- **Portability API:** header composition, `unsafeCSS`, `searchFakeFocus` ("for demos and marketing
  pages"), `initialVisibleRowCount`, density presets, icon sets, server-rendering guards. The app
  uses none of them except `unsafeCSS` and a hard-coded `density: 'compact'`.
- **Context-menu trigger:** `menu-trigger.tsx`, `use-menu-trigger.ts`, `state/menu-trigger.ts` (the
  package's only zustand store). The app runs right-click mode, so the "…" button never shows; the
  trigger is mounted only to host the slot.

### In the app

- **`tree-pane.tsx:572-605`** maps about 16 app tokens into `--trees-*-override` through an inline
  `style`, and relays the tree font because the root defines its own font variables.
- **`tree-pane.tsx:607-687`**, `treeUnsafeCss`, is a stylesheet string injected into the root. It
  covers square rows, the selected-row bar, focus-ring suppression, the search bar at
  `--bar-height`, an `Input` look-alike, indent-guide hairlines, and a hand-rolled loading shimmer
  with its own keyframes. It breaks the loader, hairline and radius rules, and the census cannot
  see it.
- **Options are fixed at construction** (`tree-pane.tsx:216-217`), so every callback reads a ref
  re-copied each render (`:295-304`). App state reaches rows only through imperative calls:
  `refreshDecorations()` keyed on `treeDecorationKey`, `setLoadingPaths`, `applyGitStatusPatch`.
  Decorations are data, not JSX, because rows cannot render app components.
- **Icons:** `lib/file-icons.ts:369-383,548-629` turns the app's glyphs into a sprite string and
  rebuilds a `byFileName` map over every path on every render. `components/file-type-icon.tsx` gets
  its colours from the tree's `getBuiltInFileIconColor`, whose `--trees-file-icon-color-*` variables
  exist only inside the root, so outside it the hex fallback always wins.
- **`packages/ui/src/styles/globals.css`:** `--workbench-tree-font-family/-size/-level-gap`
  (`:237-239`, `:416-418`) and about 48 `--trees-file-icon-color-*` hex values per mode
  (`:291-338`, `:443-490`).
- **`features/settings/utils/apply-appearance.ts:55,71-86`** writes three
  `--trees-indent-guide-*-opacity-override` properties on `<html>`.
- **Context menu:** `row-menu.tsx:36-38` stamps `data-file-tree-context-menu-root` on the popup so
  the tree's outside-click check leaves it alone. `MenuSurface`'s `popupProps`
  (`keymap/menus/components/surface.tsx:30,47-52`) exists only for this caller.
- **Focus and keys:** `lib/focus/state/service.ts:201-250` walks from host to host;
  `keymap/utils/keyboard-event.ts:10` checks `composedPath()` because `activeElement` is the host
  while the rename or filter input has focus. Both are generic and may stay.
- **Tooltips:** the uncommitted `eventOrigin` patch in `use-tooltip-layer.ts:61-75,128-131`. The
  layer's `aria-describedby` still cannot cross into the root, so tree tooltips are not announced.
- **`components/tree-loading.tsx`** hand-mirrors the tree's rows, because the real rows cannot
  mount as a skeleton.
- **Drag to chat:** the tree drags `text/plain` with the path (`useFileTreeDrag.ts:246`), and the
  composer parses that string (`features/chat/utils/composer-drop.ts:21-34`). Nothing typed crosses.
- **Rule violations nobody sees:** `web-design-census.mjs:11` excludes `packages/tree` and reads only
  TSX. The tree uses `MiddleTruncate` (`FileTreeRow.tsx:252`) against the no-middle-truncation rule,
  has no `title` recovery on any row, uses alpha for ignored rows and raw hex for icons, and
  hand-writes durations.
- **Plans held back:** Plan 102 wanted to share the tree's scrollbar recipe, which nobody can reuse
  from inside the root. Plan 128 left `sidebar-panel.tsx` off `Activity` because the tree's
  virtualizer measures itself inside the root.
- **Tests and scripts piercing the root:** `tree-pane.browser.tsx` (`fileTreeShadowRoot()` and
  eight helpers), `lib/focus/tests/service.test.tsx:229-238`, `scripts/agent/tree-occlusion.ts:5-14`,
  `scenarios/workbench-list-focus.ts:70-78`, `scenarios/large-folder.ts:157`,
  `apps/web/scripts/verify-web-design.mjs:514-524`, `apps/web/scripts/workspace-reload-proof.mjs:483`.
  Selectors in `scripts/agent/selectors.ts` go through Playwright's piercing and keep working as
  long as the ARIA roles and `aria-label='Folder tree'` stay.

## What stays

- **The model, in `packages/tree`:** `FileTreeController` (2,115, no DOM, no zustand; focus and
  scroll are request ids the view settles), path store (~4.5k), `gitStatus`, `mutationEvents`,
  `dragAndDrop`, `layout`, `preparedInput`, `renameFileTreePaths`, and their node tests. The TUI
  imports the controller from `@workspace/tree/model` (`apps/tui/src/tree/state/tree.ts:1`).
- **Behaviour the app has no equivalent for:**
  - Sticky ancestor rows: a translated sticky window, mirrored overlay rows, and focused or dragged
    rows parked off-screen. `VirtualList` has an `activeIndex` range extractor but no sticky
    ancestors.
  - The keyboard model: Shift+Arrow ranges, Mod+Space and Mod+A, F2 rename, type-to-search,
    Shift+F10, focus hand-off between sticky and in-flow rows, and real DOM focus for the rename
    input. `useListbox` returns `none` for any modifier (`listbox-keys.ts:22`), has one tab stop
    with `aria-activedescendant`, and no multi-select.
  - Native drag with touch long-press, edge auto-scroll and hover-to-expand.

## Decisions

- **D1. Where the view lives.** (a) Move the view into `apps/web/src/features/workspace/` (its only
  web consumer); `packages/tree` becomes the model. (b) Keep it in the package and add
  `packages/tree` to Tailwind's `@source` and the census roots. **Recommended: (a).** The view needs
  `@workspace/ui`, `@/lib/*` and app state, and a package cannot import the app.
- **D2. Keyboard.** (a) Keep the tree's roving model with the shadow branches removed. (b) Widen
  `useListbox` with multi-select and real focus. **Recommended: (a).** It matches the carve-out
  `AGENTS.md:80` already makes; only the word "shadow-root" goes.
- **D3. Windowing.** (a) Keep the tree's sticky window. (b) Teach `VirtualList` sticky ancestors
  first. **Recommended: (a) now, (b) when a second list needs sticky headers.**
- **D4. Names that do not fit.** Middle truncation is banned, and a flattened chain
  (`src / utils / deep`) cut from the right loses the leaf. (a) End truncation with a row `title`
  holding the full path, chain order unchanged. (b) Leaf first, the rest of the chain muted after
  it, as `features/git/components/file-row.tsx` does. **Recommended: (b)** for chains and (a) for
  single names. It changes how chains look, so it is the owner's call.
- **D5. Indent guides.** The no-hairlines rule bans edge borders. (a) A guide is structure, not a
  divider: draw it as a `w-px` element with a `bg-*` token and add a census allow entry with that
  reason. (b) Drop guides and separate levels by indent alone. **Recommended: (a)**, keeping the
  `workbench.tree.indentGuides` setting and the per-depth colours from the editor theme.
- **D6. File-icon colours.** The ~50 hex values per mode move out of the tree. (a) Thirteen hue
  tokens in `globals.css` (the tree's own grouping, `style.css:256-268`), with the icon table
  mapping to hues. (b) Keep per-icon hex in the app. **Recommended: (a).** It also fixes
  `FileTypeIcon`, which always paints the fallback today.

## Phases

Each phase ships on its own and leaves the tree working.

0. **Baseline.**
   - Run the tree scenarios below and keep the evidence directories.
   - `trace` and `renders` on `tree-sticky-scroll` and `workspace-open-large-root`. Rows will now
     match against the global sheet (159 KB, about 133 selectors that test every element, 42
     `:has()` rules), so scroll cost is the number to watch.
   - `look` at cozy and compact density, light and dark palettes, with git states, a flattened
     chain, a rename in progress, a context menu open, a loading folder and a failed folder.
1. **Out of the root.**
   - Render the view as a plain component inside `tree-pane.tsx`, in the app's React root. Delete
     `web-components.ts`, `state/renderer.ts`, `slotHost.ts`, `cssWrappers.ts`,
     `scrollbarGutter.ts`, the host half of `FileTree.ts`, the header slot, and every shadow branch
     listed above.
   - Keep `style.css` for now: scope `:host` rules to a `[data-file-tree]` wrapper and load it in
     its own cascade layer. Its `@layer base` would otherwise merge into Tailwind's `base`.
   - Icons render inline through the app's `FileTypeIcon`; sprite injection goes.
   - The context menu renders `MenuSurface` from row state. Delete the trigger, its zustand store,
     the `composedPath` check, and `data-file-tree-context-menu-root` with `popupProps`.
   - Rewrite every test and script that pierces the root to query the document.
   - The screenshots match Phase 0.
2. **App state in rows.**
   - Per D1, move the view into `features/workspace/` and trim `@workspace/tree` to the model.
   - Options become props. Delete the construction-time capture and its refs.
   - Rows render decorations as JSX and read loading paths from state. Delete
     `refreshDecorations`, `setLoadingPaths` and `treeDecorationKey`. The "Fix with AI" action
     becomes an icon `Button` with `data-tooltip`, and the tooltip layer's `eventOrigin` patch goes.
   - Give the tree-to-chat drag a typed payload next to the `text/plain` fallback.
3. **Onto the design system.**
   - Rows on `ListRow` (add roving `tabIndex` and the selected bar as a variant), `title` recovery
     per D4, icons at `size-(--icon-size-sm)`, git colours from status tokens, ignored rows in
     `text-muted-foreground`.
   - Filter box as `InputGroup` in a `PaneBar`; rename on `Input` with `focus-ring-within`; loading
     rows through `Shimmer`; indent guides per D5; icon hues per D6; the scrollbar recipe as a
     shared `@utility` (Plan 102).
   - `tree-loading.tsx` mounts the real rows as placeholders.
   - Delete `style.css` except the few sticky-window rules (which become classes), `treeStyle`,
     `treeUnsafeCss`, the `--workbench-tree-*` and `--trees-*` variables, and
     `applyFileTreeIndentGuideVisibility` with its test.
   - The tree enters `design:census` and `compiler:census` with no allow entries beyond D5's.
4. **Clean up.**
   - Remove unused public API: portability options, `density` presets, `searchFakeFocus`,
     `initialVisibleRowCount`, server-rendering guards, the zustand dependency, `MiddleTruncate`
     and its siblings.
   - Update `AGENTS.md:80`, `docs/pattern-layer.md:61`, `docs/web-design-language.md:43` and
     `UPSTREAM.md`. From here on Pierre's render code is no longer ported; the model and path store
     stay comparable.
   - Revisit Plan 128's `Activity` for `sidebar-panel.tsx` and `docs/pane-zoom-plan.md`'s shadow-root
     sizing contract.

## Verification

- **Scenarios**, run before and after every phase: `files-tree`, `workbench-list-focus`,
  `tree-file-clicks`, `tree-sticky-scroll`, `editor-product`, `file-tree-undo`,
  `file-tree-hover-prefetch`, `workspace-open-large-root`, `workspace-open-unreadable-child`,
  `workspace-switch-click-during-open`, `copy-feedback`, `search-file-actions`,
  `editor-external-edit`, `file-picker-navigation`, `chat-composer-insert`. The feature map is
  `.agents/skills/verify-fregat/features/file-tree.md`.
- **Tests:** the node model tests unchanged; `FileTree.browser.tsx` (virtual-window restore, sticky
  rows, keyboard, rename with IME, reveal and focus settlement) with document queries;
  `tree-pane.browser.tsx`. Delete `FileTree.test.tsx`, `public-api.test.ts` and
  `overflowTextSplit.test.ts`, which pin the wrapper.
- **Performance:** `trace tree-sticky-scroll --compare` and `renders` against Phase 0 after Phases 1
  and 3. If the global sheet costs scroll time, that is a finding for Plan 179, not a reason to
  bring the root back.
- **Looks:** `look` after Phases 1 and 3 on the Phase 0 matrix.

## What this plan does not do

- No change to the controller's behaviour or the path store.
- No rewrite of keyboard, drag or windowing onto `useListbox`, dnd-kit or `VirtualList` (D2, D3).
- No new tree features.
