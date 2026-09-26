# Plan 191: The file picker, resizable and in the app's icons

## Status and authorization

- Status: IMPLEMENTED 2026-09-26 on `w2/fp` (lane FP), all four phases; deploy pending (`bun run deploy --server`: new `/fs/places` and `/fs/head` routes). The owner took every recommendation in D1–D6; part of wave 2.
- Planned at: Platform `531d78a9e`, 2026-09-26. Follows Plan 159 (columns, previews, icons grid), done and deleted in
  `712270d64`; read it with `git show 712270d64^:plans/159-file-picker.md`.
- Origin: owner review of the Plan 159 picker, 2026-09-26. Every pane needs to resize, the blue file
  and yellow folder icons do not match the app, and the preview cuts its text and does not scroll.
- Size: M. Four phases, each ships on its own. Web only: `bun run deploy`.
- Risk: LOW–MED. The picker is how a project is opened on the web; every phase keeps all three views
  working.

## Outcome

The picker looks like part of the app. Every file and folder wears the icon the file tree, quick
open and the breadcrumbs give it. The places sidebar, the browsing area and the preview resize by
dragging, and every column in the columns view resizes on its own. The preview shows the whole
file up to a size limit and scrolls both ways; nothing is cut off at its edges.

## Today

- **Two icon systems.** `EntryIcon` (`features/file-picker/components/entry-icon.tsx`) switches on
  `iconMode`. `'default'` draws Phosphor duotone `FolderIcon`/`FileIcon` tinted `text-warning` and
  `text-info` (`default-entry-icon.tsx`): the yellow folder and blue file. `'vscode'` draws the app's
  pack through `iconForEntry` + `FileTypeIcon` (`lib/file-icons.ts:356`), which is what the tree,
  quick open, breadcrumbs, chat and git rows use.
- **Who gets which.** `file-picker-dialog.tsx:240` picks `iconMode ?? (mode === 'file' ? 'vscode' :
'default')`, and neither caller passes `iconMode`. So the project picker (folder mode, the main
  use) shows Phosphor icons for every row, tile, preview and the footer summary. `recent-shortcut.tsx:35`
  hard-codes `'default'` in both modes. The split dates from `62d3aad95` (2026-08-23) and no plan
  records a reason for it.
- **Sidebar.** `utils/sidebar-locations.ts` gives Root `HardDrivesIcon`, Home `HouseIcon`, and
  Desktop, Documents and Downloads Phosphor `FolderIcon`/`FolderOpenIcon`.
- **Icons grid tiles.** `EntryPreviewTile` paints a coloured square from `tileTone` (`utils/model.ts`)
  with a small icon and an extension badge (`TS`). The tree has nothing like it.
- **Fixed layout.** `file-picker-dialog.tsx:657` is a CSS grid, `lg:grid-cols-[170px_minmax(0,1fr)_240px]`.
  Columns are `w-(--picker-column-width)` (15rem, `globals.css:206`), set in `picker-column.tsx:116`.
  Nothing can be dragged.
- **Preview.** `PreviewPane` (`components/preview.tsx`) wraps the content in
  `max-h-72 … overflow-hidden`. `TextPreview` (`lib/file-preview/components/text-preview.tsx`) is
  `whitespace-pre overflow-hidden`, and `PREVIEW_LINES = 40` (`lib/file-preview/utils/preview.ts:5`).
  Long lines are clipped at the right (the 09-25 evidence shows `greet(name: st`) and the text stops
  at 18 rem height. Quick open shows the same `TextPreview` under its results (Plan 159 Phase 6).
- **The app's resizable panes.** `packages/ui/src/components/resizable.tsx` wraps
  `react-resizable-panels`. `PersistedResizablePanelGroup` saves the layout under
  `platform.resizable-layout.<storageKey>`; chat mode (`chat-mode`) and the terminal split
  (`workbench-terminals`) use it. Its panels are sized as percentages of the group, which suits
  three fixed panes. It does not suit columns that overflow a scrolling strip. No pixel-width handle
  exists in `packages/ui` or `apps/web`.
- **Possible bug.** In `07-icons-grid.png` (`/work/tmp/fregat-evidence/20260925T174325Z-scenario-file-picker-browse/`)
  the icons grid is showing while the List tab is the one pressed. Not reproduced yet.

## Related plans

- [Plan 178 icons](178-tree-in-the-app/icons.md) moves the tree onto `iconForEntry` with a
  document sprite and hue tokens, and [Plan 180](180-file-icon-variants.md) generates those tokens.
  This plan puts the picker on `iconForEntry` now; when 178 and 180 land, the picker gets their
  sprite and colours with no further change here.
- [Plan 178 rows](178-tree-in-the-app/rows.md) rebuilds tree rows on `ListRow` + `FileLabel`. The
  picker's rows are already `ListRow`; this plan matches the tree's row size and spacing through the
  shared tokens and does not wait for 178.

## Phase 1: One icon system

1. **Delete** `FilePickerIconMode`, the `iconMode` prop through every picker component,
   `DefaultEntryIcon`, and the `'default'` branch in `EntryIcon`. `EntryIcon` becomes
   `iconForEntry(entry, { open })` + `FileTypeIcon`, as in `features/workbench/components/breadcrumb-folder-rows.tsx:27`.
2. **Folders** use the app pack's folder glyph (`folder-duo`, `folder-open-duo` when open), per D1.
3. **Sidebar.** Desktop, Documents, Downloads and recents get the app folder glyph through the same
   path; Root and Home keep Phosphor `HardDrivesIcon` and `HouseIcon`, per D2.
4. **Icons grid.** Drop `tileTone` and the extension badge. A tile is the app glyph at a large size on
   `bg-muted`, or the image thumbnail. Selection uses the row tokens (`bg-row-selected`).
5. **Row metrics match the tree.** Measure the tree's row height, icon size, gap and text size on the
   dev server and use the same tokens in `file-row.tsx`, `column-row.tsx` and the folder preview. Name
   any value the tree takes from outside the tokens in the Decisions section; do not copy a raw pixel.
6. **Check** the view switcher's pressed state in the icons view; fix it if it reproduces.

## Phase 2: Resizable panes

1. **Three panes.** Replace the `lg:` grid with a `PersistedResizablePanelGroup`
   (`storageKey='file-picker'`, per D4): places sidebar, browsing area, preview, with a
   `ResizableHandle` between each. Minimums keep the sidebar's labels and the preview's facts
   readable; the browsing area takes what is left. Below `lg` the layout stays as today (sidebar and
   preview hidden), so there is nothing to resize.
2. **Columns.** Each column in the columns view has its own width, with a drag handle on its right
   edge. Dragging resizes that column only, as in Finder; double-clicking the handle fits the column
   to its widest name. New columns open at `--picker-column-width`. Widths live in the picker session
   keyed by column depth, per D3.
3. **The column handle is a shared primitive.** Add a pixel-width separator to
   `packages/ui/src/patterns/` that looks and moves like `ResizableHandle` (same hover and active
   tints, focus ring, `role="separator"` with `aria-valuenow`, ←/→ on the focused handle). It
   defines motion, reduced motion and pointer-sound policy like any new interactive primitive
   (AGENTS.md, Design Language). Add it to the `/dev` gallery.
4. **Settings.** The column default width, if D3 persists it, is a registry entry registered with its
   consumer; run `bun run settings:reference`.

## Phase 3: A preview that scrolls

1. **Layout.** The content region fills the pane's height and scrolls on its own. The name and facts
   sit in a compact block pinned under it, so a long file never pushes them out of view. Images fit
   the region (`object-contain`); folders list their children in the same scroller.
2. **Text.** `TextPreview` scrolls in both directions (`overflow-auto`, `whitespace-pre`); no line is
   clipped. It carries line numbers in a muted `font-mono tabular-nums` gutter so a scrolled view
   says where it is.
3. **How much text.** Read up to a byte budget in place of 40 lines, per D5, and say so at the end
   of the text when the file is longer ("First 64 KB of 1.2 MB"). The budget is a registry entry
   read by the preview query; the query key includes it.
4. **Quick open** shares `TextPreview`. Its panel under the results scrolls the same way; the
   `quick-open-no-flicker` scenario must stay at zero blank frames.

## Phase 4: Verification and ship

- Unit tests: column width state (drag, fit, a new column's default, widths after navigating up);
  `EntryIcon` resolves through `iconForEntry` for a folder, an open folder, a symlink and a `.md`
  file; the preview query key changes with the budget.
- Scenario `file-picker-browse` (`scripts/agent/scenarios/`) gains: drag each pane handle and a
  column handle, reopen the picker and read the sizes back; scroll the preview of a long file to its
  end and to its right edge; screenshot folder mode and file mode side by side with the file tree.
  Selectors in `scripts/agent/selectors.ts`; update `.agents/skills/verify-fregat/features/file-picker.md`.
- `look` in both colour modes and both densities, screenshots read back, published as an Artifact
  beside the tree for the owner.
- `bun run gates`; `bun run compiler:memos` on each new file; `design:census` must pass with no new
  allow-list entries.
- `bun run deploy`, then `GET /platform/release`.

## Decisions

Decided 2026-09-26: the owner took every recommendation. The alternatives stay as a record.

- **D1: folders.** The tree draws no folder glyph, only a chevron. The picker has no chevron column
  (columns carry a trailing caret, the list has none). Recommended: the app pack's folder glyph, as
  the breadcrumb folder menu does. Alternative: chevron-only leads like the tree, which leaves file
  and folder names misaligned in the columns view.
- **D2: places sidebar.** Recommended: folders (Desktop, Documents, Downloads, recents) take the app
  folder glyph; Root and Home keep their Phosphor icons, as app chrome does everywhere else.
  Alternative: all Phosphor, or all pack glyphs.
- **D3: column widths.** Recommended: each column resizes on its own for the session; new columns
  open at the default. Alternative: one shared width for every column (Finder's ⌥-drag), persisted
  as a setting. Both are small; the first is closer to Finder.
- **D4: where pane sizes persist.** Recommended: `PersistedResizablePanelGroup`, the mechanism chat
  mode and the terminal split already use. The owner dropped AGENTS.md's "no new `localStorage`
  keys" rule the same day; browser storage holds per-browser view state such as pane sizes.
- **D5: how much text the preview shows.** Recommended: 64 KB, no wrapping, scroll both ways, line
  numbers. Alternatives: a wrap toggle; or a read-only editor in the preview (more weight in the
  dialog for a view that lives a few seconds).
- **D6: out of scope unless asked.** Resizable list-view columns (Name, Modified, Size) and a
  resizable dialog. Recommended: neither now.
- **D7: row metrics (measured 2026-09-26, lane FP).** Rows already share `--density-row-height`
  with the tree (24/20 px). Names now use the tree's `--workbench-tree-font-family` and
  `--workbench-tree-font-size` (mono 12 px cozy, Inter 12.5 px compact). Two tree values come from
  the tree package, not app tokens, so the picker keeps the app's: the tree's icon is
  `--trees-icon-width` (16 px at both densities; the picker uses `--icon-size`, 16/14) and its
  icon–name gap is `--trees-item-row-gap` × density (4.8 px; the picker uses
  `--density-control-gap`, 6/4).
- **D8: places that exist (owner bug report, 2026-09-26).** Desktop, Documents and Downloads come
  from the browsed machine's `GET /fs/places`: only folders that exist, at their xdg-user-dirs paths
  on Linux (`$XDG_CONFIG_HOME/user-dirs.dirs`, a folder set to `$HOME` is off).
- **D9: columns stay columns while panes resize.** The list fallback for a narrow browsing area
  now triggers below 300 px, under the browsing pane's 320 px minimum, so dragging a pane never
  flips the view. The "List pressed while icons show" report was the tab indicator's 140 ms slide
  caught mid-flight by the scenario screenshot; the scenario now waits for it.
