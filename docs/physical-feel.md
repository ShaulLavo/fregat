# Physical feel

`workbench.feel` selects Flat, Seam, Brisk, Relaxed or Playful. Flat is the default. The other
profiles add spring motion and control depth. The OS reduced-motion preference replaces movement
with fades and press dimming. `/dev/physical` shows the shared primitives together for device checks.

Control, error, Git and terminal-bell sounds are independent switches under Sounds. They default
off. Control sounds follow pointer actions; keyboard activation and list rows stay silent. Volume
also applies to agent notification sounds. Audio starts only after a user gesture.

`scripts/generate-spring-easings.ts` samples seamui's four spring profiles into the generated block
in `packages/ui/src/styles/globals.css`. Run `bun scripts/generate-spring-easings.ts` to regenerate;
its drift and settling tests run with `test:scripts`.

Plan 154 phases 1–6 are implemented. `physical-mode` verifies settings, presses, surfaces and
reduced motion; `physical-chat` checks streamed arrivals and virtualized scrolling. Browser tests
render every voice through Chromium's OfflineAudioContext and pin Flat geometry and keyboard focus.
The owner still needs to judge the feel on the merged mesh build. Phone haptics remain parked with
Plan 143.
