# Regression checks for duplicated helpers

Plan 090 repairs defects before Plans 091 through 096 consolidate their implementations. The fixes
were verified against Platform `89aa9b747517904d6b96fa080ab3710df60cc005` on 2026-09-12. Behavior regressions
were checked before and after their fixes. Browser report sanitization is an internal hardening change:
the shared logger already redacted those fields before this work. The original checkout's uncommitted work
was left in place. Implementation lives in the `plan090-duplicate-borne-defects` worktree branch.

## Behavior preserved by later consolidation

| Area                    | Required behavior                                                                                                                                                                                                  | Regression tests                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser diagnostics     | The report redacts all 17 sensitive fields and preserves structured fields and strings. Shared logging also redacts and truncates strings to 2000 characters.                                                      | [client error reporting](../apps/web/src/lib/tests/client-error-reporting.test.ts)                                                                                                                                                                               |
| Server diagnostics      | Credentials are redacted on errors and nested causes. Quoted text is redacted, and long strings retain their last 500 characters.                                                                                  | [observability runtime](../apps/server/src/observability/tests/runtime.test.ts)                                                                                                                                                                                  |
| Address file targets    | URI segments are encoded, with an empty host and normalized leading slash. Positions stay zero-based.                                                                                                              | [address targets](../apps/web/src/features/address/tests/definition-target.test.ts)                                                                                                                                                                              |
| Chat file targets       | Relative paths cannot become URI hosts. Encoded paths round-trip through the editor decoder.                                                                                                                       | [chat targets](../apps/web/src/features/chat/hooks/tests/file-reference-definition-target.test.ts)                                                                                                                                                               |
| Workspace edits         | A workspace's parent is outside its root. Ancestor and descendant mutations still conflict with leases.                                                                                                            | [mutation containment](../apps/server/src/fs/tests/mutation-containment.test.ts), [workspace edit leases](../apps/server/src/fs/tests/workspace-edit.test.ts)                                                                                                    |
| Git paths               | `..foo` is inside the root and can be staged. Parent and sibling escapes remain outside.                                                                                                                           | [Git service](../apps/server/src/git/tests/service.test.ts)                                                                                                                                                                                                      |
| LSP paths               | Root detection and both TypeScript containment predicates accept `..foo`. Real session hover and diagnostics work for `..foo.ts`.                                                                                  | [LSP registry](../apps/server/src/lsp/tests/registry.test.ts), [TypeScript boundary](../apps/server/src/lsp/typescript/tests/boundary.test.ts), [TypeScript session](../apps/server/src/lsp/typescript/tests/session.test.ts)                                    |
| TUI storage             | Corrupt reads conditionally delete the rejected value and return defaults. Successful deletion emits one warning without stored content. Concurrent replacements are re-read and returned; absent keys are silent. | [rail](../apps/tui/src/agent-rail/tests/state.test.ts), [inbox](../apps/tui/src/agent-stage/tests/inbox.test.ts), [tabs](../apps/tui/src/terminal/tests/tabs.test.ts), [recents](../apps/tui/src/storage/tests/files.test.ts)                                    |
| Session subscriptions   | Only `starting`, `running`, and `waiting` runtime statuses prevent eviction. Running turns and actionable requests retain their separate protections.                                                              | [subscription cache](../apps/web/src/features/chat/state/tests/session-detail-subscriptions.test.ts)                                                                                                                                                             |
| Provider equality       | Object key order does not replace an adapter or restart a session binding. Array order remains meaningful.                                                                                                         | [driver registry](../apps/server/src/provider/tests/driver-registry.test.ts), [provider service](../apps/server/src/provider/tests/provider-service.test.ts)                                                                                                     |
| Persisted panel layouts | Arrays are rejected. Keyed records remain accepted.                                                                                                                                                                | [resizable layouts](../packages/ui/src/components/tests/resizable.test.tsx)                                                                                                                                                                                      |
| Git error notifications | An observed failure emits one event and one toast. Failures outside the observed transport still get reported.                                                                                                     | [client error reporting](../apps/web/src/lib/tests/client-error-reporting.test.ts)                                                                                                                                                                               |
| Logs panel              | One banner represents either or both failed queries.                                                                                                                                                               | [logs panel](../apps/web/src/features/logs/tests/panel.test.tsx)                                                                                                                                                                                                 |
| Search width            | A ref attached on a later render is measured, with observer and animation-frame cleanup.                                                                                                                           | [search width](../apps/web/src/features/search/tests/use-element-width.test.tsx)                                                                                                                                                                                 |
| File loading            | A pending read shows loading. File-picker errors take precedence over stale data in both readers.                                                                                                                  | [selected file](../apps/web/src/features/workspace/tests/use-selected-file.test.ts), [compare saved](../apps/web/src/features/editor/components/tests/compare-saved-view.test.tsx), [file picker](../apps/web/src/features/file-picker/tests/load-state.test.ts) |
| Tool labels             | Both tool selectors use `Git`, and all shared tab labels agree.                                                                                                                                                    | [tool header](../apps/web/src/features/workbench/components/tests/tool-pane-header.test.tsx)                                                                                                                                                                     |
| TUI test server         | Temporary workspaces honor `os.tmpdir()`. Machine discovery uses the stopped-state stub.                                                                                                                           | [connection](../apps/tui/src/connection/tests/session.test.ts)                                                                                                                                                                                                   |

`jsonEqual` is exported by `@workspace/contracts`. The unused web settings `default-value.ts` module
was deleted. These fixes introduce no shared helper modules. Plans 091 through 096 retain that work.
The server error logger remains separate from the general sanitizer because quote handling and
truncation differ. The URI backslash policy remains part of Plan 092.

## Corrections to the original plan

- `pathsOverlap` is symmetric. A lease on `/a/b` must conflict with a mutation at `/a`. The original
  no-conflict expectation was wrong. The directional descendant check now rejects the parent,
  and a regression preserves the ancestor lease conflict.
- `FileStorage.initialize` validated persisted recent commands before any reader could recover.
  That eager scan was removed. Database checks and strict write validation remain.
- `ProviderAdapterRegistry.reconcile` returns no value. Tests assert adapter identity and disposal
  behavior instead of a returned change flag.
- The installed logger omits arbitrary top-level Error fields from its persisted event. The test
  inspects the real logger call and the persisted nested cause to cover both redaction paths.
- Chat's markdown parser normally resolves references to absolute paths. The target builder's
  relative-path defect is covered directly, alongside actual URI decoding.
- Returning a loading state alone did not fix the compare pane. `CompareSavedView` also needed
  a `LoadingState` branch before its empty-state fallback.

## Review corrections

Corruption cleanup uses `FileStorage.removeItemIfValue`, a single conditional SQL delete. The old
read-then-delete path could erase a valid replacement from another TUI instance. Regressions use
two SQLite handles to interleave writes and deletions at each reader. A lost conditional delete
re-reads the current value instead of returning stale defaults. The terminal read-and-save test
preserves the competing tabs when the caller persists its initial state. Transactional inbox and
recent-command updates retain their write lock and strict validation.

The TypeScript session had another containment predicate beyond the plan's four listed sites.
Changing only the shared boundary admitted `..foo.ts` to handlers while excluding it from the
TypeScript program. The real-session regression reproduces the resulting internal hover error,
then verifies hover and diagnostics alongside an ordinary file after both predicates agree.

The original browser credential test passed before the local field-set change because
`safeClientEvent` already applies the shared sanitizer. The initial failing-before claim for that
test was incorrect. A new pass-through spy inspects the report handed to the logger. That boundary
check fails on the original code and passes after widening the local field set. It also proves
that report construction preserves long strings while emitted events receive the shared truncation.

## Verification

App tests run with `bun --bun vitest run` from the owning app. Web tests select `--project node`
for `.test.ts` and `--project dom` for `.test.tsx`. UI package tests run with plain `vitest run`.
The linked tests provide the focused rerun targets.
[Storage race tests](../apps/tui/src/storage/tests/corruption-race.test.ts) cover concurrent replacement and deletion. The TUI inbox change also passed the existing
`src/agent-stage/tests/drafts.test.ts` tests. Server observability routes passed alongside the runtime tests.

Workspace typechecks pass in web, server, TUI, contracts, and UI, matching their clean baseline.
Changed source files pass lint, formatting, and `git diff --check`.

The three initial DOM failures are also fixed. Markdown tests now use the editor store owned by
real navigation and open files in a real temporary workspace. The compare test supplies viewport
measurements at the DOM boundary because happy-dom has no layout engine. Its diff-content assertion
remains unchanged. Both complete test files pass, including URI integration and pending-file loading.

The original review probes now preserve concurrent inbox and history writes and return TypeScript
hover and diagnostic results for both ordinary and double-dot filenames. Focused regression tests,
app typechecks, lint, formatting, and whitespace checks pass. No repository-wide suite was used as a gate.
Local command output and before/after evidence are in `/work/tmp/plan090-evidence`.
