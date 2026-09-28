# Plan 178: parity harness

- Status: DONE 2026-09-26 (wave 2, lane T). Size M. First sub-plan; every other one depends on it.
- Owns: the tooling that proves a replacement kept the tree's look and behaviour.

## Outcome

One command captures the tree across the density × colour-mode × state matrix, diffs it against a
committed baseline pixel by pixel and property by property, and fails on drift. Every behaviour in
the [parity spec](parity-spec.md) marked ✗ has a test or scenario, written against today's tree so
it passes before any replacement starts.

## What exists

- `agent:browser look --selector '[aria-label="Folder tree"]'` reaches the tree; Playwright pierces
  the shadow root.
- `look` has no density or colour-mode flag. The 2026-09-26 baseline used a scratch driver that
  writes `workbench.density` and `workbench.colorTheme` through `/settings/write` on the throwaway
  server (`/work/tmp/plan178-parity-llLM/capture.ts`, `capture-git.ts`).
- No pixel diff exists in the repo: `--compare` diffs trace timings only. No `pixelmatch`, `odiff`
  or `toHaveScreenshot`.
- Turning the wallpaper off needs the setting's `source` field; the scratch driver got it wrong.

## Work

1. **Fixture.** Commit the fixture repo as a scenario fixture: every git state, a flattened chain,
   a long name, an unreadable folder, a deep tree for sticky rows, and a `/fs/read` held open for
   the loading state.
2. **Matrix.** A `look` option or scenario helper for density × mode, and a correct wallpaper-off
   write. Element screenshots at device scale 2 after `document.fonts.ready`, animations off, caret
   hidden.
3. **States**, driven by real input: rest, hover, keyboard focus, click focus, multi-select, menu
   open, F2 rename, mouse drag over a folder, filter match, filter empty, sticky mid-scroll, loading
   file, loading folder, failed folder with its action, every git state.
4. **Pixel diff.** `pixelmatch` or `odiff` writing a diff image and a mismatch percentage per state
   into the evidence directory, with a per-state threshold.
5. **Computed-style diff.** Snapshot the resolved geometry and colours per state (row box, padding,
   gap, icon box, name x, guide x, font, colours) and diff them exactly. Sub-pixel shifts hide in
   pixel noise; this is the check that catches them. The probe queries the document, not a shadow
   root, so it works before and after [out-of-the-root](out-of-the-root.md) with one selector switch.
6. **Behaviour coverage.** A test or scenario for every ✗ in the parity spec, grouped by the
   sub-plan that will replace it. Pointer and drag cases run as real input in `*.browser.tsx` or
   scenarios, not synthetic events. The `chat-composer-insert` drop becomes a real row drag.
7. **Baseline.** Commit the baseline images and style snapshots, and a `trace` + `renders` baseline
   for `tree-sticky-scroll` and `workspace-open-large-root`.

## Verification

- The harness passes against today's tree, twice in a row, with no drift.
- A deliberate 0.5px padding change fails the style diff; a colour change fails the pixel diff.

## Reused by

Any surface that is rebuilt and must look the same: the git changes list, the session rail and
search results when they adopt the primitives this plan builds.

## Landed

- **Run it:** `WEB_PORT=<port> bun run agent:browser scenario tree-parity` (scale 2, 1440×900 by
  default). Drift fails the run; `tree-parity/<state>/<combo>.diff.png` and `.styles.txt` in the
  evidence directory show it. `TREE_PARITY_UPDATE=1` rewrites the baseline, `TREE_PARITY_STATES`
  limits the states. Committed baseline: `scripts/agent/baselines/tree-parity/` (60 PNGs and gzipped
  style maps, about 5 MB).
- **Pieces:** fixture `scripts/agent/tree-parity/fixture.ts` (every git state including a merge
  conflict, flattened chains, a long name, an unreadable folder, a 48-file folder for sticky rows);
  state drivers `states.ts` (real input; `/fs/read` and `/fs/tree` held open or failed through
  routes); probe `probe.ts` (the `scope` line is the one switch out-of-the-root changes, part
  selectors are in `PARTS`); dependency-free pixel diff `pixel-diff.ts` (browser codecs, channel
  tolerance 2).
- **Checked:** two compare runs in a row with zero mismatched pixels and zero style lines; a 0.5px
  name padding fails the style diff (45 lines per combo), a 4% darker `--success` on added rows fails
  the pixel diff (650–940 pixels per combo) and the style diff.
- **Behaviour:** `packages/tree/src/tests/parity-{keyboard,scroll-menu,drag,chrome}.browser.tsx`
  (45 tests, real keys, mouse, wheel and CDP touch through `vitest.config.ts` commands; the helpers
  in `parity-harness.tsx` resolve the shadow root or the host, so they survive out-of-the-root), and
  the scenario `tree-parity-behaviour` for what needs the app (Mod+F, folder hover prefetch, focus
  after delete, deferred create, reload restore, a real row drag onto the composer).
- **Baselines outside the repo:** `trace` and `renders` of `tree-sticky-scroll` in
  `/work/reports/tree-parity/baselines/`. `workspace-open-large-root` fails on `origin/main` before
  the tree opens, so it has none.
- **Spec corrections** found while pinning today's behaviour are in the parity spec under
  "Harness findings".

## PR 68 follow-up verification

The harness now verifies both bundled font families loaded and records its 1440×900 viewport and
DPR 2 in `tree-parity-environment.json`. A missing font fails before baseline capture. Selecting
`TREE_PARITY_STATES=folder-error` also runs its loading-folder prerequisite.

Tree tests serialize browser files, release held mouse/touch input during cleanup, and disable
touch emulation after each test. Expansion waits for rendered rows. The 50ms scroll-menu boundary
uses Playwright's clock with real wheel and mouse input. Frame-driven drag scrolling has a bounded
3s assertion deadline. CPU-constrained runs exposed the former frame-count and wall-clock races.

Verification on 2026-09-26, through the wave-heavy runner:

- Two full compare runs at `/work/tmp/fregat-evidence/20260926T184525Z-scenario-tree-parity/` and
  `/work/tmp/fregat-evidence/20260926T184846Z-scenario-tree-parity/`: 60 captures each, zero pixel
  mismatches and zero style differences, about 58s each. Baselines remain unchanged.
- Temporary 0.5px row-name padding: all four rest captures failed, 45 style differences each and
  24,369–24,994 mismatched pixels. Evidence:
  `/work/tmp/fregat-evidence/20260926T184713Z-scenario-tree-parity/`.
- Temporary ArrowDown reversal: the real-input keyboard test failed, expecting `src/b.ts` and
  receiving `src/lib/`. Both mutations were restored byte for byte. Logs:
  `/work/tmp/w2-cx-68-style-mutation.log` and `/work/tmp/w2-cx-68-behaviour-mutation.log`.
- Tree browser suite: 69 tests. Also exercised with the entire runner and Chromium restricted to
  one CPU core. No model requests are needed for these fixtures.

The visual matrix remains an explicit local scenario, so this PR adds no matrix work to CI. The
existing browser CI job has a 15-minute cap; local tree browser runs take about 10–12s with serial
input. Every polling wait and animation wait remains bounded.

## Follow-up, 2026-09-27: the hover flake

"holds row hover until the scroll settles" failed in about half of full `test:tree-browser` runs.
Cause: once a page has seen CDP touch input, Chromium matches `(hover: none)` and
`(pointer: coarse)` for the rest of the run, and no CDP call restores it (disabling touch emulation,
a fresh session, a mouse event and an emulated-media override were each tried). Tailwind's `hover:`
applies only under `(hover: hover)`, so whenever the drag file's touch tests ran before the menu
file, no row could show hover. The touch tests moved to `tree-parity-touch.browser.tsx`, which
`vitest.tree-browser.config.ts` runs as a second project after the rest. Six full runs in a row
passed afterwards; the drag, touch and menu files together, which failed every time before, passed
twice.

## Local review, 2026-09-28

PR 187 changed the shared filter field after the stored snapshots were captured. Both main
`74bfd0d61` and PR 192 fail all 64 old snapshots, but their fresh captures compare with zero pixel
and style differences in every state. Refresh the snapshots from those main captures. PR 192 then
passes the full matrix, including `menu-open` without an exception. See
[local-review.md](local-review.md) for evidence and the repaired behavior-scenario setup.
