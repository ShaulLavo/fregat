# Plan 154: Physical mode — the seamui feel, with sounds

## Status and authorization

- Status: Phase 1 done 2026-09-25 (lane L1); Phases 2–6 next, Phase 7 parked with Plan 143.
  D1–D5 decided 2026-09-25. D6: Decided 2026-09-25: recommendation (completion wave) — Feel is one
  picker like Density; sounds are a `Sounds` category of per-event switches plus one volume.
  Error sounds come from the error toast's icon (`ToastErrorIcon`), so the 7 direct `toast.error`
  sites stay as they are.
- Priority: P2. The owner is sure about it; nothing else depends on it.
- Effort: L. One spring-token generator, one feedback engine (~150 lines), seven settings, a
  physical branch in `globals.css` for every primitive's motion, voice wiring in about ten
  primitives, one census check.
- Risk: LOW–MED. Everything sits behind settings that default off, and `flat` keeps today's motion
  unchanged. The risk is breadth: every primitive gains a second motion branch, and list entrances
  must not replay on virtualized scroll.
- Scheduling: near the end of the UI refresh lane in [`PLAN.md`](../PLAN.md). Phases 1–3 can land
  any time. Phases 4–6 run after the base-component work in
  Plan 157 (done), so the primitives that work adds (tabs, toggle
  group, checkbox, hold-to-confirm) are wired and audited once, not twice.
- Planned at: Platform `9c1c45d1`, 2026-09-25.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Deploy with `bun run deploy` (web only).

## Outcome

**Physical** is a whole feel, not a press effect. With it on, the app moves on springs instead of
fixed durations. Buttons sink under the pointer or the keyboard and spring back. Switches stretch
before they flip. Checkmarks pop in. Tab indicators slide. Popups, dialogs and toasts rise out of
their anchor with a hint of overshoot. New messages settle into the timeline. An invalid field
shakes. Controls gain seamui's raised-key and sunken-well depth and squircle corners (D4). All
four seamui personalities ship: seam, brisk, relaxed and playful (D5).

Sound is the other half: seamui's synthesized click on press and commit, plus sounds for errors,
git results and the terminal bell. Each kind has its own setting.

Everything is off by default. The feel and the control sounds live in the primitives, so a
control built on a primitive gets them without extra work. Under reduced motion, every movement
becomes an opacity change. Nothing ever goes dead.

## What seamui does (the reference)

Source: `references/seamui/apps/www/registry/seam/` (MIT). `lib/motion.ts` is the single source
of every motion value; `lib/haptics.tsx` is the sound. Teardown:
[seamui.md](../docs/ui-research/seamui.md).

### Motion system

- **Springs, not durations.** Four roles, each a spring: `press` (press-down, near instant),
  `snappy` (release, settle, state changes), `surface` (overlays entering), `bouncy` (accents,
  used sparingly). Plain durations appear only on opacity fades (`fast` 120 ms, `normal` 200 ms).
- **Personalities.** The four roles come from one personality object; swapping it retunes the
  whole library. `seam` press `{600, 40, .5}`, snappy `{420, 30, .7}`, surface `{320, 28, .9}`,
  bouncy `{380, 18, .9}` (stiffness, damping, mass). `brisk` is tighter with no overshoot
  ("dense professional tools"); `relaxed` and `playful` exist too.
- **Depth scale.** `pressed` scale .97, `resting` 1, `raised` 1.02; list entries enter from
  `{opacity 0, scale .96, y 4}` and exit to `{scale .98, y 2}`; modals from `{scale .96, y 8}`.
- **Condense** is the one CSS-expressed motion, because Base UI awaits CSS transitions before it
  unmounts a popup. Surfaces: `transition-[opacity,scale] 200ms cubic-bezier(0.22,1.3,0.36,1)`
  from `scale .95`, exit 150 ms ease-out to `.96`, origin `--transform-origin`, the standalone
  `scale` property because Base UI owns `transform`. Backdrop dims on the same clock. Sheet: 300 ms
  `cubic-bezier(0.32,0.72,0,1)` on `translate`. Toast: rises 24 px, transform 0.5 s and opacity
  0.35 s on the overshoot curve, exits falling 16 px.
- **Shake** `x: [0,-6,6,-4,4,0]` over 320 ms; the reduced form is an opacity flash `[1,.45,1]`.
- **Drill-down:** a nested menu level slides 14 px from the direction of travel while the
  surface springs to its new size.
- **Keyboard:** press depth fires on Space and Enter too (`usePressDepth` handles `keydown`, and
  motion's `whileTap` covers keyboard taps). Sound never fires from the keyboard.
- **Reduced motion, "never go dead":** press dims to `opacity .7`, entrances fade, layout jumps
  instantly, shake flashes.
- **Static depth:** controls are raised "keys" (`--shadow-resting`: two soft shadows) on
  debossed "wells" (`--shadow-well`: an inset shadow) for inputs, tracks and fields, plus
  `corner-shape: squircle`. 38 components use it.

### Per-component feel

| Component                                                            | seamui feel                                                                                                    | Reduced |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| Button (solid variants)                                              | scale .97 on the press spring, release on snappy                                                               | dim .7  |
| Button ghost and link                                                | dim .7 (no shadow to compress)                                                                                 | dim .7  |
| Toggle, toolbar item, accordion and checks triggers                  | press depth through `usePressDepth` (imperative, keeps roving focus alive)                                     | dim .7  |
| Switch                                                               | track presses; thumb stretches 16 → 20 px toward the far side while held; `layout` springs it across on snappy | instant |
| Checkbox                                                             | box presses; check pops `scale 0 → 1` on snappy                                                                | fade    |
| Radio                                                                | ring presses; dot pops `scale 0 → 1` on snappy                                                                 | fade    |
| Slider thumb                                                         | rises to 1.02 while dragged                                                                                    | dim     |
| Tabs, pagination                                                     | active indicator slides (`x`, `width`) on snappy                                                               | instant |
| Accordion, collapsible                                               | height 200 ms ease-out; chevron rotates 200 ms                                                                 | none    |
| Popover, menu, select, combobox, tooltip, preview card, context menu | condense surface                                                                                               | fade    |
| Dialog, alert dialog, command palette                                | condense surface + backdrop on the same clock                                                                  | fade    |
| Drawer                                                               | condense sheet                                                                                                 | fade    |
| Toast                                                                | condense toast; stack offsets `-0.75rem` and scales `-5 %` per index                                           | fade    |
| Field, OTP                                                           | invalid shakes; OTP digit pops `1.12 → 1` as it fills                                                          | flash   |
| Data table                                                           | body fades on sort; sort arrow rotates on snappy                                                               | instant |
| Message, conversation entries, suggestions                           | enter from the overlay depth on snappy / surface                                                               | fade    |
| Copy confirmations (code block, terminal block, branch chip)         | icon crossfade, 120 ms                                                                                         | same    |
| Progress, meter                                                      | width 500 ms ease-out                                                                                          | none    |
| Scroll area                                                          | scrollbar fades in on hover or scroll, out after 300 ms                                                        | same    |
| Avatar image                                                         | fades in 200 ms                                                                                                | same    |
| Typing indicator                                                     | dots bounce on the bouncy spring                                                                               | opacity |

### Sound

No audio files. `web-haptics` synthesizes one voice: a fresh 4 ms white-noise buffer per click,
decaying over ~0.5 ms, through a bandpass (Q 8) centred at `2000 + intensity × 2000` Hz with
±15 % jitter, at gain `0.5 × intensity`. `tap` fires on pointerdown on Button and menu items;
`tick` fires on value commits (switch, checkbox, radio, select, tabs, slider, pagination, OTP,
menu checkbox and radio items); `error` fires on invalid fields. Never on hover, focus, dialogs,
toasts or the keyboard.

## What exists today

- **Press:** `pressable` (`packages/ui/src/styles/globals.css:575`), a 1px `translate-y` on
  `:active`, skipped for `aria-haspopup` controls; `button-variants.ts` applies it.
- **Motion tokens:** `--duration-enter` 140 ms, `--duration-exit` 100 ms, `--ease-out-strong`,
  `--ease-in-out-strong` (`globals.css:101-112`). No spring, no overshoot, no `linear()` curve.
- **Popups** (popover, dropdown and context menu, select, tooltip, dialog) animate through
  `tw-animate-css` keyframes (`zoom-in-95`, fades, a sheet `slide-in-from-right-4`) on those
  tokens. The accordion uses `animate-accordion-down/up`; the switch thumb uses
  `transition-transform`.
- **Static depth:** none by rule. The design language allows three elevations (`shadow-xl` modal,
  `shadow-md` menu, nothing else) and no edge lines.
- **Root attributes:** `applyAppearance` (`apps/web/src/features/settings/utils/apply-appearance.ts`)
  and the pre-paint `apps/web/src/boot-appearance.ts` write `data-density`. `data-feel` goes beside
  it.
- **Reduced motion:** the OS query only. `workbench.reduceMotion` covers terminal loading
  indicators and stays that way.
- **Missing primitives** compared with seamui: toggle, toggle group, checkbox, radio group, tabs,
  slider. `packages/ui` has `bar-tabs.ts` for tabs inside bars (never animated).
- **Lists:** the chat timeline is a `VirtualList` (`messages-timeline.tsx`), so rows mount on
  scroll. An entrance keyed on mount would replay on every scroll.
- **Invalid fields:** `input.tsx` styles `aria-invalid`; nothing moves.
- **Audio:** `apps/web/src/features/chat-mode/state/notification-host.ts` owns a private
  `AudioContext` and plays `public/notifications/{completion,input}.mp3` when `chat.notificationMode`
  includes sound. Both mp3s are byte-identical to T3 Code's notification sounds, MIT, © T3 Tools Inc.
- **Terminal bell:** `ghostty-webgpu` emits `bell`; `features/terminal/state/mount.ts` subscribes
  `title` and `scroll` but not `bell`.
- **Controls outside the primitives:** 8 raw `<button>` sites in `apps/web/src`
  (`timeline-minimap.tsx`, `model-picker-rail-item.tsx`, `palette-card.tsx`,
  `terminal-list-row.tsx`, `editor-tab-button.tsx`, `tab-trailing-slot.tsx`, `bottom-panel.tsx`).
- **Error toasts** funnel through `apps/web/src/lib/toast-error.ts`, except 7 direct `toast.error`
  calls.

## Design

### Settings (provisional until D6)

The table below is the naive shape: one feel switch plus one switch per sound. The owner finds it
awkward (a mode that does a lot, then separate sound switches under it), and Appearance already
carries 16 keys, most of them theme. D6 settles the shape before anything is registered. Whatever
wins is registered in `packages/contracts/src/settings/keys.ts` in the phase that wires its
consumer, with `docs/settings-reference.md` regenerated after each.

| Key                             | Schema                                                  | Default | Scope         | Governs                                                |
| ------------------------------- | ------------------------------------------------------- | ------- | ------------- | ------------------------------------------------------ |
| `workbench.feel`                | `'flat' \| 'seam' \| 'brisk' \| 'relaxed' \| 'playful'` | `flat`  | `window`      | All motion and depth below; presentation, like density |
| `workbench.sounds.controls`     | boolean                                                 | false   | `application` | Press and commit clicks                                |
| `workbench.sounds.errors`       | boolean                                                 | false   | `application` | Error toasts                                           |
| `workbench.sounds.git`          | boolean                                                 | false   | `application` | Commit created, push done, PR opened                   |
| `workbench.sounds.terminalBell` | boolean                                                 | false   | `application` | `BEL` from any terminal                                |
| `workbench.sounds.volume`       | `percentSchema`                                         | 50      | `application` | Every sound, agent notifications included              |
| `chat.notificationMode`         | unchanged                                               | `off`   | `application` | Keeps its sound values: turn finished, input requested |

Sounds are `application` scope because a workspace file must not turn sound on for everyone who
clones the repo. The feel and the sounds are independent: someone can want either without the
other.

### Springs in CSS

We do not take `motion`. CSS `linear()` easing approximates any spring closely, and so do our
popups: Base UI awaits CSS transitions, so springs as CSS are the right shape anyway.

- `scripts/generate-spring-easings.ts` turns each of the four personalities' springs into
  `linear()` curves and settle durations (the time until the spring stays within 0.1 % of rest).
  It writes them into `globals.css` between generated markers, one block per personality under
  `:root[data-feel='<personality>']`: `--spring-press`, `--spring-snappy`, `--spring-surface`,
  `--spring-bouncy`, each with a `--spring-*-duration`. Rough values for `seam`: press ~200 ms with
  no overshoot, snappy ~320 ms, surface ~440 ms, bouncy ~690 ms. The generator decides the exact
  numbers.
- Every physical rule below is written once, against `:root:not([data-feel='flat'])`, and reads
  only the tokens. A personality is therefore four token values and nothing else, and a fifth
  personality later is one entry in the generator.
- A `node` test re-runs the generator and fails if `globals.css` has drifted, so the tokens stay
  one source.
- Fades use two duration tokens, `--fade-fast` 120 ms and `--fade-normal` 200 ms.
- Under any personality the existing motion tokens resolve to springs: popups,
  accordions and the switch pick up the new curve without per-call-site edits. Under `flat`,
  nothing changes.

### The feel, element by element

All CSS, keyed on `:root:not([data-feel='flat'])`, living in `globals.css` utilities and the primitives'
own classes. Call sites change nothing.

| Element                                                                    | Physical                                                                                                                                                                                                                                            | Reduced motion | Wired in                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `pressable` (Button and all consumers)                                     | `scale: .97` on press over `--spring-press`, release on `--spring-snappy`; ghost and link dim to .7                                                                                                                                                 | dim .7         | `globals.css` `pressable`                                                             |
| Keyboard press                                                             | the same depth while Space or Enter is held: the feedback layer sets `data-pressing` on keydown and clears it on keyup or blur                                                                                                                      | dim            | `use-feedback-layer.ts`                                                               |
| Switch                                                                     | track presses; thumb widens 25 % toward its far side while held; travels on `--spring-snappy`                                                                                                                                                       | instant        | `switch.tsx`                                                                          |
| Menu checkbox and radio indicators, and checkbox and radio once they exist | pop `scale 0 → 1` on `--spring-snappy` via `@starting-style`                                                                                                                                                                                        | fade           | `dropdown-menu.tsx`, `context-menu.tsx`, new primitives                               |
| Tabs, segmented control (from the base-component work)                     | Base UI indicator slides on `--spring-snappy`                                                                                                                                                                                                       | instant        | the new primitive                                                                     |
| Popover, menus, select, command, tooltip                                   | condense: from `scale .95`, `--spring-surface`; exit 150 ms ease-out to `.96`; standalone `scale` property                                                                                                                                          | fade           | each primitive's popup class                                                          |
| Dialog                                                                     | condense from `scale .96, y 8`; backdrop on the same clock; side sheet slides on the sheet curve                                                                                                                                                    | fade           | `dialog.tsx`                                                                          |
| Toast                                                                      | rises 24 px on the overshoot curve, exits falling 16 px                                                                                                                                                                                             | fade           | `sonner.tsx` (sonner's own transition, overridden under `data-feel`)                  |
| Accordion, collapsible                                                     | height and chevron on `--spring-snappy`                                                                                                                                                                                                             | none           | `accordion.tsx`, `collapsible.tsx`                                                    |
| Invalid field                                                              | shake `[0,-6,6,-4,4,0]` px over 320 ms when `aria-invalid` turns true, pure CSS                                                                                                                                                                     | flash          | `input.tsx`, `textarea.tsx`, `input-group.tsx`                                        |
| New chat messages, new timeline rows, new toasts                           | enter from `{scale .96, y 4}` on `--spring-snappy`                                                                                                                                                                                                  | fade           | rows carry `data-entering` only when they arrive live, never on a virtualized remount |
| Copy confirmation                                                          | icon crossfade `--fade-fast`                                                                                                                                                                                                                        | same           | `copy-button.tsx`                                                                     |
| Ticker numbers, meter fills                                                | width and value on `--spring-snappy`                                                                                                                                                                                                                | none           | `ticker-number.tsx`, usage meter                                                      |
| Hold-to-confirm (if the base-component work adds it)                       | the fill on `--spring-press`, shake on release before completion                                                                                                                                                                                    | flash          | the new primitive                                                                     |
| Depth (D4)                                                                 | raised keys (`--shadow-key`) on solid buttons, switch thumbs and slider thumbs; sunken wells (`--shadow-well`) on inputs, textareas, input groups and switch tracks; `corner-shape: squircle` on controls (Chromium; other engines keep the radius) | same           | primitives only                                                                       |

Never moved, in either feel: `ListRow`, tabs inside a bar, the editor, the terminal, the session
rail. Scale blurs text for a frame, and those surfaces are too dense to move. The session rail
also has a zero-render contract.

Out of scope, with a home elsewhere: drill-down nested menus change menu structure, so they belong
with the base-component work. The typing indicator is our loaders' job. Panel width animation
belongs to `react-resizable-panels`.

### The feedback engine: `packages/ui/src/patterns/feedback-layer.ts`

Stateful, so it is a pattern module, not `utils/`. It lives in `packages/ui` because primitives
call it and `packages/ui` cannot import the app. No `web-haptics` dependency: the voice is ~60 lines
to port (MIT attribution in a one-line comment), and the package's iOS path appends a label to
`<body>` and dispatches synthetic clicks.

- One lazily created `AudioContext` (`latencyHint: 'interactive'`) and one master gain, created or
  resumed only inside a gesture. `notification-host.ts` drops its own context and unlock and plays
  its mp3s through this one.
- Voices: `tap` (i .4), `tick` (i .7), `tick-off` (i .7, centre −20 %), `open` (i .3, ~1.6 kHz),
  `success` (two rising clicks 60 ms apart), `error` (seamui's heavy rattle), `bell` (i .5,
  ~1.2 kHz).
- Each call names its channel: `controls`, `errors`, `git`, `terminalBell` or `agent`.
  `configureFeedback({ channels, volume })` says which are on; `playFeedback(voice, channel)`
  drops the rest, so call sites never read a setting.
- Silent when `document.hidden`. It coalesces one voice within 30 ms, caps `error` at one per 2 s
  and `bell` at one per 500 ms. It never throws into the UI.
- `use-feedback-layer.ts` mirrors `use-tooltip-layer.ts`: document `pointerdown` (primary button,
  sound and press) and `keydown`/`keyup` (Space and Enter, press depth only) listeners that read
  `closest('[data-feedback]')` and skip disabled and `data-feedback="none"`. Delegation puts
  nothing on each control, adds no React cost, and costs nothing inside virtualized rows. It is
  mounted once next to `<TooltipLayer />` in `apps/web/src/components/active-environment-application.tsx`,
  which also pushes the settings through `configureFeedback`.

### Which control makes which sound

| Control                                                                               | Voice                     | Channel      |
| ------------------------------------------------------------------------------------- | ------------------------- | ------------ |
| `Button` and everything built on it; menu item select                                 | `tap` on pointerdown      | controls     |
| `Switch`                                                                              | `tick` on, `tick-off` off | controls     |
| `Select` commit; menu checkbox and radio items                                        | `tick`                    | controls     |
| Tabs, toggle group, checkbox, radio, slider (when they exist)                         | `tick` on commit          | controls     |
| Dialog opened by a pointer                                                            | `open`                    | controls     |
| Error toast                                                                           | `error`                   | errors       |
| Commit created, push done, PR opened                                                  | `success`                 | git          |
| Terminal `BEL`                                                                        | `bell`                    | terminalBell |
| Agent turn finished, input requested                                                  | the existing mp3s         | agent        |
| Rows, bar tabs, command palette, tooltip, popover, editor, terminal input, keystrokes | silent                    | —            |

## Phases

### Phase 1 — Event sounds

1. `feedback-layer.ts`: the voice port, channels, coalescing, hidden-tab silence.
2. Register `workbench.sounds.errors`, `.git`, `.terminalBell` and `.volume`, and push them through
   `configureFeedback`.
3. `notification-host.ts` plays through the shared context on the `agent` channel.
4. `success` from the commit, push and PR mutations' `onSuccess`; `error` from `toastError`, with
   the 7 direct `toast.error` sites moved onto it; `bell` from `terminal.on('bell')` in
   `features/terminal/state/mount.ts`.
5. A `NOTICE` beside the mp3s for T3 Code's MIT licence.

### Phase 2 — Feel foundation

1. Register the feel setting (shape per D6); write `data-feel` in `applyAppearance` and
   `boot-appearance.ts`.
2. The spring generator with all four personalities, their tokens, and the drift test.
3. `pressable` physical branch, keyboard press depth through the feedback layer's key listeners,
   and the reduced-motion fallbacks.
4. The depth tokens (D4): `--shadow-key` and `--shadow-well`, `none` under `flat`, each with a
   light and dark value. Squircle corners inside the primitives. `web-design-census.mjs` learns
   that these two shadows are legal only inside `packages/ui` and only through the tokens, and
   `AGENTS.md`'s elevation rule gains the physical-mode exception.

### Phase 3 — Surfaces

Condense for popover, menus, select, command and tooltip; the dialog and its backdrop; sheets;
toasts; accordion and collapsible. Keep the `tw-animate-css` classes as the `flat` branch.

### Phase 4 — State motion (after the base components)

Switch stretch and spring, indicator pops, tab and segmented indicators, the invalid shake, live
list entrances with `data-entering`, copy crossfade, tickers and meters, and every primitive the
base-component work added.

### Phase 5 — Control sounds (after the base components)

Register `workbench.sounds.controls`. `Button` carries `data-feedback="tap"`; the commit voices go
into switch, select, the menu items and each new primitive.

### Phase 6 — Coverage audit and gate

1. Every interactive element in `apps/web/src` that is not a primitive: the 8 raw `<button>` sites
   move onto `Button` or `ListRow`, or declare `data-feedback` with a reason.
2. A `rawControls` check in `scripts/lint/web-design-census.mjs`: a raw `<button>` or
   `role="button"` in `apps/web/src` fails unless `web-design-allow.json` excuses it.
3. `AGENTS.md`, Design Language: feedback belongs to the primitives. A new interactive primitive
   declares, in the same pass, its physical motion, its reduced form and its voice.

### Phase 7 — Phone haptics (after Plan 143)

Only if Plan 143 keeps the phone web layout. `navigator.vibrate` on Android with seamui's PWM
patterns and the iOS `<input type="checkbox" switch>` taptic, behind `workbench.haptics`. Haptics
follow device capability, so a shared setting does nothing on a desktop.

## Decisions

Made by the owner, 2026-09-25:

- **D1 — several sound settings.** One boolean per kind plus a shared volume.
  `chat.notificationMode` keeps its sound values.
- **D2 — the terminal bell is its own setting,** default off.
- **D3 — no per-device feel.** Added only if seamui's feel differed on mobile, and it does not:
  the registry has no `pointer: coarse` or `hover: none` query, and the springs, scales and
  durations are the same everywhere. The only mobile difference is haptics (Phase 7).

- **D4 — depth is in.** Raised keys, sunken wells and squircle corners, in physical mode only and
  inside the primitives only, through two tokens that are `none` under `flat`.
- **D5 — all four personalities.** seam, brisk, relaxed and playful all ship; the user picks.

Open:

- **D6 — settings semantics. Decide before any phase starts.** A physical mode that changes a
  lot, with separate sound switches beside it, gets awkward fast, and Appearance is already
  crowded by theme settings. Questions to answer:
  - Is sound part of the feel or orthogonal to it? If part of it, picking "seam" turns clicks on
    and the per-kind switches become overrides. If orthogonal, they are two unrelated groups.
  - Is there a master switch at all? VS Code has none for sounds: `accessibility.signals.<event>`
    carries its own `sound: on | auto | off` per event, plus `accessibility.signals.sounds.volume`
    (`references/vscode/src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts`).
    That model has no mode to feel awkward under, at the cost of many keys.
  - Presets plus overrides, like `workbench.theme` + `workbench.theme.customizations`? It is
    consistent with what exists, but it copies the part of theming that already hurts.
  - Where does it live on the settings page: under Appearance, beside density, or in a group of
    its own ("Feel")?
    Proposed answer (Claude, 2026-09-25, not yet confirmed): Feel is a single picker like Density
    (Flat, Seam, Brisk, Relaxed, Playful), not a mode. Sounds are a separate list of events, each on
    or off, plus one volume, as in VS Code's accessibility signals. Neither sits under the other.
    Before deciding, sketch the whole Appearance page as it would look with the feel settings in it,
    and settle theming's shape too, since both land on that page.

Also settled: sound never fires from the keyboard, but press depth does. Everything defaults off.
Sound is independent of `prefers-reduced-motion`. No `motion` or `web-haptics` dependency.

## Verification

- **Springs:** the generator's drift test, plus a `node` test that each curve starts at 0, ends at
  1, and overshoots only where its damping ratio says it should.
- **Voice:** a `*.browser.tsx` test renders each voice through an `OfflineAudioContext` and
  asserts length, non-silence and the spectral peak. Real Chromium audio, no mock.
- **Engine rules:** `node` tests for channel filtering, coalescing, the error and bell caps, and
  hidden-tab silence, with the context injected.
- **Scenario `physical-mode`** in `scripts/agent/scenarios/`, selectors in
  `scripts/agent/selectors.ts`, plus a feature-map line. It switches `workbench.feel`, asserts
  `data-feel`, and screenshots mid-press on a Button (pointer and Space), a Switch mid-stretch, a
  menu and a dialog mid-entrance, and an invalid field mid-shake. Scrolling the chat timeline back
  and forth must not replay an entrance: `data-entering` count stays 0 while scrolling. An init
  script counts `AudioContext.prototype.createBufferSource` calls to prove: a press ticks, a
  keyboard press is silent, a row click is silent, each sound setting silences only its channel,
  and `printf '\a'` plays `bell` once.
- **Reduced motion:** the scenario repeats under `page.emulateMedia({ reducedMotion: 'reduce' })`
  (as `color-mode-preview.ts` does); every step shows a dim or fade, never a still frame.
- **Performance:** `trace` on the chat stream and a menu open, physical against flat, with
  `--compare`. Springs must not add long tasks.
- `bun run gates` and `bun run settings:reference`.
- Deploy with `bun run deploy`, then the owner uses it on the mesh build. A scenario cannot judge
  whether it feels right, so owner sign-off closes the plan.
