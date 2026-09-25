# Plan 157: Base components — tabs, scroll fades, hold-to-confirm, status dots, typeahead

## Status and authorization

- Status: PROPOSED — ready. The owner approved all five items on 2026-09-25 and queued this plan next.
- Priority: P1 in the UI refresh lane. [Plan 154](154-physical-mode.md) waits on it.
- Effort: M. Three new `packages/ui` pieces, two utilities, one pure-function fix, and call-site
  migrations.
- Risk: LOW. Each item is additive, and its call sites move in the same pass.
- Planned at: Platform `9c1c45d1`, 2026-09-25. Research:
  [neon-ui.md](../docs/ui-research/neon-ui.md) items 1, 2, 3 and 6, and
  [extend-ui.md](../docs/ui-research/extend-ui.md) for the typeahead fix.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy` (web only).

## Outcome

- **Tabs** are a primitive with a sliding indicator, not hand-rolled rows of pressed buttons.
- **Scrolling lists fade at the edge you can scroll toward** and stay crisp at rest, with no JS.
- **Irreversible actions are confirmed by holding the button**, with the mouse or with Space or
  Enter.
- **Status reads from one dot vocabulary** everywhere, and live states breathe.
- **Typeahead in every list refines in place** instead of jumping past a row that already matches.

Each of these lands in `packages/ui`, so Plan 154 can later give each one its physical-mode motion
and voice in one place.

## 1. Tabs and segmented control

**Today.** `packages/ui` has no tabs. Three settings components hand-roll them from `Button`:
`features/settings/components/scope-tabs.tsx` (`role='tablist'`, `aria-selected`),
`usage-range-tabs.tsx` (`role='group'`, `aria-pressed`) and `view-toggle.tsx`. None slides; the
selected fill jumps.

**Build** `packages/ui/src/components/tabs.tsx` over Base UI `Tabs`: `Tabs`, `TabsList`, `TabsTab`,
`TabsPanel` and `TabsIndicator`. Base UI's indicator exposes `--active-tab-left`, `--active-tab-width`,
`--active-tab-top` and `--active-tab-height`. One absolutely positioned `bg-accent` span transitions
`translate` and `width` on `--duration-enter` with `--ease-in-out-strong` (the curve for things that
move on screen). There is no ResizeObserver. Neon's `components/ui/tabs.tsx` is the source; its own
`workspace-tabs` hand-rolls a ResizeObserver and is not the one to copy.

- Two variants. `tabs` switches panels. `segmented` is the compact pill row for a choice that swaps
  one view (usage range, form or JSON view). Both are Base UI Tabs, because both swap what is shown.
- No border and no underline: the indicator is a fill (no dividers). Corners follow the primitive
  rules: the indicator carries the control radius and the list carries none. The census stays green.
- An optional count chip inside a tab (Neon's), using `TickerNumber` only where the count updates live.
- Reduced motion: the indicator moves without the transition.

**Migrate** `scope-tabs.tsx`, `usage-range-tabs.tsx` and `view-toggle.tsx`, and search for any other
`aria-pressed` button row that is really one choice among several. `ToggleIconButton` toggles are
independent on/off switches, so they stay. Editor tabs (`bar-tabs.ts`, `editor-tab-bar.tsx`) and
the bottom panel's tab strip are a different pattern: bar tabs, square and never animated. They
stay.

## 2. Scroll edge fades

**Today.** Lists scroll with hard edges. The only mask is hand-written in
`features/chat/components/user-message-body.tsx`.

**Build** two utilities in `packages/ui/src/styles/globals.css`, from shadcn's `scroll-fade` utility
as vendored in Neon (`references/neon-ui/packages/registry/src/styles/tokens.css:175-260`):

- `scroll-fade`: two `@property`-registered lengths, animated by `animation-timeline: scroll(self y)`,
  drive a `mask-image` gradient. The top edge fades only once content is above it, and the bottom
  only while content is below. At rest both are crisp. Engines without scroll timelines keep crisp
  edges. The fade depth is a new token, `--scroll-fade-size`. The scrollbar thumb uses a foreground
  alpha, not Neon's `--border`.
- `scroll-pinned`: hides the scrollbar while a view is following its tail. The thumb would otherwise
  report a position the reader does not control. It is applied through `data-pinned` by whatever owns
  "following".

**Apply** as the default in the shared patterns, with an opt-out: the `VirtualList` viewport
(`patterns/virtual-list.tsx`) and `ToolPane` bodies (`patterns/tool-pane.tsx`), plus the `command.tsx`
list and the chat timeline viewport (`features/chat/components/timeline-viewport.tsx`, with
`scroll-pinned` while it follows). Leave `user-message-body.tsx`'s clamp mask alone: it cuts long
messages, which is a different job. The editor and terminal never get it.

## 3. Hold-to-confirm

**Today.** Destructive confirms are one click on a `variant='destructive'` Button, including the
ones that cannot be undone.

**Build** `packages/ui/src/components/hold-button.tsx`, porting Neon's mechanism
(`references/neon-ui/packages/registry/src/components/confirm-dialog/confirm-dialog.tsx`):

- The fill is one `clip-path: inset(0 X 0 0)` transition, `linear` over the hold. A second copy of the
  label sits inside the fill, so the sweep edge crosses the letters instead of flipping them. There is
  no rAF and no per-frame setState, so the component renders twice per hold, not sixty times a
  second.
- Letting go early springs back over 180 ms. A shake amplitude grows over the hold through a
  registered `@property` and resolves on completion.
- Space and Enter hold exactly like the pointer. Key repeat is ignored, and blur or pointer-leave
  cancels.
- Tokens: `--duration-hold` 1200 ms (Neon's default) and `--duration-hold-release` 180 ms. No call
  site picks a number.
- Reduced motion: the fill still sweeps, because it is the progress indicator, not decoration. The
  shake is dropped.
- A11y: `aria-describedby` says "Hold to confirm". Completion calls `onConfirm` once, and the caller's
  mutation owns pending state as it does today (`useIsMutating`).

**Where it applies.** Only where the action cannot be undone. `DeleteDialogFooter`
(`patterns/delete-dialog-footer.tsx`) gains a `hold` prop, and these confirms use it:

- `features/git/components/discard-dialog.tsx`: discarding changes
- `features/chat/components/checkpoint-revert-dialog.tsx`
- `features/chat-mode/components/worktree-cleanup-dialog.tsx`
- `features/editor/components/history-clear-dialog.tsx`

These stay one-click, because something else already undoes them: file deletes (the file tree undo,
Plan 136), and session and project deletes if they are recoverable. Check each before leaving it.

## 4. Status dots

**Today.** Hand-made dots, each with its own colour helper:

- `session-row.tsx:98`, `session-attention-indicator.tsx:15` (`sessionStatusDotClass`)
- `model-picker-row.tsx:85`, `model-picker-trigger.tsx:64` (`statusDotClass`)
- `logs/components/event-row.tsx:69` (`logLevelDotClass`)
- `workbench/components/tab-trailing-slot.tsx:57` (dirty tab)
- `lib/environments/components/phase.tsx:24`
- not `chat/components/composer-active-plan.tsx:54`: that plan-step dot becomes a step mark in
  [Plan 160](160-chat-turn-anatomy.md), so it is left alone here

`logs/components/list-loading.tsx:14` is a skeleton of the dot, and it follows the same primitive.

**Build** `packages/ui/src/components/status-dot.tsx`:

- `tone`: `neutral | info | success | warning | destructive`, mapped to the status tokens. Colour lives
  only in the dot; the word beside it stays `text-foreground` or `text-muted-foreground` (Neon's
  rule).
- `live`: breathes, opacity `.45 → 1` over `--duration-breathe` (2.6 s), `ease-in-out`, forever.
  Neon adds a `currentColor` glow; we drop it, because it is a shadow outside the three elevations.
  Reduced motion holds it steady at full opacity. Pure CSS, so it keeps the session rail's
  zero-render contract and replaces a per-row spinner for "working".
- Size is `--status-dot-size` (the current `size-1.5`), with `rounded-full` inside the primitive.
  Round, per the design language's circles rule; Neon's square dots are not adopted.
- Decorative (`aria-hidden`). The state is always in the text or the row's accessible name.

**Migrate** the sites above in the same pass, fold each colour helper into a `tone` mapping in its
feature's `utils/`, and add a `statusDots` census check: a `rounded-full` span with a status
background outside `status-dot.tsx` fails.

## 5. Typeahead refines in place

**Today.** `typeaheadListboxIndex` (`packages/ui/src/patterns/listbox-keys.ts:73`) always searches from
`activeIndex + 1`. With `ab` typed and the cursor already on "about", the next keystroke `c` jumps to
the next "abc…" row and skips the current one when that row itself matches.

**Fix.** A `from` argument. `use-listbox.ts` (`handleTypeahead`, line 94) passes `activeIndex` for a
buffer longer than one character, so a longer buffer refines in place. It passes `activeIndex + 1`
for a single character or a repeated single letter, which cycles as today. Extend UI's
`useEntryTypeAhead` behaves this way.

Tests go in `packages/ui/src/patterns/tests/listbox-keys.test.ts`: refining stays on a matching row,
a repeated letter cycles, disabled rows are skipped, and the search wraps.

## Order

1. Typeahead (smallest; independent).
2. Status dots (primitive, migrations, census check).
3. Scroll fades (utilities, then the shared patterns).
4. Tabs (primitive, then the three settings rows).
5. Hold-to-confirm (primitive, `DeleteDialogFooter`, then the four dialogs).

Each step lands green on its own.

## Verification

- `listbox-keys.test.ts` for the typeahead cases.
- `hold-button` tests in `packages/ui` (`dom` project, through the React Compiler like the rest of the
  package):
  - a pointer hold completes once
  - an early release cancels and does not confirm
  - a Space hold completes, and key repeat does not restart it
  - blur cancels
  - the component does not re-render per frame (count renders over a hold)
- A `row-states.browser.tsx`-style browser test for `scroll-fade`: crisp at the top at rest, the top
  edge masked after scrolling, and no mask when the content fits.
- `agent:browser look`, with the screenshots read back:
  - settings in both densities and both colour modes (scope tabs, usage range, form/JSON toggle),
    mid-glide
  - the session rail with a working session (the breathing dot)
  - the logs list
  - the git discard dialog mid-hold
- A new scenario, `base-components`, in `scripts/agent/scenarios/`, with selectors in
  `scripts/agent/selectors.ts` and a feature-map line. It holds and releases early on the discard
  dialog, holds Space to completion, and switches settings tabs and captures the indicator
  mid-travel.
- `renders` on the session rail before and after the dot migration: the count must not rise.
- `bun run gates` (design, compiler and dupes census) and `bun run compiler:memos` on each new file.
- Deploy with `bun run deploy` and check `GET /platform/release`.

## Not in this plan

The tooltip glide (owner-approved; its own small plan, because it changes the `AGENTS.md` tooltip
rule), the fixed-width select trigger, log following, and all physical-mode motion and sound
([Plan 154](154-physical-mode.md), which wires these primitives afterwards).
