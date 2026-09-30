# Plan 270: Local inspector and frame diagnostics

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-51; size M. Depends on Plan 206.
- Source: `/work/reports/keymap-wave/zed-feature-triage.md` and `.json`, default translation
  `206-zed-translation.json`, and Zed `933d8d93819c749a607e561883855a9b95c79cea`. Preserve action identity and every payload variant.

## Outcome

Open a local UI inspector, cycle frame diagnostics, and reset the current measurement window.

## Zed actions and behavior

- `dev::ToggleInspector` opens or closes the current window's element inspector with picking,
  element bounds and inspection state. Zed tears down its hitbox tracking when closed.
  Sources: [`crates/gpui/src/window.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/gpui/src/window.rs) `toggle_inspector`,
  [`crates/gpui/src/inspector.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/gpui/src/inspector.rs).
- `dev::ToggleFpsOverlay` cycles hidden → minimal frame time → detailed statistics.
  Detailed mode reports current draw duration, p99, p90, maximum and total frames.
  `dev::ResetFrameOverlayStats` clears duration samples while retaining the total frame count.
  Sources: [`crates/zed/src/zed.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/zed/src/zed.rs) action registration,
  [`crates/gpui/src/debug_overlay.rs`](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/gpui/src/debug_overlay.rs).

`dev::ResetFrameOverlayStats`, `dev::ToggleFpsOverlay`, `dev::ToggleInspector`.

## Existing Fregat and Editor work

`apps/web/src/features/dev/components/page.tsx` and `apps/web/src/features/dev/utils/tabs.ts` own the `/dev` gallery.
`scripts/agent/browser.ts`, `trace-summary.ts` and `browser-renderer.ts` own trace and render
capture. `apps/web/src/keymap/table.ts` owns app commands. These support inspection workflows;
there is no in-app inspector or frame-overlay command in the audited table.

## Design

Add `dev.toggleInspector`, `dev.cycleFrameOverlay`, and `dev.resetFrameStats` in the command
table with `Workspace` context and availability from the local diagnostics owner. Bind only
Plan 206 preset rows from the pinned translation. Implement the browser inspector in the dev
feature using DOM picking, bounds and the dispatch context path. Desktop may use host inspection
when available. Build the panel from shared UI primitives and add a `/dev` tab.

A diagnostics service owns a zustand store with mode, selected element and measurement snapshot.
Keep sample collection separate from overlay rendering so painting the overlay cannot create a
measurement loop. Browser RAF cadence is a frame-interval measurement; Editor timing data is
an operation measurement. Label each accurately. Register any sample-limit/update setting in
`packages/contracts/src/settings/keys.ts`; keep instrumentation disabled while hidden.

## Steps

- [ ] Add a failing command test and fixture scenario for cycle/reset/pick before implementation.
- [ ] Implement diagnostics lifecycle, bounded samples and reset that preserves total frames.
- [ ] Implement inspector picking and close cleanup; expose frame/context details without document contents or secrets.
- [ ] Register commands and translate Linux/macOS rows into ours/zed; show unavailable inspection capabilities in Settings.
- [ ] Add the gallery tab and scenario, inspect screenshots and run focused checks.

## Acceptance

A deterministic scheduler test proves all three overlay states, reset semantics and subscription
cleanup. Inspector tests prove selection, Escape dismissal and cleanup of picking listeners.
Add `dev-diagnostics`: cycle all modes, select a pane, reset samples and close inspection.
Run `bun run agent:browser scenario dev-diagnostics` and `look`, then read screenshots.
Use `trace dev-diagnostics --compare <before-directory>` and `renders dev-diagnostics` before
and after to verify overlay rendering does not feed measurement. Run focused tests and gates;
commit, push and deploy. Measurements identify the browser/Editor renderer being sampled.

## Out of scope

Native GPUI internals, a general browser DevTools replacement, remote telemetry, and performance
tuning. This plan supplies local measurements; optimization needs its own measured change.
