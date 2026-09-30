# Plan 266: Settings navigation and profile selection

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: M. Depends on Plan 206, Plan 220.

Triage assignment: ZT-47 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Navigate settings sections and scope tabs by keyboard, open a scope's backing JSON document, collapse the settings view, and preview or choose a named settings profile.

## Zed actions and behavior

- `settings_editor::ExpandNavEntry` expands a root. `settings_editor::CollapseNavEntry` collapses the containing root and focuses it. `settings_editor::FocusFirstNavEntry`, `settings_editor::FocusLastNavEntry`, `settings_editor::FocusNextNavEntry`, `settings_editor::FocusPreviousNavEntry`, `settings_editor::FocusNextRootNavEntry` and `settings_editor::FocusPreviousRootNavEntry` walk visible entries or roots. [crates/settings_ui/src/settings_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/settings_ui/src/settings_ui.rs#L3083).

- `settings_editor::FocusFile` takes a numeric file index and focuses its tab; `settings_editor::FocusNextFile` and `settings_editor::FocusPreviousFile` clamp at the file-list edges. `settings_editor::ToggleFocusNav` toggles navigation/content focus. `settings_editor::OpenCurrentFile` opens backing settings. `settings_editor::Minimize` minimizes the native settings window. [crates/settings_ui/src/settings_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/settings_ui/src/settings_ui.rs#L4470) and [crates/settings_ui/src/settings_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/settings_ui/src/settings_ui.rs#L4545).

- `settings_profile_selector::Toggle` opens a fuzzy profile picker. Selection previews a profile, confirmation retains it, and dismissal restores the original. [crates/settings_profile_selector/src/settings_profile_selector.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/settings_profile_selector/src/settings_profile_selector.rs#L124).

## Existing Fregat and Editor support

Category and scope stores exist in [apps/web/src/features/settings/state/category-store.ts](../apps/web/src/features/settings/state/category-store.ts) and [apps/web/src/features/settings/state/scope-store.ts](../apps/web/src/features/settings/state/scope-store.ts). [apps/web/src/features/settings/components/scope-tabs.tsx](../apps/web/src/features/settings/components/scope-tabs.tsx) exposes User, Workspace and read-only Defaults. Settings JSON document identities exist in [apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts). [packages/contracts/src/settings/keys.ts](../packages/contracts/src/settings/keys.ts) owns scope constraints. No named settings-profile model was found.

The shared JSON editor uses the React Editor adapter, `editor/packages/react/src/index.tsx` after Plan 207, verified in [the current Editor source](../../Editor/packages/react/src/index.tsx).

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Register `Settings` with `NavigationMenu` and scope-tab child nodes, mapping the source `SettingsWindow` context. Translate FocusFile indices to typed Fregat targets User/Workspace/Defaults in preset data; retain unavailable Zed-specific targets as unmapped. Browser Minimize collapses settings and restores prior workbench focus; desktop support delegates to the window owner when available. Store navigation/focus in zustand. Named profiles are application-owned registry-validated setting overlays with stable IDs; protect machine execution values and secrets through existing scope/secret owners. Preview is transient, cancel restores the prior resolved snapshot, and confirm uses a serialized mutation that settles settings caches.

## Steps

- [ ] Add failing navigation/FocusFile translation and profile preview/cancel tests; create `settings-navigation-profiles`.
- [ ] Model visible root/child entries and implement expansion, clamped traversal and navigation/content focus without raw shortcut handlers.
- [ ] Map typed scope tabs and backing JSON opening, preserving Defaults read-only and unavailable Workspace state.
- [ ] Add named profile storage/resolution and picker preview/confirm/cancel; register settings and regenerate the reference.
- [ ] Register all fifteen actions and preset rows; implement browser collapse semantics with focus restoration and shared UI controls.

## Acceptance

Focused settings tests cover collapsed/filtered children, root traversal, all FocusFile payloads, missing workspace, Defaults immutability and profile rollback on cancel/failure. `agent:browser scenario settings-navigation-profiles` navigates with keys, opens backing JSON, previews/confirms/cancels profiles and collapses/reopens settings with restored focus. Read `look` evidence; use `caches` to verify confirmed settings settlement. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run deploy --server --restart`.

## Out of scope

Profile export/sync and a replacement settings schema are outside this plan. Native window mechanics remain with the desktop owner. Zed-specific scope files have explicit unmapped rows.
