# Plan 223: Complete completion and signature-help widget commands

## Status and authorization

- Status: APPROVED 2026-09-29, requested by the owner: "implement everything Zed has".
- Depends on Plan 207, Plan 204, Plan 206. Size: M. Triage item: ZT-04.
- Inputs: `/work/reports/keymap-wave/zed-feature-triage.md`, its `.json`, and
  `/work/reports/keymap-wave/206-zed-translation.json`. Zed behavior is pinned to
  `933d8d93819c749a607e561883855a9b95c79cea`.

## Outcome

Navigate completion boundaries, replace a suffix, compose a completion and request word/signature help.

## Covered Zed actions and behavior

`editor::ComposeCompletion`; `editor::ConfirmCompletionReplace`; `editor::ContextMenuFirst`; `editor::ContextMenuLast`; `editor::ShowSignatureHelp`; `editor::ShowWordCompletions`.

- `editor::ContextMenuFirst` and `ContextMenuLast` select the first or last
  completion/code-action entry. They differ from paging. See
  [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L8025).
- `ConfirmCompletionReplace` passes `CompleteWithReplace` to the completion edit
  pipeline, choosing the LSP replacement range over its insertion range.
  `ComposeCompletion` passes `Compose` with the optional item index. Providers
  receive that intent and may reopen completion after applying it. See
  [crates/editor/src/completions.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/completions.rs#L73) and
  [crates/editor/src/editor.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/editor.rs#L11631). Ordinary LSP compose uses the
  configured insertion policy; provider-specific compose behavior belongs to that provider.
- `ShowWordCompletions` explicitly opens word suggestions with the automatic
  threshold bypassed. `ShowSignatureHelp` explicitly requests signature help.
  See [crates/editor/src/completions.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/completions.rs#L23) and
  [crates/editor/src/signature_help.rs](https://github.com/zed-industries/zed/blob/933d8d93819c749a607e561883855a9b95c79cea/crates/editor/src/signature_help.rs#L165).

## Existing Fregat and Editor work

Editor source below was verified in `/work/projects/Editor/packages/` before Plan 207.
Implement it in Fregat `editor/packages/` after that cutover; the external checkout is
read-only for this wave.

[packages/lsp-plugin/src/keyCommands.ts](/work/projects/Editor/packages/lsp-plugin/src/keyCommands.ts) already maps trigger, next/previous,
page navigation, accept, hide, and signature close/next/previous commands.
[packages/lsp-plugin/src/completionController.ts](/work/projects/Editor/packages/lsp-plugin/src/completionController.ts),
[packages/lsp-plugin/src/completionCommit.ts](/work/projects/Editor/packages/lsp-plugin/src/completionCommit.ts), and
[packages/lsp-plugin/src/signatureHelpController.ts](/work/projects/Editor/packages/lsp-plugin/src/signatureHelpController.ts) own widget state and edits.
Fregat attaches them in
[language-server-plugin.ts](../apps/web/src/features/editor/utils/language-server-plugin.ts).
There are no first/last or explicit replace/compose entries in that command map.

## Design

Use the [keymap architecture](../docs/keymap/architecture.md): command IDs, titles,
typed arguments, and mutation policy belong in the command table. Bindings belong in
Plan 206 preset data under `apps/web/src/keymap/presets/`. Hosted editors register
focus nodes and handlers in the window dispatcher. Preserve Linux/macOS contexts,
payloads, source order, and unbinds from the translation; activate modal rows when
their mode owner exists. A declined command falls through to its ancestor.

Extend the Editor command declarations and LSP widget handlers in
`editor/packages/lsp-plugin/`. Publish completion/code-action visibility from the
controllers and use that context for list commands. Preserve typed completion
intent and optional item index through the router. Keep snippet parsing, additional
text edits, server commands, and undo grouping in the existing commit pipeline.

Provide word suggestions from the text snapshot through the completion source
contract. Add an explicit signature-help trigger without resetting existing overload
navigation. Requests use cancellation and source revision checks already owned by
the plugin. Host-facing asynchronous loads/effects follow TanStack ownership;
completion controller state stays with the plugin lifecycle.

## Steps

- [ ] Reproduce missing boundaries and replacement-range acceptance using failing fixture-LSP tests.
- [ ] Add catalog/router entries and typed completion intents; implement first/last for both visible list types.
- [ ] Extend the commit pipeline for replace and compose, preserving snippet fields and additional edits.
- [ ] Add explicit word-source and signature-help commands with capability and revision checks.
- [ ] Translate Plan 206 widget rows, preserving completion precedence over snippet Tab.
- [ ] Add `completion-widget-commands` with a fixture LSP source, read screenshots, and ship the change.

## Acceptance

Run the affected completionController, completionCommit, completionSnippet, and
signatureHelp tests. Fixture responses include distinct insertion/replacement ranges,
snippets, additional edits, no matches, and a stale response. Check first/last across
a list longer than one page and one undo transaction per acceptance. In
`agent:browser scenario completion-widget-commands`, request words/signature help,
select list boundaries, replace a suffix, and compose a suggestion without triggering
the snippet Tab command. Read screenshots back and record the evidence directory.

Run the narrow tests for changed owners and `bun run gates`; pre-commit typecheck
must pass. Browser scenarios use fixture/mock providers only. Put heavy tests,
scenarios, builds, and deploys through
`bash /work/tmp/wave-heavy/run.sh "zt-04" -- env PATH="$PATH" <command>`.
Use an explicit free port for any private dev server and stop it afterward.
Deploy verified implementation with `bun run deploy`, or
`bun run deploy --server --restart` when server code changes. Confirm the served release.

## Out of scope

Provider predictions, Vim insert-mode state, new LSP servers, and code-action
mutation ownership covered by Plan 227.
