# Plan 178: filter, rename, scrollbar, skeleton

- Status: PROPOSED. Size M. After [app-owned-state](app-owned-state.md). Runs beside
  [rows](rows.md).
- Owns: the controls around and inside the rows, each built as a shared pattern the tree adopts
  first.

## Outcome

The filter box, the inline rename input, the scrollbar and the loading skeleton are shared app
patterns. The tree looks the same; five other filter fields and two other rename inputs lose their
hand-rolled copies.

## Filter field

- **Today:** the tree's own input, restyled through `treeUnsafeCss` to look like `Input`, rendering
  28 / 32px with a visible border and a 2px outline focus. Placeholder "Filter files". Type-to-filter
  seeds it from row keys (`useFileTreeKeyboard.ts:313`). Blur `retain`.
- **App copies:** InputGroup + magnifier + input + clear button in `history-toolbar.tsx:99-129`,
  `session-rail.tsx:310-340`, `logs/toolbar.tsx:52`, `settings/page.tsx:157`,
  `keybinding-section.tsx:27`. None shares Escape, ArrowDown or keep-on-blur handling.
- **Build:** a `FilterField` pattern in `packages/ui/src/patterns/` on `PaneBar` + `InputGroup`:
  magnifier addon, clear button with a tooltip, Escape clears then blurs, ArrowDown moves into the
  list, `retain` or `clear` on blur, and an imperative `seed(char)`.
- **Parity:** the bar at `--bar-height`. The input aligns to the `Input` primitive (Q1): no visible
  border, the control-height token (today it renders 4px taller), `focus-ring-within`. An empty
  result keeps today's collapsed tree (Q2, quirk 10).
- **Adopters:** the five above.

## Inline rename

- **Today:** `RenameInput.tsx`, a raw `<input>` inside a `div` row: transparent, borderless, row − 4px
  tall, padding-x 6px, the whole name selected, IME-safe, commit on Enter or blur, cancel on Escape.
- **App copies:** `SessionRename` (`components/session-rename.tsx`), `TerminalListRowEditor`
  (`workbench/components/terminal-list-row-editor.tsx`).
- **Build:** an `InlineRenameInput` pattern on `Input`: settle once, Enter / Escape / blur, IME
  guard, stops pointer events reaching the row, an `initialSelection` range, `aria-invalid` with the
  validation message.
- **Parity:** today's borderless look inside the row; the rename row turns square like every other
  row (Q1). The whole name stays selected, extension included (Q2).
- **Adopters:** session and terminal rename.

## Scrollbar

- **Today:** 6px, stable gutter, thumb `fg 25%` 4px wide, visible only while hovered
  (`style.css:410-461`). `.app-scrollbar-thin` always shows its thumb.
- **Work:** land Plan 102 D2/D3 (done in lane L1) with the tree's recipe
  as the shared `@utility`, plus a `scroll-gutter` utility. Plan 102 already names the tree's recipe
  as the better one.

## Loading skeleton

- **Today:** `components/tree-loading.tsx` hand-mirrors rows with a folder glyph, `px-1.5` and
  `pl-5` / `pl-9` indents. Real rows have no folder glyph, a 16px inset and 14.3 / 18.7px levels.
- **Work:** the skeleton mounts `ListRow` + `TreeRowLead` with placeholder bars inside
  `LoadingState`, one per real element.

## Delete

`RenameInput.tsx`, the search input in `FileTreeView.tsx`, `style.css:409-598` and `:990-1009`, the
filter and scrollbar parts of `treeUnsafeCss`.

## Verification

- Harness states: filter match, filter empty, rename, loading.
- Behaviour tests from the harness: filter keys, rename lifecycle, IME, blur commit.
- `look` on each adopter.
