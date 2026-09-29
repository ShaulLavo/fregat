# Plan 267: Theme mode and font-size commands

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: M. Depends on Plan 206.

Triage assignment: ZT-48 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Toggle light/dark mode and increase, decrease or reset editor and UI text sizes, with explicit persistent or temporary changes.

## Zed actions and behavior

- `theme::ToggleMode` flips explicit light/dark; system or unspecified mode flips the currently resolved appearance and persists the new explicit mode. [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs#L9035).

- `zed::IncreaseBufferFontSize`, `zed::DecreaseBufferFontSize`, `zed::IncreaseUiFontSize` and `zed::DecreaseUiFontSize` adjust by one pixel and clamp. `zed::ResetBufferFontSize` and `zed::ResetUiFontSize` remove the stored override for persist:true, or clear the runtime override for persist:false. [crates/zed/src/zed.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/zed/src/zed.rs#L1164) and [crates/theme_settings/src/settings.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/theme_settings/src/settings.rs#L567). The translation retains persist:false payloads; UI-size default rows belong to Welcome/Onboarding, whose contexts are currently unavailable in Fregat.

## Existing Fregat and Editor support

[packages/contracts/src/settings/keys.ts](../packages/contracts/src/settings/keys.ts) registers `workbench.colorTheme`, theme bundles and `editor.fontSize` with bounds 8–40 and default 13. [apps/web/src/features/settings/utils/apply-appearance.ts](../apps/web/src/features/settings/utils/apply-appearance.ts) resolves system appearance and applies typography families. [apps/web/src/features/editor/components/editor.tsx](../apps/web/src/features/editor/components/editor.tsx) consumes Editor options. A workbench UI-font-size setting and shared temporary font-size owner are absent from this baseline.

Editor already exposes `setFontSize` and font-metric publication in `editor/packages/editor/src/editor/Editor.ts` after Plan 207, verified in [the current Editor source](../../Editor/packages/editor/src/editor/Editor.ts).

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Register theme/font commands at `Workspace` and translate global editor-size rows there. Keep Welcome/Onboarding UI-size rows unmapped until those owners exist; expose UI commands in the palette/user bindings. Reuse `editor.fontSize`; register `workbench.fontSize` at application scope with schema bounds/default derived from existing typography. A window-owned zustand override holds persist:false values through tab/view switches and clears on reload or reset. Persistent changes use existing settings mutations, reset removes the chosen-scope override and reveals inherited values. Apply UI scaling through shared typography tokens and pass effective editor size as options. Toggle mode writes `workbench.colorTheme` using resolved appearance when system is selected.

## Steps

- [ ] Add failing tests for temporary/persistent increments, inherited reset and system-mode toggle; create `theme-font-commands`.
- [ ] Register workbench UI size, constraints and command argument schema; generate `bun run settings:reference`.
- [ ] Implement shared effective-size selection and temporary overrides; wire Editor options and shared UI typography tokens.
- [ ] Add all seven commands and exact preset context/payload translations; retain unavailable Welcome/Onboarding inventory.
- [ ] Verify changes in settings form/JSON, two editor views and floating controls without rebuilding documents.

## Acceptance

Extend `apps/web/src/features/settings/utils/tests/apply-appearance.test.ts` and focused settings-action tests for clamping, +1/-1 steps, persisted scope writes, inherited resets and transient reload behavior. `agent:browser scenario theme-font-commands` exercises the palette and translated shortcuts, changes both sizes, toggles from system mode and checks transient changes leave backing JSON untouched. Read `look` evidence at both sizes. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run deploy --server --restart`.

## Out of scope

Browser page zoom, terminal font commands, per-file typography, new themes and Welcome/Onboarding UI are outside this plan.
