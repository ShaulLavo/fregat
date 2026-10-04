# Plan 227: Complete LSP navigation, refactoring and display commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206, Plan 237. Size: L. Triage item: ZT-08.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Choose code actions, confirm rename, organize imports, control diagnostics/inlay hints and open declarations or type definitions in splits.

## Covered Zed actions and behavior

`diagnostics::ToggleDiagnosticsRefresh`; `editor::ConfirmCodeAction`; `editor::ConfirmRename`; `editor::GoToDeclaration`; `editor::GoToDeclarationSplit`; `editor::GoToTypeDefinitionSplit`; `editor::OrganizeImports`; `editor::ToggleCodeActions`; `editor::ToggleInlayHints`.

- `editor::ToggleCodeActions` opens/closes the action menu. `ConfirmCodeAction`
  applies its selected action, including typed selection payloads. `ConfirmRename`
  confirms the active rename editor and submits its workspace edits. See
  [crates/editor/src/code_actions.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/code_actions.rs) and [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L8304).
- `GoToDeclaration` requests declaration locations. `GoToDeclarationSplit` and
  `GoToTypeDefinitionSplit` send the same navigation request with a split destination.
  Results retain target selection ranges. See
  [crates/editor/src/navigation.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/navigation.rs#L1066).
- `OrganizeImports` requests the `source.organizeImports` code-action kind and applies
  the returned action through workspace-edit handling. See
  [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L8593).
- `ToggleInlayHints` controls view rendering and refreshes hints through the inlay
  owner. See [crates/editor/src/inlays/inlay_hints.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/inlays/inlay_hints.rs#L325).
- `diagnostics::ToggleDiagnosticsRefresh` cancels an in-flight diagnostics-view
  refresh or starts one when idle. It does not toggle a permanent automatic-refresh
  preference. See [crates/diagnostics/src/diagnostics.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/diagnostics/src/diagnostics.rs#L423).

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/lsp-plugin/src/plugin.ts](/work/projects/Editor/packages/lsp-plugin/src/plugin.ts), [packages/lsp-plugin/src/codeActions.ts](/work/projects/Editor/packages/lsp-plugin/src/codeActions.ts),
and [packages/lsp-plugin/src/renameWidget.ts](/work/projects/Editor/packages/lsp-plugin/src/renameWidget.ts) already own code actions and rename.
[packages/lsp-plugin/src/definitionNavigation.ts](/work/projects/Editor/packages/lsp-plugin/src/definitionNavigation.ts) maps definitions, references,
implementations, and type definitions; declaration is missing from that map.
Fregat has [workspace-edit-service.ts](../apps/web/src/features/editor/state/workspace-edit-service.ts)
for preview/commit and recovery, and
[language-server-plugin.ts](../apps/web/src/features/editor/utils/language-server-plugin.ts)
for host integration. Extend this pipeline for the new operations and split destinations.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Extend `editor/packages/lsp-plugin/` contracts for declarations, action confirmation,
imports, inlay hints, and explicit diagnostic refresh. Honor server capabilities,
response revisions, location links, and cancellation. Pass host navigation a typed
same-pane/split destination. Plan 237 owns split creation and focus; the plugin
returns locations without changing Fregat's pane model.

Keep code-action/rename workspace edits with the existing preview/commit owner,
including command-only and edit-plus-command responses. Requests and effects at
Fregat boundaries use feature queries/mutations and settle cache before completion.
Diagnostics refresh toggles a cancellable snapshot operation in the Problems view owner.
Add that narrow view action to the diagnostics feature if no refresh owner exists.
Inlay rendering uses Editor decorations with a registry-backed display setting.
All errors use the feature catalog; unsupported capabilities decline cleanly.

## Steps

- [ ] Reproduce missing declaration/split and confirmation commands with failing fixture-LSP responses.
- [ ] Extend capability/request contracts and typed navigation destinations, then connect Plan 237's split owner.
- [ ] Route action/rename confirmation and organize-imports through existing workspace-edit preview/commit handling.
- [ ] Add inlay request/render/toggle ownership and cancellable diagnostics refresh with registered settings where needed.
- [ ] Register catalog commands, contexts for code actions/rename/Problems, and preset payloads.
- [ ] Add `lsp-command-completeness`, verify cache settlement and screenshots, then deploy web plus server if protocol changed.

## Acceptance

Run affected LSP navigation, codeActions, rename, and workspaceEdit fixture tests,
plus Fregat workspace-edit-service tests. Include unsupported capabilities, multiple
locations, stale responses/edits, annotated multi-file edits, command-only actions,
and failed preview/commit recovery. Test selected-item confirmation and the optional code-action item index
from the source action contract. In `agent:browser scenario lsp-command-completeness`, navigate
declaration/type definition into the exact split, confirm rename/imports with preview,
toggle inlay hints, and cancel/restart a diagnostics refresh using fixture responses.
Read screenshots and `agent:browser caches` settlement evidence back.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-08" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run install-release`, or
`bun run install-release --server --restart` when server code changes. Confirm the served release.

## Out of scope

Installing new real language servers, workspace symbol/call hierarchy UI, a second
workspace-edit transaction pipeline, and pane layout design from Plan 237.
