# Plan 196: Polish sliders, menu switches, and picker triggers

## Status and authorization

- Status: PROPOSED 2026-09-27. Planning and push authorized; implementation has not started.
- Planned at: Platform `9c08916bf`, 2026-09-27.
- Priority: P2. Effort: M. Risk: LOW for styling, MED for toggle composition and keyboard behavior.
- Dependencies: none. Reconcile overlapping appearance work before execution.
- Owner decision: improve sliders using the useful parts of shadcn, retain Platform's design,
  fix menu switches and picker-trigger feedback, and evaluate a common toolbar toggle.
- The settings switch is the shared reference for on/off switches throughout the app. Its reuse
  and any extraction needed to share its presentation are in scope. Preserve its accepted design.
  The owner will try the Feel presets separately. Drawer work belongs to another run.

This document records the agreed work for a future implementation run. Publishing this plan does
not authorize its execution in the planning run.

## Outcome

Sliders remain recognizable and responsive in Flat, including dark themes. On/off switches across
the app reuse the settings switch. Menu switches share its presentation while preserving menu
behavior. Select and font-picker
triggers provide consistent hover and press feedback. Persistent toolbar toggles get one shared
treatment if the composition review confirms that their behavior fits a common component.

Keep Flat as the default. Preserve the existing Feel presets and reduced-motion behavior.
The work improves feedback within those choices; it does not choose an animation preference for
the owner or change their saved settings.

## Findings and decisions

| Control                | Evidence                                                                                                                                               | Agreed direction                                                                                                              | Effort / risk                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Slider                 | `packages/ui/src/components/slider.tsx:26` has a 4px track and a 14px `bg-background` thumb, with no explicit hover, active, or disabled treatment.    | Restore useful shadcn interaction cues through Platform tokens. Preserve the single-value API and existing settings behavior. | S / low                          |
| Settings switch        | `packages/ui/src/components/switch.tsx:17` already wraps Base UI and closely matches shadcn Lyra. Spring travel and stretch are in `globals.css:2708`. | Use it as the shared reference across the app. Extract its presentation for menu switches while preserving its design.        | Included in switch consolidation |
| Menu switch            | `packages/ui/src/components/dropdown-menu.tsx:170` uses Base UI `CheckboxItem`, then draws a separate switch with spans.                               | Share visual styling and applicable motion with the settings switch. Retain menu semantics and focus.                         | S / low to medium                |
| Select and font picker | `select.tsx:57` and `combobox.tsx:15` omit shared press feedback and define explicit hover fill only in dark mode.                                     | Add consistent trigger feedback while keeping the popup anchor stationary.                                                    | S / low                          |
| Toolbar toggles        | `apps/web/src/components/toggle-icon-button.tsx:31` and `features/search/components/toggle-button.tsx:26` each own selected styling.                   | Review a shared Toggle and migrate the compatible callers together.                                                           | M / medium                       |
| Drawer                 | Theme studio already uses Base UI Drawer.                                                                                                              | Excluded.                                                                                                                     | Separate run                     |

The initial audit inspected settings on the running mesh app. The Feel setting displayed `flat`.
The slider thumb nearly disappeared against the dark track. DOM inspection reported a 14px thumb,
a dark background, and `box-shadow: none`. This is an observed result, not a proven explanation of
the CSS cascade. Reproduce it before deciding how to fix the ring and shadow composition.

The audit did not exercise slider dragging or toggle motion. The local `agent:browser look --doctor`
failed on this Mac because `/work/tmp` was absent, and `localhost:5173` was unavailable. The mesh
app opened through the browser, but `/platform/dev/physical` returned Not Found. No screenshot
evidence directory was created. Resolve the verification environment before implementation.

## Reference and current implementation

The project selects `base-lyra` in `packages/ui/components.json` and depends on Base UI 1.8.
Compare current upstream source before implementing; do not overwrite local components with the CLI.

- [shadcn Lyra slider source](https://ui.shadcn.com/r/styles/base-lyra/slider.json), inspected 2026-09-27.
  It has a larger invisible thumb target, explicit hover and active rings, disabled opacity, and
  edge alignment. Its square geometry and literal white fill are not requirements for Platform.
- [shadcn Lyra switch source](https://ui.shadcn.com/r/styles/base-lyra/switch.json), inspected 2026-09-27.
  Our settings switch already retains the same basic dimensions and thumb travel.
- [Base UI Slider](https://base-ui.com/react/components/slider) documents thumb labels, events,
  disabled state, keyboard steps, and alignment.
- `docs/physical-feel.md` describes Flat, Seam, Brisk, Relaxed, Playful, and reduced motion.
- `docs/web-design-language.md` and `AGENTS.md` define the local control rules.

Current slider thumb, `packages/ui/src/components/slider.tsx:29`:

```tsx
<SliderPrimitive.Thumb
  aria-label={ariaLabel}
  data-slot='slider-thumb'
  className='focus-ring bg-background ring-foreground/10 size-3.5 rounded-full shadow-(--shadow-key) ring-1'
/>
```

The slider's `onValueCommitted` forwards the callback and plays a pointer feedback tick.
`apps/web/src/lib/appearance/components/material-slider.tsx` separates live `onChange` from
`onCommit` and renders the numeric value and unit. Preserve that contract.

The menu switch is a `MenuPrimitive.CheckboxItem`. Its decorative thumb has no `switch-thumb`
slot. The shared spring selectors therefore do not reach it. Production consumers are
`features/file-picker/components/compact-menu.tsx` and `features/chat/components/model-options-menu.tsx`.

`packages/ui/src/components/button-variants.ts` is the feedback exemplar. It uses `focus-ring`
and `pressable`. `globals.css:601` keeps popup-owning controls stationary and uses press opacity
in physical modes. Preserve that anchoring rule when styling picker triggers.

## Scope and constraints

Implementation may change these files and the narrowly related tests listed below:

- `packages/ui/src/components/{slider,switch,dropdown-menu,select,combobox}.tsx`.
- New shared switch presentation files and a Toggle component or toggle styles under
  `packages/ui/src/components/`. Keep pure class helpers separate from render components.
- `packages/ui/src/styles/globals.css`, limited to these controls and any necessary semantic tokens.
- `apps/web/src/components/toggle-icon-button.tsx` and
  `apps/web/src/features/search/components/{toggle-button,replace-toggle-button}.tsx`.
- Other on/off switch callers under `apps/web/src/` identified by the Phase 2 inventory, limited
  to replacing duplicate switch implementations with the shared Switch or its menu presentation.
- `apps/web/src/features/dev/components/physical-tab.tsx` and new focused gallery components beside it.
- `packages/ui/src/patterns/tests/physical-controls.browser.tsx` and focused new control browser tests there.
- `packages/ui/vitest.browser.config.ts` only if browser commands or dependency discovery need adjustment.
- `scripts/agent/scenarios/{physical-mode,settings-appearance-rows}.ts`, a new
  `control-polish.ts` scenario, `scripts/agent/scenarios/index.ts`, and `scripts/agent/selectors.ts`.
- Relevant verification feature notes under `.agents/skills/verify-fregat/features/` and this plan's checklist.

Keep the following constraints:

- Use Tailwind, shared tokens, shared focus utilities, and the configured timing and easing values.
  Add a semantic token if the existing palette cannot keep the thumb visible across themes.
- Preserve compact and cozy geometry. A larger invisible hit target must not overlap neighboring controls.
- Preserve accessible labels, keyboard operation, disabled states, and controlled component contracts.
- Define pointer sound policy once. Keep keyboard activation silent and avoid duplicate sounds.
- Follow the existing React Compiler rules and maximum nesting depth of three.
- Change shared owners rather than restyling each settings call site.

Out of scope: drawers, sheets, dialog layout, settings-switch redesign, default Feel changes,
new animation dependencies, inputs, textareas, setting persistence, server code, and unrelated cleanup.
Do not animate rows, editor tabs, or terminal input. Phone modifier keys and specialized choice cards
are excluded from the first toolbar-toggle migration because they have different focus contracts.
Do not add range or vertical slider support without a concrete caller requiring it.

## Execution order

### Phase 1: Capture a baseline and complete slider states

- [ ] Reconcile source drift before editing:
      `git diff --stat 9c08916bf..HEAD -- packages/ui apps/web/src/components apps/web/src/features/search apps/web/src/features/dev scripts/agent`.
      Read changed owners and update stale assumptions. Preserve other sessions' edits.
- [ ] Use `verify-fregat` to establish a working dev route. Use `mesh serve ls` and
      `bun run agent:browser look --doctor`. Register a missing route with `bun run dev:serve` on the
      appropriate host. Never hand-start the shared ports or modify the Mac's filesystem to mimic `/work`.
- [ ] Capture the actual settings sliders and the existing physical gallery before changes.
      Record theme, density, Feel, and reduced-motion state with each capture.
- [ ] Add slider examples covering enabled and disabled states to the gallery. Keep the current
      single-value API and accessible name on the thumb's input.
- [ ] Make the thumb visible in light and dark themes, independently of optional depth shadows.
      Inspect computed styles to identify why the current Flat ring disappears.
- [ ] Add distinct hover, pressed or dragging, focus-visible, and disabled treatments.
      Compare upstream's expanded target and edge alignment, adopting them only if they preserve the
      current layout and endpoint behavior. Keep the pointer and thumb aligned during a drag.
- [ ] Keep live value updates immediate. Do not animate position in a way that trails the pointer.
      Use existing Feel motion for feedback, with a static or fading reduced-motion treatment.

Verify: run the focused browser tests and `settings-appearance-rows` command below. They must pass,
including endpoint movement, disabled input, and existing appearance persistence behavior.
Read screenshots for light and dark modes and both densities before continuing.

### Phase 2: Reuse the settings switch throughout the app

- [ ] Inventory on/off switch implementations across `apps/web/src/` and `packages/ui/src/`.
      Start with `rg -n 'Switch|role=.switch|switch-thumb|switch-item' apps/web/src packages/ui/src`.
      Inspect custom track-and-thumb markup too. Record each caller and its migration or existing reuse.
- [ ] Use `@workspace/ui/components/switch` directly wherever ordinary switch semantics fit.
      The settings switch defines the accepted appearance, states, motion, and feedback policy.
      Keep icon toggle buttons in Phase 4; they retain their toolbar presentation.
- [ ] Factor the smallest shared track and thumb treatment needed by Switch and DropdownMenuSwitchItem.
      Preserve settings-switch rendering and behavior. Do not nest an interactive Switch inside a menu item.
- [ ] Apply the same size-appropriate colors and state-travel timing to both presentations.
      Route menu checked state into the shared presentation without duplicating state in React.
- [ ] Keep menu rows stationary. Share thumb feedback where appropriate without giving the whole
      row button-style movement or a second focus target.
- [ ] Preserve menu open behavior, focus return, disabled behavior, and cancellation handling.
      Keep one feedback event per accepted pointer change and silent keyboard activation.
- [ ] Add a menu-switch example beside the normal switch in the gallery.

Verify: focused browser tests must demonstrate pointer and keyboard toggling, unchanged menu
semantics, stable row geometry, and matching thumb travel timing in Flat and a physical preset.
The `control-polish` scenario must exercise both production menu-switch consumers.

### Phase 3: Add picker-trigger feedback

- [ ] Bring SelectTrigger and ComboboxTrigger onto the applicable shared hover and press treatment.
      Cover light and dark modes, enabled and disabled states, focus, and expanded state.
- [ ] Reuse Base UI trigger behavior. Keep popup anchors fixed during pointer and keyboard presses.
      Check actual `aria-haspopup` behavior before relying on the existing stationary-trigger rule.
- [ ] Preserve font-picker search, selection, Escape handling, and focus return.
      Keep existing sound ownership and verify that a trigger press does not double-play feedback.
- [ ] Add Select and font-style Combobox examples beside Button in the gallery.

Verify: focused browser tests must show stable trigger bounds while pressed, visible keyboard
focus, disabled inertness, and correct selection and dismissal. The `control-polish` scenario must
open an enum setting and the Interface font picker through their real settings UI.

### Phase 4: Review and consolidate persistent toolbar toggles

- [ ] Inventory true persistent toggle callers with
      `rg -n 'aria-pressed|ToggleIconButton|SearchToggleButton' apps/web/src/components apps/web/src/features/search`.
      Separate independent on/off actions from mutually exclusive choices and momentary actions.
- [ ] Compare a small Button-based Toggle with Base UI Toggle composition. Use the current toolbar
      behavior as the baseline. Choose the option that preserves controlled state, refs, Tooltip rendering,
      accessible names, shortcuts, focus, and pointer feedback with the least duplication.
- [ ] Record the decision here before migrating callers. A ToggleGroup is not a prerequisite.
      If the callers cannot share one behavior safely, record that finding and defer the component.
- [ ] If the shared Toggle fits, put persistent selected styling in its shared owner and migrate the
      compatible icon and search toggles in one pass. Keep domain command and tooltip wrappers where needed.
      Delete superseded styling. Do not introduce compatibility aliases.

Verify: focused browser tests must prove that `aria-pressed` follows controlled state, activation
fires once, disabled toggles do nothing, and tooltip composition retains a single focusable control.
Exercise the migrated search toggles and one toolbar toggle through `control-polish`.

### Phase 5: Verify and ship the implementation

- [ ] Complete the visual and behavior matrix below. Read every reported screenshot.
- [ ] Run the package checks and required gates. Attribute existing failures before expanding scope.
- [ ] Review the final diff against the scope and preserve settings switches' existing appearance.
- [ ] Commit implementation by explicit paths and push from the shared checkout. Do not stash,
      switch branches, restore files, or reset other sessions' work. A rejected push uses
      `git pull --rebase`, then push again, preserving unrelated changes.
- [ ] Deploy web changes with `bun run deploy`. Verify `/platform/release` and the changed controls
      on the mesh. A server deployment is not part of this plan.
- [ ] Update the plan status according to the current plan-index convention. Record remaining limits.

## Verification commands and evidence

Run package browser tests through plain Node, as the package's existing script does. Use
`physical-controls.browser.tsx` as the test structure and the real Base UI components. Add narrow
tests for the plausible failures above; avoid class-string snapshots or broad test-suite churn.

| Purpose                   | Command                                                                                   | Expected result                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| UI typecheck              | `bun run --cwd packages/ui typecheck`                                                     | Exit 0                                                                 |
| UI lint                   | `bun run --cwd packages/ui lint`                                                          | Exit 0                                                                 |
| Existing control coverage | `bun run --cwd packages/ui test:browser src/patterns/tests/physical-controls.browser.tsx` | All selected tests pass                                                |
| New control coverage      | `bun run --cwd packages/ui test:browser src/patterns/tests/control-polish.browser.tsx`    | New focused tests pass                                                 |
| Appearance integration    | `bun run agent:browser scenario settings-appearance-rows`                                 | Exit 0; saved appearance remains correct                               |
| Existing Feel coverage    | `bun run agent:browser scenario physical-mode`                                            | Exit 0; motion, reduced motion, and feedback checks pass               |
| New real-user coverage    | `bun run agent:browser scenario control-polish`                                           | All selected control paths pass; screenshots and observations recorded |
| Visual capture            | `bun run agent:browser look`                                                              | App ready; screenshot read back                                        |
| Required gates            | `bun run gates`                                                                           | Exit 0; no new exceptions masking these changes                        |
| Whitespace                | `git diff --check`                                                                        | No errors                                                              |
| Web deployment            | `bun run deploy`                                                                          | Live check succeeds; release matches shipped change                    |

Create and register `control-polish` and its focused browser test before running those new commands.
Keep scenario selectors in `scripts/agent/selectors.ts`. Use isolated state for actions that change
settings; do not run a writing scenario against the owner's production state.

Capture Flat and one physical preset in light and dark modes at compact and cozy density.
Cover reduced motion separately, then smoke-test the remaining Feel presets without duplicating
the entire matrix. Record idle, hover, press or drag, keyboard focus, selected, and disabled states
where applicable. Exercise mouse, keyboard, and touch targeting. Motion claims need interaction
evidence or computed animation observations; a still screenshot alone cannot establish them.

Evidence belongs in the verifier's reported directory, normally
`/work/tmp/fregat-evidence/<run>/`. Include the path and any console or network problems in the
implementation report. Performance or render claims require the corresponding trace or render
comparison; this plan makes neither claim.

## Stop conditions and maintenance

Stop the dependent phase and report if the verification host remains unavailable, existing
component contracts differ materially from this plan, or the work requires changes outside the
listed scope. Do not redesign settings switches, drawers, or persistence to get a control test green.

The toolbar-toggle phase may conclude with a documented deferral if its focus or composition
requirements conflict. That does not block the slider, menu-switch, or picker-trigger phases.

Future control changes must inspect both component classes and `globals.css`: Feel behavior is
split across those owners. Keep switch presentation shared without merging Switch and menu item
semantics. Preserve the baseline visual checks when themes, density, focus, or shadow tokens change.
