# Plan 178: rows on app primitives

- Status: PAUSED after PR 2 (wave 2, lane T; the wave wound down). PRs 3 and 4 are left for
  later. Size L, landing as four sequential PRs, each off main after the previous one merges. After [app-owned-state](app-owned-state.md). Runs beside
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

## Landing order

The sub-plan is too big for one reviewable PR, so it lands in four, each off `main`:

1. **Lead.** `TreeRowLead` in `packages/ui` (indent, guides, chevron lane) for the tree and its six
   adopters: git change group headers, chat turn files, the folder picker, search result groups,
   references and problems. The tree's injected guide stylesheet goes; the focused row's parent
   guide is a prop.
2. **Row box.** `ListRow` gains the cursor ring, the selected bar and the pressed-tint opt-out; tree
   rows move onto it, with the git and decoration lanes and `Shimmer` in Tailwind.
3. **Name.** `FileLabel` gains extension-preserving truncation and a chain mode; the tree's
   truncation components go.
4. **Attributes.** The private `data-file-tree-*` and `data-item-*` attributes and their readers go.

Interim, until [keyboard-and-selection](keyboard-and-selection.md) moves the tree to one tab stop
(Q3): tree rows keep their roving `tabIndex`.

## Landed

### 1. Lead

- `packages/ui/src/patterns/tree-row-lead.tsx`: `TreeRowLead({ depth, expanded, guides,
activeGuide, onChevronClick, children })`. The lead is padded by `depth × --tree-indent`, and
  each guide is a `w-px` element at `--tree-guide-offset + level × --tree-indent`, shifted by
  `--tree-guide-shift`. The `--tree-lane` wide lane holds the chevron, which is the tree's glyph
  rotated −90° when closed, or `children`. Guides take `--tree-guide` at rest, light to
  `--tree-guide-1…6` by level while the pointer is over the `group/tree` ancestor, and fade with
  the motion defaults. Defaults live in `globals.css`: the indent is 0.875rem, the lane is
  `--icon-size-sm`, and every guide opacity is 1.
- The tree sets its own geometry: the indent is level gap + row gap + half the icon − 0.5px (14.3
  and 18.7px), the lane is 16px, and the chevron keeps its x-height nudge. The editor-syntax guide
  tones become `--tree-guide-1…6`, and the `workbench.tree.indentGuides` opacities become
  `--tree-guide-opacity`, `--tree-guide-hover-opacity` and `--tree-guide-active-opacity`. The
  focused row's parent guide is `activeGuide`. The document-level `<style>` that `TreeView`
  rewrote on every focus move is gone.
- Adopters:
  - Chat turn files and the folder picker drop their inline `paddingLeft`, and the picker's indent
    goes from 1rem to the shared 0.875rem.
  - Git group headers, search groups, references and problems take the lead at depth 0.
  - All six draw the tree's chevron in place of Phosphor's caret. It jumps between states as the
    tree's always did, so the adopters lose their 150ms rotation; a mid-way rotation reads as a
    third state.

- `TreeRow` builds the lead itself, so the React Compiler reuses an unchanged row's lead and file
  icon.

#### Verification

- `tree-parity` before the re-baseline showed zero pixel drift in all 60 captures
  (`/work/tmp/fregat-evidence/20260927T024203Z-scenario-tree-parity/`). The style probe changed
  only in these fields:
  - The probe now reads the lane and guides by their new slots: a guide's `width` and
    `background-color` replace its `border-left-*`.
  - Guide transitions went from 150ms to the motion default of 100ms.
  - The chevron's `fill` moved to its path, and its rotation moved to the `rotate` property, which
    changes the reported `transform`.
  - At depth 2 and deeper in cozy, positions differ by at most 0.03px of calc rounding.

  After the re-baseline there is zero drift
  (`/work/tmp/fregat-evidence/20260927T025856Z-scenario-tree-parity/`). `tree-parity-behaviour`,
  `tree-sticky-scroll` and `tree-file-clicks` pass.

- `renders tree-large-scroll` (base `167c3e944` → this branch, `…/20260927T025423Z-…` →
  `…/20260927T025719Z-…`):
  - `TreeRow` subtree: 410.7 → 203.2 ms.
  - `TreeView` subtree: 703 → 468 ms.
  - `FileTypeIcon`: 3,061 renders and 14 ms → 153 and 2.9 ms.
  - `TreeRowLead`: 200 renders, 9.7 ms.
- `trace` against the base, two alternating runs each on a loaded machine, before the lead moved
  into `TreeRow` (median render per wheel step):
  - `tree-large-scroll`: 15.2 and 14.7 ms on the base, 13.2 and 15.7 ms here.
  - `tree-sticky-scroll`: 55.4 ms on the base, 45.2 and 42.2 ms here. The base's second run did
    not complete.
- Adopters, `look` before → after (`/work/tmp/fregat-evidence/`):
  - `breadcrumb-picker`: `20260927T021042Z` → `20260927T024345Z`.
  - `lsp-references`: `20260927T021158Z` → `20260927T024403Z`.
  - `search-type-delete`: `20260927T021304Z` → `20260927T023901Z`.
  - `problems-panel-rows`: `20260927T021418Z` → `20260927T023923Z`.
  - `file-icon-hues` git changes: `20260927T024009Z` → `20260927T023940Z`.
  - Chat turn files: the scenario that shows them needs a native provider fixture session and was
    not run.
- Review follow-ups:
  - `TreeRowLead` drops its unused `className`.
  - The chat card header draws `TreeChevron`.
  - The harness gains a `guides-on-hover-focus` state. Its baseline was captured on `main`
    `9305b8062`, before this PR.
  - The folder picker's lane follows `--icon-size-sm` (12px in compact, 14px in cozy), in place of
    a fixed 14px. That moves its rows 2px in compact. The shift is intended: the chevron lines up
    with the row icons below it at every density.

### 2. Row box

- `ListRow` gains three props:
  - `selectedBar`: a 2px foreground bar at the start edge while the row is selected, inset 4px.
  - `cursor`: the list's keyboard cursor, ringed with the new `focus-ring-inset-drawn` while focus
    is inside the `group/listbox` ancestor.
  - `tabIndex`, for a list whose rows take DOM focus.

  The bar and ring classes go only on the rows that draw them. On every row, the pseudo-element
  rules added a `::after` resolve to each restyle; putting them on the drawing rows alone cut the
  elements restyled over the large scroll from 19.1k to 15.2k.

- Tree rows render as `ListRow` (`interactive={false}`, so there is no pressed tint), with the
  tree's geometry and fonts as Tailwind classes.
  - Hover stays gated on the root's `data-is-scrolling` through an arbitrary variant keyed on the
    row's class, so a scroll still restyles the rows alone.
  - A selected row keeps its fill under the pointer. #130's hover gate had made hover outrank it.
  - The row box rules in `tree-view.css` and `tree-pane.css` are gone: the box, hover, selected,
    bar, ring and drag dim. What remains are the truncation markers' state colours, until the name
    moves onto `FileLabel`.
- Q1 alignments, the drift the harness shows before its re-baseline
  (`/work/tmp/fregat-evidence/20260927T041353Z-scenario-tree-parity/`):
  - The focus ring is the app's inset ring on a square row, in place of the tree's 1px rounded
    outline.
  - A row focused by a mouse press draws no ring until a key is pressed. `:focus-visible` cannot
    tell, because rows take focus from script, so `TreeView` records the pressed row and any key
    clears it. States: focus-keyboard, focus-click, multi-select, filter-match, filter-empty,
    sticky, drag-over-folder, loading-file, loading-folder and guides-on-hover-focus.
  - The rename row is square, and it still draws no bar.

  Every other state has zero drift. After the re-baseline all 64 captures have zero drift
  (`…/20260927T043014Z-scenario-tree-parity/`).

- Tests: the tree's browser tests now load the app stylesheet, and their config runs Tailwind,
  because rows are styled by utilities.

#### Verification

- `trace tree-large-scroll`, three alternating runs against `main` `9305b8062`:
  - Style over the wheel steps: base 129.6, 132.7 and 120.9 ms; this branch 120.0, 131.7 and
    111.6 ms.
  - Render per step: base 11.0, 11.5 and 10.3 ms; this branch 10.0, 11.8 and 9.5 ms.
  - Elements restyled: 18.3k on the base, 15.2k here.
  - Traces: base `…/20260927T043250Z`, `…/043358Z` and `…/043505Z`; branch `…/043324Z`,
    `…/043432Z` and `…/043538Z`.
- `trace tree-sticky-scroll`: style 56.9 ms on the base (the other base run lost its marks);
  56.9 and 117.9 ms here, on a loaded machine.
- `renders tree-large-scroll`: `ListRow` adds 75–118 ms over the scenario, one render per row.
  The `TreeView` subtree was 468 → 423 ms in one pair and 427 → 603 ms in another, so the render
  cost is not settled.
- Tests: tsc web and ui; `packages/ui` patterns 55; `row-states.browser` 4; web dom 458;
  `test:tree-browser` 79. `tree-parity-behaviour`, `tree-sticky-scroll` and `tree-file-clicks`
  pass. Gates pass, and the first-load gate is 1,681,783 against a pin of 1,735,134.
