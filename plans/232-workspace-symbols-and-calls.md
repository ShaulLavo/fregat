# Plan 232: Add workspace symbol search and incoming/outgoing calls

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-13, size L. Depends on Plan 207, Plan 204, Plan 206, Plan 220, Plan 227.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Find symbols across the project and inspect the caller/callee graph.

## Zed actions and behavior

### Workspace symbols

`project_symbols::Toggle`.

Zed searches project symbols, labels roots when several are visible, and opens a symbol at its UTF-16 source position; secondary confirmation opens adjacent. [crates/project_symbols/src/project_symbols.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_symbols/src/project_symbols.rs#L120), [crates/project_symbols/src/project_symbols.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/project_symbols/src/project_symbols.rs#L204).

### Calls

`call_hierarchy::ShowIncomingCalls`, `call_hierarchy::ToggleDirection`.

Zed prepares the cursor symbol, lazily fetches incoming or outgoing calls, sorts source call sites and opens their locations. ToggleDirection flips the graph direction around the prepared symbol. [crates/call_hierarchy/src/call_hierarchy.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/call_hierarchy/src/call_hierarchy.rs#L79).

## Existing implementation

[apps/web/src/lib/document-symbols.ts](../apps/web/src/lib/document-symbols.ts) supplies document-local symbol queries.
[apps/web/src/features/editor/utils/language-server-plugin.ts](../apps/web/src/features/editor/utils/language-server-plugin.ts) connects editors to language
servers; [packages/lsp/src/client.ts](/work/projects/Editor/packages/lsp/src/client.ts) offers cancellable generic requests, and
[packages/lsp/src/workspace.ts](/work/projects/Editor/packages/lsp/src/workspace.ts) synchronizes documents. There is no dedicated workspace-symbol
or call-hierarchy owner in these paths. Reuse Plan 227's language navigation and result-opening contracts.

Editor citations name the current read-only checkout. After Plan 207, execute the same package
changes under `editor/packages/` in Fregat and update its public package exports there.

## Design

Add typed workspace-symbol and prepare/incoming/outgoing call requests in `editor/packages/lsp`
and capability publication in `editor/packages/lsp-plugin`. Fregat owns the symbol picker and
call-tree feature. Include environment, workspace, server, document revision, query or prepared
item data, and direction in query ownership; preserve opaque LSP item `data` through requests.
Cancel superseded work and deduplicate results by source identity and range. Register
`workspace.showSymbols`, `editor.showIncomingCalls`, and `callHierarchy.toggleDirection` in
`Workspace`, `Editor` and `CallHierarchy` contexts. Disable unavailable capabilities. Keep the
prepared root stable on direction changes; represent recursion as repeatable nodes with bounded
lazy expansion. Use shared list/pane patterns and keep the prior complete subject while loading.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing LSP fixture requests for workspace symbols, prepareCallHierarchy and both call directions.
- [ ] Implement typed requests and capability checks in Editor packages, with cancellation and opaque data retention.
- [ ] Build the workspace-symbol picker and lazy call tree; route source opening through Plan 227.
- [ ] Register the three actions and preset rows; add `zed-workspace-symbols-and-calls`.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Focused LSP tests cover UTF-16 positions, opaque item data, unsupported capabilities, null
preparation, multiple prepare results and stale replies after a workspace switch.
`zed-workspace-symbols-and-calls` finds a cross-file symbol, opens it, shows callers, flips to
callees, expands a recursive node and opens a call site using fixture servers only.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run deploy`, adding `--server --restart` when server code changes.

## Out of scope

Document outline, Plan 231; generating a static whole-program call graph; model providers; TUI parity.
