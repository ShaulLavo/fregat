# Finish the loading, empty and error states

Status: proposed, implementation not started. Requested 2026-09-12.

`CLAUDE.md` already decided this area. It names five loaders, assigns each one a job, bans
hand-rolling a sixth, and states the failure mode in one line:

> A loading state and an empty state must never look alike. "Loading X" and "No X" set in the same
> type is a bug — the user cannot tell a slow panel from an empty one. Pending gets a loader;
> `EmptyState` is only for a verdict the app can actually deliver.
>
> Check the fall-through. A list that only branches on `error` and `length === 0` will show
> "Nothing here" while it is still fetching. Branch on pending **before** empty.

Most of the app obeys this. The adoption is unfinished in seven specific ways, and one of them is a
live user-facing bug: the command palette tells you a project has no scripts, and Quick Open tells
you no files match, while the fetch that would answer is still in flight.

This plan does not re-open the loader taxonomy, does not touch motion, colour or the corner/bar/
density decisions (those are [Plan 100](100-web-design-language.md)), and does not add a sixth
primitive. It finishes adopting decisions that already exist, in `apps/web` and `packages/ui`.
The TUI renders its own loaders in `apps/tui` and is out of scope. [Root PLAN.md](../PLAN.md) owns
execution order.

## Decisions

Stated once, referenced by number below. The implementer does not re-decide at a call site. A call
site that needs something the table does not cover is a missing variant, and the fix is to add the
variant in the same pass.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                        | Owner after this plan                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| D1  | **A skeleton mirrors.** A skeleton mounts the same primitive and the same density variables as the loaded view, and draws one placeholder per real element — icon square, label bar, trailing detail — never N anonymous full-width bars. The reference is `features/git/components/panel-loading.tsx` with `features/workspace/components/tree-loading.tsx`.                   | Each feature's `*-loading.tsx`                                                 |
| D2  | **One placeholder fill.** Every placeholder rectangle is `skeleton-sweep`. Tone survives only on the border or rule that _frames_ a placeholder, never on the fill — a loading state must not assert a value's tone before the value is known.                                                                                                                                  | `skeleton-sweep` in `packages/ui/src/styles/globals.css`                       |
| D3  | **Pending travels as data, and is branched first.** A hook that owns a query returns the query object (or an explicit `isPending`), never `data` alone. Every list branches pending → error → empty → content, in that order. Inside `cmdk`, pending renders as a disabled `CommandItem` holding a skeleton, because an empty group lets `CommandEmpty` win.                    | Each feature hook; `features/command-palette/symbol-groups.tsx` is the pattern |
| D4  | **A wait with nothing to mirror is a loader, not a skeleton.** When the wait blocks a whole pane or the whole viewport and no content shape exists to stand in for, it is a centred `RingLoader` with a visible label, per `CLAUDE.md`: "`RingLoader` … the one to scale up for a whole-surface wait." The reference is `features/environments/components/connection-gate.tsx`. | Each boot/gate component                                                       |
| D5  | **`LoadingState` never wraps a loader.** `LoadingState` is the skeleton shell: a `role="status"` region plus a 120ms delay. Putting `OrbitLoader`/`RingLoader`/`Spinner` inside it nests two `role="status"` regions announcing the same label and runs the mark through a delay meant for placeholder bars.                                                                    | `packages/ui/src/components/loading-state.tsx` doc comment                     |
| D6  | **`Alert` owns the tinted notice.** `Alert` gains `warning`, `info` and `success` variants, and `destructive` is aligned to the formula the call sites already use: `border-<tone>/30 bg-<tone>/10 text-<tone>`. Notice boxes compose it. Full-bleed banners stay banners and take `StaleNotice`'s shape: tone-matched border, icon, role.                                      | `packages/ui/src/components/alert.tsx`                                         |
| D7  | **Every error offers a way out or says why it cannot.** A panel error renders through `EmptyState tone='error'` and carries an `action` whenever a retry handle already exists. Where none exists, the call site carries a one-line comment naming what the user should do instead.                                                                                             | Each error branch                                                              |

**D4 and D6 need the user's confirmation before their phases land.** Both change what the product
looks like rather than removing noise.

- **D4** changes the first thing a user sees. Today boot, chat connect and navigation each draw a
  small grey bar; under D4 they draw a centred ring and a sentence. `components/navigation-status.tsx`
  is the sharp case: it currently renders a 4px × 128px sliver in the strip under the titlebar,
  which reads as a stalled progress bar. The alternative reading is that it was _deliberately_ almost
  invisible, to avoid flashing chrome on a fast navigation. Confirm which: a centred ring, or nothing
  at all until the navigation exceeds a threshold.
- **D6** changes the look of roughly a dozen notice boxes at once (radius, padding, icon grid, and
  the `destructive` variant's fill). The alternative is to leave `Alert` alone and let notices stay
  hand-rolled. Confirm before Phase 5; Phases 1–4 and 6 do not depend on it.

## Reconcile the baseline

Platform base `31919382`. The working tree is dirty at that base across `apps/server`, `apps/web` and
`packages/ui`. **Other agents are editing these same files.** Three findings this plan started from
were already fixed while the survey ran (see _Dropped findings_ below), so the standing rule applies
harder than usual: capture HEAD and the full dirty diff, **re-run every census command below and
re-derive every line reference before touching anything**. Cite the symbol, not the line — the
symbol names in this plan were read at this base and are the durable anchor.

### Count the same way every time

Run from `apps/web/src`, test files excluded. These are the completion gate.

```
# C1 — hand-rolled loaders. Banned outright by CLAUDE.md.
grep -rn 'animate-spin\|animate-pulse' --include=*.tsx . | grep -v /tests/

# C2 — placeholder fills that are not the sweep token, inside a LoadingState file.
for f in $(grep -rln "components/loading-state" --include=*.tsx . | grep -v /tests/ | sort); do
  grep -n "<div className='" "$f" | grep -v 'skeleton-sweep' | grep -E "\bbg-[a-z-]+(/[0-9]+)?" | sed "s|^|  $f:|"
done

# C3 — skeletons with no icon-square placeholder. A finder, not a defect count:
# some loaded views genuinely have no icon. Phase 3 names which of these are real.
for f in $(grep -rln "components/loading-state" --include=*.tsx . | grep -v /tests/ | sort); do
  grep -q "skeleton-sweep[^']*\bsize-" "$f" || echo "  $f"
done

# C4 — the defect signature for D3: a query destructured to `data` alone throws
# isPending away at the hook boundary, so no consumer can branch on it.
grep -rnE "const \{ *data(:[^}]*)? *\} *= *useQuery" --include=*.tsx --include=*.ts . | grep -v /tests/

# C5 — the surface where the empty-before-pending defect lives.
grep -rln 'length === 0' --include=*.tsx . | grep -v /tests/ | wc -l

# C6 — a loader nested inside the skeleton shell (D5).
grep -rn -A3 '<LoadingState' --include=*.tsx . | grep -v /tests/ | grep -E '<(OrbitLoader|RingLoader|Spinner)'

# C7 — Alert adoption and the tinted-notice formula it is losing to.
grep -rln "components/alert'" --include=*.tsx . | grep -v /tests/ | wc -l
grep -rnE "border-(destructive|warning|info|success)/[0-9]+" --include=*.tsx . | grep -v /tests/ \
  | grep -E "bg-(destructive|warning|info|success)/[0-9]+"
grep -rhoE "border-(destructive|warning|info|success)/[0-9]+" --include=*.tsx . | grep -oE '/[0-9]+' | sort | uniq -c
grep -rhoE "bg-(destructive|warning|info|success)/[0-9]+"     --include=*.tsx . | grep -oE '/[0-9]+' | sort | uniq -c

# C8 — error states, and which of them offer an action.
grep -rn "tone='error'" --include=*.tsx . | grep -v /tests/
grep -rl "tone='error'" --include=*.tsx . | grep -v /tests/ | xargs grep -c 'action=' | grep -v ':0'
```

C5 is the blunt one: 51 files is the _search space_, not the defect list. C4 is the sharp one — it
finds the same class mechanically, in four hits, because a component cannot branch on a pending
state its hook never handed it. Prefer C4; use C5 only to audit what C4 missed.

### Baseline census

| Measure                                               | Baseline at `31919382`                                                                                         | Target                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| C1 `animate-spin` / `animate-pulse` in `apps/web/src` | 0                                                                                                              | 0 (regression guard)                            |
| C2 non-sweep placeholder fills inside loaders         | 9 (3 files)                                                                                                    | 0                                               |
| C3 skeletons with no icon-square placeholder          | 20 files; 7 are real defects (Phase 3 names them)                                                              | 13 (the 7 fixed)                                |
| C4 queries destructured to `data` alone               | 4; 3 render an empty verdict from the result                                                                   | 0 that render a verdict                         |
| C5 files branching on `length === 0`                  | 51                                                                                                             | unchanged; C4 is the gate                       |
| C6 loaders nested inside `LoadingState`               | 3                                                                                                              | 0                                               |
| C7 files importing `Alert`                            | 1                                                                                                              | ≥ 13                                            |
| C7 lines on the `border-<tone>/N bg-<tone>/N` formula | 25 — 12 notice boxes, 2 full-bleed banners, 1 `Alert` className patch, 2 interactive cards, 8 chips/tiles/bars | 12 boxes and the patch gone; the rest unchanged |
| C7 distinct border alphas / bg alphas                 | border `/20 /25 /30 /40 /70`; bg `/10 /20 /30 /45`                                                             | notices on `/30` + `/10`; others untouched      |
| C8 `EmptyState tone='error'` sites                    | 12 across 12 files                                                                                             | unchanged                                       |
| C8 error sites carrying an `action`                   | 4 of 11 panel errors                                                                                           | every site with a retry handle, or a comment    |
| Ellipsis written `...` in user-visible strings        | 0                                                                                                              | 0 (regression guard)                            |

### Dropped findings

The survey that produced this plan named three things that no longer hold. They are recorded here so
nobody re-files them:

- **Flat `bg-muted` placeholder bars in `features/logs/components/event-list.tsx`,
  `features/editor/components/compare-saved-view.tsx` and
  `features/editor/components/workspace-edit-preview-dialog.tsx`.** All three now use
  `skeleton-sweep`. Their skeletons are still wrong — three anonymous bars each — but that is D1, not
  D2, and they are handled in Phase 3.
- **`lib/code-theme/components/preview.tsx` drawing five flat `bg-muted-foreground/10` lines.** Fixed
  by another agent mid-survey; it is `skeleton-sweep` now.
- **`animate-spin` on a borrowed `ArrowsClockwiseIcon` in `features/git/components/commit-controls.tsx`.**
  Also fixed mid-survey; it is a `Spinner` now. C1 is 0 and stays a guard.

## Phase 1 — one placeholder fill (D2)

Cheapest, no decisions, three files. Every placeholder rectangle inside a `LoadingState` becomes
`skeleton-sweep`. The framing border keeps its tone; the fill does not.

- `features/workbench/components/diagnostics-loading.tsx`, `DiagnosticsLoading`: three tile value
  bars are `bg-destructive/20`, `bg-warning/20`, `bg-info/20`. The tiles' `border-destructive/25`,
  `border-warning/25`, `border-info/25` and the row rules' `border-l-destructive` / `-warning` /
  `-info` stay — those frame the placeholder and exist at that tone whatever the count turns out to
  be. The fills become `skeleton-sweep`.
- `features/chat-mode/components/checkpoint-loading.tsx`, `CheckpointLoading`: six
  `bg-diff-added/20` / `bg-diff-removed/20` count chips become `skeleton-sweep`. An unloaded
  checkpoint has not yet said whether anything was added or removed.
- Anything else C2 reports after the re-run.

Gate: C2 is 0. `apps/web` typecheck.

## Phase 2 — branch on pending before empty (D3)

The user-facing bug, and the reason this plan exists. Three components render an empty verdict over a
fetch in flight.

**The pattern to copy** is `features/command-palette/symbol-groups.tsx`, `SymbolGroups`, which
already carries the reason in a comment:

```
if (isPending) {
  // Still a CommandItem: an empty group would let cmdk's CommandEmpty render
  // "No symbols" over a list that is merely still fetching.
  return (
    <CommandGroup heading='Symbols'>
      <CommandItem disabled value='symbols:loading'>
        <SymbolsLoading />
      </CommandItem>
    </CommandGroup>
  )
}
```

`features/search/components/pending-or-empty.tsx`, `SearchPendingOrEmpty`, is the same decision
outside `cmdk`: `status === 'loading'` returns `SearchResultsLoading` before either empty branch is
reached. `features/settings/components/import-section.tsx` is the third: `sources.isPending` renders
first, and the empty branch is guarded `sources.isSuccess && sources.data.length === 0`.

### 2a. Scripts mode — "No scripts in this project."

- `features/command-palette/use-command-palette-scripts.ts`, `useCommandPaletteScripts`, destructures
  `const { data: discovered } = useQuery({…})` and returns a bare array. Return `{ isPending, scripts }`
  instead — `isPending` must be false when the query is disabled, so the saved-scripts-only case is
  not held behind a loader that will never resolve. The query is `enabled: enabled && rootPath !== null`.
- `features/command-palette/content.tsx`, `CommandPaletteContent`, passes `scriptItems={scriptItems}`
  to `CommandPaletteGroupsFactory`. Add `scriptsPending`, alongside the `symbolsPending` prop it
  already passes two lines later.
- `features/command-palette/command-palette-groups-factory.tsx`: thread the prop to `ScriptGroups`.
- `features/command-palette/script-groups.tsx`, `ScriptGroups`: branch `isPending` before
  `scripts.length === 0`, rendering a disabled `CommandItem` with a skeleton. The existing
  `features/chat/components/command-menu-loading.tsx` is the right shape for a `cmdk` row — icon
  square, label bar, trailing detail — and already takes a `label`.
- `features/command-palette/tests/script-groups.test.tsx` asserts today that an empty list produces
  "No scripts in this project." Per `CLAUDE.md` ("Delete obsolete tests instead of preserving old
  behavior"), that test becomes: the verdict renders only when `isPending` is false, and a pending
  list renders the skeleton row instead.

### 2b. Quick Open — "No matching files" on every keystroke

- `features/command-palette/use-command-palette-files.ts`, `useCommandPaletteFiles`, already returns
  the whole `fileSearchQuery`, so nothing changes in the hook. The loss is at the call site:
  `content.tsx` passes `fileSearchError={fileSearchQuery.isError}` and never passes the pending flag.
- Add `fileSearchPending`, true only when `fileSearchEnabled` and the query is pending — a base tree
  listing with no query typed is not pending, and must keep rendering instantly.
- `features/command-palette/quick-open-groups.tsx`, `QuickOpenGroups`, gains the branch. It already
  renders a disabled `CommandItem` for `searchError`; pending takes the same slot with a skeleton
  instead of a message.
- Evidence that the flash window is real is already in the repo:
  `features/command-palette/tests/use-command-palette-files.test.tsx` asserts
  `filePaths(result.current.visibleFileItems)` is `[]` immediately after the query changes and before
  the next result lands. That empty array is what `CommandEmpty` renders over.

### 2c. Settings — "No providers are available." / "No models are available yet."

Same defect, same signature, different surface. Both files destructure
`const { data } = useQuery(providerListQueryOptions(), useSettingsOwner())` and then render an
`EmptyRow` from a length check:

- `features/settings/components/provider-section.tsx`, `ProviderSection` → "No providers are available."
- `features/settings/components/model-section.tsx`, `ModelSection` → "No models are available yet."

Both take the query object, branch `isPending` first, and render a `LoadingState` whose skeleton
mirrors one `ProviderRow` / `ModelRow` respectively (D1). `EmptyRow` itself is a bare `<p>`; leave it
alone in this plan — it is a settings-row idiom, not a panel verdict, and changing it is Phase 6's
call if at all.

`features/chat/hooks/use-provider-display.ts` is the fourth C4 hit and is **not** a defect: it
renders no verdict, and falls back to a cached display list when `data` is absent. Leave it.

Gate: C4 reports no hit that renders a verdict. A dom test in
`features/command-palette/tests/script-groups.test.tsx` and one in
`features/settings/tests/` assert that a pending list renders a busy region and **does not** render
the empty string. The narrowest check that catches a regression here is asserting the _absence_ of
the verdict text while pending, not the presence of the skeleton.

## Phase 3 — skeletons that mirror their content (D1)

Seven skeletons draw N anonymous bars where the loaded view is a list of shaped rows. For each, the
file that shows the right answer is one directory away.

| Skeleton                                                                | Draws today               | Must mirror                                                                                                               | Copy the shape from                                   |
| ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `components/workspace-project-menu.tsx` (inline)                        | one `h-4 w-full` bar      | `DropdownMenuRadioItem`: title + muted qualifier, at menu-item height                                                     | `features/file-picker/navigation/recents-loading.tsx` |
| `features/environments/components/ssh-host-list.tsx` (inline)           | two `h-7` slabs           | `SshHostOption`: terminal icon, mono label, optional sub-label, trailing check                                            | `features/file-picker/components/list-loading.tsx`    |
| `features/environments/components/tailnet-host-list.tsx` (inline)       | two `h-7` slabs           | same `SshHostOption`, plus the "Offline" trailing slot                                                                    | same                                                  |
| `features/settings/components/import-section.tsx` (inline)              | two `h-8` slabs           | `ImportSourceRow`                                                                                                         | `features/chat/components/models-loading.tsx`         |
| `features/logs/components/event-list.tsx` (inline)                      | three `h-4` bars at `p-6` | `LogsEventRow`: `grid-cols-[64px_minmax(0,1fr)_auto]`, level dot + mono time, two-line label, trailing duration + chevron | `features/git/components/panel-loading.tsx`           |
| `features/editor/components/compare-saved-view.tsx` (inline)            | three `h-4` bars          | `DiffEditor`: a gutter column and code lines                                                                              | `features/settings/components/json-loading.tsx`       |
| `features/editor/components/workspace-edit-preview-dialog.tsx` (inline) | three bars at 10/16/12px  | the `preview.rows` card: icon, operation label, trailing target, mono path line                                           | `features/git/components/panel-loading.tsx`           |

Two rules while doing this:

1. **Extract, do not inline.** Each of these is an inline `LoadingState` inside a component that also
   renders the loaded view. A skeleton that mirrors a row is long enough to be its own file, and
   `CLAUDE.md` wants pure render components in `components/`. Follow the naming the repo already uses
   (`*-loading.tsx`, in the same feature folder, no folder name repeated in the file name). The three
   host/menu/import cases may share one file _only if_ they render the same row; they do not, so they
   do not.
2. **Use the real variables.** Row height is `h-(--density-row-height)` or
   `h-(--density-control-height-sm)`, padding is `px-(--density-row-padding-x)`, and a header is
   `PaneBar` — as `panel-loading.tsx` and `tree-loading.tsx` already do. A skeleton with hand-written
   heights will drift from the row it stands in for the moment density changes.

Gate: C3 drops by 7. For each converted pane, a manual before/after at both densities confirming the
first row does not move when data arrives — this is the same parity check Plan 100 Phase 7 step 5
runs, and if that plan has landed, record the evidence there rather than twice.

## Phase 4 — a wait with nothing to mirror is a loader (D4, D5)

Two shapes of the same mistake: using the skeleton shell where a loader belongs.

### 4a. Whole-surface waits drawn as a bar (D4)

The reference is `features/environments/components/connection-gate.tsx`, `ConnectionGate`:

```
<div role='status' className='bg-background text-foreground grid min-h-svh place-content-center gap-3'>
  <RingLoader className='mx-auto size-8' />
  <p className='text-sm'>Connecting to server…</p>
</div>
```

`features/terminal/components/panel.tsx` is the pane-scoped sibling: a centred
`RingLoader label='Opening terminal'` absolutely positioned over the surface it blocks.

Convert, subject to the D4 confirmation above:

- `components/application-bootstrap.tsx`, `ApplicationBootstrap` — `LoadingState label='Connecting to
local machine'` wrapping one `skeleton-sweep h-4 w-48`. Whole viewport; there is no content shape
  to mirror because the application has not been built yet.
- `features/chat/providers/transport-provider.tsx`, `ChatTransportProvider` — `LoadingState
label='Connecting chat'` wrapping one `skeleton-sweep h-4 w-48`. Whole chat surface, same reason.
- `components/navigation-status.tsx`, `NavigationStatus` — `skeleton-sweep h-1 w-32`, a 4px sliver in
  the strip between `AppTitlebar` and `main` in `components/app-shell.tsx`. **This is the one to
  confirm first** (see D4). Its sibling branch, `status === 'unavailable'`, is a bare
  `<div role='alert' className='bg-background text-destructive p-3'>` — under D6 that becomes an
  `Alert variant='destructive'`, and under D7 the pair should be decided together.
- `components/app-workspace.tsx`, `AppWorkspace` — `LoadingState label='Restoring workspace'` with two
  bars at `p-6`. Judgement call, and the plan makes it: this one **stays a skeleton** but becomes a
  mirroring one, because the thing being restored is a workspace with a known shape — it should draw
  the titlebar/sidebar/editor frame, not a ring. If that turns out to need more structure than one
  file, it moves to Phase 3's table instead and this bullet is deleted.

`components/application-bootstrap.tsx`'s error branch is a bare `<div role='alert'>` holding a
`Button` with no variant. Under D7 it becomes `EmptyState tone='error'` with the retry `action` it
already has; do it in this phase since the file is open.

### 4b. Loaders nested inside `LoadingState` (D5)

`LoadingState` mounts `role="status" aria-busy aria-label={label}` immediately and reveals its
children after `delayMs` (120ms). `OrbitLoader` mounts its own `role="status" aria-label={label}`.
Nesting them announces the same label from two regions and holds the mark — which _is_ the content —
behind a delay written for placeholder bars. Three sites, each passing the label twice:

- `features/chat-mode/components/stage-body.tsx`, `StageBody`, `activeSession.status === 'resolving'`
  → `<LoadingState label='Opening session'><OrbitLoader label='Opening session' /></LoadingState>`
- `features/chat-mode/components/session-rail-empty.tsx`, `SessionRailEmpty`, the `searching || !ready`
  branch
- `features/chat-mode/components/worktree-manager.tsx`, the `!projection?.bootstrapComplete` branch

Each becomes the loader alone in a labelled slot: `OrbitLoader` keeps its `label`, the `LoadingState`
wrapper goes, and the container keeps whatever padding it had. `CLAUDE.md` places `OrbitLoader` as
"a process running with no known end, in a slot beside a label" — so where the label is already
visible text (`worktree-manager`), pass `aria-hidden` and let the text name the wait; where it is not
(`stage-body`), keep `label` on the loader.

Add the rule to the `LoadingState` doc comment in `packages/ui/src/components/loading-state.tsx` so
the next author does not re-derive it.

Gate: C6 is 0. A dom test asserting exactly one `role="status"` in the rendered `StageBody` resolving
branch — that is the narrowest check for this defect, and a snapshot would not catch it.

## Phase 5 — `Alert` owns the tinted notice (D6)

**Confirm D6 before starting.** `packages/ui/src/components/alert.tsx` has exactly one consumer in
the whole repo. Its `destructive` variant is `bg-card text-destructive`, which is not the notice the
app actually draws — so its one consumer,
`features/chat/components/chat-runtime-status.tsx`, patches the real formula back in through a
`runtimeAlertClass` helper at the bottom of the file:

```
function runtimeAlertClass(tone: ChatRuntimeAlertTone) {
  if (tone === 'warning') {
    return 'border-warning/30 bg-warning/10 text-warning'
  }
  return undefined
}
```

That helper is the evidence. Twelve more boxes hand-roll the same three classes with no primitive at
all.

### 5a. The variants

In `alertVariants`, add `warning`, `info` and `success`, and align `destructive`, all on
`border-<tone>/30 bg-<tone>/10 text-<tone>` with `*:data-[slot=alert-description]:text-<tone>/90`
matching the existing `destructive` rule. All four tone tokens and their `@theme inline` mappings
already exist in `packages/ui/src/styles/globals.css` (`--color-destructive`, `--color-info`,
`--color-success`, `--color-warning`); no new token is needed. Keep `default` as `bg-card`.

Delete `runtimeAlertClass` and pass `variant={alert.tone}` instead.

### 5b. The migration

Twelve hand-rolled boxes compose `Alert` / `AlertTitle` / `AlertDescription`, and `AlertAction` where
they already have a trailing control:

`features/chat/components/provider-sign-in-dialog.tsx` (three: success, warning, destructive),
`features/editor/components/workspace-edit-preview-dialog.tsx` (two warnings),
`features/editor/components/workspace-edit-recovery-dialog.tsx` (warning + destructive),
`features/editor/components/unsaved-changes-dialog.tsx` (destructive),
`features/workspace/components/delete-entry-dialog.tsx` (destructive),
`features/settings/components/diagnostics-banner.tsx` (warning),
`features/settings/components/raw-conflict-banner.tsx` (warning),
`features/settings/components/malformed-banner.tsx` (destructive).

Note that `unsaved-changes-dialog` and `delete-entry-dialog` sit on `border-destructive/25` and
`plan-follow-up-banner` on `border-info/25` — the alpha drift C7 measures. The variant settles it at
`/30`; do not preserve the old value.

### 5c. What stays hand-rolled, and why

Say it in the plan so nobody migrates them by momentum:

- **Two full-bleed banners stay banners.** `lib/environments/components/stale-notice.tsx`,
  `StaleNotice`, is already right: tone-matched `border-b`, a `WarningCircleIcon`, `role='status'`,
  and no radius because it spans the pane. `features/logs/components/panel.tsx` draws the same idea
  worse — `bg-destructive/10 text-destructive border-b`, a plain `border-b` that resolves to
  `border-border` rather than the tone, no icon, no role. Give it `border-destructive/30`, a
  `WarningCircleIcon` and `role='alert'`, matching `StaleNotice`'s shape. Do not give either one a
  rounded `Alert`.
- **Two interactive cards keep their own layout.** `features/chat/components/pending-user-input-card.tsx`
  (an agent question with a field and options) and `features/chat/components/plan-follow-up-banner.tsx`
  (a badge, a title and an action button) are surfaces with their own grids, not the `Alert`
  `[auto_1fr]` notice. They keep their markup; only their alphas move onto `/30` + `/10`.
- **Eight tinted non-notices are untouched.** `features/file-picker/entry-ui.tsx` (two `Badge`s),
  `features/logs/components/timeline-bar.tsx` (four chart bars),
  `features/workbench/components/diagnostics-panel.tsx` (three severity tile tints),
  `features/settings/components/dialog.tsx` and `features/settings/components/setting-row.tsx` and
  `components/logging-error-boundary.tsx` (icon squares and a badge). These are not notices and their
  alphas are not the formula.

Gate: C7 files importing `Alert` is ≥ 13; the twelve boxes no longer appear in C7's formula grep;
`runtimeAlertClass` is gone. `packages/ui` typecheck and lint. The dom tests of the dialogs whose
markup changed — `features/editor/tests/workspace-edit-preview-dialog.test.tsx` is the one that
asserts on that surface today.

## Phase 6 — every error offers a way out (D7)

The panel-error idiom itself needs no change: eleven of twelve `tone='error'` sites already render
through `EmptyState`, and `features/git/components/diff-notice.tsx` documents why
("A diff pane must never be a blank rectangle the reader has to interpret"). The gap is the action
slot.

**Already correct — four sites, use them as the template:**
`features/file-picker/list.tsx` (an `onRetry` prop), `features/settings/components/import-section.tsx`
(`sources.refetch()`), `features/environments/components/ssh-host-list.tsx` and
`features/environments/components/tailnet-host-list.tsx` (`query.refetch()`, disabled on
`query.isFetching`, with a `Spinner` while it runs — which is exactly `CLAUDE.md`'s "`Spinner` — a
control mid-action").

**Dead ends — seven sites. Each gets an action or a comment:**

| Site                                                   | Symbol / branch                             | Retry handle                                                               |
| ------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------- |
| `features/git/components/panel.tsx`                    | `status.isError && !status.data`            | `status.refetch()` — verified present; add the action                      |
| `features/workbench/components/diagnostics-panel.tsx`  | `renderDiagnosticsState`, `'error'`         | none found; needs a handle from the LSP status owner or a comment          |
| `features/workspace/components/tree-pane.tsx`          | `state.status === 'error'`                  | `LoadState`, no refetch exposed; thread one or comment                     |
| `features/search/components/results-view.tsx`          | `status === 'error' && groups.length === 0` | re-run the search, if the buffer store exposes it                          |
| `features/search/components/buffer-status-state.tsx`   | `status === 'error'`                        | same handle as above; these two must agree                                 |
| `features/editor/components/compare-saved-view.tsx`    | `fileState.status === 'error'`              | `useSelectedFile`'s reload path, if one exists                             |
| `features/git/components/diff-view.tsx` → `DiffNotice` | `tone='error'`                              | a diff that cannot render is usually not retryable — expect a comment here |

The rule, so this does not become an archaeology project: **add the action where the handle is one
hop away; otherwise add a one-line comment naming what the user should do instead, and stop.**
Threading a new retry path through a store is out of scope for this plan — if a site needs that, note
it and leave it. `components/application-bootstrap.tsx`'s error branch is converted in Phase 4a.

Gate: C8's action count rises, and every remaining dead end carries a comment. Diff review over the
seven files; no test asserts "has a button" usefully.

## Phase 7 — the sweep

1. **Re-run the census.** Every C-number hits its target. C3's 13 survivors are reviewed one by one:
   a skeleton with no icon square is correct only when the loaded row has no icon.
2. **Widen it once.** The census greps for `<div className='…'>` and `<LoadingState`. It will miss
   class strings built with `cn()` across lines, loaders rendered from a `.ts` model file, and any
   skeleton that never imported `LoadingState`. Run once over: every file exporting a component whose
   name ends `Loading`; every `role='status'` and `role='alert'` in `apps/web/src` (checking each is
   a primitive and not a hand-rolled region); and `aria-busy`. Record the numbers in this plan.
3. **The five-loader audit.** For each of the five primitives, list its call sites and confirm each
   one matches the job `CLAUDE.md` assigns it — `LoadingState` a region with no content,
   `OrbitLoader` a process in a slot beside a label, `RingLoader` a quiet or whole-surface wait,
   `Spinner` a control mid-action, `Shimmer` text already on screen inside a running sentence. At this
   baseline that is 17 `OrbitLoader`, 4 `RingLoader`, 25 `Spinner` and 4 `Shimmer` sites in
   `apps/web/src`. A site in the wrong column is a defect fixed before this phase closes.
4. **Loading-versus-empty parity.** For every surface this plan touched, screenshot the pending state
   and the empty state side by side. If they are the same type at the same size, the plan failed at
   its stated purpose regardless of what the census says.
5. **Write it down.** `CLAUDE.md`'s loading section already carries D1's spirit; add D1's one-sentence
   form ("a skeleton mounts the same primitive and the same density variables as the loaded view, and
   draws one placeholder per real element") and D5 ("`LoadingState` never wraps a loader") to it, and
   nothing else — the section is already the longest in the file.

## Verification boundaries

Narrow checks only, per repository policy and `PLAN.md`'s Platform-only boundary. Never a repo-wide
suite, never a bare test count.

| Plausible failure                                                      | Narrowest check that catches it                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Scripts mode still prints the verdict while fetching                   | `features/command-palette/tests/script-groups.test.tsx`, asserting the verdict text is **absent** while pending          |
| Quick Open flashes "No matching files" per keystroke                   | a dom test over `QuickOpenGroups` with `fileSearchPending`, same absence assertion                                       |
| The scripts loader never resolves when the query is disabled           | the same test with `enabled: false` — a pending flag that ignores `enabled` hangs the list forever                       |
| Settings sections print "No providers" during the provider fetch       | a dom test in `features/settings/tests/` driving the real in-process server per `test/fixtures.ts`                       |
| A skeleton header moves when data arrives                              | manual pending/loaded capture per converted pane (Phase 3 gate); `packages/ui` `pane-bar.test.tsx` covers the bar itself |
| Two `role="status"` regions announce the same wait                     | a dom test counting `getAllByRole('status')` in `StageBody`'s resolving branch                                           |
| An `Alert` variant resolves to a raw palette colour or the wrong alpha | `packages/ui` lint + a `alert.test.tsx` asserting the rendered class list per variant                                    |
| A dialog's notice markup regressed                                     | `features/editor/tests/workspace-edit-preview-dialog.test.tsx`                                                           |
| Anything reintroduces a hand-rolled loader or flat placeholder         | C1 and C2, run as part of the phase gate                                                                                 |

App tests run `bun --bun vitest` against the `node` and `dom` projects in `apps/web/vitest.config.ts`;
`packages/ui` runs plain `vitest`. Import `{ test, expect }` from `apps/web/test/fixtures.ts`, not
from `vitest`. No new browser test is needed: nothing here depends on real layout or paint that
happy-dom cannot answer, and the one thing that does — header parity between skeleton and loaded
view — is Plan 100's browser gate, not a second one.

## What this plan does not do

- **Corners, bar heights, density variables, dividers, type steps, elevation.**
  [Plan 100](100-web-design-language.md) owns all six, including the bar-height token that
  `panel-loading.tsx` and `tree-loading.tsx` already consume through `PaneBar`. If both plans are in
  flight, land 100 first: its Phase 2 converts skeleton headers onto `PaneBar`, and redoing that
  under this plan's row-shape edits is wasted work.
- **Motion.** Neither the sweep timing, the loader speeds, nor the 120ms `delayMs` change. Reduced
  motion is already handled inside the primitives and in `globals.css`; `CLAUDE.md` bans
  `motion-reduce:` at the call site and there are none left.
- **`EmptyRow` in settings.** It is a bare `<p>`, not an `EmptyState`. Whether settings rows should
  use the panel primitive is a settings-surface question, not a loading-state one.
- **New retry plumbing.** Phase 6 adds an action where the handle is one hop away and a comment
  where it is not. Threading a refetch through `LoadState` or the search buffer store belongs to
  whichever plan owns those stores.
- **The TUI.** `apps/tui` has its own `OrbitLoader` and `RingLoader` taking a `theme` prop, 14 call
  sites, and a terminal renderer. Nothing here applies to it.
- **`lib/code-theme/components/preview.tsx`'s error branch.** It is a bare `<p role='alert'>` rather
  than an `EmptyState`. It is a 51px-tall theme thumbnail, not a panel; leave it, or fold it into a
  future pass over `lib/`.
