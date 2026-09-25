# Plan 159: The file and folder picker, rebuilt around columns and real previews

## Status and authorization

- Status: P1–P5 done 2026-09-25 (lane L1), with P5's filter chips deferred under D4; P6 next. D1–D4 accepted as recommended on 2026-09-25. The owner wants this ("100000%").
- Priority: P1 in the UI refresh lane. It runs after Plan 157 (done), whose
  segmented control, scroll fades and typeahead refine it uses.
- Effort: L. A second view with its own keyboard model, a content preview with two data paths, a
  thumbnail component, three chords and a status line. Later phases add icons, filters and the
  quick open preview.
- Risk: MED. The picker is how a project is opened on the web, so a regression blocks the first
  step. Every phase keeps the list view working and lands green on its own.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Research:
  [extend-ui.md](../docs/ui-research/extend-ui.md) ("File System deep dive" and "File-picker adopt
  list"), source in `references/extend-ui/apps/v4/components/extend/file-system.tsx` (5,381 lines)
  and `file-thumbnail.tsx`.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy` (web only).

## Outcome

Choosing a folder feels like Finder. A columns view keeps the whole path on screen: each folder
you select opens its children in the next column, and a preview sits at the end. Selecting a file
shows what is in it: an image renders, and code shows its first lines in our syntax colours. The
footer counts what is listed. ⌘[ and ⌘] go back and forward, ⌘↑ goes up and ⌘↓ opens. The list
view stays for sorting by size and date. Icons and filter chips follow later, and quick open can
share the same preview.

## Today

- **Who uses it.** `components/file-picker-dialog.tsx` (588 lines) is the web picker.
  `features/environments/components/project-picker.tsx` opens it in `mode='folder'` to choose a
  project. `components/use-pick-entry.tsx` wraps it for `components/app-workspace.tsx` (folder
  mode), and in the desktop shell (`getPlatformBridge()`) it uses the native dialog instead. The
  rebuild only changes the web dialog.
- **Layout.** A three-column grid, `170px | list | 240px`: `PlacesSidebar` (home, recents), the list
  (`features/file-picker/components/list.tsx`: `VirtualList` + `useListbox`, `FileRow` rows,
  sortable `ListHeader`), and `PreviewPane` (`components/preview.tsx`).
- **Preview.** It shows no content: an icon tile (`entry-preview-tile.tsx`, `size-24`), the name,
  a `KindBadge`, and Kind, Size, Modified and Created facts. Nothing is read from the file.
- **Data.** Directory listings are TanStack queries: `directoryQueryOptions`
  (`utils/directory-query.ts`), keyed by `filePickerKeys.directory(path, query, mode, showHidden)`
  in `lib/query-keys.ts`, `staleTime` 10 s, entries streamed into the cache as they arrive.
  `useDirectoryLoad` uses the unfiltered listing as placeholder data while a search runs.
  `useDirectoryTransition` owns `preloadDirectory` (a `prefetchQuery`) and `loadDirectory` (a
  `fetchQuery` behind an intent id, so a stale click cannot win).
- **Prefetch.** `FileRow` calls `onDirectoryIntent` from `useForesight` on hover intent, and the
  dialog preloads the selected folder in an effect (`file-picker-dialog.tsx:204-208`). This is why
  the next column can be instant.
- **Keyboard** (`utils/keyboard.ts`, `handleDialogKeyDownCapture`): ⌘⇧G edits the path, ⌘⇧. toggles
  hidden files, ⌘↑ goes up. In the list, → enters a folder and ← or Backspace goes to the parent.
  Enter commits through `useListbox`. Back and Forward are buttons with no chord; there is no ⌘↓.
- **Footer.** `SelectedSummary` (name of the pickable entry) plus Cancel and Choose. No count.
- **States.** The list branches loading, then error with Retry, then empty (`list.tsx`), which
  follows the pending-before-empty rule.
- **Quick open** (`features/command-palette/components/quick-open-groups.tsx`) has no preview.
  `content.tsx` already drives live previews for themes, palettes, bundles and wallpapers through
  `HighlightReporter`, and `code-theme-preview-panel.tsx` is the layout precedent for a side panel.
- **Verification.** No `agent:browser` scenario covers the picker, and
  `.agents/skills/verify-fregat/features/` has no picker page.

## Rules this plan holds to

- Every read is a TanStack query with a `queryKey` from `lib/query-keys.ts` (`filePickerKeys`) and a
  `staleTime`. No effect-driven fetches, no module-level caches, no local pending flags.
- Lists are `VirtualList` + `useListbox` + `ListRow`-shaped rows; the icons grid in Phase 5 extends
  `useListbox`, it does not bypass it.
- No flicker: a column or preview whose key changes keeps showing the previous content until the new
  data lands (`placeholderData: keepPreviousData`, as `features/command-palette/hooks/use-files.ts`
  does), and branches pending before empty.
- Truncation recovery: every truncated name carries the full path in `title` on the row, per
  `AGENTS.md`.
- Loaders are the shared ones (`LoadingState`, `Spinner`); Extend's pulsing "Loading…" label is not
  ported.
- No borders, token colours only, bar height from `--bar-height`. Extend's hex icon palette,
  `border-b` bars and `text-[10px]` are not ported.

## Phase 1 — Columns view

**Done 2026-09-25 (lane L1).** `columns-view.tsx`, `picker-column.tsx`, `column-row.tsx`,
`utils/columns.ts` (tested), setting `files.picker.view` (`auto | columns | list`; auto is D1).
The existing right-hand preview stays as the view's last pane in both views. The strip scrolls
sideways without a fade (`scroll-fade` is vertical only). A narrow dialog is measured with
`useElementWidth`, not a breakpoint. The text below is the original plan.

**Build** `features/file-picker/components/columns-view.tsx`:

- One column per folder on the path from the current folder down to the selection. Each column is a
  `VirtualList` with its own `useListbox` and the same `FileRow`, at a fixed width token
  (`--picker-column-width`, 240 px as in Extend).
- **Keyboard:** ↑↓ within a column, ← to the parent column, → into the selected folder's column.
  Only the focused column is a tab stop.
- **The trailing column mounts from a deferred selection.** Extend defers the next column and the
  preview with `useDeferredValue` (`file-system.tsx:4522-4525`), so holding an arrow key does not
  build a column per step. Do the same.
- **Data.** Each column reads `directoryQueryOptions` for its folder. The selected folder is already
  being prefetched (hover intent and the selection effect), so the next column usually renders from
  cache on first paint. A column still loading shows `LoadingState` skeleton rows in its own frame;
  the columns to its left never move.
- The **preview becomes the last column** when the selection is a file, reusing Phase 2's panel.
- Horizontal scroll keeps the deepest column in view, with Plan 157's `scroll-fade` on the column
  strip.
- The column strip scrolls sideways inside the dialog; below `lg` the dialog falls back to the list
  view (no room for columns).

**Switch views** with Plan 157's segmented control in the `PaneBar`: Columns and List (Icons joins
in Phase 5). The view is a registry setting, `files.picker.view`, registered in this phase with its
consumer (`packages/contracts/src/settings/keys.ts`, then `bun run settings:reference`).
`application` scope: it selects nothing that executes. The default is D1.

**Keep** the list view as it is, with its sortable headers. Search results render in the list view
whichever view is chosen: a flat result set has no column path.

## Phase 2 — Content preview

**Rebuild** `features/file-picker/components/preview.tsx` so it shows content, keeping the facts
(`dl`) beneath:

- **Images** (by extension, the `kindLabel` groups in `utils/model.ts`): an `<img>` on the existing
  `/fs/blob?path=` route, which chat markdown images already use
  (`features/chat/utils/markdown-images.ts:20`, server `apps/server/src/fs/routes.ts:45`), through
  `FileThumbnail` (Phase 3).
- **Text and code:** the first ~40 lines through `fetchFile(path, signal, client, { acceptTextOnly:
true })` (`lib/file-server.ts:226`), rendered with `HighlightedCode`
  (`packages/markdown/src/components/highlighted-code.tsx`), the renderer chat code blocks use, so
  the colours match the code theme setting. Binary or non-text files fall back to the facts.
- **Folders:** the first N children, read from the directory query cache that prefetch has filled.
  No extra request.
- **Settle before fetching.** The preview key is the selection after it settles (~120 ms), so
  arrowing through fifty files does not start fifty reads. Use `useDebouncedValue` from
  `@tanstack/react-pacer`, already a web dependency, not a hand-written timer. The read is a query,
  `filePickerKeys.preview(path)`, with `staleTime` and `keepPreviousData`, so the panel never blanks
  between two files.
- **Pending and error.** Pending shows the previous preview dimmed with a `Spinner` in the header
  slot; a failed read shows the facts plus an inline error. Never an empty panel while loading.

Quick open gets the same panel in Phase 6 if D2 says so.

## Phase 3 — FileThumbnail

**Port** Extend's `file-thumbnail.tsx` (183 lines) as `features/file-picker/components/file-thumbnail.tsx`,
restyled:

- The image fades in on its first load only. Extend keeps a module-level `Set` of revealed URLs so a
  remount does not replay the fade (`file-thumbnail.tsx:28`). We keep no module state: a remounted
  `<img>` for a cached URL is already `complete` with a `naturalWidth` when its ref attaches, so
  the fade is skipped from that check alone.
- A failed load swaps cleanly to the entry's icon tile (`EntryPreviewTile`), with no broken-image
  glyph and no retry loop.
- Motion from `--duration-enter` and `--ease-out-strong`, opacity only (Extend's blur is dropped: a
  filter on an image in a virtualized grid is a paint cost).
- It serves the preview now and the icons grid in Phase 5. Chat attachments and the wallpaper picker
  are later consumers; it moves to `lib/` or `packages/ui` only when a second feature imports it.

## Phase 4 — Chords and the status line

- **Chords** in `utils/keyboard.ts`, handled in `handleDialogKeyDownCapture`: ⌘[ back, ⌘] forward
  (today only buttons), ⌘↓ open, which enters a folder or commits a pickable file, as Finder does.
  ⌘↑ already exists. Each button gains `aria-keyshortcuts` and its chord in the `IconTooltip` label,
  the way Up already shows "(⌘↑)". Plain ←/→ in the list are unchanged.
- **Status line** in the `DialogFooter` beside `SelectedSummary`: "N items", or "N results" while
  searching, `tabular-nums`, in a `role="status"` region. Counts come from the entries the view
  shows, so hidden files and the accept filter are already applied.
- **Typeahead** refines in place once Plan 157 (done) item 5 lands; the picker's
  list already opts in (`typeahead: true` in `list.tsx`), and each column opts in the same way.

## Phase 5 — Icons grid and filter chips (later)

**Icons grid done 2026-09-25 (lane L1).** `useListbox` takes `columns` (grid moves in
`listbox-keys.ts`), and `icons-view.tsx` windows a `VirtualList` over rows of `FileTile`s from
`utils/tiles.ts`, so `VirtualList` itself did not change. **Filter chips not built:** D4's
recommendation is that they wait until large folders show they are wanted, and nothing has shown
it yet. The text below is the original plan.

- **Icons view** for image and asset folders:
  - `useListbox` gains a grid mode: a `columns` count, ↑↓ step by `columns`, ←→ by one, no
    wrapping. The index is computed from the column count, not from DOM rects as Extend does,
    because virtualized tiles have no rect.
  - `VirtualList` gains a row-of-tiles layout: window over rows, each rendering `columns` tiles
    measured from the container width.
  - Tiles are `FileThumbnail` for images and `EntryPreviewTile` otherwise, with truncated names
    carrying `title`.
- **Filter chips** under the `PaneBar`, if D4 says so: Kind (from the `kindLabel` groups) and
  Modified (today, 7 days, 30 days). Chips are `bg-muted` fills with an operator menu and a remove
  button, plus one Clear action. In `mode="file"` with `accept`, the accept filter shows as a locked
  chip instead of greying rows out silently. A filter that hides the selection clears it.

## Phase 6 — Quick open preview (if D2)

`features/command-palette/components/content.tsx` feeds `HighlightReporter`'s value for file rows
into a right-hand panel built from Phase 2's preview, laid out like `code-theme-preview-panel.tsx`.
Same query, same settle, same `keepPreviousData`. The palette's own no-flicker contract
(`scripts/agent/scenarios/quick-open-no-flicker.ts`) must stay green.

## Decisions

Decided 2026-09-25: the owner accepted every recommendation below ("whatever seems best"). The
alternatives stay only as a record of what was weighed.

- **D1 — which views.** Recommended: Columns and List now, Columns the default in `mode='folder'`
  (the main use is choosing a project folder, where the whole path matters) and List the default in
  `mode='file'`. Icons in Phase 5 for asset folders. No gallery: that is a document viewer, which
  belongs to [Plan 156](156-documents-in-the-editor.md).
- **D2 — real content previews, and quick open.** Recommended: yes to images and the first ~40
  lines of text, fetched only after the selection settles, and yes to quick open sharing the panel
  (Phase 6). Folders preview their first children from cache.
- **D3 — list view as a `@workspace/tree`.** Recommended: no. Keep a flat `VirtualList` per
  directory. The columns view already shows the path, and the tree's lazy-children path for remote
  folders is a large project for little gain here. Revisit if multi-select picking is ever needed.
- **D4 — filter chips.** Recommended: yes, but in Phase 5, and only Kind and Modified plus the
  locked accept chip. Search covers most needs, so this waits until large folders show it is
  wanted.

## Verification

- `node`/`dom` tests next to the existing ones in `features/file-picker/tests/` and `utils/tests/`:
  - column path derivation from current folder and selection, including a selection outside the
    current folder
  - the chords in `keyboard.test.ts` (⌘[, ⌘], ⌘↓, and that plain arrows are untouched)
  - the preview's kind routing (image, text, binary, folder) and that a failed image falls back
  - status counts with hidden files and `accept`
- A new scenario, `file-picker`, in `scripts/agent/scenarios/`, selectors in
  `scripts/agent/selectors.ts`, and a new `.agents/skills/verify-fregat/features/file-picker.md`
  page. It opens the project picker on a fixture tree with images, code and nested folders, then:
  - walks three folders deep in columns with the arrow keys and screenshots the path
  - holds ↓ through a long folder and asserts the trailing column and preview settle once
    (`caches` shows one preview query per settled file, not one per keystroke)
  - selects an image and a code file and screenshots both previews
  - uses ⌘[, ⌘] and ⌘↓, and switches to List and back
  - counts blank frames while moving between two files (`countBlankFrames`, as the no-flicker
    scenarios do): zero
- `look` on the dialog in both densities and both colour modes, screenshots read back.
- `renders` on the columns view while holding an arrow key: ancestor columns do not re-render.
- `bun run gates` and `bun run compiler:memos` on each new file.
- Deploy with `bun run deploy` and check `GET /platform/release`.
