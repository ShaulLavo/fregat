# Plan 178: parity spec

The contract every sub-plan rebuilds against. It records the tree as it renders in the app on
2026-09-26 (Platform `bfc48ef17`), after the app's overrides: `style.css` in layer `base`,
`treeUnsafeCss` in layer `unsafe` (wins), the unlayered active-guide `<style>` (wins over both),
and the `--trees-*-override` map set inline on the host.

Baseline evidence: `/work/tmp/plan178-parity-llLM/evidence/` (33 captures, compact and cozy,
light and dark, rest, hover, focused, filter, empty filter, rename, drag; each with a JSON of
resolved variables and computed styles). The fixture repo with every git state, a flattened
chain, a long name and an unreadable folder is `/work/tmp/plan178-parity-llLM/fixture`. The
[parity harness](parity-harness.md) turns both into committed tooling.

## Visual

### Geometry

The tree's scale factor is 0.8 in both densities, so padding, gap, radius and the indent unit are
fixed. Only row height, font and the level gap follow density.

| Property          | Compact                                                   | Cozy                       | Nearest app token                              |
| ----------------- | --------------------------------------------------------- | -------------------------- | ---------------------------------------------- |
| Row height        | 20px                                                      | 24px                       | `--density-row-height`, matches                |
| Row padding-x     | 6.4px                                                     | 6.4px                      | `--density-row-padding-x` 6 / 8px              |
| Pane inset        | 16px left, 10px right + 6px gutter                        | same                       | none                                           |
| Gap between parts | 4.8px                                                     | 4.8px                      | `--density-control-gap` 4 / 6px                |
| Icon lane, glyph  | 16×16                                                     | 16×16                      | `--icon-size-sm` 12 / 14px                     |
| Chevron           | 16×16 box, drawn ≈11×6.5                                  | same                       | same as icon                                   |
| Font              | Inter 12.5px / 20px / 400                                 | JetBrains Mono 12px / 24px | `text-xs` 12px / 16px; 12.5px is off the scale |
| Indent per level  | 14.3px                                                    | 18.7px                     | none                                           |
| Name x, depth 0   | 27.2px                                                    | 27.2px                     | —                                              |
| Flattened chain   | `" / "` text between segments, each segment end-truncated | same                       | —                                              |
| Git lane          | 12px                                                      | 12px                       | none                                           |
| Row radius        | 0                                                         | 0                          | square rows, matches                           |

### Row states

- **Rest:** transparent, `--foreground`.
- **Hover:** `--row-hover`, instant. Same as `ListRow`.
- **Pressed:** no tint. `ListRow` paints `bg-row-active`.
- **Menu open on the row:** holds the hover fill.
- **Selected:** `--row-selected`; the chevron turns `--foreground`; file icons keep their colour.
- **Selected bar:** `::after`, 2px wide at `left: 0`, 4px from top and bottom, square, `--foreground`.
  Contiguous selected rows show one bar each, broken by 8px gaps.
- **Focus ring:** `::before`, 1px solid `--ring` outline, offset −1px, radius 4.8px on a square row.
  Shown only while the tree contains focus, including after a mouse click.
- **Drag source:** opacity 0.5.
- **Drop target:** nothing is painted. A folder expands after 800ms of hover.
- **Rename:** the row becomes a `div`, rounded 4.8px, no selected bar. Input transparent, borderless,
  no ring, row − 4px tall, padding-x 6px. The git letter stays.
- **Search match:** no emphasis. Non-matches are hidden.
- **Loading file:** hand-copied shimmer, 2s linear, −100%→250%; reduced motion paints
  `--muted-foreground`.
- **Folder loading / error / no access:** text `loading`, `error`, `no access` in #84848a. Error and
  no access add a 12px sparkle action at opacity 0.7, radius 4px, opacity 1 on hover.
- **Git:** added and untracked `--success`; modified, renamed and conflicted `--warning`; deleted
  `--destructive`; letter weight 600; the file icon keeps its colour. A folder containing changes
  shows a 6px `--warning` dot at opacity 0.5. Ignored is `--muted-foreground` with the icon at 0.5.
- **Sticky rows:** transparent, no shadow. Flowing rows under them are clipped with `clip-path`.
  Hidden at scrollTop 0 until the first scroll (200ms reveal). While scrolling and for 50ms after,
  sticky hover is suppressed and pointer events are off.

### Indent guides

- 1px `border-left` shifted −0.25px. The first sits 13.65px from the row edge, then one per level.
- At rest: `--border`. While the pointer is over the tree, all guides switch together to six
  editor-syntax colours cycled by depth (type 34%, keyword 30%, string 28%, number 32%, function 30%,
  variableBuiltin 30%, mixed with transparent). Theme gaps fall back to raw hex.
- `workbench.tree.indentGuides`: `always` (default), `onHover`, `none`. With `onHover` the focused
  row's parent guides stay lit. Opacity transitions 150ms ease.

### Filter bar

- Always visible. `--bar-height`, `--bar-padding-x`, no background.
- Input renders 28 / 32px (content-box, 4px over `--density-control-height-sm`), radius
  `--radius-md`, `bg-input/30`, a visible 1px `--input` border, Inter 12px.
- Focus: 2px `--ring` outline, offset −1px, no halo, no transition.
- Placeholder "Filter files", a raw-hex colour mix near `text-muted-foreground`.
- No matches: no empty state; the tree reappears collapsed with the query still in the box.

### Scrollbar, motion, drag preview, icons

- **Scrollbar:** 6px, `scrollbar-gutter: stable`, thumb `fg 25%` drawn 4px wide with radius 3px,
  visible only while the list is hovered. `.app-scrollbar-thin` shows the thumb always.
- **Motion:** row hover instant; chevron jumps between down and right with no transition; guide
  opacity 150ms ease; smooth scroll on reveal.
- **Drag preview:** a clone of the source row, fixed, opacity 0.85, `0 4px 12px rgba(0,0,0,.15)`.
  Safari uses the native image.
- **Icons:** the app's 93-glyph sprite (`app-vscode-icon-*`) for every file; unknown files use
  `file-duo`. **Folders have no glyph**: the chevron alone fills the lane, in #84848a. Icon colours
  come from 13 hue pairs in raw hex; inside the tree `bun` is mauve, elsewhere `FileTypeIcon` paints
  it pink.

## Behaviour

Coverage key: **B** `FileTree.browser.tsx`, **D** `FileTree.test.tsx`, **U** tree unit tests,
**AB** `tree-pane.browser.tsx`, **AT** `tree-pane.test.ts`, **FA** `use-fs-actions.test.tsx`,
**S** an agent scenario. ✗ = no coverage today. The [parity harness](parity-harness.md) adds a test
for every ✗ before anything is replaced.

### Keyboard

The tree stops propagation for every key it handles; only Mod+Z, Mod+Shift+Z, Mod+F and
Mod+Shift+E reach the app keymap.

- ✗ ↑ moves focus, clamped. ↓ (B).
- → expands (B); ✗ on a file or expanded folder moves to the next row.
- ← collapses (B); ✗ otherwise moves to the parent, no-op at root; ✗ on a flattened chain (verify).
- Home / End (B). ✗ PageUp / PageDown scroll natively without moving focus.
- Arrows move focus only. Selection does not follow.
- ✗ Shift+↑/↓ extends the range from the focused row; reversing shrinks it.
- Mod+Space toggles (B). Mod+A selects all visible (B).
- ✗ Enter / Space: native button click (select only this row, toggle a folder, open a file).
- F2 renames (B). Shift+F10 opens the menu (B, D); ✗ ContextMenu key.
- A letter or digit, no Ctrl/Meta/Alt, opens the filter seeded with it (B). ✗ Punctuation does not.
- Filter open: Escape closes, Enter selects the focused match, ↑/↓ step matches clamped (B, AB).
  ✗ Printable keys on a row are ignored.
- Mod+Z / Mod+Shift+Z through the keymap (S). ✗ Mod+F opens the filter.

### Pointer and touch

- Click selects only this row, focuses it, toggles a folder, keeps scroll (B, S).
- ✗ Mod+click toggles; ✗ Shift+click selects a range; ✗ Mod+Shift+click merges.
- ✗ Double-click on a folder toggles twice. ✗ Middle mousedown focuses the row.
- Right-click opens the menu without changing selection (B, S); ✗ suppressed during scroll and
  50ms after.
- ✗ A sticky-row click reveals the real row below its sticky parents and focuses it.
- ✗ A flattened chain click targets its last folder.
- Decoration action (S); ✗ does not select the row.
- Hover prefetch: files (AB, S); ✗ folders.
- ✗ Touch long-press drags after 400ms, cancelled by 10px of movement; no menu on touch;
  `touchcancel` cancels.

### Selection and focus

- Roving tab stop (tabIndex 0 on the focused row). Focused, selected (set + anchor). No marked state.
- Parked rows: the focused or dragged row stays mounted, invisible, beside the window (B, partly).
- After a menu closes: `focusNearestPath`. ✗
- After rename: focus stays on the row at its new path. ✗
- After delete: nearest visible ancestor, then row 0. ✗

### Expansion and loading

- Expanding expands ancestors; collapse is not recursive; descendants remember expansion.
- Flattened empty directories on. Lazy loading of expanded folders; re-expanding an error retries.
- The chain's last folder stays expanded when a single child turns a folder into a chain (AT).
- ✗ Reload restores expansion, selection and scroll when the active file matches.
- Selecting an editor tab expands ancestors, selects and reveals smoothly without focus (AB).

### Filter

- `hide-non-matches`, loaded paths only, substring on the full relative path (B, U).
- Saves expansion, expands match ancestors; manual collapse overrides survive query changes (U).
- ✗ Closing restores the saved expansion. `retain` on blur (B, AB). ✗ Focus after Escape.
- Drag disabled while a query is set; rename and reveal close the filter.

### Rename and create

- Starting a rename expands ancestors, selects only this row (which opens a file), closes the
  filter, fills and fully selects the name (✗).
- Enter commits, Escape cancels, IME respected (B). ✗ Blur commits.
- Validation: empty, contains `/`, exists (U). Commit moves the row at once, then journals the move.
- Create adds `untitled` / `new folder` with remove-on-cancel (AB). ✗ Deferred until the folder loads.

### Drag and drop

- Dragging a selected row drags the selection, nested paths de-duplicated (FA; ✗ de-dup).
- ✗ A folder row drops into it; a file row into its parent; a chain segment into that folder.
  No drop between rows. Invalid targets still show `move`.
- ✗ Hover-to-expand 800ms. ✗ Edge auto-scroll: 40px band, up to 18px per frame.
- ✗ Escape cancels. ✗ OS files dropped on the tree are ignored.
- ✗ A real drag onto the chat composer inserts a mention (the payload format is suspect).

### Scroll and virtualization

- Fixed row height; density change keeps the scroll anchor (B, AB). Overscan 10.
- Sticky folders show every open ancestor (B, S); ✗ push-up and clipping; ✗ first-frame reveal.
- `scrollToPath` nearest / top / center, smooth, settlement (B); ✗ reduced motion forces `auto`.
- ✗ scrollTop clamps after a collapse. ✗ Parked dragged row.

### Menu

- Right-click and Shift+F10 anchoring (B). Targets one row even with a multi-selection. ✗
- ✗ Closes on Escape (restores focus), outside click, user scroll, row removal. ✗ An overlay eats
  input while open.

### Accessibility

- treeitem with level, posinset, setsize, expanded, selected, haspopup, busy (U).
- ✗ No label on the tree inside the root; no `aria-multiselectable`; filter input unlabelled;
  decoration action not focusable; git letters not in the accessible name.

## Harness findings (2026-09-26)

The [parity harness](parity-harness.md) pins today's behaviour; where it differs from the text
above, the harness is right and these are the corrections.

- **Menu:** a wheel over the tree while the menu is open is eaten by the menu's wash, so the list
  does not scroll and the menu stays open; "closes on user scroll" only happens for scrolls that
  bypass the wash. Removing the menu's row leaves the menu open (the close effect does not re-run).
- **Filter:** Escape restores the saved expansion and leaves focus in the emptied filter box.
- **Git:** a merge conflict (`UU`) renders as `M` in `--warning`; `.gitignore`d files and folders
  render as plain rows, so the ignored style (muted, icon at 0.5) never shows in the app.
- **Chains:** the flattened chain's segments are real drop targets (`flattenedSegmentPath`).
- **Composer drop:** a real row drag onto the composer starts, drops, and leaves the composer
  empty (quirk 8), pinned by `tree-parity-behaviour`.
- **Touch:** Chromium holds back `touchmove` within its ~15px slop, so the 10px cancel only shows
  past that.

Every ✗ above now has a test except the drop effect shown over an invalid target, which real input cannot read: `packages/tree/src/tests/parity-*.browser.tsx` or the
`tree-parity-behaviour` scenario.

## Quirks

Answered 2026-09-26 (index § Decisions, Q2): 1, 8 and 9 are bugs and get fixed; the rest stay.

1. F2 is not gated on `mutationsEnabled`: with mutations off, the row moves and nothing is written.
2. Starting a rename on a file selects it, which opens it in the editor.
3. Punctuation never starts the filter.
4. Plain arrows do not open files.
5. Double-clicking a folder cancels itself out.
6. No drop-target highlight.
7. Ignored files count toward a folder's change dot.
8. The composer drop parses `${rootPath}/…` but the tree sends a root-relative path.
9. The editor drop wants `copy`; the tree allows only `move`, so the drop is refused.
10. An empty filter result shows the collapsed tree, not an empty state.

## Parity-vs-rule conflicts

Where keeping today's look breaks an AGENTS.md rule. Verdicts are in the index § Decisions, Q1.

| Current look                                                  | Rule                                   |
| ------------------------------------------------------------- | -------------------------------------- |
| Middle truncation that keeps the extension                    | No middle truncation                   |
| No `title` on any row                                         | Truncation recovery                    |
| Compact font 12.5px                                           | Four type sizes                        |
| Cozy file names in mono                                       | Two type voices                        |
| Indent guides are 1px lines                                   | No hairlines                           |
| Filter input with a visible border, 4px taller than the token | No hairlines; primitives own controls  |
| Rounded focus ring on a square row; rounded rename row        | Corners belong to primitives           |
| Focus ring after a mouse click, 1px, no halo                  | `focus-ring` on `:focus-visible`       |
| Chevron, decoration text, icon hues, placeholder in raw hex   | Tokens only                            |
| Ignored icon and change dot at 0.5 opacity                    | No text alpha                          |
| Guide opacity 150ms ease; own shimmer keyframes               | No hand-written motion; no own loaders |
| Drag preview `0 4px 12px rgba(…)`                             | Three elevation levels                 |
| Padding 6.4px, gap 4.8px, 16px icons in both densities        | One density system                     |
