# Plan 178: parity harness

- Status: PROPOSED. Size M. First sub-plan; every other one depends on it.
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
