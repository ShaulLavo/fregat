# seamui — teardown and "physical mode" sketch

Source: https://seamui.dev, repo `meiskv/seamui` (MIT, © 2026 Mikhail Villamor), cloned at
`references/seamui` (HEAD 7c57149, 2026-08-01). Canonical sources: `apps/www/registry/seam/`.
Stack: shadcn registry model, Base UI, `motion` 12, Tailwind v4 — close to ours except `motion`.

## Catalog (67 components, 305 registry items)

- **Foundation, in seven waves:** button, toggle, toggle-group, toolbar, input, textarea, avatar, separator,
  switch, checkbox(-group), radio-group, slider, tooltip, popover, preview-card, dialog,
  alert-dialog, drawer, dropdown-menu, select, context-menu, combobox, tabs, accordion,
  collapsible, progress, meter, number-field, otp-field, scroll-area, toast, label, field, form.
- **General:** card, badge, skeleton, spinner, kbd, empty-state, alert, breadcrumb, pagination,
  table, data-table, sidebar, command-palette.
- **AI/agent:** message, conversation, composer, response, code-block, tool, reasoning,
  typing-indicator, suggestions, sources, chat-timeline, permission-card, plan-card,
  connector-card, model-picker, mode-selector, context-meter, agent-status.
- **Workbench** (this is our domain): workbench-header, session-item (+hover card), branch-chip
  (sync / PR), checks-panel (CI + merge action), terminal-block, device-selector.
- **Voice:** voice-visualizer, voice-avatar, dictation-card, voice-control-bar, media-toggle.
- **Blocks:** auth, settings, team, billing, notifications.

## How the sounds work

There are **no audio files**. Every sound is one synthesized click from the `web-haptics` npm
package (MIT, Lochie Axon, v0.0.6, 6.4 KB min). seamui's `lib/haptics.tsx` is a 70-line
provider over `useWebHaptics({ debug: sound })`. The package's "debug" mode is where the audio
lives.

**The click voice** (`web-haptics/dist/chunk-*.mjs`, `playClick` / `ensureAudio`):

| Stage     | Value                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source    | `AudioBuffer`, mono, **4 ms** (`sampleRate * 0.004`)                                                                                                                         |
| Waveform  | white noise × `exp(-n / 25)`. The decay constant is 25 samples, about 0.5 ms at 48 kHz, so the audible tick is about 2 ms                                                    |
| Variation | the buffer is **refilled with fresh noise on every click**, so no two clicks are identical                                                                                   |
| Filter    | `BiquadFilter` **bandpass, Q = 8**, centre `2000 + intensity × 2000` Hz × random jitter `1 ± 0.15`                                                                           |
| Gain      | `0.5 × intensity`                                                                                                                                                            |
| Graph     | `BufferSource → bandpass → gain → destination`; each click is a new `BufferSource` that disconnects `onended`                                                                |
| Context   | created lazily inside the first `trigger()` (always a pointer gesture, so autoplay allows it); `resume()` if suspended. `latencyHint` is left at its default (`interactive`) |
| Preload   | none needed. The first click awaits context creation; after that playback is synchronous                                                                                     |

**Patterns → repeated clicks.** A preset is a list of `{duration, intensity, delay}` segments.
During an "on" segment a rAF loop re-clicks every `16 + (1 − intensity) × 184` ms. A light tap
therefore makes one click, and a heavy 35 ms segment makes a 2–3 click rattle.

**seam's four presets** (`INTENSITY` map → web-haptics presets):

| seam preset            | web-haptics                                                              | Vibration | Audible result                          |
| ---------------------- | ------------------------------------------------------------------------ | --------- | --------------------------------------- |
| `tap` (press)          | light: 15 ms @ 0.4                                                       | 15 ms     | 1 click, ~2.8 kHz, gain 0.2             |
| `tick` (state commits) | medium: 25 ms @ 0.7                                                      | 25 ms     | 1 click, ~3.4 kHz, gain 0.35            |
| `success`              | medium (same as tick; the richer two-pulse `success` preset goes unused) | 25 ms     | 1 click                                 |
| `error`                | heavy: 35 ms @ 1.0                                                       | 35 ms     | 2–3 clicks 16 ms apart, 4 kHz, gain 0.5 |

Unused web-haptics presets are worth keeping: `success` [30 ms @ .5, gap 60, 40 ms @ 1],
`warning` [40 @ .8, gap 100, 40 @ .6], `error` [3 × 40 @ .9, gaps 40], `selection` 8 ms @ .3,
`rigid` 10 ms @ 1, `soft` 40 ms @ .5, `nudge` [80 @ .8, gap 80, 50 @ .3].

**Haptics.** Android uses `navigator.vibrate(pattern)`, where intensity is faked by PWM: 20 ms
slots split on/off by intensity. iOS 18 Safari has no Vibration API, so the package appends a
hidden `<label for=…><input type="checkbox" switch></label>` to `<body>` and calls
`label.click()`. The native switch plays the system taptic. Desktop Chrome defines
`navigator.vibrate` as a no-op, so the audio is the only feedback there.

**Where it fires** (per component):

- **Button, Toggle, Toolbar item:** `tap` on `pointerdown`, primary button only. It fires on
  pointerdown, not on click, which is half of why it feels instant. Keyboard activation does not
  fire it.
- **Switch, Checkbox, Radio, Select, Tabs, Slider (commit), Pagination, OTP (per digit), menu
  checkbox/radio items:** `tick` in `onCheckedChange` / `onValueChange`.
- **Menu item select:** `tap`.
- **OTP invalid, Field invalid, data-table edit rejected:** `error`.
- **Never:** hover, focus, dialog open/close, or toasts. The owner's "little sounds" are one
  click at different pitches.

Controls: `<HapticsProvider enabled sound>` (two booleans) and a per-control prop,
`haptic={false | preset}`. Without a provider every trigger is a no-op. Sounds are
deliberately orthogonal to `prefers-reduced-motion`.

## How the feel works (exact values)

`lib/motion.ts` is the single source of motion values. Everything is a spring except
opacity fades.

- **Springs.** The `seam` personality: press `{stiffness 600, damping 40, mass .5}`, snappy
  `{420, 30, .7}`, surface `{320, 28, .9}`, bouncy `{380, 18, .9}`. Three alternates retune the
  whole library in one line. `brisk` (800/50/.4 press) is labelled "dense professional tools"
  and is the one that fits us.
- **Depth.** Pressed is `scale .97`, resting 1, raised 1.02. Overlay enters at
  `{opacity 0, scale .96, y 4}` and exits at `{scale .98, y 2}`. Modal enters at
  `{scale .96, y 8}` and exits at `{scale .97, y 6}`.
- **Press.** `whileTap` goes to .97 on the press spring (≤1 frame) and releases on the snappy
  spring, with slight overshoot. Ghost and link variants dim to `opacity .7` instead of scaling,
  because they have no shadow to compress. Composite items (toolbar, tabs) use imperative
  `animate()` on the plain element, because a motion component in Base UI's render path breaks
  roving-focus registration.
- **Switch.** While pressed, the thumb **stretches 16 → 20 px** (sm 12 → 15) toward the far
  side, then springs across on release. This is the iOS feel. The thumb uses `layout`; the
  track swaps `justify`.
- **Base UI popups ("condense", CSS only, because Base UI awaits CSS transitions before
  unmounting).** Enter: `transition-[opacity,scale] 200ms cubic-bezier(0.22,1.3,0.36,1)` from
  `scale .95`. Exit: 150 ms ease-out to `scale .96`. Origin is `var(--transform-origin)`. They
  animate the standalone `scale` property, because Base UI owns `transform`.
- **Sheet:** 300 ms `cubic-bezier(0.32,0.72,0,1)` on `translate`. **Toast:** transform 0.5 s /
  opacity 0.35 s on the overshoot bezier.
- **Error shake:** `x: [0,-6,6,-4,4,0]`, 320 ms easeInOut. **Drill-down (nested menu):** the
  incoming level slides 14 px from the direction of travel while the surface springs to its new
  size. The old level unmounts at once, because a lingering level keeps its items registered for
  arrow keys.
- **Reduced motion, "never go dead":** press becomes `opacity .7`, entrances become fades,
  layout changes become instant, and shake becomes an `opacity [1,.45,1]` flash.
- **Static depth:** "debossed wells, embossed keys" (inset `shadow-well` tracks and raised
  `shadow-resting` thumbs), plus `corner-shape: squircle` on controls (Chrome 139+).

## Physical mode for platform (sketch)

**Settings** (`packages/contracts/src/settings/keys.ts`, category Appearance; each key
registered in the same pass as its consumer):

- `workbench.pressFeel: 'flat' | 'physical'`, default `flat`. It is written to the root as
  `data-press` next to `data-density` in `boot-appearance.ts`, so the motion half is pure CSS.
- `workbench.interfaceSounds: 'off' | 'events' | 'controls-and-events'`, default `off`.
- `workbench.interfaceSoundVolume: number 0–100`.

None of these reaches execution, so `application` scope is fine. Fold the existing
`chat.notificationMode` sound half into the `events` tier rather than keeping two sound switches
(open question below).

**One sound engine** in `packages/ui`, because primitives must reach it and `packages/ui` cannot
import the app:

- `packages/ui/src/patterns/feedback-layer.ts` (stateful: one `AudioContext`, one gain node).
  It holds a ~60-line port of the web-haptics click voice and a small voice table. Do not take
  the `web-haptics` dependency: its iOS trick appends a label to `<body>` and dispatches
  synthetic `click` events through document listeners.
- `use-feedback-layer.ts` mirrors `use-tooltip-layer.ts`. It installs one document `pointerdown`
  / `keydown` listener that reads `data-feedback="tap"` from the closest element. That puts
  nothing on each control, adds no React cost, and virtualized rows are free.
- An imperative `playFeedback(voice)` covers what delegation cannot see: state commits,
  open/close, and app events.
- The app composition layer mounts it once and pushes `configureFeedback({ tier, volume })` from
  `useSettingValue`. `notification-host.ts` drops its private `AudioContext`/`unlock` and plays
  its two mp3s through the same context. The mp3s stay: a notification is a chime, not a click.
  The origin and license of `completion.mp3` / `input.mp3` (landed in 2acc3b73, plan 126) need
  checking.

**How primitives opt in:**

| Primitive                                               | Motion (`data-press="physical"`)                                                                                                                                                                          | Sound                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pressable` utility (Button and every consumer)         | `scale .97` on `:active` via the standalone `scale` property, press ~60 ms; release on a new `--ease-spring: cubic-bezier(0.22,1.3,0.36,1)` token. The existing "no nudge for `aria-haspopup`" rule stays | `data-feedback="tap"` on pointerdown                                    |
| `switch`                                                | thumb stretches +25 % toward the far side while `:active`; spring across on toggle                                                                                                                        | `tick-up` when turned on, `tick-down` when turned off (±20 % pitch)     |
| checkbox / menu checkbox / radio items, `select` commit | —                                                                                                                                                                                                         | `tick`                                                                  |
| `dialog`                                                | condense enter from `scale .96` on `--ease-spring`                                                                                                                                                        | `open` (soft, i=.3, lower centre ~1.6 kHz) / `close` (i=.25)            |
| `dropdown-menu`, `popover`, `tooltip`                   | condense enter only                                                                                                                                                                                       | silent: they open too often, mostly from the keyboard                   |
| `sonner`                                                | spring enter                                                                                                                                                                                              | `error` for error toasts (coalesced to one per 2 s); no sound otherwise |
| `ListRow`, tabs in a bar, editor, terminal input        | none: dense surfaces never scale                                                                                                                                                                          | silent                                                                  |

**Reduced motion.** Under `prefers-reduced-motion` or `workbench.reduceMotion`, physical press
becomes an opacity dim and never goes dead (seam's rule). Browsers ship no
`prefers-reduced-sound`, so sound is its own opt-in: default `off`. The engine also stays silent
when `document.hidden` is true, coalesces the same voice within 30 ms, and ignores key repeats.

**Events that earn a sound (`events` tier):**

| Event                              | Voice                                            |
| ---------------------------------- | ------------------------------------------------ |
| Agent turn finished                | existing `completion.mp3`                        |
| Approval or input requested        | existing `input.mp3`                             |
| Commit created, push, or PR opened | synth `success` (two rising clicks, 60 ms apart) |
| Mutation error toast               | synth `error`                                    |
| Terminal bell                      | opt-in only (open question)                      |

These stay silent: keystrokes, command-palette execution, file saves, and undo.

## Steal list

1. **The click voice.** Port it (no dependency, no audio assets, no licensing risk; MIT
   attribution in a comment). Highest joy per line of code.
2. **Fire on pointerdown**, not click, for press sounds.
3. **The switch press-stretch** (16 → 20 px). CSS-only with `:active`.
4. **Condense popups on the standalone `scale` property** with an overshoot bezier. Needs one
   new `--ease-spring` token. Our current 140/100 ms ease-out-strong stays the `flat` default.
5. **Personalities as one knob.** If we ever add springs, `brisk` is the starting point.
6. **Reduced-motion "never go dead" fallbacks** (dim, flash): a rule for our reduced-motion
   work, not just this feature.
7. **The drill-down menu:** lateral 14 px entry with an instant unmount of the old level (the
   roving-focus reason is real).
8. **permission-card "receipt".** A decided prompt settles into a quiet one-line audit receipt
   instead of vanishing. Compare our `pending-approval-panel`.
9. **agent-status vocabulary:** waiting (on you) / working / ready (to review) / done / error.
   State reads through shape, and only error gets a hue.
10. **`corner-shape: squircle`** inside the primitives (progressive; Firefox falls back to
    radius). It fits "corners belong to the primitives".

Not stolen: debossed wells and embossed keys with shadows. They break "no dividers" and the
three-level elevation rule, and would need an owner-level design-language change.

## Cost / risk

- **Engine + settings + primitives wiring:** about 1–2 days. No new runtime dependency; the
  `motion` library is not needed, because everything above is expressible in CSS plus the
  `scale` property.
- **Latency.** PipeWire adds 10–40 ms and Bluetooth output 150 ms or more, and a late click
  feels worse than none. Use `latencyHint: 'interactive'`; the tier stays off by default.
- **Autoplay.** The context must be created or resumed inside a gesture. The notification host
  already solves this; share it.
- **Annoyance in an IDE.** Keyboard-heavy use makes per-keystroke or per-command sounds
  unbearable. Hence the tiering and the silent list.
- **Scale-on-press in dense UI** blurs text for a frame. Limit it to buttons, switches and
  toggles, never rows.
- **Census.** New tokens (`--ease-spring`, press duration) must go through globals.css, not
  call sites. `pressable` changes touch every Button.

## Open questions

1. Per-device feel. A phone on the mesh and the desktop share `application`-scoped settings.
   Do we want per-client values (there is no settings layer for that today, and `localStorage`
   is banned)?
2. Should `chat.notificationMode` split, so native notifications stay there and its sound moves
   into `workbench.interfaceSounds`, or should both coexist?
3. Should keyboard activation of a button click (seam: no), or only pointer presses?
4. Terminal bell: map `BEL` to a soft tick, or leave the terminal silent?
5. Real haptics on iPhone via the `<input switch>` trick: worth porting as an optional half, or
   is audio enough?
6. Where did `completion.mp3` and `input.mp3` come from, and under what license?
