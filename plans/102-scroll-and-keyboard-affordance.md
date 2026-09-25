# Make scrolling and shortcuts legible

Status: Phase 2 done 2026-09-25 (lane L1, with Plan 157's scroll fades). Phases 1 and 3 remain. Requested 2026-09-12.

Two affordances in `apps/web` are inconsistent and one was designed and never built.

**Scrollbars.** 59 scroller class strings spell the bar four different ways: the shared
`.app-scrollbar-thin` utility (10), the `no-scrollbar` utility that hides it (2), one hand-rolled
inline hide (1), and the browser default (46). Meanwhile `packages/tree` ships a strictly better
recipe that nobody can reuse, because the tree renders into a shadow root.

**Nested scrolling.** 32 capped scrollers hand the wheel to the pane behind them when they reach
their end. The reader is looking at a tool-call list inside a chat message and the whole timeline
moves instead.

**The keyboard chip.** `TooltipContent` already reserves layout and styling for a chip through a
`data-slot='kbd'` selector, and `globals.css` backs it with `--density-tooltip-kbd-padding-right`
in both density blocks. Nothing in the repository renders `data-slot='kbd'`. The slot has zero
occupants; the app spells a keyboard hint three other ways instead.

Three strands, three phases, independent of each other, cheapest first. Scope is `apps/web`,
`packages/ui`, and one split in `packages/ui/src/styles/globals.css`. `packages/tree` is the source
of the recipe and is not edited. [Root PLAN.md](../PLAN.md) owns execution order.

## Decisions

Stated once here and referenced by number below. The implementer does not re-decide at a call site.
A call site that needs something these do not cover is a missing utility, and the fix is to add the
utility in the same pass.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                    | Owner after this plan                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| D1  | **A cap means nested.** Any scroller with a `max-h-*` cap is by definition inside something else that scrolls, so it carries `overscroll-contain`. One spelling, both axes, no `overscroll-y-contain` on new sites. A full-height pane scroller (`h-full`, `flex-1`, no cap) is the pane and does not need it.                                                              | the call site's class string; gated by the census         |
| D2  | **The thin scrollbar is the tree's recipe.** Thumb transparent at rest, revealed on `:hover` or `:focus-within` of the scroll container; inset by a 1px transparent border with `background-clip: content-box`; radius half the track width; thumb `color-mix(in oklch, var(--muted-foreground) 45%, transparent)`.                                                         | `.app-scrollbar-thin` in `globals.css`                    |
| D3  | **The reserved gutter is its own utility.** `scroll-gutter` (`scrollbar-gutter: stable`) is never baked into D2. It goes on vertical scrollers whose content crosses the overflow threshold while the user watches. It never goes on a horizontal strip or a horizontal code block, where reserved width is a dead band.                                                    | `@utility scroll-gutter` in `shadcn-tailwind.css`         |
| D4  | **The editor keeps the native track.** `.app-editor-host .editor-virtualized` is split out of the shared rule and keeps its own 6px webkit track and `scrollbar-width: auto`. The minimap lane measures that track; a transparent hover-revealed thumb would still measure, but `scrollbar-width: thin` changes the width.                                                  | its own block in `globals.css`, with the existing comment |
| D5  | **Hiding the bar is for horizontal strips only.** `no-scrollbar` survives on the editor tab strip and nowhere else. It comes off `CommandList`, a vertical capped list and the one place a "more results" cue matters most, and the hand-rolled inline hide on the vertical model-picker rail becomes D2. A vertical scroller hides its bar only with a comment saying why. | `packages/ui/src/components/command.tsx`                  |
| D6  | **One keyboard chip.** `Kbd` in `packages/ui/src/components/kbd.tsx`, rendering a `<kbd>` with `data-slot='kbd'`. It is the only way to draw a key in the app. No call site hand-rolls a chip.                                                                                                                                                                              | `packages/ui/src/components/kbd.tsx`                      |
| D7  | **The chip's fill is surface-relative.** `bg-current/10 border-current/20`, colour inherited. Not `bg-background`: the tooltip ground is `bg-foreground`, so a fixed light chip works there and vanishes on `bg-popover-solid`. `currentColor` is not a palette hue and does not bypass theming.                                                                            | `kbd.tsx`                                                 |
| D8  | **Two placements, one component.** A menu shows the shortcut as a persistent trailing chip, because the action is already on screen and the chip teaches the key for next time. A tooltip shows it on hover, as a discovery hint for a trigger that carries no label. Same `Kbd`, two placements. Do not flatten this.                                                      | documented in `CLAUDE.md`                                 |
| D9  | **The `*Shortcut` slots stay generic.** `CommandShortcut` / `ContextMenuShortcut` / `DropdownMenuShortcut` are a trailing-metadata slot, not a keyboard component: 8 of their 10 call sites render a session count, `active`, `Current`, or a disabled reason. They keep their span. `Kbd` goes _inside_ the two that carry a key.                                          | the three primitives, unchanged in shape                  |

**D2: Decided 2026-09-25: recommendation (completion wave).** D7 needs the user's confirmation before its phase lands. Both change what the product
looks like rather than removing noise.

- D2 makes every thin scrollbar invisible at rest. That is the tree's behaviour today and it is
  quieter, but at-rest invisibility removes the only passive "there is more below" cue in a long
  log or search list. D3's reserved gutter is the compensation: the lane is always there, so the
  layout never moves and the thumb appears the moment the pointer enters. Confirm that trade.
- D7 departs from the nicest chip in the app today (`chat-welcome-view.tsx`, which uses
  `bg-background border-subtle`). The departure is forced: `TooltipContent` is
  `bg-foreground text-background`, an inverted ground, and the plan's whole point is that the
  tooltip slot finally has an occupant. A `currentColor` mix is the only fill that reads correctly
  on both grounds without a second variant.

Every other decision removes a spelling or adds a class; none of them is a judgement call at a call
site.

## Reconcile the baseline

Platform base `31919382`, working tree dirty at 57 files, 11 of them in
`packages/ui/src/components`. Other agents are editing `apps/web` and `packages/ui` while this plan
sits unexecuted, so **every line number below is a hint and every symbol name is the anchor**.
Before starting, capture HEAD and the full dirty diff, re-run the census, and re-derive the file
lists from its output rather than from the tables here. A finding that no longer reproduces is
dropped, not patched around.

The [web design language](../docs/web-design-language.md) is implemented, and
`scripts/lint/web-design-census.mjs` passes through `bun run design:census`. Its `oxc-parser`
class-string extractor and `TARGETS` table own these measures. Add `scrollIdiom`,
`uncontainedScroller` and `kbdSpelling` there and use `--check` as the gate; the shell counts below
remain useful for exploration. Preserve the settled corners, bar heights, type steps and dividers.

### Count the same way every time

From the repository root. `rg -U` is required: these class strings wrap across lines, and a
line-oriented grep undercounts by roughly a tenth.

```sh
SCROLL="'[^']*overflow-(x-|y-)?(auto|scroll)[^']*'"
CAP="'[^']*max-h-[^']*overflow-(x-|y-)?(auto|scroll)[^']*'|'[^']*overflow-(x-|y-)?(auto|scroll)[^']*max-h-[^']*'"
R="apps/web/src packages/ui/src"
S() { rg -Uo --no-filename -g '*.tsx' -g '!*/tests/*' "$SCROLL" $R; }
C() { rg -Uo --no-filename -g '*.tsx' -g '!*/tests/*' "$CAP" $R; }

S | wc -l                                                      # scrollers, total
S | rg -c app-scrollbar-thin                                   # shared thin utility
S | rg -c no-scrollbar                                         # hidden, via the utility
S | rg -c 'scrollbar-width:none'                               # hidden, hand-rolled inline
S | rg -vc 'app-scrollbar-thin|no-scrollbar|scrollbar-width:none'  # browser default
C | wc -l                                                      # capped scrollers
C | rg -vc overscroll                                          # capped and uncontained
rg -o --no-filename -g '*.tsx' -g '!*/tests/*' 'scrollbar-gutter:[a-z]+\]' $R | wc -l
rg -o --no-filename -g '*.tsx' -g '!*/tests/*' '<kbd' $R | wc -l
rg -o --no-filename -g '*.tsx' -g '!*/tests/*' "data-slot='kbd'" $R | wc -l
rg -o --no-filename -g '*.tsx' 'function [A-Za-z]+Shortcut' packages/ui/src | wc -l
rg -o --no-filename -g '*.tsx' -g '!*/tests/*' '<(Command|DropdownMenu|ContextMenu)Shortcut' $R | wc -l
```

To see _which_ sites, drop `-o --no-filename` and add `-n`:

```sh
rg -Un -g '*.tsx' -g '!*/tests/*' "$CAP" $R | rg -v overscroll
```

### Baseline census

Measured at `31919382`. Tests excluded throughout.

| Measure                                 | Baseline | Target                                     |
| --------------------------------------- | -------- | ------------------------------------------ |
| Scroller class strings                  | 59       | unchanged; this plan restyles, not removes |
| — shared `.app-scrollbar-thin`          | 10       | every vertical text scroller               |
| — `no-scrollbar` utility                | 2        | 1 (the editor tab strip only)              |
| — hand-rolled inline hide               | 1        | 0                                          |
| — browser default                       | 46       | 0                                          |
| Capped scrollers (`max-h-*` + overflow) | 35       | 35                                         |
| — of those, uncontained                 | 32       | 0                                          |
| Arbitrary `[scrollbar-gutter:…]`        | 1        | 0; a named `scroll-gutter` instead         |
| `<kbd>` elements                        | 3        | 0 outside `kbd.tsx`                        |
| `data-slot='kbd'` occupants             | 0        | 1 (`Kbd`), reached by every hint           |
| `*Shortcut` slot components             | 3        | 2 (`DropdownMenuShortcut` is unreferenced) |
| `*Shortcut` call sites                  | 10       | 9; 2 of them render a `Kbd`                |
| `<TooltipContent>` sites                | 12       | unchanged; some gain a `Kbd`               |

### The 32 uncontained scrollers

4 are in `packages/ui` primitives and are fixed once, in the primitive:
`select.tsx` `SelectContent`, `dropdown-menu.tsx` `DropdownMenuContent`,
`context-menu.tsx` `ContextMenuContent`, `command.tsx` `CommandList`. Two more primitives are not
scrollers themselves but are turned into one by their call sites, and take the same edit:
`dialog.tsx` `DialogContent` and `popover.tsx` `PopoverContent`. A dialog or popover that scrolls is
floating over the page by definition, so D1 reaches them whether or not they carry the cap.

7 `apps/web` sites are those six primitives with a `max-h-*` added at the call site; they inherit
containment and need no edit: `workspace-project-menu.tsx`,
`chat-mode/components/session-scope-menu.tsx`, `settings/components/widgets/font-widget.tsx`,
`settings/components/widgets/code-theme-widget.tsx`, `environments/components/form-dialog.tsx`,
`environments/components/picker-dialog.tsx`, `chat-mode/components/worktree-manager.tsx`.
Confirm inheritance by re-running the census after Phase 1 step 1 rather than assuming it.

The remaining 21 elements, in 19 files, are real edits:

| File (under `apps/web/src`)                                        | Element                                    |
| ------------------------------------------------------------------ | ------------------------------------------ |
| `features/chat/components/live-activity-row.tsx`                   | the `data-tool-group-scroll` region        |
| `features/chat/components/activity-group-row.tsx`                  | the `data-tool-group-scroll` region        |
| `features/chat/components/activity-detail-section.tsx`             | the `data-tool-group-scroll` `<pre>`       |
| `features/editor/components/diagnostic-peek.tsx`                   | the `data-diagnostic-peek` `role='dialog'` |
| `features/chat/components/pending-approval-panel.tsx`              | the capped `<pre>`                         |
| `features/chat/components/chat-input-editor.tsx`                   | the growing composer                       |
| `features/command-palette/content.tsx`                             | the results list                           |
| `features/command-palette/components/code-theme-preview-panel.tsx` | the preview pane                           |
| `features/editor/components/workspace-edit-preview-dialog.tsx`     | the diff grid                              |
| `features/editor/components/workspace-edit-recovery-dialog.tsx`    | the `<ul>`                                 |
| `features/environments/components/ssh-host-list.tsx`               | the list                                   |
| `features/environments/components/tailnet-host-list.tsx`           | the list                                   |
| `features/git/components/commit-progress.tsx`                      | the log `<pre>`                            |
| `features/logs/components/event-inline-detail.tsx`                 | the detail `<pre>`                         |
| `features/settings/components/keybinding-resolution.tsx`           | two lists                                  |
| `features/settings/components/keybinding-section.tsx`              | the section list                           |
| `features/settings/components/model-section.tsx`                   | the model list                             |
| `features/settings/components/raw-conflict-banner.tsx`             | two `<pre>`s                               |
| `components/machine-error-details.tsx`                             | `PopoverDescription`                       |

`components/logging-error-boundary.tsx` already carries the complete correct recipe for a bounded
`<pre>` — `app-scrollbar-thin … max-h-64 overflow-y-auto overscroll-contain` — and is the
copy-paste reference for every `<pre>` in that list. `features/chat/components/composer-active-plan.tsx`
is the same reference for a bounded list: it is a `data-tool-group-scroll` region that already has
`overscroll-contain`, which is why its three siblings not having it reads as an omission rather
than a design.

### The four keyboard-hint spellings

| Where                                                    | Today                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `features/chat/components/chat-welcome-view.tsx`         | `WelcomeHint` — the nicest chip: bordered `<kbd>` inside a bordered wrapper. The model. |
| `features/workbench/components/code-panel.tsx`           | a different recipe in the `EmptyState` hint, with the literal string `⌘P` hard-coded.   |
| `keymap/components/pending-chord-indicator.tsx`          | a bare `<kbd className='font-mono whitespace-nowrap'>` — no chip at all.                |
| `command.tsx` / `context-menu.tsx` / `dropdown-menu.tsx` | three `*Shortcut` spans, muted and letterspaced. Not a chip, and mostly not a shortcut. |

`pending-chord-indicator.tsx` is the one place in the app where a key is literally the subject of
the sentence — it renders `formatChord(pending.keys)` followed by "pressed. Waiting for the next
key…" — and it is the one place with no chip at all.

The data for a real chip already exists. `commandShortcut(command, bindings)` in
`keymap/utils/format-keys.ts` resolves a display string for any `PlatformCommandId`, and
`useCommand().bindings` (`keymap/providers/command-context.ts`, `CommandContextValue.bindings`)
supplies the bindings. `features/command-palette/command-palette-utils.ts` already calls it, and so
does `keymap/menus/utils/resolve.ts`. Only the render is missing.

## Phase 1 — a cap means contained

Cheapest and most mechanical. One class, 21 call sites plus 6 primitives, no new files.

1. Add `overscroll-contain` to the six `packages/ui` content components named above. Put it next
   to the existing `overflow-y-auto` in the same base string, not in a variant. `DialogContent` and
   `PopoverContent` have no `overflow` of their own; add the class anyway — it is inert until a call
   site makes the surface scroll, which four of them do.
2. Re-run the census. Confirm the seven inheriting `apps/web` call sites dropped off the list on
   their own. If one did not, it is setting `overflow` itself and belongs in step 3.
3. Work the 21 in the table, starting with the four the user feels daily and in this order:
   `live-activity-row.tsx` and `activity-group-row.tsx` first — they carry byte-identical class
   strings and must be edited as a pair or they drift; then `activity-detail-section.tsx`, their
   third sibling; then `diagnostic-peek.tsx`, where overscrolling the peek moves the very line the
   peek is pointing at.
4. `messages-timeline.tsx` keeps its `overscroll-y-contain`. It is `h-full`, not capped, so D1 does
   not reach it, and it is the outer surface the three chat regions chain into. Do not touch it in
   this phase.

Gate: census measure "capped and uncontained" is 0. Plus two computed-style assertions, which are
what catch the class being written but not reaching the element:

- Add one line to the existing `features/editor/tests/diagnostic-peek.browser.tsx`, which already
  queries `[data-diagnostic-peek]`: `getComputedStyle(peek).overscrollBehaviorY === 'contain'`.
- Add `features/chat/tests/tool-group-overscroll.browser.tsx`, modelled on
  `features/chat/components/message-bubble.browser.tsx`, rendering `LiveActivityRow` and
  `ActivityGroupRow` expanded and asserting the same on `[data-tool-group-scroll]`.

Both are `browser` project, because happy-dom does not resolve Tailwind classes to computed styles.

## Phase 2 — one scrollbar

**Done 2026-09-25 (lane L1), in a different shape.** The tree recipe is a base-layer rule on every
element (`*`, `*:hover`, `*:focus-within`), not an `.app-scrollbar-thin` class on each scroller, so
there is no per-site sweep and the class is gone. The editor keeps its own webkit block (D4).
`scroll-gutter` exists and sits on the composer, command menu, commit progress, logs, search results
and timeline. `no-scrollbar` survives on the two horizontal strips and the one-icon-wide model
picker rail, each allow-listed. The census measure is `scrollIdiom`; the computed-style test is
`packages/ui/src/patterns/tests/scroll-edges.browser.tsx`. The text below is the original plan.

Files: `packages/ui/src/styles/globals.css`, `packages/ui/src/styles/shadcn-tailwind.css`, the six
primitives from Phase 1, and the `apps/web` scrollers.

**Confirm D2 before this phase lands.**

1. **Split D4 out first, before touching anything else.** The `.app-scrollbar-thin` rules and the
   `.app-editor-host .editor-virtualized` rules are currently written as shared selector lists —
   `::-webkit-scrollbar`, `-track`, `-thumb`, `-thumb:hover`, `-corner`. Give the editor its own
   copy of those five rules with the values it has today, keep the existing
   "Keep the pixel-sized track measurable for the minimap's scrollbar lane" comment on its
   `scrollbar-color: auto; scrollbar-width: auto` block, and verify the editor's rendered track
   width is unchanged before step 2. Doing this after step 2 means the minimap silently inherits a
   hover-revealed thumb and nobody notices until a lane measurement is wrong.

2. **Rewrite `.app-scrollbar-thin` as the tree's recipe.** Add one token beside the existing
   `--row-hover` family in `globals.css`, in `:root` and wherever the dark palette overrides it if
   45% does not read on both:

   ```css
   --scrollbar-track: 6px;
   --scrollbar-thumb: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
   ```

   `in oklch, …, transparent` is this file's convention — `--row-hover`, `--row-selected` and
   `--border-subtle` are all written that way. The tree mixes `in lab` against its own background
   instead, which it has to, because it cannot see our tokens; do not copy that half.

   Then replace the existing `.app-scrollbar-thin` block in `globals.css`, in place:

   ```css
   .app-scrollbar-thin {
     --scrollbar-thumb-current: transparent;
     scrollbar-width: thin;
     scrollbar-color: var(--scrollbar-thumb-current) transparent;
   }

   .app-scrollbar-thin:hover,
   .app-scrollbar-thin:focus-within {
     --scrollbar-thumb-current: var(--scrollbar-thumb);
   }

   .app-scrollbar-thin::-webkit-scrollbar {
     height: var(--scrollbar-track);
     width: var(--scrollbar-track);
   }
   .app-scrollbar-thin::-webkit-scrollbar-track {
     background: transparent;
   }
   .app-scrollbar-thin::-webkit-scrollbar-thumb {
     background-color: var(--scrollbar-thumb-current);
     background-clip: content-box;
     border: 1px solid transparent;
     border-radius: calc(var(--scrollbar-track) / 2);
   }
   .app-scrollbar-thin::-webkit-scrollbar-corner {
     background-color: transparent;
   }
   ```

   The radius is derived from the track, as the tree derives it, so a future change to the track
   width cannot leave a square thumb behind. The transparent border plus `background-clip: content-box` is what insets the thumb inside the
   track so it reads as a floating pill rather than a filled lane; it is the half of the tree's
   recipe that the current shared utility is missing. `:focus-within` is ours, not the tree's: a
   keyboard user scrolling a focused list never hovers it, and an invisible thumb there is a
   regression D2 would otherwise introduce.

   Drop the `::-webkit-scrollbar-thumb:hover` rule that brightens to `var(--foreground)`. It is
   thumb hover, not container hover, and under D2 the thumb is already at full strength by the time
   the pointer can reach it.

3. **Add `scroll-gutter` (D3)** in `shadcn-tailwind.css` beside the existing `no-scrollbar`
   `@utility`, so the two hide-and-reserve utilities live together:

   ```css
   @utility scroll-gutter {
     scrollbar-gutter: stable;
   }
   ```

   Replace the one arbitrary spelling — `[scrollbar-gutter:stable]` in
   `features/chat/components/messages-timeline.tsx` — with it.

4. **Adopt in the primitives.** Put `app-scrollbar-thin` on `SelectContent`,
   `DropdownMenuContent`, `ContextMenuContent`, `CommandList`, `DialogContent` and `PopoverContent`
   — the same six Phase 1 touched. That one edit covers every menu, select, palette, dialog and
   popover in the app: 12 `DropdownMenuContent`, 5 `SelectContent`, 2 `ContextMenuContent` and 3
   `CommandList` call sites, plus every dialog and popover behind the other two. Per D5,
   `CommandList` also loses `no-scrollbar` in the same edit — it is a `max-h-72` vertical list, and
   the command palette, the model picker and the code-theme picker are exactly the surfaces where
   "there are more results below" has to be visible.

   `PopoverDescription` is deliberately not in the set. It is a text block, usually not a scroller,
   and D3's gutter would indent every description in the app. Its one scrolling call site,
   `components/machine-error-details.tsx`, adds both classes itself.

5. **Adopt in `apps/web`.** Two passes over the census's scroller list. First, the 46 browser-default
   scrollers get `app-scrollbar-thin`; re-derive that list from the census rather than from any list
   here, because it is the measure most exposed to drift. Second, every _vertical text_ scroller —
   whether it was already thin or just became thin — also gets `scroll-gutter`.

   The 10 sites that are already thin are all vertical text scrollers, so all 10 take the gutter and
   nothing else:
   `logging-error-boundary.tsx`, `chat-mode/components/tool-pane.tsx`, `messages-timeline.tsx`,
   `chat/components/chat-input-command-menu.tsx`, `chat/components/chat-input-editor.tsx`,
   `search/components/results-view.tsx`, `search/components/result-editor-surface.tsx`,
   `logs/components/event-list.tsx`, `git/components/panel.tsx`, `git/components/commit-progress.tsx`.

   `chat-input-editor.tsx` is the one that pays for D3 immediately: it is `max-h-48 min-h-14`, so it
   crosses the overflow threshold while the user is typing, and without a reserved gutter the caret
   jumps sideways on the line that makes the composer scroll.

6. **The gutter's exclusions**, named so nobody adds it by sweep. These are horizontal and must not
   reserve a band:
   `features/workbench/components/editor-tab-bar.tsx` (also the one `no-scrollbar` that survives),
   `features/chat/components/assistant-markdown-code-block.tsx`,
   `features/chat/components/assistant-markdown-code-body.tsx`,
   `features/chat/components/chat-input-attachment-list.tsx`,
   `features/file-picker/navigation/mobile-locations.tsx` (two),
   `lib/code-theme/components/preview.tsx`.
   They still take `app-scrollbar-thin`; a horizontal code block with a browser-default bar is
   exactly the loud case D2 fixes.

7. **The hand-rolled hide.** `features/chat/components/model-picker-rail.tsx` spells the hidden bar
   inline as `[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`. It is
   a vertical rail, so under D5 it does not qualify to hide at all: replace the three arbitrary
   values with `app-scrollbar-thin`. If the rail genuinely must stay bare, it uses `no-scrollbar`
   with a one-line comment saying why, and the census allow-list records it.

Gate: census shows `app-scrollbar-thin` on every scroller, `no-scrollbar` at 1, hand-rolled inline
hide at 0, browser default at 0, arbitrary gutter at 0. Plus one computed-style assertion, since a
CSS rewrite is exactly the change a class census cannot verify: in a `browser` test, render a
`DropdownMenuContent` with overflowing content and assert `getComputedStyle(el).scrollbarWidth` is
`'thin'` and that `scrollbarColor` resolves its thumb to `transparent` at rest. The existing
`features/settings/tests/density-contract.browser.tsx` is the precedent for that shape — it renders
real primitives and reads computed styles. And re-run whichever editor gate the repository already
has for the minimap lane before calling D4 done.

## Phase 3 — the keyboard chip

The highest-value strand, because it is not a cleanup: a primitive was designed, its slot and its
density token were shipped, and it was never built.

**Confirm D7 before this phase lands.**

1. **Build it.** `packages/ui/src/components/kbd.tsx`, one component, exporting `Kbd`:

   - renders `<kbd data-slot='kbd'>` — the slot is not decoration, it is the selector
     `TooltipContent` already targets with `has-data-[slot=kbd]:pr-(--density-tooltip-kbd-padding-right)`
     and four `**:data-[slot=kbd]:*` rules;
   - `inline-flex items-center border font-mono leading-none`, sized on the `text-3xs` step both
     hand-rolled chips already use;
   - fill per D7: `bg-current/10 border-current/20`, colour inherited from the surface;
   - `rounded-md` — the same step the tooltip's `**:data-[slot=kbd]:rounded-md` forces, written
     once here so the two agree instead of one overriding the other;
   - accepts `className` through `cn` like every other primitive, and nothing else. No `size` prop
     and no variants until a second size actually exists.

   Do not add a barrel. `@workspace/ui/components/kbd` resolves through the package's
   `"./components/*"` export.

2. **Resolve the binding.** Add `apps/web/src/keymap/hooks/use-command-shortcut.ts`, one hook:
   `useCommandShortcut(command: PlatformCommandId): string | null`, returning
   `commandShortcut(command, useCommand().bindings)`. It belongs in `keymap/` and nowhere else —
   `CLAUDE.md` puts command policy next to the command registry, not in `lib/` and not in
   `components/`. `format-keys.ts` already handles platform glyphs and chord separators; the hook
   adds nothing but the context read.

3. **Replace the three hand-rolled kbds.**
   - `features/chat/components/chat-welcome-view.tsx`: `WelcomeHint`'s inner `<kbd>` becomes `Kbd`.
     The bordered wrapper around it stays — it is the hint row's own shape, not part of the chip.
   - `features/workbench/components/code-panel.tsx`: the `EmptyState` hint becomes `Kbd`, and the
     hard-coded `⌘P` becomes `useCommandShortcut('workspace.showQuickAccess')` — that command is
     defined with `chord: ['Mod+P']` in `packages/client-core/src/commands/workspace.ts` and its
     description is literally "Search workspace files and quick actions", which is the hint the
     panel is writing by hand. Do not re-type the glyph. Render the hint only when
     the hook returns a string, because a user who unbound the palette should not be told to press
     a key that does nothing.
   - `keymap/components/pending-chord-indicator.tsx`: the bare `<kbd>` becomes `Kbd`. This is the
     one that most needs it and the smallest edit — `formatChord(pending.keys)` already produces
     the string.

4. **Put `Kbd` inside the two trailing slots that carry a key.** Per D9 the slots themselves do not
   change:
   - `features/command-palette/command-palette-row.tsx` renders
     `<CommandShortcut><Kbd>{item.shortcut}</Kbd></CommandShortcut>`;
   - `keymap/menus/components/item-row.tsx` renders a `Kbd` **only** when `item.trailing` is the
     shortcut. It is not always: `keymap/menus/utils/resolve.ts` sets `trailing` to
     `item.unavailable ?? (disabled ? inspection.reason : commandShortcut(…))`, so the same slot
     also carries an unavailability sentence and a disabled reason. Wrapping a sentence in a key cap
     is worse than leaving it plain. Split the resolved menu item so the shortcut and the reason are
     separate fields rather than inferring which one you got.

   The eight other `*Shortcut` call sites — session counts, `active`, `Current`, a symbol count —
   are untouched and must stay untouched.

   One coupling to preserve: `CommandItem` hides its check mark with
   `group-has-data-[slot=command-shortcut]/command-item:hidden`, and
   `features/chat/components/model-picker-row.tsx` carries a comment depending on that. Adding a
   `Kbd` _inside_ a `CommandShortcut` keeps `data-slot='command-shortcut'` present and the coupling
   intact. Do not move the `data-slot` onto the `Kbd`.

5. **Delete `DropdownMenuShortcut`.** It has zero call sites in the repository. `packages/ui`
   resolves each component as its own export path, so the repository's Knip gate cannot see it as
   unused. Deleting it is on-topic: it is one of the four spellings this phase exists to reduce.

6. **Tooltips (D8).** Give `TooltipContent` a `Kbd` on triggers that are icon-only _and_ dispatch a
   bound command. Enumerate them rather than sweeping: of the 12 `<TooltipContent>` sites today,
   all render a bare label, and most are local UI handlers with no `PlatformCommandId` behind them.
   For each one, the test is whether `useCommandShortcut` returns a string; if it does not, the
   tooltip is unchanged. Render as `<TooltipContent>{label}<Kbd>{shortcut}</Kbd></TooltipContent>` —
   the primitive's `has-data-[slot=kbd]:pr-…` tightens the right padding for exactly that shape, so
   no call site sets spacing.

   Adding a tooltip where there is none today is out of scope; see below.

Gate: census shows `<kbd>` at 0 outside `kbd.tsx`, `data-slot='kbd'` occupants at 1, `*Shortcut`
slot components at 2. Plus `packages/ui/src/components/tests/kbd.test.tsx`, beside the existing
`button.test.tsx` / `input.test.tsx` / `pane-bar.test.tsx`, asserting the rendered element is a
`<kbd>` and carries `data-slot='kbd'` — that attribute is the entire contract with `TooltipContent`
and is the one thing a rename would silently break. Plus one `browser` assertion that a
`TooltipContent` containing a `Kbd` computes the tightened `padding-right`, which is the proof the
reserved token finally has an occupant and the only check that can catch the slot name drifting.

## Verification boundaries

Narrow checks only, per repository policy. Never a repo-wide suite, never a bare test count.

| Plausible failure                                         | Narrowest check                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A capped scroller was missed                              | census "capped and uncontained" is 0                                                                                                                |
| The class is written but does not reach the element       | the two Phase 1 computed-style assertions (`diagnostic-peek.browser.tsx`, the new chat one)                                                         |
| The two chat rows drifted apart again                     | both appear in the same census run; edit them in one commit                                                                                         |
| The scrollbar rewrite silently changed the editor's track | Phase 2 step 1 lands and is verified first, separately, against the minimap lane gate                                                               |
| The thumb is invisible even on hover                      | the Phase 2 computed-style assertion on `scrollbarColor` / `scrollbarWidth`                                                                         |
| A gutter was reserved on a horizontal strip               | the Phase 2 exclusion list, re-derived from the census's horizontal-scroller slice                                                                  |
| `Kbd` renders the wrong element or loses its slot         | `packages/ui/src/components/tests/kbd.test.tsx`                                                                                                     |
| The tooltip slot still has no occupant                    | the Phase 3 `padding-right` browser assertion                                                                                                       |
| A trailing metadata span got wrapped in a key cap         | diff review of the 10 `*Shortcut` call sites; 8 must be unchanged                                                                                   |
| The command-palette check mark stopped hiding             | nothing covers this today — diff review that `data-slot='command-shortcut'` still sits on the outer span, per the comment in `model-picker-row.tsx` |

Workspace checks: `packages/ui` typecheck, lint, and `vitest run src/components/tests/` (four files,
five after Phase 3). `apps/web` typecheck, lint, the two or three named `browser` files via
`bun run --filter web test:browser`, and the dom tests of the components whose markup
changed. Run `bun run design:census`.

## What this plan does not do

- **Corners, bar heights, density, dividers, type steps, elevation, interaction fills.**
  The [web design language](../docs/web-design-language.md) settles these. This plan adds
  `overscroll-contain`, `app-scrollbar-thin`, `scroll-gutter` and `Kbd`, and changes no radius, no
  height and no colour token except the one new `--scrollbar-thumb`.
- **Adding tooltips where none exist.** The sidebar rail and the bottom-panel tabs are icon-only
  and have no tooltip at all today; giving them one is a new affordance, not a consolidation, and it
  interacts with the settled rail-tab treatment. A future pass owns it.
- **Showing shortcuts on palette rows that do not show one.** `features/command-palette/view-groups.tsx`
  and the colour/theme groups render `CommandItem`s with a real `PlatformCommandId` and no trailing
  shortcut, while `command-palette-row.tsx` shows one. That is a genuine inconsistency and it is a
  data question — which palette groups deserve a key — not a rendering one. Out of scope; note it
  when Phase 3 lands so it is not lost.
- **`packages/tree`.** The recipe is read from it and adapted; the shadow-root stylesheet is not
  edited, and no attempt is made to share one stylesheet across the boundary.
- **The editor's own scrollbars, minimap lane, or diff-view scroll surfaces.** D4 isolates them
  deliberately.
- **Scroll _behaviour_** — anchoring, restoration, `scroll-into-view`, momentum, the chat
  timeline's virtualizer. This plan is affordance only: what the scrollbar looks like and where the
  wheel stops. `messages-timeline.tsx`'s anchoring logic is not touched.
- **Overscroll on the `body` / app shell.** Rubber-banding at the window level is a separate
  question with a platform (desktop shell) dimension.
