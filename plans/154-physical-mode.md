# Plan 154: Physical mode — press feel and interface sounds

## Status and authorization

- Status: PROPOSED — research done ([docs/ui-research/seamui.md](../docs/ui-research/seamui.md));
  D1–D3 need the owner.
- Priority: P2. The owner is sure about it; nothing else depends on it.
- Effort: M. One engine (~150 lines), three settings, CSS in `globals.css`, voice wiring in about
  ten primitives, one census check.
- Risk: LOW. Every behaviour sits behind a setting that defaults off. The only change that reaches
  every user is the `pressable` utility gaining a second mode, and `flat` keeps today's rule.
- Scheduling: near the end of the UI refresh lane in [`PLAN.md`](../PLAN.md). Phases 1 and 2 can
  land any time. Phases 3 and 4 run after the base-component work from
  [docs/ui-research](../docs/ui-research/README.md), so every primitive that work adds (tabs,
  toggle group, hold-to-confirm, checkbox) is wired and audited once, not twice.
- Planned at: Platform `9c1c45d1`, 2026-09-25.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy` (web only).

## Outcome

A **Physical** setting makes controls feel like objects: buttons sink under the pointer, switches
stretch before they flip, popups settle in with a little overshoot. A separate **Interface sounds**
setting adds seamui's click: a 4 ms synthesized tick on press and a slightly higher tick when a
control commits a value, plus sounds for the few app events worth hearing. Both are off by default,
both live in the primitives, and a control added later gets them by being built on a primitive.

## What seamui does (the reference)

Source: `references/seamui/apps/www/registry/seam/` (MIT). Full teardown with exact values in
[seamui.md](../docs/ui-research/seamui.md).

- **Sound.** No audio files. `web-haptics` synthesizes one voice: a fresh 4 ms white-noise buffer
  per click, decaying over ~0.5 ms, through a bandpass (Q 8) centred at `2000 + intensity × 2000`
  Hz with ±15 % jitter, at gain `0.5 × intensity`. The `AudioContext` is created inside the first
  gesture. Heavier presets re-click every `16 + (1 − intensity) × 184` ms, which is why `error`
  rattles.
- **Where it fires**, read from the registry source (`lib/haptics.tsx` and every `useHaptics` call):

  | Voice                                       | Components                                                                                                                                                                   |
  | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `tap` on `pointerdown`, primary button only | Button (so every Button-based control: toggle, toolbar item, session item, tool and sources disclosures, empty-state actions), menu item select, submenu trigger             |
  | `tick` on value commit                      | Switch, Checkbox, CheckboxGroup, RadioGroup, Select, Tabs, Slider (commit), Pagination, OTP digit, NumberField, ModeSelector, menu checkbox and radio items, data-table sort |
  | `error`                                     | Field invalid, OTP invalid, data-table edit rejected                                                                                                                         |
  | never                                       | hover, focus, dialog open or close, toasts, keyboard activation                                                                                                              |

- **Feel.** Press is `scale .97` on a stiff spring and releases with slight overshoot; ghost and
  link variants dim to `opacity .7` instead. The switch thumb stretches 16 → 20 px while pressed.
  Base UI popups enter from `scale .95` over 200 ms on `cubic-bezier(0.22, 1.3, 0.36, 1)` and exit
  over 150 ms, animating the standalone `scale` property because Base UI owns `transform`. Under
  reduced motion every effect becomes an opacity change, never nothing.

Two things we deliberately do differently: seamui never sounds on the keyboard, and neither do
we (an IDE is driven from the keyboard; a click per chord is unbearable). And seamui sounds on
every tab and menu open; we keep dense surfaces silent (below).

## What exists today

- **Press feedback** is one utility, `pressable` (`packages/ui/src/styles/globals.css:575`): a
  1px `translate-y` on `:active`, skipped for `aria-haspopup` controls. `button-variants.ts` applies
  it; three files use it in total.
- **Motion tokens:** `--duration-enter` 140 ms, `--duration-exit` 100 ms, `--ease-out-strong`,
  `--ease-in-out-strong` (`globals.css:101-112`). No spring or overshoot curve.
- **Root attributes:** `applyAppearance` (`apps/web/src/features/settings/utils/apply-appearance.ts`)
  and the pre-paint `apps/web/src/boot-appearance.ts` write `data-density`. `data-press` goes
  beside it.
- **Audio:** `apps/web/src/features/chat-mode/state/notification-host.ts` owns a private
  `AudioContext`, unlocks it on the first `pointerdown`/`keydown`, and plays
  `public/notifications/{completion,input}.mp3` when `chat.notificationMode` includes sound. Both
  mp3s are byte-identical to T3 Code's `notification-completion.mp3` and `notification-input.mp3`
  (`references/t3code/apps/web/src/assets/`), MIT, © T3 Tools Inc. That answers the research
  doc's licence question; the notice is recorded in Phase 1.
- **Reduced motion:** only the OS media query. `workbench.reduceMotion` is scoped to terminal
  loading indicators (its title says so) and stays that way.
- **Primitives that would carry a voice:** `button`, `switch`, `select`, `dropdown-menu` and
  `context-menu` (both have checkbox and radio items), `dialog`, `popover`, `tooltip`, `command`,
  `sonner`, `accordion`, `collapsible`. **Missing** compared with seamui: toggle, toggle group,
  checkbox, radio group, tabs, slider. The base-component work is expected to add some of these.
- **Controls outside the primitives:** 8 raw `<button>` sites in `apps/web/src`
  (`timeline-minimap.tsx`, `model-picker-rail-item.tsx`, `palette-card.tsx`,
  `terminal-list-row.tsx`, `editor-tab-button.tsx`, `tab-trailing-slot.tsx`, `bottom-panel.tsx`).
  `ToolbarButton`, `ToggleIconButton`, `RailTabs` and `UiModeToggle` already go through `Button`.
- **Error toasts** funnel through `apps/web/src/lib/toast-error.ts`, except 7 direct `toast.error`
  calls.

## Design

### Settings

Registered in `packages/contracts/src/settings/keys.ts`, category Appearance, each in the phase
that wires its consumer. Regenerate `docs/settings-reference.md` after each.

| Key                              | Schema                                       | Default | Scope         | Why that scope                                                           |
| -------------------------------- | -------------------------------------------- | ------- | ------------- | ------------------------------------------------------------------------ |
| `workbench.pressFeel`            | `'flat' \| 'physical'`                       | `flat`  | `window`      | Presentation only, like `workbench.density`                              |
| `workbench.interfaceSounds`      | `'off' \| 'events' \| 'controls-and-events'` | `off`   | `application` | A workspace file must not turn sound on for everyone who clones the repo |
| `workbench.interfaceSoundVolume` | `percentSchema`                              | 50      | `application` | Same                                                                     |

The two halves stay separate settings: someone can want the feel without the noise.

### The engine: `packages/ui/src/patterns/feedback-layer.ts`

Stateful, so it is a pattern module, not `utils/`. It lives in `packages/ui` because primitives
call it and `packages/ui` cannot import the app. No `web-haptics` dependency: the voice is ~60
lines to port (MIT attribution in a one-line comment), and the package's iOS path appends a label
to `<body>` and dispatches synthetic clicks.

- One lazily created `AudioContext` (`latencyHint: 'interactive'`) and one master gain. It is
  created or resumed only inside a gesture handler. `notification-host.ts` drops its own context and
  unlock and plays its mp3s through this one (`playBuffer`).
- A voice table: `tap` (i .4), `tick` (i .7), `tick-off` (i .7, centre −20 %), `open` (i .3,
  centre ~1.6 kHz), `success` (two rising clicks 60 ms apart), `error` (seamui's heavy rattle).
- `configureFeedback({ tier, volume })` from the app; `playFeedback(voice, { tier })` for callers.
  A voice declares its tier (`controls` or `events`), and the engine drops anything the configured
  tier excludes, so call sites never read the setting.
- Silent when `document.hidden`. It coalesces one voice within 30 ms and caps `error` at one per 2 s.
  It never throws into the UI: a failed context is logged once at debug and the engine goes inert.
- `use-feedback-layer.ts` mirrors `use-tooltip-layer.ts`: one document `pointerdown` listener,
  primary button only, reads `closest('[data-feedback]')`, skips `disabled` / `aria-disabled` and
  `data-feedback="none"`. Delegation puts nothing on each control, adds no React cost, and costs
  nothing inside virtualized rows. Mounted once next to `<TooltipLayer />` in
  `apps/web/src/components/active-environment-application.tsx`, which also pushes the settings
  through `configureFeedback`.

### Press feel: CSS only

- `applyAppearance` and `boot-appearance.ts` write `data-press` next to `data-density`, from the
  same mirror, so the first paint is right.
- New tokens in `globals.css`: `--ease-spring: cubic-bezier(0.22, 1.3, 0.36, 1)`,
  `--duration-press: 60ms`, and `--press-scale: .97`.
- `pressable` gains a physical branch under `:root[data-press='physical']`: `scale:
var(--press-scale)` on `:active` (the standalone property, so it never fights a transform), press
  on `--duration-press`, release on `--ease-spring` over `--duration-enter`. Ghost and link
  variants dim to `opacity .7` instead, as in seamui. The `aria-haspopup` exception stays. `flat` is
  today's 1px step, unchanged.
- **Switch:** the thumb widens 25 % toward its far side on `:active`, then travels on
  `--ease-spring`.
- **Popups** (dialog, popover, dropdown and context menu, select, command): in physical mode the
  enter animation starts from `scale .95` on `--ease-spring` over 200 ms, origin
  `var(--transform-origin)`. Tooltips keep their own entrance; the glide work in the UI refresh
  lane owns them.
- **Reduced motion:** under `prefers-reduced-motion`, physical press is an `opacity .7` dim, the
  stretch and overshoot are dropped, and popups fade. Never dead.
- **Never scaled:** `ListRow`, tabs inside a bar, the editor, the terminal. Scale blurs text for a
  frame, and those surfaces are too dense to move.

### Which control gets which voice

| Control                                                                            | Voice                            | Where it is wired                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Button` and everything built on it                                                | `tap` on pointerdown             | `data-feedback="tap"` from `button-variants` / `button.tsx`; `feedback={false}` prop maps to `none` |
| `Switch`                                                                           | `tick` on, `tick-off` off        | `onCheckedChange` wrapper in `switch.tsx`                                                           |
| `Select` commit                                                                    | `tick`                           | `onValueChange` wrapper in `select.tsx`                                                             |
| Menu checkbox and radio items (dropdown, context)                                  | `tick`                           | Their `onCheckedChange` / `onValueChange` wrappers                                                  |
| Menu item select                                                                   | `tap`                            | `data-feedback` on the item; pointer only, so keyboard use of menus stays silent                    |
| Dialog                                                                             | `open` on open, nothing on close | `dialog.tsx`, only when opened by a pointer                                                         |
| Tabs, toggle group, checkbox, radio, slider (if the base-component work adds them) | `tick` on commit                 | The new primitive, in Phase 3                                                                       |
| Error toast                                                                        | `error` (events tier)            | `lib/toast-error.ts`; the 7 direct `toast.error` sites move onto it                                 |
| `ListRow`, bar tabs, command palette items, tooltip, popover, editor, terminal     | silent                           | —                                                                                                   |

Events tier (`events` and `controls-and-events`):

| Event                                | Voice                       |
| ------------------------------------ | --------------------------- |
| Agent turn finished                  | `completion.mp3` (existing) |
| Approval or input requested          | `input.mp3` (existing)      |
| Commit created, push done, PR opened | `success`                   |
| Error toast                          | `error`                     |

Keystrokes, command execution, saves and undo stay silent.

## Phases

### Phase 1 — The engine and event sounds

1. `feedback-layer.ts` with the voice port, table, tiers, coalescing and hidden-tab silence.
2. Register `workbench.interfaceSounds` and `workbench.interfaceSoundVolume`, and push them through
   `configureFeedback` from the composition layer.
3. `notification-host.ts` plays through the shared context and loses its private unlock. What
   happens to `chat.notificationMode`'s sound values follows D1.
4. Events: `success` from the commit, push and PR mutations' `onSuccess` (the git feature's
   mutation options), `error` from `toastError`, and the 7 direct `toast.error` sites moved onto
   `toastError`.
5. Record the T3 Code MIT notice for the two mp3s beside them
   (`apps/web/public/notifications/NOTICE`) and the seamui/web-haptics attribution in the engine.

### Phase 2 — Press feel

1. Register `workbench.pressFeel`; write `data-press` in `applyAppearance` and `boot-appearance.ts`.
2. The tokens and the physical `pressable` branch, the switch stretch, popup condense, and the
   reduced-motion fallbacks, all in `globals.css`.
3. `design:census` still passes: no call-site durations or curves, no new radius or shadow.

### Phase 3 — Controls tier

1. `use-feedback-layer.ts`, mounted once. `Button` carries `data-feedback="tap"` by default.
2. The commit voices in `switch`, `select`, and the dropdown and context menu checkbox and radio
   items. Pointer-opened dialogs play `open`.
3. Every primitive the base-component work added gets its row in the table above.

### Phase 4 — Coverage audit and gate

1. Inventory every interactive element in `apps/web/src` that is not a primitive. Each of the 8 raw
   `<button>` sites moves onto `Button` or `ListRow`, or declares `data-feedback` (`tap` or `none`)
   with a reason.
2. Add a `rawControls` check to `scripts/lint/web-design-census.mjs`: a raw `<button>` or
   `role="button"` in `apps/web/src` fails unless `web-design-allow.json` excuses it. This keeps
   "every control fits physical mode" true after this plan, and enforces the existing "do not reach
   for a raw `<button>`" rule.
3. `AGENTS.md`, Design Language: one bullet saying feedback belongs to the primitives, and a new
   interactive primitive declares its press behaviour and voice in the same pass.

### Phase 5 — Phone haptics (after Plan 143)

Only if Plan 143 keeps the phone web layout. `navigator.vibrate` on Android with seamui's PWM
patterns, and the iOS `<input type="checkbox" switch>` taptic, both as a third value of the sound
setting or a separate `workbench.haptics`. Not started before 143 decides what the phone is for.

## Decisions

- **D1 — one sound switch or two.** `chat.notificationMode` has `sound` and
  `notifications-and-sound`. Recommended: narrow it to `off | notifications` (native notifications
  only) and let `workbench.interfaceSounds` own every sound, turn completion included. Greenfield,
  so no migration; update every reader in the same pass. Alternative: keep both, and completion
  plays if either says so.
- **D2 — terminal bell.** Recommended: out of scope; the terminal stays silent. Alternative: `BEL`
  plays `tick` in the events tier.
- **D3 — one feel per device.** Settings are shared by the desktop and a phone on the mesh.
  Recommended: accept that for now and revisit with Plan 143; there is no per-client settings layer,
  and `localStorage` is banned.

Settled here, not open: keyboard activation never clicks; both settings default off; sounds are
independent of `prefers-reduced-motion` (seamui's choice, and there is no reduced-sound query);
tooltips and popovers never sound; no `motion` or `web-haptics` dependency.

## Verification

- **Voice:** a `*.browser.tsx` test renders each voice through an `OfflineAudioContext` and
  asserts its length, that it is not silent, and where the spectral peak falls. No mock: Chromium's
  audio graph is real.
- **Engine rules:** `node` tests for tier filtering, the 30 ms coalescing, the error cap and the
  hidden-tab silence, with the context injected. It is a browser boundary, so a fake is allowed
  there.
- **Scenario `physical-mode`** in `scripts/agent/scenarios/`, selectors in
  `scripts/agent/selectors.ts`, plus a feature-map line. It sets the three settings, asserts
  `data-press`, holds the pointer on a Button and a Switch, and screenshots mid-press. An init
  script counts `AudioContext.prototype.createBufferSource` calls to prove: a press ticks, a
  keyboard activation does not, a row click does not, and `off` is silent. Run `look` on settings,
  a dialog and a menu in both feels and both densities, and read the screenshots back.
- **Reduced motion:** the same scenario repeats the press under `page.emulateMedia({ reducedMotion:
'reduce' })` (as `color-mode-preview.ts` does) and shows the dim, not a scale.
- `bun run gates` (design and compiler census) and `bun run settings:reference`.
- Deploy with `bun run deploy`, then listen on the mesh build, because a scenario cannot judge
  whether it feels good. Owner sign-off closes the plan.
