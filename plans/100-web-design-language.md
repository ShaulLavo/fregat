# Settle the web design language

Status: proposed, implementation not started. Requested 2026-09-12.

This plan gives `apps/web` one visual language and makes it enforceable. Today the app has no
settled answer for corners, bar heights, density, dividers, type steps, elevation or interaction
fills, so every call site answers for itself. The symptom the user sees is inconsistent padding,
borders and radii, and a titlebar and sidebar that look wrong next to each other. The cause is
upstream of any padding: the decisions live in call sites instead of in tokens and primitives.

The plan therefore does not sweep paddings one by one. It makes six decisions, encodes each one
in `packages/ui` or `packages/ui/src/styles/globals.css`, deletes the per-site overrides that
contradicted it, and ends with a mechanical census plus an independent review so nothing is
missed. Scope is `apps/web` and `packages/ui`. The TUI and the native Mac client have their own
rendering and are out of scope. [Root PLAN.md](../PLAN.md) owns execution order.

## Decisions

Each decision is stated once here and referenced by number below. The implementer does not
re-decide at a call site; a call site that needs something the decisions do not cover is a
missing token, and the fix is to add the token in the same pass.

| #   | Decision                                                                                                                                                                                                                                                                                                                                            | Owner after this plan                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| D1  | **Corners.** One language, owned by primitives. Recommended: soft-small. Controls (button, input, select, chip) use the `md` step; floating surfaces (menu, popover, dialog, tooltip) use the `lg` step; list rows, bars, panes and tabs-in-bars are square. Bare `rounded` (fixed 4px, not on the scale) is banned. Call sites never set a radius. | `globals.css` radius tokens; each primitive                  |
| D2  | **Bars.** One `--bar-height` token (with a compact value) for every horizontal bar: titlebar, pane headers, tab strips, bottom panel header, dialog headers and footers. One `--rail-width` equal to the bar height for vertical icon rails. Skeleton headers use the same token as the header they stand in for.                                   | `globals.css`; a `PaneBar` primitive in `packages/ui`        |
| D3  | **Density.** The existing `--density-*` variables are the only density system. The `compact:` Tailwind variant is removed from `apps/web`. If the app needs a density value the set lacks (row height, bar height, rail width), it is added to the set, not hand-written.                                                                           | `globals.css` `:root` and `:root[data-density='compact']`    |
| D4  | **Dividers.** `border-border` is the divider. A second, lighter weight is allowed only as a named token `border-subtle`; opacity modifiers on `border-border` are banned.                                                                                                                                                                           | `globals.css`                                                |
| D5  | **Type.** Four UI sizes: `text-sm`, `text-xs`, `text-2xs` (11px) and `text-3xs` (10px), registered in the theme. Arbitrary `text-[Npx]` is banned. Bar titles are `text-xs font-medium`; section headings inside panes are `text-sm font-semibold`. Tabular numerals on every number that updates.                                                  | `globals.css` `@theme`                                       |
| D6  | **Fills and elevation.** Lists use `bg-row-hover` / `bg-row-selected`. Toggled controls (rail tabs, bottom tabs, mode toggle) use `bg-accent`. Button hover comes from the Button primitive and is never re-declared. Elevation has three levels: none for panes, `shadow-md` for menus and popovers, `shadow-xl` for modal dialogs.                | Primitives; documented in the styling section of `CLAUDE.md` |

D1 is the only decision that changes the product's look rather than removing noise, so it is the
one to confirm with the user before Phase 1 lands. The recommended default above is what the
census suggests the app was already reaching for: `rounded-md` is the most common override
(97 sites) and the popover primitive already ships `rounded-lg`.

## Reconcile the baseline

Platform base `3c935f6a`. The working tree carries 287 modified files at that base, almost all
under `apps/web/src/features/address/`; none of them are in this plan's file lists, but the
implementer must capture HEAD and the full dirty diff before editing and must not fold address
work into these commits.

### Count the same way every time

All counts below were taken at this baseline with these commands from `apps/web/src`, test
files excluded. Re-run them before each phase and again in Phase 7; the final numbers are the
completion gate.

```
grep -rhoE '\brounded(-[a-z0-9]+)?\b' --include=*.tsx . | sort | uniq -c | sort -rn
grep -rnoE "(^|[ '\"\`])rounded([ '\"\`]|$)" --include=*.tsx . | grep -v tests | wc -l
grep -rhoE '\bcompact:[a-z0-9.\-]+' --include=*.tsx . | wc -l
grep -rhoE '\(--density-[a-z-]+\)' --include=*.tsx . | wc -l
grep -rhoE 'border-border/[0-9]+' --include=*.tsx . | sort | uniq -c
grep -rhoE 'text-\[[0-9.]+(px|rem)\]' --include=*.tsx . | sort | uniq -c | sort -rn
grep -rhoE '\bshadow(-[a-z0-9]+)?\b' --include=*.tsx . | sort | uniq -c
grep -rhoE 'hover:bg-[a-z/0-9-]+' --include=*.tsx . | sort | uniq -c | sort -rn
grep -rE '<button\b' --include=*.tsx . | grep -v tests | wc -l
grep -rnE -A6 '<Button' --include=*.tsx . | grep -oE "rounded(-[a-z]+)?\b" | wc -l
```

### Baseline census

| Measure                               | Baseline                                                                                                                                    | Target                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Radius classes in `apps/web`          | `rounded-md` 97, `rounded-sm` 86, bare `rounded` 37, `rounded-lg` 26, `rounded-full` 16, `rounded-xl` 7, `rounded-2xl` 1, `rounded-[2px]` 1 | 0 outside the allow-list in Phase 4 |
| Bare `rounded` files                  | 21                                                                                                                                          | 0                                   |
| `<Button>` sites overriding radius    | 38 of 211                                                                                                                                   | 0                                   |
| Primitives shipping `rounded-none`    | button, input, textarea, select, dialog, tooltip, dropdown, context menu, accordion, alert, command, input-group, resizable                 | 0; each carries its D1 step         |
| `compact:` overrides in `apps/web`    | 357                                                                                                                                         | 0                                   |
| `--density-*` consumers in `apps/web` | 0                                                                                                                                           | every bar, row and control          |
| Distinct hard-coded bar heights       | 44, 48, 40, 36, 32, 28 (see table below)                                                                                                    | 1 token, 2 values                   |
| `border-border/N` variants            | /50 1, /60 18, /70 13, /80 3                                                                                                                | 0                                   |
| Arbitrary text sizes                  | 11px 103, 10px 54, 13px 6, 12px 2, 9px 1, 7px 1, 6px 1                                                                                      | 0                                   |
| Shadow steps in use                   | xs 1, sm 3, bare 6, lg 6, xl 5, 2xl 1                                                                                                       | md and xl only, plus none           |
| Raw `<button>` outside primitives     | 35 in 22 files                                                                                                                              | 0 without a comment naming why      |
| Row hover idioms                      | `row-hover` 15, `accent` 8, `muted` 6, `background/N` 5                                                                                     | `row-hover` only on rows            |
| Dead `--sidebar-*` tokens             | 8 defined, 1 consumer                                                                                                                       | deleted                             |

### Bars at this baseline

Values are cozy then compact. The served page defaults to `data-density="compact"`
(`packages/contracts/src/settings/keys.ts:107`), so the compact column is what everyone sees.

| Bar                                      | File                                                                           | Cozy    | Compact |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ------- | ------- |
| Titlebar                                 | `components/app-titlebar.tsx:26`                                               | 44      | 40      |
| Chat panel header                        | `features/chat/components/chat-panel-header.tsx:34`                            | 48      | 40      |
| Chat-mode stage header                   | `features/chat-mode/components/stage-header.tsx:38`                            | 44      | 40      |
| Tool pane header (Files, Search, Logs…)  | `features/workbench/components/tool-pane-header.tsx:63`                        | 40      | 36      |
| Editor tab bar / tab                     | `features/workbench/components/editor-tab-bar.tsx:68`, `editor-tab-button.tsx` | 40 / 36 | 36 / 32 |
| LSP references pane header               | `features/editor/components/language-server-references-pane.tsx:73`            | 40      | 36      |
| Git header                               | `features/git/components/header.tsx:25`                                        | 36      | 32      |
| Bottom panel header                      | `features/workbench/components/bottom-panel.tsx:27`                            | 36      | 32      |
| File picker dialog header / footer       | `components/file-picker-dialog.tsx:458`, `:611`                                | 44 / 48 | 36 / 40 |
| Git loading header (skeleton)            | `features/git/components/panel-loading.tsx:8`                                  | 32      | 32      |
| Tree loading header (skeleton)           | `features/workspace/components/tree-loading.tsx:7`                             | 28      | 28      |
| Search results loading footer (skeleton) | `features/search/components/results-loading.tsx:28`                            | 28      | 28      |
| Sidebar icon rail width                  | `features/workbench/components/sidebar-panel.tsx:35`                           | 44      | 40      |

Two concrete defects fall out of this table. Switching the sidebar from Files to Git moves the
header edge by 4px. The Files skeleton header is 28px and the real Files header is 36px, so the
loading-to-loaded transition jumps.

## Phase 0 — make the census a script

Add `scripts/lint/web-design-census.mjs` beside `scripts/lint/web-boundaries.mjs` and a
`web-design-census.test.ts` next to it, wired into the root `test:scripts` script. The script
walks `apps/web/src/**/*.tsx` (tests excluded), extracts class strings, and reports every
measure in the census table above. It takes an `--allow` file of accepted exceptions (path plus
class) and exits non-zero when any measure exceeds its target.

Until Phase 4 lands, run it in report mode only. From Phase 4 on it runs in `lint`. Every later
phase's gate is this script's output, and Phase 7 relies on it. Do not skip this phase to save
time; it is what turns "triple check" from a promise into a command.

## Phase 1 — tokens and primitives

Files: `packages/ui/src/styles/globals.css`, `packages/ui/src/components/*.tsx`,
`packages/ui/src/components/button-variants.ts`, `packages/ui/src/components/badge-variants.ts`.

1. **D1.** Keep `--radius` as the base. Add nothing to the scale; remove nothing. Change every
   primitive from `rounded-none` to its step: `md` on button (all sizes, including the four
   `icon-*` sizes that currently repeat `rounded-none`), input, textarea, select trigger,
   input-group, badge; `lg` on dialog content, popover (already), dropdown and context menu
   content, command dialog, tooltip; menu items and select items `md`. Leave `resizable` square.
   Leave `switch` and `ring-loader` `rounded-full`.
2. **D2.** Add `--bar-height: 2.25rem` (cozy) and `2rem` (compact), `--bar-padding-x`,
   `--rail-width: var(--bar-height)`, `--row-height` (list rows: 1.5rem / 1.375rem), and map
   them under `@theme inline` so `h-(--bar-height)` and `w-(--rail-width)` work. Add a
   `PaneBar` primitive in `packages/ui/src/components/pane-bar.tsx`: a `header`/`div` with
   `h-(--bar-height) shrink-0 items-center gap-(--density-control-gap) px-(--bar-padding-x)`
   and a `border` prop for which edge carries `border-border`. It renders children only. Feature
   knowledge stays in feature components that compose it.
3. **D3.** Extend `--density-*` with the values the app hand-writes today and the primitives
   lack: `--density-row-height`, `--density-row-padding-x`, `--density-chip-height`. Keep the
   `compact`/`cozy` custom variants in `globals.css` for now; they are deleted in Phase 3 once
   the last consumer is gone.
4. **D4.** Add `--border-subtle` in `:root`, `.dark`, and every palette block that overrides
   `--border` (lines 218, 407, 545, 583, 615 at this baseline), mapped as `--color-border-subtle`.
5. **D5.** Register `--text-2xs: 0.6875rem` with a line height and `--text-3xs: 0.625rem` in
   `@theme`. Do not register 13px, 12px, 9px, 7px or 6px; Phase 4 maps those to the nearest step.
6. **D6.** Delete the eight `--sidebar-*` tokens and their `@theme inline` mappings after moving
   the one consumer (`bg-sidebar`) onto `bg-card`.

Gate: `packages/ui` typecheck, lint, and its `button.test.tsx` and `input.test.tsx`, which
assert on the density variables. Nothing in `apps/web` changes yet; the census must show the
same counts as baseline.

## Phase 2 — one bar

Convert every row of the bars table onto `PaneBar` and the `--bar-height` token. Concretely:

- `components/app-titlebar.tsx`: `h-11 compact:h-10` becomes `h-(--bar-height)`. The three grid
  cells get one padding, `px-(--bar-padding-x)`, and the desktop traffic-light inset stays as
  the only exception. Keep the CSS grid; keep `NATIVE_WINDOW_DRAG_CLASS`.
- `features/workbench/components/tool-pane-header.tsx`: horizontal orientation composes
  `PaneBar`; the vertical orientation keeps its own layout but takes `w-(--rail-width)`.
- `features/git/components/header.tsx`, `features/workbench/components/bottom-panel.tsx`,
  `features/chat/components/chat-panel-header.tsx`, `features/chat-mode/components/stage-header.tsx`,
  `features/editor/components/language-server-references-pane.tsx`, `components/file-picker-dialog.tsx`
  header and footer: same conversion. Chat and Git headers drop `text-sm font-semibold` for the
  D5 bar title style; their secondary line becomes `text-2xs text-muted-foreground`.
- `features/workbench/components/editor-tab-bar.tsx` and `editor-tab-button.tsx`: strip height
  is `--bar-height`; the tab is `--bar-height` minus the 4px top inset, expressed as
  `h-[calc(var(--bar-height)-0.25rem)]` once, in the tab button, with a comment.
- Skeletons: `tree-loading.tsx`, `git/components/panel-loading.tsx`, `search/components/results-loading.tsx`
  and `chat/components/models-loading.tsx` use the same `PaneBar` so the skeleton header is
  pixel-identical to the real one.
- `features/workbench/components/sidebar-panel.tsx`: the rail is `w-(--rail-width)`; its buttons
  are `size='icon-sm'` with no className overrides beyond colour.

Gate: the census reports one bar height. A browser test in
`features/workbench/components/tests/` asserts, via `getBoundingClientRect`, that the titlebar,
sidebar header, editor tab strip and bottom panel header have equal heights at both densities,
and that the Files and Git headers are equal. This is the test that catches the 4px jump.

## Phase 3 — one density system

Replace every `compact:` override in `apps/web` with the `--density-*` or bar token that
expresses the same intent, then delete the `compact` and `cozy` custom variants from
`globals.css`. The 357 sites concentrate in 25 files (10 in `components/logging-error-boundary.tsx`,
9 in `features/chat/components/provider-sign-in-dialog.tsx`, 8 in
`features/chat-mode/components/session-rail.tsx`, 7 each in `features/workspace/components/tree-loading.tsx`,
`features/file-picker/list.tsx` and `components/file-picker-dialog.tsx`, then a long tail).
Work file by file, top of the list first.

Mapping rules, so two implementers make the same call:

| Hand-written today                               | Becomes                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `h-7 compact:h-6`, `size-7 compact:size-6`       | `size='icon-sm'` / `size='sm'` on Button; otherwise `h-(--density-control-height-sm)` |
| `h-6 compact:h-5` on list rows                   | `h-(--density-row-height)`                                                            |
| `px-3 compact:px-2`, `px-2 compact:px-1.5`       | `px-(--density-control-padding-x)` or `px-(--density-row-padding-x)`                  |
| `gap-2 compact:gap-1.5`, `gap-1.5 compact:gap-1` | `gap-(--density-control-gap)`                                                         |
| `p-3 compact:p-2`, `py-2 compact:py-1.5`         | `p-(--density-section-padding)`, `py-(--density-section-gap)`                         |

A value that fits none of these rows is a new density variable, added in `globals.css` in the
same commit, not a new arbitrary pair.

Gate: `compact:` count is 0 in `apps/web`; the `compact`/`cozy` variant lines are gone from
`globals.css`; typecheck passes; the Phase 2 browser test passes at both densities.

## Phase 4 — call-site cleanup

With D1 to D6 owned by tokens and primitives, delete the overrides that contradicted them.

**Radius (D1).** Remove `rounded-*` from all 38 `<Button>` sites and from every element that is
a primitive underneath. For the remaining sites, the allow-list is short: `rounded-full` on
avatars, dots and pills; `rounded-lg` on cards and chat bubbles; `rounded-md` on chips and
thumbnails that are not `Badge`. Bare `rounded` is replaced everywhere (21 files, 7 sites in
`features/workbench/components/diagnostics-loading.tsx` alone). Everything else loses its
radius. List rows, bars and pane surfaces are square. `rounded-[2px]` goes.

**Dividers (D4).** The 35 `border-border/N` sites become `border-border` or `border-subtle`.
Rule: a line between two panes or under a bar is `border-border`; a line inside content (chat
message dividers, `messages-timeline.tsx`, `message-completion-divider.tsx`, `chat-welcome-view.tsx`)
is `border-subtle`. 23 of the 35 sites are in `features/chat/`.

**Type (D5).** 168 `text-[Npx]` become `text-2xs` (11px) or `text-3xs` (10px). 13px and 12px
become `text-xs`; 9px, 7px and 6px are looked at individually, since a 6px label is not
readable and is probably a bug rather than a size.

**Elevation (D6).** Menus and popovers `shadow-md` from the primitive; dialogs `shadow-xl` from
the primitive; delete `shadow`, `shadow-sm`, `shadow-xs`, `shadow-lg`, `shadow-2xl` from the 20
files that set them. The one deliberate exception is `editor-tab-button.tsx`, where the active
tab's `shadow-sm` is part of the raised-tab idiom; it stays with a comment or the idiom changes
in Phase 6.

**Raw buttons.** Each of the 35 raw `<button>` elements in 22 files becomes a `Button` with a
variant, or keeps a one-line comment saying what the primitive cannot do (drag handles and
`role='tab'` sortable tabs are the expected survivors). The hand-rolled
`focus-visible:ring-ring/50 ... ring-1` strings disappear with them.

Gate: the census script runs in `lint` from here on and passes with the allow-list. `apps/web`
typecheck and lint pass.

## Phase 5 — interaction vocabulary

Apply D6 to the fills. List rows use `hover:bg-row-hover` and `bg-row-selected`: convert the 8
`hover:bg-accent` and 6 `hover:bg-muted` row sites (`assistant-changed-files-section.tsx`,
`assistant-changed-files-tree.tsx`, `result-file-header.tsx`, `match-row.tsx`,
`language-server-references-pane.tsx`, `file-group.tsx`, `breadcrumbs.tsx`, `file-picker/list.tsx`
and the rest of the per-file list in the census). The five `hover:bg-background/N` sites are
looked at individually; they are usually a control sitting on a tinted surface and become
`variant='ghost'`. Toggled controls use `bg-accent` and `aria-pressed`; the one
`active && 'bg-card-solid'` becomes `bg-accent`.

Gate: the census hover histogram shows `row-hover` on rows and nothing else on rows.

## Phase 6 — the titlebar and sidebar

This is the visible payoff and it depends on the phases above. Three changes:

1. **Break the L-shape.** The titlebar and sidebar are both `bg-card` with full-strength borders,
   so they read as one slab. Give the sidebar the pane surface (`bg-background`) and drop its
   `border-r`; the resizable handle is the divider. The titlebar keeps `bg-card` and its
   `border-b`, so it is the only card-toned bar and reads as the window chrome.
2. **One tab idiom for rails.** The sidebar rail buttons and the bottom-panel tab buttons use the
   same shape: `Button` `variant='ghost'` `size='icon-sm'` or `size='sm'`, `bg-accent` when
   pressed, no radius override. The mode toggle in `components/ui-mode-toggle.tsx` is the only
   segmented pill in the app; either it becomes the same two ghost buttons with `aria-pressed`,
   or the bottom-panel tabs adopt the pill. Recommended: drop the pill. Editor document tabs keep
   the raised-tab idiom because they are documents, not views, but they sit on the D2 height.
3. **Titlebar cells.** One padding across the three grid cells, the document cell's `border-l`
   becomes `border-subtle`, and the workspace menu trigger, document title and mode toggle share
   the D5 bar title style.

Gate: a screenshot pass (Phase 7 step 4) at both densities and both colour schemes, compared
side by side with the baseline screenshots captured before Phase 1.

## Phase 7 — the triple-check sweep

This phase exists because the plan's own file lists were produced by grep and grep misses
things: class strings built with `cn()` across lines, template literals, and classes in `.ts`
model files. Nothing in this phase is optional.

1. **Re-run the census.** Every measure in the baseline table hits its target, and the allow-list
   is reviewed line by line: an exception without a reason comment is a defect.
2. **Widen the census, once.** Run the same extraction over patterns the original census did not
   cover and record the numbers in this plan: `size-[0-9]` and `h-[0-9]` overrides on `<Button>`,
   `leading-*` (nine distinct values at baseline), `gap-*` inside bars, `min-h-[`, `w-[`, and every
   remaining arbitrary value `-\[`; hand-rolled `dark:` colour variants (`CLAUDE.md` bans them);
   `!` important prefixes; inline `style=` props (12 files at baseline) that set anything other
   than a measured or computed value; and `.ts` files under `apps/web/src` that export class
   strings. Anything the widened census finds is fixed under the same decisions before this
   phase closes.
3. **Independent review.** A reviewer who did not implement Phases 1 to 6 reads every changed
   file against the decisions table with `git diff <baseline>..HEAD -- apps/web/src packages/ui`,
   and lists each place where a call site still makes a decision the table already made. The
   review is a written list with file and line, kept in the PR, not a verbal pass.
4. **Visual pass.** Using the browser test harness in `apps/web/test/env/browser-file-server.ts`
   (not a new server), capture the workbench with each sidebar tab, the bottom panel open, the
   chat-mode stage, the file picker dialog, the settings page, a dropdown, a context menu, a
   popover and a tooltip, at both densities and both colour schemes: 4 variants per surface.
   Overlay a ruler on every bar. Compare with the baseline set. Any bar off the token, any corner
   off the step, any divider at a second weight is a defect.
5. **Loading parity.** For every pane, screenshot the loading state and the loaded state and
   confirm the header does not move. The Files pane is the known offender.
6. **Write it down.** The decisions table moves into the Styling section of `CLAUDE.md` in
   condensed form so the next contributor does not re-open it. If any settings key changed,
   regenerate `docs/settings-reference.md` with `bun run settings:reference`.

The plan is complete when steps 1 to 6 each have recorded evidence in the PR. A green census
alone is not completion.

## The Row primitive gap

Eight full-width list rows stayed raw `<button>` elements rather than composing `Button`, and five
allow-list entries point here for the reason. It is one reason, not eight judgement calls.

`Button` is a control: fixed height, centred content, its own radius, and its own hover fill. A list
row is none of those. It is full width, left-aligned, often a CSS grid of columns, its height comes
from `--density-row-height`, it must be square, and its hover must be `bg-row-hover` so it agrees
with every other row in the app.

The fill is the part that cannot be worked around. `Button`'s ghost variant ships `hover:bg-muted`
and `dark:hover:bg-muted/50`, which are selector specificity (0,3,0). A call site adding
`hover:bg-row-hover` (0,2,0) or `bg-row-selected` (0,1,0) loses. Three rows had already been
converted to the row tokens and were still painting the Button's muted fill, invisibly, because of
this. Piling on specificity at the call site would be a worse answer than staying raw.

The real fix is a `Row` primitive in `@workspace/ui` — full width, left-aligned, square, row height,
the row fill vocabulary, and no hover declaration of its own — at which point those eight sites
compose it and the allow-list entries go away. That is out of scope here because it is a new
primitive with its own API decisions, not a class-string change. Until it exists, a raw `<button>`
with a one-line comment is the correct answer, and the census allow-list records each one.

Two survivors are not row-shaped and would not compose a `Row` either: the editor tab spreads
dnd-kit listeners and needs `role='tab'`, and the timeline minimap mark is absolutely positioned.

## Verification boundaries

Narrow checks only, per repository policy. `packages/ui`: typecheck, lint, `button.test.tsx`,
`input.test.tsx`. `apps/web`: typecheck, lint with the census, the Phase 2 bar-height browser
test, and the dom tests of components whose markup changed. The root `test:scripts` covers the
census script's own test. Do not gate on a repository-wide suite; the change is class strings
and tokens, and the checks above are the ones that can catch a plausible regression.

## Out of scope

Motion, colour palettes, wallpaper material, icon set, the TUI, the Mac client, and any change
to component structure beyond what the decisions require. Chat message layout is touched only
for dividers, radius and type steps.
