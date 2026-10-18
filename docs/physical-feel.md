# Physical feel

`workbench.feel` selects Flat, Seam, Brisk, Relaxed or Playful. Flat is the default. The other
profiles add spring motion and control depth. The OS reduced-motion preference replaces movement
with fades and press dimming. `/dev/physical` shows the shared primitives together for device checks.

Control, error, Git and terminal-bell sounds are independent switches under Sounds. They default
off. Controls acknowledge each intentional pointer click. Buttons tap; choices, navigation rows,
and bar tabs tick, including clicks on the current selection and modifier clicks. A click
acknowledges input before navigation or a command finishes. The same native input event sounds
once across nested controls and change callbacks; separate clicks each sound. Picker gestures keep
the original native release as their input, shared by library-generated and native clicks.

Actionable `ListRow` instances get a tick and stationary press dimming automatically. An `onClick`,
`onDoubleClick` or `as='button'` makes a row actionable. `interactive` controls hover styling only.
Informational rows and disabled controls stay quiet. `data-feedback='silent'` opts out of audio.
Rows and bar tabs keep their geometry. Hover, row reordering, touch scrolling, keyboard activation
and programmatic changes stay silent. Press-drag-release selection in a menu or select acknowledges
the chosen item once. A pointer press shows feedback immediately; sound follows its
click, so a touch canceled for scrolling makes no sound. Select triggers dim under a press.
Volume also applies to agent notification sounds. Audio starts only after a user gesture.

Generated picker clicks inherit release provenance only while the native mouseup is dispatching.
The pressed trigger owns its popup and submenus through `aria-controls`; moving between unrelated
rows supplies no choice feedback. An aligned popup covering its trigger still acknowledges a
release within the trigger.

Shared primitives acknowledge in their click capture handler, before an action can remove the
control or stop propagation. Raw controls with an explicit `data-feedback` policy use the document
click listener; a raw action that stops propagation calls `playClickFeedback` in its own capture
handler. The nearest control owns the click, so an icon action inside a row sounds once. Associated
labels acknowledge their original pointer click. Text-field labels stay silent. Base UI Switch
renders its visible switch immediately before its hidden checkbox, with an optional hidden unchecked
value between them. The shared label resolver follows that relationship, covered by DOM tests;
Base UI's forwarded zero-detail checkbox click stays silent.

`scripts/generate-spring-easings.ts` samples seamui's four spring profiles into the generated block
in `packages/ui/src/styles/globals.css`. Run `bun scripts/generate-spring-easings.ts` to regenerate;
its drift and settling tests run with `test:scripts`.

Plan 154 phases 1–6 are implemented. `physical-mode` verifies settings, presses, surfaces and
reduced motion; `physical-chat` checks streamed arrivals and virtualized scrolling. Browser tests
render every voice through Chromium's OfflineAudioContext and pin Flat geometry and keyboard focus.
The owner still needs to judge the feel on the merged mesh build. Phone haptics remain parked with
Plan 143.
