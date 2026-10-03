# Plan 269: Extension browsing, installation and management

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: L. Depends on Plan 206, Plan 268, Plan 220. Approved work scheduled later, after these dependencies.

Triage assignment: ZT-50 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Open the extension manager, browse compatible packages, inspect details, install a local/catalog package, enable or disable it, and remove it cleanly.

## Zed actions and behavior

- `zed::Extensions` opens or activates the existing Extensions page. Optional `category_filter` filters contribution kinds, and optional `id` focuses a package. [crates/extensions_ui/src/extensions_ui.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/extensions_ui/src/extensions_ui.rs#L114).

- Cards expose installation/version state and operations. The store serializes operations per extension, downloads/extracts into staging, installs and reloads; removal deletes owned package/work directories and reloads contributions. [crates/extensions_ui/src/components/extension_card.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/extensions_ui/src/components/extension_card.rs) and [crates/extension_host/src/extension_host.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/extension_host/src/extension_host.rs#L824).

## Existing Fregat and Editor support

Theme catalog queries exist in [apps/web/src/features/settings/hooks/use-bundle-library.ts](../apps/web/src/features/settings/hooks/use-bundle-library.ts) and [apps/web/src/lib/theme-library](../apps/web/src/lib/theme-library). The command table is [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts). Plan 268 adds manifest compatibility and load/unload ownership. There is no general extension manager/catalog in current `apps/web/src/features` or corresponding server package lifecycle.

Editor contribution ownership/disposal is in `editor/packages/editor/src/createPlugin.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/createPlugin.ts); the manager delegates attachment to Plan 268.

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Add an `extensions` feature and `Extensions` focus node with shared list/picker commands from Plan 220. Preserve optional category/id action arguments. Keep catalog source configurable through the settings registry and support local fixture packages from the outset. Queries own catalog/detail/installed snapshots; per-package scoped mutations install/enable/disable/remove and settle caches before resolving. Backend validates archive paths, package identity, compatibility and sizes, stages atomically, and calls Plan 268 lifecycle hooks. Disable disposes contributions but retains the package; remove unloads before deleting owned package/work paths. Store optional payloads/caches on `/work` by default and check the mount/free space before a large download. Log operation identity/results without package content or credentials.

## Steps

- [ ] Add failing boundary/installation tests against local fixture archives and a fixture catalog; create `extension-manager`.
- [ ] Define compatible-package query contracts, local/catalog source adapters and registry settings; regenerate reference.
- [ ] Implement serialized stage/install/enable/disable/remove operations through Plan 268, including retry convergence and interrupted staging recovery.
- [ ] Build searchable/filterable list and details with pending/error/empty states, operation feedback, titles for truncated metadata and keyboard focus.
- [ ] Register `zed::Extensions` translation, category/id arguments and selectors; reuse the open manager rather than creating duplicate tabs.

## Acceptance

Focused real-filesystem tests in a temp directory reject traversal, symlink escape, identity/version mismatch and oversize archives; exercise failed staging, concurrent install/remove, repeat install and unload-before-delete. `agent:browser scenario extension-manager` browses a fixture catalog, opens a filtered package by ID, installs/invokes/disables/enables/removes it and retries a failed install. `look` verifies manager states; `caches` verifies mutation settlement. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run install-release --server --restart`.

## Out of scope

Public catalog hosting, paid extensions, Zed accounts, silent automatic updates and real catalog/provider calls during verification are outside this plan. Runtime/contribution APIs are Plan 268.
