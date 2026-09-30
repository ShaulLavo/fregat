# Plan 234: Support untitled buffers, Save As and save without formatting

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Triage: ZT-15, size L. Depends on Plan 207, Plan 204, Plan 206.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed evidence is pinned to `933d8d93`.

## Outcome

Create an unsaved document, choose its first path or another path, and explicitly bypass format-on-save.

## Zed actions and behavior

### Untitled creation

`workspace::NewFile`.

Zed creates an unnamed singleton editor buffer in the active pane, then asks for a path on first save. [crates/editor/src/items.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/editor/src/items.rs), [crates/workspace/src/workspace.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/workspace.rs).

### Save variants

`workspace::SaveAs`, `workspace::SaveWithoutFormat`.

Zed SaveAs gives a singleton buffer a new file path. Its typed SaveIntent carries SaveWithoutFormat through the same conflict/save flow with `format: false`. [crates/editor/src/items.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/editor/src/items.rs#L1029), [crates/workspace/src/pane.rs](https://github.com/zed-industries/zed/blob/933d8d93/crates/workspace/src/pane.rs#L2274).

## Existing implementation

[apps/web/src/lib/documents/utils/types.ts](../apps/web/src/lib/documents/utils/types.ts) has file/settings and unsynced variants,
with file/settings/none save capabilities. [apps/web/src/features/editor/state/save-service.ts](../apps/web/src/features/editor/state/save-service.ts)
already serializes save mutations and coordinates file writes with workspace edits.
[apps/web/src/features/editor/utils/save.ts](../apps/web/src/features/editor/utils/save.ts) classifies dirty savable documents;
[apps/web/src/features/workspace/hooks/use-unsaved-work-guard.ts](../apps/web/src/features/workspace/hooks/use-unsaved-work-guard.ts) guards navigation.
[packages/editor/src/documentSession.ts](/work/projects/Editor/packages/editor/src/documentSession.ts) owns text, history and shared view sessions.
Tree NewFile currently creates a named filesystem entry.

Editor citations name the current read-only checkout. After Plan 207, execute the same package
changes under `editor/packages/` in Fregat and update its public package exports there.

## Design

Add a branded untitled identity and explicit save capability to the document model. Fregat
owns path choice, overwrite/conflict policy, root/environment identity and successful identity
promotion; Editor owns the buffer and view sessions. SaveAs keeps one live buffer, history and
all view selections while retargeting its file association. Choose an explicit collision policy
when the destination already has a live document; never merge unrelated buffers silently.
Extend save options with typed format intent and route all variants through EditorSaveService's
mutation scope. Register `workspace.newUntitled`, `workspace.saveAs`, and
`workspace.saveWithoutFormat` under writable Workspace/Editor capabilities. Untitled documents
participate in save-all and dirty-close prompts. First-save cancellation or failure retains the
original identity and text. Refresh language/LSP association and file/search caches only after
successful persistence. Register any format-on-save knob in the settings registry.

Keep command IDs, titles, typed arguments and enablement in the command table under
`packages/client-core/src/commands/`; handlers belong to the owning feature and its focus node.
Plan 206 owns bindings as preset data under `apps/web/src/keymap/presets/`, including Linux/macOS
contexts, payloads, section order and key equivalents from the translation inventory. Activate
rows when their owner exists. The focused node may decline; use the shared dispatcher without
local shortcut listeners or inline command chords.

## Steps

- [ ] Add failing save-service fixtures for untitled first save, cancellation, overwrite failure and SaveAs to an already-open destination.
- [ ] Extend identity, capabilities, session attachment and dirty-close handling; preserve history across promotion.
- [ ] Add typed save intent and format bypass, including settings registration/reference generation if a knob is introduced.
- [ ] Register all three commands and presets; add `zed-untitled-save-variants` with temporary files and fixture formatter/LSP.
- [ ] Run the acceptance checks, record screenshot evidence, then commit, push and deploy the implementation.

## Acceptance

Run focused save-service/document-session tests. `zed-untitled-save-variants` types into a
new buffer, cancels first save, saves successfully, uses SaveAs from two views and closes a dirty
untitled tab. Identity changes exactly once after success; failure retains content. A fixture
formatter proves ordinary format-on-save runs when enabled and SaveWithoutFormat writes the
unformatted content through the same conflict checks.

Run heavy checks through `bash /work/tmp/wave-heavy/run.sh "<label>" -- env PATH="$PATH" <cmd>`.
Use fixture providers and fixture language servers. Add scenario selectors in
`scripts/agent/selectors.ts`, run `bun run agent:browser scenario <name>` for the named scenario above, then
`bun run agent:browser look`; read screenshots back and record the evidence directory. Run `bun run gates`
and the relevant typecheck. Commit by path, push, and deploy the completed implementation with
`bun run deploy`, adding `--server --restart` when server code changes.

## Out of scope

Crash recovery for every buffer; notebooks; excerpt-list SaveAs; changing filesystem clipboard policy; TUI parity.
