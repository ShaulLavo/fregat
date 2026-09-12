# Recover what truncation hides

Status: proposed, implementation not started. Requested 2026-09-12.

`apps/web` truncates 147 elements. Most of them carry a value the app did not author — a path, a
branch, a session title, a model name, a machine label, a host, a code excerpt — and in 78 of them
there is no way to read the part that was cut. Two rows truncate a raw full path from the right, so
the basename, the only identifying segment, is the first thing to disappear and nothing recovers it.

The app already has the right answer; it is written down nowhere, so half the call sites reinvent it
and half do not bother. This plan states the rule, teaches the existing design census to measure it,
fixes the sites that lose a value outright, and removes the four duplicated palette-row markup
blocks that spread the loss.

It does not remove truncation. Truncation is correct: these are one-line rows in narrow panes. It
does not add a tooltip library, a middle-truncating path formatter, or a hover card. Scope is
`apps/web/src`; `packages/ui` is measured but exempt (see D3). [Root PLAN.md](../PLAN.md) owns
execution order.

## Decisions

Stated once, referenced by number below. The implementer does not re-decide at a call site. A site
the table does not cover is a gap in the table, and the fix is to extend the table in the same pass.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner after this plan                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| D1  | **Truncate and recover.** Any element carrying `truncate` or `line-clamp-N` whose content is a value the app did not author must expose the complete value through a native `title` on the element that spans the whole row — the row container, or, where the truncating text is its own full-width block, that block. Never on a `shrink-0` span sitting inside a wider row.                                                                                                      | `CLAUDE.md`; the census measure       |
| D2  | **A title adds, it does not echo.** Where the row knows more than it can show — the full path behind a basename, the file and line behind a code excerpt, why a tab is read-only — the title says that. A title that is character-for-character the visible text is allowed only when the row has nothing to add.                                                                                                                                                                   | each call site; reviewed in Phase 6   |
| D3  | **Static app-authored labels are exempt**, and so is `packages/ui`. "Chat", "References", "External", "New session", a column header: these cannot be cut in any real layout, and a primitive cannot know whether the string it renders is a label or a value. Every exemption is an allow-list entry with a reason, not a silence.                                                                                                                                                 | `scripts/lint/web-design-allow.json`  |
| D4  | **`title` and `Tooltip` split by job.** The `Tooltip` primitive is for icon-only controls and for rich explanations that need styling and a delay. Native `title` is for recovering truncated text, where a portalled popup inside a virtualized list is the wrong machinery. Do not convert truncation sites to `Tooltip`. No control carries both. A control that already earns a `Tooltip` for an explanation may name its value there too; that is the one direction this runs. | `CLAUDE.md`                           |
| D5  | **No middle truncation.** The app has no middle-truncating formatter and gets none. A row that must show a path renders the basename first and the directory second, muted, so a right cut eats the directory and leaves the name. `features/git/components/file-row.tsx` (`fileRowLabel`) is the reference.                                                                                                                                                                        | `apps/web/src/lib/path-formatters.ts` |
| D6  | **Palette rows take `title` on `CommandItem`.** `RowLabel` renders a fragment so it drops into `CommandItem`'s flex row; a wrapper inside it would either fight that layout or, as `display:contents`, generate no box for the browser to hover. `CommandItem` spreads to the row `div`, so the title lands on the real row container in the same file the row is written in.                                                                                                       | each palette row file                 |
| D7  | **`…` is the ellipsis.** `CLAUDE.md` already says so. The one violation is `SEARCH_ELLIPSIS` in `features/search/utils/match-display.ts`; it moves, and every search preview window widens by up to four characters as a result. That widening is accepted, not worked around.                                                                                                                                                                                                      | `match-display.ts`                    |

**D5 and D7 need the user's confirmation before Phase 1 or Phase 3 starts.** Both change what the
user reads rather than only adding a hover.

- D7 moves where every doubly-truncated search preview cuts. Worked through by hand below: exactly
  one existing assertion changes.
- D5 changes two rows from "one long path, right-cut" to "name, then directory". The diagnostics
  panel currently reads `/Users/…/platform/apps/web/src/features/editor/comp` and would read
  `editor.tsx` followed by the muted directory. That is the point, but it is a visible change to a
  pane the user reads constantly.

Every other decision only adds a hover or deletes duplicated markup.

## The best version, promoted

`features/workbench/components/editor-tab-button.tsx` is the only truncation in the app that does
all three things. The row container — the `<button>` itself — carries the title, enriched rather
than echoed:

```tsx
title={
  unavailable
    ? `${tab.title} (read only; ${unavailable.label ?? unavailable.name} is unreachable)`
    : tab.title
}
```

The visible label truncates inside it (`editorTabTitle`). And it decides on purpose which of two
competing strings yields characters first, with the reasoning in the file:

```
// Yields space before the filename does: a tab is 144px wide and
// `(b25d374 *M)` alone nearly fills it, so a `shrink-0` suffix
// truncated the name away entirely.
```

`tab.title` comes from `tabTitle()` in `lib/documents/utils/labels.ts`, which is already the app's
canonical "complete value for this document" helper. Prefer it over recomposing a path by hand.

The second exemplar is `features/chat/components/assistant-changed-files-tree.tsx`: both branches
of `renderFileNode` put `title={node.path}` on the row element, not on the truncating span.

## Reconcile the baseline

Platform base `31919382`, working tree dirty with 82 files. The tree moved under the survey that
produced this plan: `tool-pane.tsx`'s turn-diff row was rewritten from `<Button>` to a raw
`<button>` mid-survey, its class string changed, and its line moved 197 → 198. **Every line number
below is a hint; the symbol name is the anchor.** Re-run the census and re-derive the references
before starting, and capture HEAD plus the full dirty diff so this work does not fold into whatever
else is in flight.

Plan 100 is partly landed: `PaneBar`, `--bar-height`, `text-2xs`, `bg-row-hover` and
`scripts/lint/web-design-census.mjs` are all live, and `design:census` runs inside root `verify`.
That is why this plan extends that script instead of adding a second one. The two plans' file lists
overlap in `highlight.tsx`, `file-group.tsx`, `match-row.tsx`, `file-picker/list.tsx`,
`app-titlebar.tsx`, `stage-header.tsx`, `language-server-references-pane.tsx` and
`assistant-changed-files-tree.tsx`. Do not run both in the same working tree at the same time.

### Count the same way every time

From the repository root. Test files excluded throughout.

```
grep -rhoE '\btruncate\b|\bline-clamp-[0-9]+\b' apps/web/src --include=*.tsx --exclude-dir=tests | wc -l
grep -rlE  '\btruncate\b|\bline-clamp-[0-9]+\b' apps/web/src --include=*.tsx --exclude-dir=tests | wc -l
comm -23 <(grep -rlE '\btruncate\b|\bline-clamp-[0-9]+\b' apps/web/src --include=*.tsx --exclude-dir=tests | sort) \
         <(grep -rl  '\btitle='                            apps/web/src --include=*.tsx --exclude-dir=tests | sort) | wc -l
grep -rhoE '\btitle='       apps/web/src --include=*.tsx --exclude-dir=tests | wc -l
grep -rhoE 'text-ellipsis'  apps/web/src --include=*.tsx --exclude-dir=tests | wc -l
grep -rnE  "'[^']*\.\.\.'|\"[^\"]*\.\.\.\"" apps/web/src packages/ui/src --include=*.ts --include=*.tsx --exclude-dir=tests
grep -rhoE '<TooltipTrigger' apps/web/src --include=*.tsx --exclude-dir=tests | wc -l
node scripts/lint/web-design-census.mjs            # after Phase 0
```

### Baseline census

| Measure                                                               | Baseline                                                       | Target                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------- |
| Truncating elements in `apps/web`                                     | 147 in 85 files (146 `truncate`, 1 `line-clamp-3`)             | 147 — this plan removes none            |
| Files with a truncating element and no `title=` anywhere (grep)       | 48 files, 78 elements                                          | 0 files that render an unauthored value |
| Truncating elements with no `title` on any in-file JSX ancestor (AST) | 118 in 66 files                                                | 0 outside the allow-list                |
| `title` on the truncating element rather than its row                 | 11                                                             | 2 (both deliberate, below)              |
| `title=` attributes in `apps/web`                                     | 125                                                            | rises; never falls                      |
| `text-ellipsis` longhand                                              | 6, all in `features/search/components/highlight.tsx`           | 0                                       |
| Literal `'...'` in source strings                                     | 1 (`SEARCH_ELLIPSIS`); a second grep hit is prose in a comment | 0                                       |
| `<TooltipTrigger>` sites                                              | 12 across 14 files                                             | 12; none added for truncation           |
| Controls carrying both `title` and a `Tooltip`                        | 3                                                              | 0                                       |
| Exact copies of `RowLabel`'s markup                                   | 3 files (6 spans), plus 1 partial                              | 0                                       |
| `RowLabel` consumers                                                  | 6                                                              | 10                                      |
| Truncation in `packages/ui`                                           | 1 (`select.tsx`, `*:data-[slot=select-value]:line-clamp-1`)    | 1, exempt under D3                      |

The two deliberate `title`-on-the-truncating-element sites, which must survive Phase 6 review:
`features/chat/components/chat-runtime-status.tsx` (`AlertDescription`, `line-clamp-3` + `title` —
the clamped block is its own full-width row, so it is the row container; do **not** flatten it to
`truncate`), and the diff-suffix span in `editor-tab-button.tsx`, whose `title` carries the diff
status, a different fact from the row title above it.

### How sharp the measure can get

"Truncating elements whose row has no title" is the number worth having, and it is only partly
scriptable.

- The grep measure (48 files / 78 elements) is exact and a hard **lower bound**. A file with no
  `title=` at all certainly has unrecovered truncation.
- The AST measure (118 elements) is an **upper bound**. It over-reports in two ways: it cannot see a
  row container rendered by a different component (`RowLabel` inside `CommandItem`; `editorTabTitle`
  inside `EditorTabButton` — both are correct and both are counted), and it cannot tell an
  app-authored label from a value.
- Nothing distinguishes "Chat" from `session.title`. That classification is human judgement, once
  per site. Phase 6 is where it is made, and the allow-list is where it is recorded so it is made
  only once.

Report both numbers. A plan that claims one exact figure here is guessing.

## Phase 0 — teach the census to see this

File: `scripts/lint/web-design-census.mjs`, `scripts/lint/web-design-census.test.ts`.

The script already walks the JSX AST with an `ancestors` stack (`walk`, `collect`, `nearestElement`)
and already has the allow-list plumbing this needs. Add one measure, `truncationRecovery`:

1. In `collect`, when pushing a `JSXOpeningElement`, also record whether its `attributes` contain a
   `JSXAttribute` named `title`, and record the keys of the enclosing `JSXOpeningElement` ancestors
   alongside the existing `elementKey`.
2. Add a `TARGETS.truncationRecovery` entry: a hit is a class string containing `truncate` or
   `line-clamp-<digits>` whose own element and whose recorded ancestors all lack `title`.
   `listed: true`, `allowListed: true`, `skipUnder: [UI_PACKAGE]` (D3).
3. Start it `histogramOnly: true`. Flip to `limit: 0` in Phase 6, not before — `design:census`
   already gates root `verify`, and a gating measure landed early blocks everyone.
4. Extend `web-design-census.test.ts` with fixtures for the four shapes: title on the element, title
   on an ancestor, title on neither, and an allow-listed exemption.

Gate: `bun --bun vitest run scripts/lint/web-design-census.test.ts --environment node` from the
repository root, and `node scripts/lint/web-design-census.mjs` reports 118 for the new measure
against the untouched tree. If it does not report 118, the walk is wrong — fix the script, not the
number.

## Phase 1 — the two text defects

Cheapest, highest-volume, and independent of everything else.

**`features/search/utils/match-display.ts`.** `SEARCH_ELLIPSIS = '...'` becomes `'…'`. This feeds
every windowed search result in the app. The survey warned that the surrounding length arithmetic
would need fixing; it does not — `normalizedDisplayLength`, `searchWindowLength` and
`searchRangeDisplay` all read `SEARCH_ELLIPSIS.length` or `prefix.length`, so they follow the
constant. What does change is where the cut falls: a preview with both a prefix and a suffix gains
four characters of window. Worked through against the existing fixtures in
`features/search/tests/search-match-row.test.ts`:

| Case                               | Today                    | After                    |
| ---------------------------------- | ------------------------ | ------------------------ |
| default length (96), both ellipses | `{ start: 27, end: 33 }` | `{ start: 25, end: 31 }` |
| `maxLength: 20`, both ellipses     | `{ start: 5, end: 11 }`  | unchanged                |
| name match, prefix only            | `start < 40` holds       | unchanged                |

Update that one expectation in the same commit. Do not add a compensating constant to hold the old
cut — the window is defined in characters and `…` is one character.

**`features/search/components/highlight.tsx`.** Six occurrences of
`overflow-hidden text-ellipsis whitespace-nowrap` — three on the outer `<span>`s in
`HighlightedPreview`, three on the `<mark>`s — become `truncate`. Same three declarations, one
class. These are the only `text-ellipsis` uses in the repository, against 147 `truncate`.

Gate: `cd apps/web && bun --bun vitest run --project node src/features/search/tests/search-match-row.test.ts`
and `--project dom src/features/search/tests/row-states.test.tsx`. `text-ellipsis` count is 0.
Literal `'...'` in source strings is 0.

## Phase 2 — write the rule down

File: `CLAUDE.md`.

Add a section **Truncation And Recovery** immediately after **Loading And Empty States** — the two
are the same kind of rule, about not leaving the user unable to tell what they are looking at.
Condense D1 through D5 into it, including the `title` / `Tooltip` split, which the app has followed
and never recorded. Eleven of the 12 `TooltipTrigger` sites are icon-only controls or styled
explanations — `model-picker-row.tsx` uses `max-w-64 leading-snug text-balance` for a disabled
reason, `assistant-markdown-link.tsx` uses `wrap-anywhere` for an href. The twelfth,
`model-picker-trigger.tsx`, wraps a truncating model label, and its tooltip reads
`${modelLabel} - ${statusLabel}`. It stays: the control already needed a tooltip for the provider
status, and adding the label to an explanation it was going to show anyway is the allowed direction.
Record it as an allow-list entry, not as a template.

Then delete the three `title` attributes that sit on a control which already has a `Tooltip`, since
the browser shows both: `features/chat/components/chat-input-attachment-list.tsx`,
`features/chat/components/chat-input-submit-button.tsx`,
`features/search/components/toggle-button.tsx`. `aria-label` stays; it is what the tooltip cannot do.

Gate: `bun run --cwd apps/web lint`; the both-title-and-Tooltip count is 0; `<TooltipTrigger>` count
still 12.

## Phase 3 — the raw-path rows, and one path helper

Two rows render a raw full path into a right-truncating span. They are the worst case in the app:
the identifying segment is the first thing cut.

1. `features/chat-mode/components/tool-pane.tsx`, `turnScopeBody` (≈198). `file.path` is
   repo-relative — `features/chat/utils/turn-diff-tree.ts` already splits the same field into a
   tree. The flat list is the inconsistent sibling of
   `assistant-changed-files-tree.tsx`, which renders the same data with `title={node.path}`.
   Apply D5: basename, then muted directory; `title={file.path}` on the row `<button>`.
2. `features/workbench/components/diagnostics-panel.tsx`, `renderDiagnosticsStatus` (≈102).
   `source.filePath` is a full workspace path
   (`editor.tsx`: `languageServerTarget?.matchPath ?? documentSourcePath(currentTarget) ?? ''`).
   Same treatment; `title={source.filePath}` on the block, which is its own full-width row.

Both need the directory half of a path, which lives today in
`features/git/utils/paths.ts` (`parentPath`) with a byte-identical private copy at the bottom of
`features/editor/components/language-server-references-pane.tsx`. Two features, two copies, and a
third and fourth consumer arriving: `CLAUDE.md`'s layering rule says it moves up.

- Add `parentPath` to `apps/web/src/lib/path-formatters.ts`, beside `basename` and under the same
  kind of comment. Delete `features/git/utils/paths.ts` and the private copy in the references pane;
  update `features/git/components/file-row.tsx` and `referencePathLabel`.
- **Do not absorb `features/file-picker/model.ts`'s `parentPath`.** It splits on `filter(Boolean)`
  and rejoins, so `'/a/b'` gives `'a'` where the new one gives `'/a'`, and it drops repeated
  separators. Same name, same `(string) => string` signature, different answer — exactly the trap
  `path-formatters.ts`'s existing comment about the six `basename` variants describes. Say so in the
  new comment and leave the file-picker copy alone.
- Add `apps/web/src/lib/tests/path-formatters.test.ts` covering `parentPath` at the repository root,
  one level deep, with a leading slash, and with no separator, plus one case pinning the divergence
  from the file-picker variant. This is the "test per call site" that `CLAUDE.md` requires before
  merging same-sounding helpers.

Gate: `cd apps/web && bun --bun vitest run --project node src/lib/tests/path-formatters.test.ts`,
`bun run typecheck`, and `bun run unused:check` at the root (it catches the deleted module's
leftovers).

## Phase 4 — the palette rows

`features/command-palette/row-label.tsx` is the shared palette row text. Twelve palette row types
exist; six use it, three hand-roll its markup character-for-character, one hand-rolls its label span
and composes its own description, and two have their own shape.

1. Widen `RowLabel`'s `description` from `string` to `ReactNode`. That single type change is what
   lets the fourth copy migrate; nothing else about the component changes.
2. Migrate onto `RowLabel`, deleting the duplicated span pairs:
   `file-palette-row.tsx`, `editor-palette-row.tsx`, `session-project-palette-row.tsx` (exact
   copies), and `session-palette-row.tsx` (its composite project-and-branch description becomes the
   `ReactNode` description, with its extra classes on `descriptionClassName`).
3. Apply D6 — `title` on `CommandItem`, for the rows that carry an unauthored value only:

   | Row                           | Title                                             |
   | ----------------------------- | ------------------------------------------------- |
   | `file-palette-row`            | the entry's full path                             |
   | `editor-palette-row`          | the tab's `tabTitle()`, not its label             |
   | `session-palette-row`         | project, worktree/branch and machine, spelled out |
   | `session-project-palette-row` | `project.workspaceRoot` and its qualifier         |
   | `symbol-groups`               | container name and symbol kind                    |
   | `color-theme-groups`          | the theme id and source                           |
   | `script-groups`               | the full script command                           |

   Exempt under D3, with allow-list entries: `command-palette-row`, `view-groups`,
   `color-mode-groups`, `components/app-colors-groups`, `goto-line-groups`. All five render strings
   the app wrote.

`CommandItem` spreads to cmdk's `Item`, which spreads the remainder onto its `div`, and its props
type extends `React.HTMLAttributes<HTMLDivElement>` — so `title` is typed and reaches the DOM row.
Verified against `cmdk@1.1.1`.

Gate: `cd apps/web && bun --bun vitest run --project dom src/features/command-palette/tests/` —
`session-groups.test.tsx`, `script-groups.test.tsx`, `color-theme-groups.test.tsx` and
`use-command-palette-files.test.tsx` render these rows. `RowLabel` consumers: 10. Exact copies: 0.

## Phase 5 — the named pane sweep

Nine rows, each one `title` on the row container. Anchors are symbols; lines are hints.

| File                                                        | Row                                                 | Title adds                                                             |
| ----------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `features/search/components/file-group.tsx`                 | `SearchFileGroupHeader`'s outer `div`               | `group.path`                                                           |
| `features/editor/components/…references-pane.tsx`           | the group header `<button>`                         | `group.path`                                                           |
| `features/editor/components/…references-pane.tsx`           | `ReferenceRow`'s `<button>`                         | `${target.path}:${line}` — the excerpt is visible, its location is not |
| `features/chat/components/assistant-changed-files-tree.tsx` | `renderDirectoryNode`'s `<button>` only             | `node.path`                                                            |
| `components/app-titlebar.tsx`                               | the document grid cell                              | the active tab's full title                                            |
| `features/chat-mode/components/stage-header.tsx`            | `<nav aria-label='Session'>`                        | project › worktree › session                                           |
| `features/settings/components/machine-row.tsx`              | the header flex row, and the `<p>` as its own block | machine name and target                                                |
| `features/environments/components/ssh-host-option.tsx`      | the `<Button>`                                      | `target` when it differs from label                                    |
| `features/file-picker/list.tsx`                             | the `role='option'` row `div`                       | `entry.path`                                                           |

Three of these need a note.

- **`assistant-changed-files-tree.tsx` file rows are already correct.** Both branches of
  `renderFileNode` carry `title={node.path}`. Only `renderDirectoryNode` is missing one. The survey
  claimed both; verification says otherwise. Touch the directory row and nothing else.
- **`app-titlebar.tsx` needs a model field.** `titlebarModel` in
  `features/workbench/utils/titlebar-model.ts` returns `documentTitle: tabLabel(activeTab.content)`,
  which is the short label, while `documentTitle()` in `lib/documents/utils/labels.ts` means the
  full path. Two meanings, one name. Rename the model's field to `documentLabel` and add
  `documentTitle: tabTitle(activeTab.content)` beside it, so the model's vocabulary matches the
  helpers' — one file, one consumer.
- **`stage-header.tsx` must not title the rename input.** When `editing` is true the `<nav>` holds a
  `SessionRename` input; omit the title in that branch.

Exempt in these same files, with allow-list entries: the pane header `<span>References</span>`; the
`SortableColumnHeader` label and the kind/modified columns in `file-picker/list.tsx`.

Gate: `node scripts/lint/web-design-census.mjs` — the `truncationRecovery` hit list no longer names
any of the nine. `cd apps/web && bun run typecheck`, and
`bun --bun vitest run --project dom src/features/search/tests/row-states.test.tsx src/features/workbench/components/tests/editor-tab-bar.test.tsx`.

## Phase 6 — the classification sweep

Everything the census still lists. At this baseline that is 118 minus what Phases 4 and 5 removed;
the remainder concentrates in chat, chat-mode, settings rows and the file picker, and is dominated
by session titles, project titles, machine labels, agent and model names, keybinding commands and
file names — values, not labels.

Nothing here is optional and nothing here is a judgement made twice:

1. **Disposition every remaining hit.** Three outcomes only: _fix_ (add the title per D1/D2),
   _exempt_ (allow-list entry with a reason under D3), or _already covered_ (allow-list entry naming
   what owns the recovery — `RowLabel` inside `CommandItem`, `editorTabTitle` inside
   `EditorTabButton`, and the `Tooltip` around `model-picker-trigger.tsx`'s two truncating elements
   are the three known shapes). An exemption without a reason is a defect.
2. **Move the 11 `title`-on-the-truncating-element sites onto their row containers**, except the two
   deliberate ones named in the baseline. `features/git/components/file-row.tsx` is the instructive
   case: it is the D5 reference for the basename split, yet its `title={relativePath}` sits on the
   inner text cell, so hovering the icon or the status letter recovers nothing.
3. **Flip the measure to `limit: 0`** in `TARGETS.truncationRecovery` and confirm root `verify`
   passes with the allow-list.
4. **Independent review.** A reviewer who did not implement Phases 1 to 5 reads
   `git diff <baseline>..HEAD -- apps/web/src scripts/lint` against this decisions table and lists,
   with file and line, every title that echoes its visible text without adding anything (D2) and
   every allow-list reason that does not survive reading. Written list in the PR.
5. **Hover pass.** Using the existing harness in `apps/web/test/env/browser-file-server.ts` — not a
   new server, and not the dev server, which stays running — open the workbench, the command
   palette, the chat-mode stage and the file picker at a narrow width, and hover one row of each
   kind. Anything that truncates and tells you nothing is a missed site.

## Verification boundaries

Narrow checks only. Named by the failure each one catches, per repository policy; no repository-wide
suite, and no bare test count.

| Plausible failure                                            | Narrowest check                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `…` moves the search preview window incorrectly              | `cd apps/web && bun --bun vitest run --project node src/features/search/tests/search-match-row.test.ts` |
| `truncate` does not reproduce the longhand's three rules     | `cd apps/web && bun --bun vitest run --project dom src/features/search/tests/row-states.test.tsx`       |
| `RowLabel` migration changes palette row layout or filtering | `cd apps/web && bun --bun vitest run --project dom src/features/command-palette/tests/`                 |
| New `parentPath` silently diverges from an existing variant  | `cd apps/web && bun --bun vitest run --project node src/lib/tests/path-formatters.test.ts`              |
| Deleted `features/git/utils/paths.ts` leaves dead imports    | `bun run --cwd apps/web typecheck` and `bun run unused:check`                                           |
| The census measure itself is wrong                           | `bun --bun vitest run scripts/lint/web-design-census.test.ts --environment node`                        |
| A row was missed, or an exemption has no reason              | `node scripts/lint/web-design-census.mjs --check` (the Phase 6 gate) plus the written review            |
| A title echoes instead of adding                             | the Phase 6 review; no script can judge this                                                            |

`bun run design:census` covers the last two once the measure gates. Editor tab behaviour is covered
by `src/features/workbench/components/tests/editor-tab-bar.test.tsx`, which already exists.

## What this plan does not do

- **Search result previews stay without a title.** `features/search/components/match-row.tsx`
  truncates a code excerpt whose complete value is an entire source line, sometimes thousands of
  characters. A native tooltip is the wrong container for that, and the row's own purpose is to open
  the file. Recorded as an exemption, not an oversight.
- **No middle-truncating path formatter, no `direction: rtl` trick, no hover card.** D5 settles this.
- **No `Tooltip` conversions.** D4 settles this.
- **`packages/ui` is not changed.** Its one truncation, `select.tsx`'s
  `*:data-[slot=select-value]:line-clamp-1`, belongs to a primitive that cannot know what it renders;
  the consumer sets the title on the trigger.
- **`parentPath` and `basename` consolidation beyond the one move in Phase 3 belongs to
  [Plan 092](092-path-and-uri-helpers.md).** Five `parentPath`-shaped helpers exist with three
  different behaviours. This plan moves the two that are byte-identical and names the one that is
  not; it does not open the rest.
- **Radius, spacing, density, colour and elevation belong to
  [Plan 100](100-web-design-language.md).** Several files here are on both lists. Sequence, do not
  interleave.
- **Accessible naming is not in scope.** `title` is a recovery affordance, not a label;
  `aria-label` and `aria-labelledby` stay exactly as they are.
