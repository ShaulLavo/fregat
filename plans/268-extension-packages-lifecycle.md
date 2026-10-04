# Plan 268: Extension packages, contribution boundaries and lifecycle

## Status and authorization

Status: APPROVED 2026-09-29. Requested by the owner: "implement everything Zed has". Size: L. Depends on Plan 207, Plan 206, Plan 122 host/command integration. Approved work scheduled later, after these dependencies.

Triage assignment: ZT-49 in `/work/reports/keymap-wave/zed-feature-triage.json`; binding contexts and payloads in `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior below is pinned to `933d8d93`.

## Outcome

Load and unload a local extension package that contributes commands, languages, themes and UI through the existing Editor/Fregat plugin contracts.

## Zed actions and behavior

- No default-bound Zed actions belong to ZT-49. This supporting plan supplies the lifecycle required by `zed::Extensions` in Plan 269.

- Zed manifests identify versioned packages and declarative themes, icon themes, languages, grammars, language servers, context servers, snippets and debug adapters. The extension host loads registrations, tracks outstanding operations and reloads after install/removal; executable extensions use a versioned WASM host. [crates/extension/src/extension_manifest.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/extension/src/extension_manifest.rs#L84), [crates/extension_host/src/extension_host.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/extension_host/src/extension_host.rs) and [crates/extension_host/src/wasm_host.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/extension_host/src/wasm_host.rs). Fregat's executable format follows Plan 122's decided full-access contract.

## Existing Fregat and Editor support

Plan 122 establishes trusted, composable client/backend plugins and selective execution. Editor already has namespaced command registration, view scopes, inputs/channels and disposal in `editor/packages/editor/src/createPlugin.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/createPlugin.ts) and `editor/packages/editor/src/plugins.ts` after Plan 207, verified in [the current Editor source](../editor/packages/editor/src/plugins.ts). Fregat assembles plugins in [apps/web/src/features/editor/components/editor.tsx](../apps/web/src/features/editor/components/editor.tsx) and [apps/web/src/features/editor/utils/plugins.ts](../apps/web/src/features/editor/utils/plugins.ts). [apps/web/src/features/settings/hooks/use-bundle-library.ts](../apps/web/src/features/settings/hooks/use-bundle-library.ts) loads theme bundles. A general installable extension manifest/lifecycle owner remains to be added.

## Design

Commands join [apps/web/src/keymap/table.ts](../apps/web/src/keymap/table.ts) with typed arguments and availability, following [the keymap architecture](../docs/keymap/architecture.md). Linux/macOS bindings are preset data under `apps/web/src/keymap/presets/` per Plan 206, retaining source contexts and payloads. The host dispatcher owns keys; handlers decline when their owner is unavailable. Extend Plan 122's host integration with one package manifest containing ID/version/API compatibility, declared package dependencies, contribution metadata and optional shared/client/server entries. Trusted code retains access to Editor/DOM/host services and backend filesystem/network/process services. Validate manifests and package paths at the load boundary. A package owns every registered contribution and disposer; commands are namespaced and duplicate exclusive owners fail deterministically. Activation may be lazy by declared language/feature inputs; uninterested pieces receive no callbacks. Local standalone Editor plugins retain standalone packs; inside Fregat all bindings are host preset/user data. Extension reads use queries; load/unload/reload are per-package serialized mutations, with lifecycle state in a service-owned zustand store. Put reusable plugin work in `editor/packages/*` after 207.

## Steps

- [ ] Add fixture packages and failing load/unload/duplicate-owner tests; reconcile Plan 122 phase 6 with the shared command catalog.
- [ ] Define typed manifest/version compatibility and validate paths/entry points before code activation.
- [ ] Implement client/server registration ownership, namespaced commands, lazy activation and reverse-order cleanup after failed or partial load.
- [ ] Wire language/theme/UI contributions through existing hosts, with preset bindings and disposal on every attached editor view.
- [ ] Add reload behavior and a fixture extension in `/dev`; create `extension-lifecycle` and selectors for contributed command/UI removal.

## Acceptance

Focused manifest/lifecycle tests cover incompatible versions, duplicate IDs/commands, dependency cycles, partial activation failure, repeated unload, multiple editor views and no callbacks for uninterested inputs. `agent:browser scenario extension-lifecycle` loads a local fixture, invokes its command, opens its UI, reloads and unloads; contributed controls/commands disappear and live documents survive. Read `look` evidence. Run `bun run gates` and the required typecheck. Heavy checks use `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`. Browser evidence uses fixture providers, an isolated home and explicit free ports; read screenshots back and record `/work/tmp/fregat-evidence/<run>/`. Commit by path, push, and deploy the implementation to the mesh after review; server changes require dev verification and `bun run install-release --server --restart`.

## Out of scope

The manager/catalog is Plan 269. Zed WASM binary compatibility, Zed account infrastructure, an imposed sandbox and public marketplace operation are outside this plan.
