# Extend UI — survey for Platform

Source: <https://ui.extend.ai/ui/docs> (also served at `www.extend.ai/ui`). Read from the source
clone at `references/extend-ui` (commit `a0ddcec`, 2026-09-14). All file paths below that start with
`components/extend/` are relative to `references/extend-ui/apps/v4/`.

## 1. What it is

- A shadcn **registry** of document-processing components: viewers and editors for PDF, DOCX, XLSX,
  PPTX and CSV, plus a Finder-style file browser, upload, thumbnails, extraction-review and schema
  editing. The components are copied into the consuming app as source (`npx shadcn add @extend/<name>`).
  They are not an npm package.
- **License: MIT.** Copyright CrowdView Inc (dba Extend), with portions from shadcn. The renderer
  packages it depends on (`@extend-ai/react-docx`, `react-xlsx` and `react-pptx`) are MIT too.
  EmbedPDF is MIT. `@pierre/trees` and `@pierre/diffs` are Apache-2.0.
- **Stack:** Next 16 with a fumadocs site, React 19.2, Tailwind v4 and `@base-ui/react` 1.4. The
  registry builds each item for either Base UI or Radix, depending on the consumer's `style`. Icons
  go through an `IconPlaceholder` element that names one icon per library, and `phosphor` is one of
  the supported libraries. The primitive layer is the same one we use. The styling layer is not
  (see §5).
- **Machine-readable entry points:** `https://ui.extend.ai/ui/llms.txt`, `/r/registry.json`, and a
  `.md` version of every docs page.
- **Size:** 17 components and 9 blocks. The code is about 48k lines in `components/extend/`, and
  8k of those are sample OCR data in `layout-blocks.tsx`. `file-system.tsx` alone is 5,381 lines.

Heavy runtime dependencies, by component:

| Dependency                                             | Used by                                  | Unpacked size      |
| ------------------------------------------------------ | ---------------------------------------- | ------------------ |
| `@embedpdf/*` (PDFium wasm, ~25 plugins)               | pdf-viewer, pdf-editor, and their blocks | ~5 MB core+engines |
| `@extend-ai/react-docx` 0.9                            | docx-viewer/editor                       | 12.8 MB            |
| `@extend-ai/react-xlsx` 0.16                           | xlsx-viewer/editor                       | 19.4 MB            |
| `@extend-ai/react-pptx` 0.2                            | pptx-viewer                              | 10.1 MB            |
| `@glideapps/glide-data-grid` 6.0.4-alpha (canvas grid) | csv-viewer, bounding-box-citations       | 3.7 MB             |
| `@pierre/trees` 1.0.0-beta.4                           | file-system (list view)                  | 1.5 MB             |
| `@pierre/diffs`                                        | bounding-box-citations, schema-builder   | 7.4 MB             |
| `@dnd-kit/*`                                           | schema-builder, document-splits          | small              |
| `border-beam`, `signature_pad`, `papaparse`            | upload, e-signature, csv                 | small              |

**`@workspace/tree` descends from the same code.** Commit `ed75f3c5` ("replace pierre submodule with
in-repo tree package") turned `@pierre/trees` into `packages/tree`. Extend's list view is therefore
built on our own tree's ancestor, so its integration code (decoration lane, sprite icons, search
session, `resetPaths` that keeps disclosure state) maps almost one-to-one onto
`FileTreeController`.

## 2. Component catalog

Verdicts: **copy** = lift the code and restyle it, **port** = rebuild the idea on our primitives,
**defer** = useful once the roadmap gets there, **skip**.

| Component                                                                                                                           | What it does                                                                                                                                                                   | Platform feature it serves                                                                                                                                                                                                                                                       | Verdict                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [File System (Finder)](https://ui.extend.ai/ui/docs/components/file-system)                                                         | Flat manifest → icons / list / columns / gallery browser, filters, sort, search, preview pool                                                                                  | File picker (`components/file-picker-dialog.tsx`), project picker, a future "browse attachments" view                                                                                                                                                                            | **port** (see §3)                                                                                                                                         |
| [File Thumbnail](https://ui.extend.ai/ui/docs/components/file-thumbnail)                                                            | Image preview tile with a fade-in that does not replay, a failed-URL fallback and a loading state                                                                              | Picker preview pane, chat attachment thumbnails (`features/chat/components/chat-attachment-thumbnails.tsx`), wallpaper picker                                                                                                                                                    | **copy** (183 lines; restyle)                                                                                                                             |
| [File Upload](https://ui.extend.ai/ui/docs/components/file-upload)                                                                  | Dropzone with a drag-depth counter, `accept` matching and a rejection message                                                                                                  | Chat input drop (`chat-input.tsx` already has `onDrop`), wallpaper upload, dropping OS files into the tree                                                                                                                                                                       | **port** the drag-depth and accept logic; skip `border-beam`. The docs promise progress, retry and queueing, but the source has none.                     |
| [Document Viewer Sidebar](https://ui.extend.ai/ui/docs/components/document-viewer-sidebar)                                          | Thumbnail rail: inline at ≥768 px, an overlay below that. `useElementWidth` ignores zero-width measurements.                                                                   | Any document viewer. The zero-width rule matters to **`lib/keep-alive`**: a parked `KeepAliveSlot` measures 0 and should not relayout                                                                                                                                            | **port** the measurement rule now; the rail later                                                                                                         |
| [PDF Viewer](https://ui.extend.ai/ui/docs/components/pdf-viewer)                                                                    | EmbedPDF viewer: zoom modes, search, selection, thumbnails, overlays, rotate, download                                                                                         | Opening `.pdf` as an editor-tab document; chat file attachments (`chat-file-preview.tsx` previews text only today); picker preview                                                                                                                                               | **defer**. It is the one viewer worth its weight when documents land.                                                                                     |
| [PDF Editor](https://ui.extend.ai/ui/docs/components/pdf-editor)                                                                    | Annotations, redaction, forms, signatures, page organizer                                                                                                                      | None on the roadmap                                                                                                                                                                                                                                                              | skip                                                                                                                                                      |
| [DOCX Viewer](https://ui.extend.ai/ui/docs/components/docx-viewer) / [Editor](https://ui.extend.ai/ui/docs/components/docx-editor)  | Word rendering and editing                                                                                                                                                     | Attachment preview only                                                                                                                                                                                                                                                          | skip (12.8 MB dependency)                                                                                                                                 |
| [Excel Viewer](https://ui.extend.ai/ui/docs/components/xlsx-viewer) / [Editor](https://ui.extend.ai/ui/docs/components/xlsx-editor) | Workbook grid: sheets, frozen panes, formulas                                                                                                                                  | Attachment preview only                                                                                                                                                                                                                                                          | skip (19.4 MB)                                                                                                                                            |
| [PowerPoint Viewer](https://ui.extend.ai/ui/docs/components/pptx-viewer)                                                            | Virtualized slide rail and zoom                                                                                                                                                | None                                                                                                                                                                                                                                                                             | skip                                                                                                                                                      |
| [CSV Viewer](https://ui.extend.ai/ui/docs/components/csv-tsv-viewer)                                                                | PapaParse and a Glide canvas grid: zoom, debounced search with result navigation, A1 addresses                                                                                 | A grid view for `.csv`/`.tsv` editor tabs                                                                                                                                                                                                                                        | **defer**. The idea is a "view as table" toggle on a text document. Glide is canvas, so none of `ListRow`, the tokens or truncation recovery would apply. |
| [Bounding Box Citations](https://ui.extend.ai/ui/docs/components/bounding-box-citations)                                            | `HumanReviewPanel`: one field per schema property, actual vs expected, per-field undo and "Set to NULL", a JSON diff tab, and `onFieldFocus` that highlights the source region | **Plan 139** (per-hunk keep/undo, review mode) and **Plan 140** (diagnostics back to the agent). The shape carries over: each reviewed item links to a source location, and focusing it highlights that location. In our case the location is a `file:line` range in the editor. | **port** the interaction model                                                                                                                            |
| [Schema Builder](https://ui.extend.ai/ui/docs/components/schema-builder)                                                            | JSON Schema table editor with nested object and array rows, enum tables, drag reorder, and a synced JSON tab                                                                   | **Plan 145** custom agents, hooks and MCP config; structured output for **Plan 144**. Its synced Form/JSON tabs are the same pattern as our settings raw-JSON view.                                                                                                              | **port** the synced tabs; skip dnd-kit                                                                                                                    |
| [Layout Blocks](https://ui.extend.ai/ui/docs/components/layout-blocks)                                                              | OCR blocks, lines and words drawn over PDF pages, confidence colours, list↔overlay hover sync                                                                                  | None directly. The list↔overlay hover sync is the same idea as the citation panel.                                                                                                                                                                                               | skip                                                                                                                                                      |
| [E-Signature](https://ui.extend.ai/ui/docs/components/e-signature)                                                                  | Signature fields on a PDF                                                                                                                                                      | None                                                                                                                                                                                                                                                                             | skip                                                                                                                                                      |
| [Document Splits](https://ui.extend.ai/ui/docs/components/document-splits)                                                          | Drag pages into split groups with range labels                                                                                                                                 | Possible later: drag hunks or files into commit groups (the git panel, Plan 139). Speculative.                                                                                                                                                                                   | skip for now                                                                                                                                              |

Blocks (composed demos): `file-system-block`, `pdf-dropzone`, `bounding-box-citations-block`,
`layout-blocks-block`, `e-signature`, `document-splits-block`, `excel-editor`, `pdf-editor-block`,
`docx-editor-block`. The one shared piece is `pdf-block-resizable-shell.tsx`: `react-resizable-panels`
with a layout saved to localStorage, switching from horizontal to vertical below 900 px. We already
have `resizable.tsx`, and our settings rule forbids new localStorage keys.

Base primitives in the registry (accordion, autocomplete, badge, breadcrumb, button, card,
color-picker, command, dialog, dropdown-menu, group, input, kbd, popover, scroll-area, select, sheet,
sidebar, skeleton, sonner, spinner, switch, tabs, toast, toggle, tooltip, resizable) are shadcn v4
Base UI defaults. `packages/ui` already covers them or deliberately differs, so **skip**. We have no
`Kbd`, `Tabs`, `Toggle`, `Autocomplete` or `ColorPicker` primitive. If one is needed, take it from
shadcn's Base UI style directly, not from here.

## 3. File System deep dive

### Data model (`components/extend/file-system.tsx:188-300, 858-957`)

- The input is a **flat manifest** (`FileSystemItem[]`, S3 `ListObjectsV2` shaped). Folders are
  optional; `buildFileSystemIndex` infers missing prefixes and builds three maps:
  `children: Map<parent, Entry[]>`, `files`, `folders`. Children are pre-sorted by name, so the
  default sort reuses those arrays.
- A folder without a date inherits its newest descendant's `updatedAt`. Folders are walked deepest
  first so the dates propagate upward.
- Lazy loading: a folder with `hasChildren: true` and no loaded entries calls `loadChildren({path,
cursor})` the first time it is opened or selected, and keeps following `nextCursor`. Selecting a
  folder in the columns view prefetches it.
- URLs are external. `getFileUrl` presigns, and the results are cached per path for the
  component's lifetime. Page thumbnails are cached as `"path#pageIndex"`. Both caches are
  lazy-`useState` Maps.

### Views

| View    | Layout                                                                                                                                                                                                                     | Keyboard                                                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Icons   | `repeat(auto-fill, minmax(6.5rem,1fr))` grid of fixed 102 px tiles. The column count is measured with a ResizeObserver so the rows can be windowed. Selection draws an `bg-accent` glyph box and a `bg-primary` name pill. | 4-way arrows. Up/down pick the nearest tile in the next row by rect (`rowDelta*1000 +                                                                                                                                                                             | dx  | `). Enter opens. |
| List    | `@pierre/trees` with 28 px rows. Date Modified and Size render in the tree's decoration lane: one `<span title>`, split into two aligned columns by CSS `::before`. Sortable column headers sit above it.                  | The tree's keyboard model. Focus is mirrored into single selection so arrows select, as in Finder. Enter or double-click on a folder navigates into it; a single click toggles disclosure.                                                                        |
| Columns | Miller columns, 240 px each, with a preview-and-metadata column at the end. Each column is `React.memo` with scalar props, so selecting deep in the trail does not re-render ancestor columns.                             | Up/down within a column, left to the parent, right into the selected folder. Mounting the trailing column is **deferred**, so holding an arrow key stays cheap. Selection happens on `pointerdown` for mouse, and on click for touch so a scroll does not select. |
| Gallery | A large stage, an info sidebar and a 56 px virtualized filmstrip                                                                                                                                                           | Left/right move through the strip. While the user scrubs, the stage shows a spinner, and the viewer mounts only after `useSettledValue` settles.                                                                                                                  |

Shared across all views:

- **One tab stop per view** (roving tabindex), so Shift+Tab goes back to the view switcher.
- **Type-ahead** (`useEntryTypeAhead`) runs over each view's display-ordered list. The buffer
  resets after 700 ms. Repeating a single letter cycles through the matches; a longer buffer
  refines **in place** and does not step past the current row.
- Finder chords: ⌘↑ goes to the enclosing folder, ⌘↓ opens, ⌘[ and ⌘] move back and forward in
  history, ⌘F focuses search. Navigating clears the search and the selection.
- When navigation unmounts the focused row, focus is put back on the root. Without that, focus
  falls to `<body>` and the chords stop working.
- A **status bar** (`aria-live="polite"`) shows "N items" or "N results" and "“name” selected".
- Search matches a substring of the path relative to the current folder, with hide-non-matches
  semantics: ancestors of a hit stay visible. In the list view the query drives the tree's own
  search session, which highlights matches without remounting.
- **Filters** are pills under the toolbar: file type (`is` / `is any of` / `is not`, MIME grouped
  into Documents/Images/…), and Date created or modified with presets or a custom-range calendar
  dialog. Each pill has an operator dropdown and a remove button, and there is one Clear action.
  When a filter hides the selected entry, the selection is cleared.
- **Responsive toolbar** from a ResizeObserver on the component root, not the viewport. Below
  560 px the search collapses into a popover. Below 360 px the folder title is dropped. Below
  768 px the view tabs become an icon Select.
- A **keep-alive preview pool** (`file-system.tsx:1886-2060`). Up to 4 recently shown viewers stay
  mounted, and the 3 most recent stay attached to the DOM. Each viewer renders through a portal into
  a stable detached `<div>` that a layout effect moves between hosts (gallery stage or dialog).
  Opening a file the gallery already loaded therefore hands the live viewer to the dialog with no
  reload. Detached pool members cost no layout. This is the same problem `lib/keep-alive` solves for
  terminals.
- Empty, loading and filter-empty states are three distinct messages. The loader is a
  pulsing text label, which our loading-state rules ban.

### Visual details

- Folder glyph: one inline SVG with two gradients. The same string is drawn as a React element and
  as a CSS `url()` inside the tree's shadow DOM, so both are pixel-identical.
- File icons: the `@pierre/trees` built-in "complete" sprite, with per-type colours as `light-dark`
  hex pairs. The palette flips for selected rows (they sit on `bg-primary`) and for paper-white
  thumbnail tiles in dark mode.
- Thumbnails fade in with blur over 160 ms, ease `cubic-bezier(.22,1,.36,1)`. A module-level
  `revealedPreviewImageUrls` Set keeps a remount from replaying the fade. Multi-page thumbnails
  show a hover pager (‹ 1/12 ›).
- Density: 28 px list and column rows, 102 px icon tiles, a 48 px toolbar, a 28 px status bar.

### How ours compares

Our picker is `components/file-picker-dialog.tsx` plus `features/file-picker/*`. It is already
ahead of Extend in several places:

- Back, forward and up; an editable location bar (⌘⇧G); a places sidebar with recents.
- Sortable columns; a hidden-files toggle stored as a setting (⌘⇧.); a new-folder popover.
- Directory prefetch on hover intent (`useForesight` in `file-row.tsx`) and on selection
  (`preloadDirectory`).
- Errors with a retry, and pending shown before empty.
- `useListbox` with `aria-activedescendant`. Rows never hold focus, so Extend's focus-reclaim hack
  is unnecessary for us.

The tree (`packages/tree`) already does search sessions, multi-select, drag and drop, rename, git
status and undo.

What we lack: any view but the list; real content previews (`preview.tsx` shows an icon tile and
facts); thumbnails; filters; a status count; ⌘[ ⌘] ⌘↓; grid keyboard navigation in `useListbox`.
Quick open (`features/command-palette/components/quick-open-groups.tsx`) has no preview, although
the palette's `HighlightReporter` already drives live previews for themes, wallpapers and bundles.

### File-picker adopt list (in priority order)

1. **Columns view.** Add `features/file-picker/components/columns-view.tsx`, with a view switcher in
   the `PaneBar` of `components/file-picker-dialog.tsx`.
   - It suits "Choose folder", the main use (`features/environments/components/project-picker.tsx`),
     because the whole path stays visible.
   - Each column is a `VirtualList` with `useListbox`. Left and right move between columns.
   - Mount the trailing column from `useDeferredValue(selectedPath)`, so a held arrow key does not
     build DOM on every step.
   - `preloadDirectory` and the foresight prefetch already make the next column instant.
   - The existing `PreviewPane` becomes the last column.
   - Persist the chosen view as a registry setting (`files.picker.view`) in the same pass that wires
     it.
2. **Content preview in `preview.tsx`.**
   - Images: `<img src=/fs/blob?path=…>` through a ported `FileThumbnail`. The route already exists
     for chat markdown images (`features/chat/utils/markdown-images.ts`).
   - Text and code: the first ~40 lines from `/fs/read?acceptTextOnly`, painted with the existing
     editor snippet tokens (the hover code-fence painter).
   - Folders: the first N children from the directory query cache that `preloadDirectory` has
     already filled.
   - Settle before fetching, as Extend's `useSettledValue` does, but as a TanStack query keyed on the
     settled path, not an effect.
3. **Status line** in the `DialogFooter` beside `SelectedSummary`: "N items" or "N results" as
   `tabular-nums` in a `role="status"` region.
4. **Chords** in `features/file-picker/utils/keyboard.ts`: ⌘[ and ⌘] for back and forward (already
   buttons), and ⌘↓ to open or commit the selection, which is Finder's own chord. Add the matching
   `aria-keyshortcuts` and Tooltip text.
5. **Type-ahead refine-in-place**, in `packages/ui/src/patterns/listbox-keys.ts`.
   - Today `typeaheadListboxIndex` always starts searching at `activeIndex + 1`. A multi-character
     buffer can therefore jump past a row that already matches.
   - Extend searches from the current row when the buffer is longer than one character, and from
     the next row only when a single letter repeats.
   - This is a one-line change with one test, and it applies to every listbox.
6. **Filter chips** under the `PaneBar`. Kind comes from the extension groups `kindLabel` already
   derives; Modified has presets (today, 7 days, 30 days).
   - Chips are `bg-muted` fills with an operator menu and an ×, and there is one Clear action.
     No borders.
   - In `mode="file"` with `accept`, show the accept filter as a locked chip instead of greying out
     rows silently.
   - Worth doing only if large folders turn out to be common in practice. Search already covers
     most of it.
7. **Icons (grid) view**, lower priority for a code workbench but good for image, wallpaper and
   asset folders.
   - It needs a grid mode in `useListbox`: a `columns` count, up and down step by `columns`, no
     wrapping.
   - Compute the index from the column count, not from DOM rects as Extend does, because rects do
     not exist for virtualized rows.
   - `VirtualList` needs a row-of-tiles layout: window over rows, each rendering `columns` tiles.
     Extend's own `useVirtualWindow` does exactly this with a fixed stride.
8. **Quick open preview**, in `features/command-palette/components/content.tsx`.
   - Feed `HighlightReporter`'s value for file rows into a right-hand preview panel (the same
     snippet renderer as item 2), settled at about 120 ms. The theme preview panel is the existing
     layout precedent.
9. **List view as a tree**, optional and large. `@workspace/tree` could render the picker's list
   with inline disclosure.
   - Extend's `FileSystemPierreTree` (`file-system.tsx:3988-4500`) is the reference integration:
     columns via `renderRowDecoration`, thumbnails injected as sprite symbols, `resetPaths` that
     keeps disclosure across sort and filter changes, and disclosure remembered per folder across
     view switches.
   - The picker lists remote folders lazily, so this needs the tree's lazy-children path.

Not adopting:

- Extend's hex icon palette. Colours go through tokens.
- The pulsing "Loading…" label, a banned loader.
- `border-b`/`border-t` bars, `rounded-xl` and `text-[10px]`.
- The flat-manifest model. Our server answers per directory, and `/fs/tree` is not an object store.
- Cursor pagination. `VirtualList` handles big folders; revisit if `/fs/tree` on huge directories
  shows up in a trace.

## 4. Ranked steal list

| #   | What                                                                                                                    | Where it lands                                                                                                | Mode                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Columns view + deferred trailing column + preview column                                                                | `features/file-picker`                                                                                        | port                                                           |
| 2   | Settled-selection content preview (image via `/fs/blob`, code via snippet tokens)                                       | picker `preview.tsx`, then quick open                                                                         | port                                                           |
| 3   | `FileThumbnail`: fade that does not replay, failed-URL fallback, `loading=lazy decoding=async`, `contain: layout paint` | new `packages/ui/src/patterns/thumbnail.tsx`; consumers are picker, chat attachments and the wallpaper picker | copy + restyle                                                 |
| 4   | Type-ahead refine-in-place                                                                                              | `packages/ui/src/patterns/listbox-keys.ts`                                                                    | port (one line)                                                |
| 5   | Zero-width measurement guard for parked content                                                                         | whatever measures inside `lib/keep-alive` slots (terminal fit, VirtualList)                                   | port the rule; check first whether any consumer relayouts at 0 |
| 6   | Keep-alive preview pool: portal into a stable detached div, reparented by a layout effect, LRU of 4 with 3 attached     | reference design for when heavy viewers (PDF) arrive; compare with `lib/keep-alive` before building anything  | idea                                                           |
| 7   | Review panel shape: item → source location focus, per-item undo, form/diff tabs over one state                          | Plan 139 review mode, Plan 140                                                                                | port idea                                                      |
| 8   | Synced Form/JSON tabs over one schema state                                                                             | Plan 145 custom agents/hooks editors                                                                          | port idea                                                      |
| 9   | Dropzone drag-depth counter + accept matcher + inline rejection                                                         | chat input, wallpaper picker, tree drop from OS                                                               | port (≈40 lines)                                               |
| 10  | Status line, ⌘[ ⌘] ⌘↓ chords, filter chips                                                                              | picker                                                                                                        | port                                                           |
| 11  | PDF viewer (EmbedPDF)                                                                                                   | future document tabs and attachments                                                                          | defer                                                          |

## 5. Cost and risk

- **Styling drift is the main cost of copying.** Every Extend file uses what our design census
  bans:
  - edge borders (`border-b`, `border-t`, `border-r`), `rounded-xl`/`rounded-sm`, `text-[10px]`;
  - alpha surfaces (`bg-muted/40`), raw hex, `shadow-xs`, hand-written durations and easings;
  - `animate-pulse` loaders.

  Plan to rewrite the classes when porting; do not copy them. The census would reject a verbatim
  copy.

- **Async shape.** Presigning, lazy page loads and `loadChildren` are `useEffect` plus
  `isCurrent`-flag state machines and ref-backed Maps. Our rule puts these in TanStack queries
  keyed on path or page. Port the behaviour, not the code.
- **Manual memoization.** `useMemo` and `useCallback` are everywhere, alongside `React.memo`
  columns. Under the React Compiler most of these are redundant. Run `compiler:memos` after
  porting. Keep only memos whose identity feeds an effect, such as `attachedStagePaths`, which
  feeds the host ref callbacks.
- **Keyboard model.** Extend's grid navigation reads `getBoundingClientRect` over mounted tiles.
  Ours must be index math inside `useListbox`, because only windowed rows are mounted.
- **Dependency weight.** Each viewer carries a multi-MB renderer. Only EmbedPDF is plausible, and
  only once documents are a roadmap item; per the Plan 129 dependency shape it would be
  lazy-imported per document kind. The DOCX, XLSX and PPTX packages are `0.x` from a single vendor.
- **`@pierre/diffs` is out.** Our docs record the decision to open diffs in our own editor, not
  embed `@pierre/diffs` (`docs/t3code-chat-parity-gap-analysis.md:421`). The citation and schema
  panels' JSON diff tab would use `editor-diff` instead.
- **Glide Data Grid** is canvas-rendered and an alpha build (`6.0.4-alpha24`). Truncation
  recovery, tokens and `ListRow` would not apply inside it.
- **License risk:** none. MIT and Apache-2.0 throughout. Keep the shadcn and Extend notice in any
  copied file header.

## 6. Open questions for the owner

1. Which picker views: columns only (the best fit for choosing folders), or also icons and gallery
   for image and asset folders?
2. Should the picker show real content previews (code with syntax colour, images), even though it
   is mostly used to choose a folder? Does quick open get the same preview panel?
3. Are PDF, DOCX or XLSX files ever first-class documents in Platform (editor tabs, chat
   attachments), or is text-only preview the permanent scope? That one answer decides the whole
   viewer half of this library.
4. Should the picker's list view become a `@workspace/tree` (inline disclosure, multi-select), or
   stay a flat `VirtualList` per directory?
5. Filter chips (kind, modified date) in the picker: wanted, or is search enough?
6. For Plan 139's review mode: is the "item → source focus, per-item undo, form/diff tabs" shape
   from the citations panel the direction you had in mind?
