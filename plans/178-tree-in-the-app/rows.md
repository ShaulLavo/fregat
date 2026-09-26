# Plan 178: rows on app primitives

- Status: PROPOSED. Size L. After [app-owned-state](app-owned-state.md). Runs beside
  [icons](icons.md) and [chrome](chrome.md).
- Owns: rebuilding the row in Tailwind on `ListRow` and a new shared tree-row lead, with the
  current look.

## Outcome

A tree row is `ListRow` plus a shared `TreeRowLead` (indent, guides, chevron) plus `FileLabel`,
styled only with Tailwind and theme tokens. The harness shows the same row. Five other trees in the
app adopt `TreeRowLead`.

## Reuse

| Row part                 | Today                                      | Becomes                                                                                          | Gap                      |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------ |
| Row box, hover, selected | `style.css:600-718` + unsafe overrides     | `ListRow` (`packages/ui/src/patterns/list-row.tsx`)                                              | small                    |
| Selected bar             | `::after` in `treeUnsafeCss`               | a `ListRow` variant                                                                              | small                    |
| Focus ring on the row    | `::before`, shown while the tree has focus | a `ListRow` cursor state ringed under the list's `:focus-within`                                 | small                    |
| Roving tab stop          | tabIndex 0 on the focused row              | none: one tab stop on the list (Q3)                                                              | small                    |
| Indent, guides, chevron  | spacers + `border-left` + sprite chevron   | new `TreeRowLead` in `packages/ui/src/patterns/`                                                 | build                    |
| Name, chain, truncation  | `MiddleTruncate`, chain spans              | `FileLabel` (`components/file-label.tsx`) gains extension-preserving truncation and a chain mode | small                    |
| Git colour and letter    | `style.css:1103-1160`                      | `FileStatusCell`, `gitStatusSymbol`, status tokens                                               | align maps               |
| Change dot on folders    | 6px `--warning` at 0.5                     | Plan 157's `StatusDot`                                                                           | 157 lands first (queued) |
| Decorations and action   | text lane + `span role=button`             | component slot, `Button` + `data-tooltip`                                                        | none                     |
| Loading file             | own shimmer keyframes                      | `Shimmer`                                                                                        | none                     |
| Drag source dim          | opacity 0.5                                | stays (drag sub-plan)                                                                            | none                     |

### ListRow extensions

- A `cursor` (or `focused`) state that draws a ring only while the list container has
  `:focus-within`, matching today's "ring while the tree has focus".
- A `selectedBar` variant: 2px, inset 4px top and bottom, `--foreground`.
- `tabIndex` stays −1: the list holds the one tab stop (Q3).
- A way to opt out of the pressed tint: the tree has none, and keeps none (Q1). Whether other lists
  follow is a [tree-leads](tree-leads.md) question.

### Truncation

The tree keeps its extension-preserving middle truncation (Q1): `component-file-na….tsx`. It moves
into `FileLabel` as an option so it is one implementation, not a tree-private one, and the row gains
a `title` with the full path (Q2: added, changes nothing on screen). Until
[tree-leads](tree-leads.md) decides whether the app adopts it, the tree's use is a census allow
entry citing Q1.

### TreeRowLead

- Props: `depth`, `expandable`, `expanded`, `guides: 'always' | 'onHover' | 'none'`, optional
  `guideColor(depth)`.
- Draws one guide per level as a `w-px` element with a `bg-*` token, the chevron in the icon lane,
  and the indent from a token.
- Adopters, each with its own harness-style before/after: git changes group header
  (`change-group-header.tsx`), chat turn files (`assistant-changed-files-tree.tsx`, inline
  `paddingLeft: depth*0.875rem`), folder picker (`breadcrumb-picker-row.tsx`, `depth*1rem`), search
  result groups (`file-group.tsx`), diagnostics and references. Today there are six chevron copies
  in two conventions and three indent units.

### Attributes and ids

The row's state is ARIA and `ListRow`'s own attributes (`aria-selected`, `aria-expanded`,
`aria-level`, `data-marked`), nothing else. The tree's ~50 private `data-file-tree-*` and
`data-item-*` attributes go, with the constants in `utils/constants.ts` that name them.

- Read outside the tree today, so each gets a replacement in this pass: `data-item-path` (a row's
  path; becomes the `ListRow` key plus a `data-path` only if a reader still needs it),
  `data-file-tree-virtualized-scroll` (the scroller; the list's `role` and label), `data-item-section`,
  `data-item-loading`, `data-file-tree-sticky-row`, `data-file-tree-search-input` /
  `-search-container` (the `FilterField`), `data-file-tree-context-menu-root` (gone with
  [out-of-the-root](out-of-the-root.md)), `data-item-selected`, `data-item-focused`,
  `data-item-rename-input`.
- Readers to move: `tree-pane.tsx`, the tree tests, `scripts/agent/selectors.ts`, the scenarios
  and `apps/web/scripts/*` named in out-of-the-root. Selectors go through roles and labels first.
- The `id` on the tree's list stays only as the `aria-activedescendant` base (Q3).

### New tokens

Values come from the parity spec; names are proposals.

- `--tree-indent` (14.3 / 18.7px per density), `--tree-guide-offset` (13.65px).
- `--tree-guide-1` … `--tree-guide-6`, derived from editor syntax colours at runtime as today, with
  token fallbacks replacing the raw hex in `indent-guide-style.ts`.
- `--tree-font-size` / `--tree-font-family` for compact 12.5px and cozy mono (kept, Q1); they
  replace `--workbench-tree-*`.
- `--tree-row-padding-x` (6.4px), `--tree-gap` (4.8px) and `--tree-icon-size` (16px): the tree's
  0.8-scale geometry, kept exactly (Q1).

## Parity

Every visual line in the parity spec's "Row states", "Indent guides" and "Geometry" sections, except
the Q1 alignments: tokens for hex, a square `:focus-visible` ring, `Shimmer`, motion tokens for the
guide fade, no alpha on ignored icons and the change dot. Rename-row styling moves to [chrome](chrome.md).

## Delete

`style.css` rules for rows, guides, git, decorations, truncation (~800 lines), the tree's
truncation components once `FileLabel` owns the behaviour (`MiddleTruncate`, `Truncate`,
`Fruncate`, `OverflowText`, `OverflowContent`, `OverflowMarker`, `overflowTextSplit`), the row parts of `treeUnsafeCss`, `--trees-*` row overrides, the hand-written
shimmer, `applyFileTreeIndentGuideVisibility` and its test.

## Verification

- Harness pixel and style diff per state, compact and cozy, light and dark.
- `design:census` now scans the tree's files; the allow list holds only Q1 exceptions, each citing it.
- `renders` on `tree-sticky-scroll`: `ListRow` + `TreeRowLead` must not add renders per scroll frame.
- Each `TreeRowLead` adopter: `look` before and after on its surface.
