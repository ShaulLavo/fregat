# Fix diagnostics with AI

Status: implemented. The Problems list and keyboard diagnostic popup landed with lane L8 (Platform #33). The hover entry (lane L7, Platform #37) calls L8's `useDiagnosticFix`; it was reverted while #33 was pending and restored once #33 reached main. The Editor side is on Editor main (per-diagnostic hover actions, Editor #36).

Clicking **Fix with AI** opens a chat draft containing the diagnostic and its source context. The user reviews and sends it through the existing agent workflow. Keep native language-server quick fixes alongside it. This action must work even when the server offers no code actions.

## Implement the host action

1. Add a shared diagnostic request model under `apps/web/src/lib/diagnostic-ai/`. Both `editor` and `workbench` consume it. Carry the environment, workspace root, document identity, range, severity, source, code, message, and document version. Derive protocol fields from the existing LSP types.
2. Add a narrow provider that exposes `requestDiagnosticFix(request)`. Wire its implementation in the app composition layer, where chat and editor can meet. Do not import chat features into editor or workbench, and do not copy the existing cross-feature import in `features/git/components/diff-line-comment-action.tsx`.
3. Reuse `features/chat/hooks/use-attach-to-composer.ts` and the existing chat navigation and draft machinery behind the provider. Preserve existing draft text. Prefer a fresh draft tied to the diagnostic's environment and workspace, with the editor still visible.
4. Make draft selection explicit before attaching text. The existing `attachTextToNewChat` falls back to a global inbox, and `composer-inbox-store.ts` text entries contain no environment or root. A diagnostic from one workspace must never enter a different workspace's composer.
5. Execute shared-state changes through a keyed TanStack mutation. Expose its pending and failure state to the action. Log the source surface, diagnostic code, severity, destination identity, and outcome on one operation event. Keep diagnostic messages, source excerpts, and prompt text out of logs.

Acceptance: clicking from a second workspace opens the correct draft without changing an existing draft in the first workspace. Reveal failure leaves a recoverable request and a visible retry.

## Capture the context the user sees

1. Build one prompt formatter shared by all three entry points. Include the path, one-based line and column, diagnostic source and code, full message, and a bounded excerpt around the affected range.
2. Read the current editor document for unsaved content. Do not silently substitute the file on disk. Mark the excerpt as unsaved when appropriate so the agent understands why its filesystem may differ.
3. Resolve the diagnostic against its document version when the user clicks. If edits invalidate the diagnostic, request fresh diagnostics or explain that the diagnostic changed. Do not reuse stale offsets in a different document.
4. For Problems entries without an open document, use the existing document-loading path in the selected environment. Carry the document identity through any await and validate it before filling the draft.
5. Include related locations as references. Do not attach entire projects or unrelated file contents.
6. Frame the request as investigating and fixing the cause. Treat diagnostic messages and source excerpts as quoted context, not instructions. Do not imply that a diagnostic's suggested workaround, such as adding an ambient `any` module, is necessarily correct.

Acceptance: error and warning prompts retain the exact message and range. Unsaved changes appear in the prompt. Deleted ranges cannot produce a prompt pointing at unrelated code.

## Add all three entry points

The paths below are relative to `/work/projects/platform` unless marked as Editor paths.

| Entry point               | Existing code                                                                                                    | Required change                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover message             | Editor: `packages/lsp-plugin/src/diagnosticNotes.ts`, `hoverParticipant.ts`; `packages/plugin-ui/src/tooltip.ts` | Add an optional, generic per-note action supplied by the host. Preserve diagnostic identity when multiple notes share a hover.               |
| Keyboard diagnostic popup | `apps/web/src/features/editor/components/diagnostic-peek.tsx`; `state/diagnostic-peek-source.ts`                 | Add the action and retain the original diagnostic range and version in the model. Geometry offsets and severity text alone are insufficient. |
| Problems list             | `apps/web/src/features/workbench/components/diagnostic-list.tsx`                                                 | Add an action per diagnostic outside the existing row button. Preserve list navigation and provide keyboard access to the action.            |

Pass the host callback through `features/editor/hooks/use-lsp-plugin.ts` and `features/editor/utils/language-server-plugin.ts`. Update the linked Editor package declarations and every consumer together. The Editor package owns generic diagnostic actions, while Platform supplies the AI label and behavior.

Use shared `Button` and loader primitives in React. Keep hover actions reachable by keyboard and pointer without the hover closing during activation. Always offer the action for errors and warnings, including diagnostics without a source, code, related information, or native fix. Hint and information diagnostics can use the same action.

Acceptance: each diagnostic in a combined hover has its own working action. Clicking a Problems action does not also trigger the row's navigation action. Closing the popup preserves its existing focus behavior.

## Verify before shipping

1. Test prompt formatting with errors, warnings, missing metadata, multiline messages, related locations, and unsaved text.
2. Test destination selection across environments and workspaces, preservation of existing drafts, duplicate clicks, navigation failure, and stale diagnostics.
3. Add an Editor browser test for per-note actions and keyboard activation. Keep the AI behavior out of Editor tests.
4. Extend `scripts/agent/scenarios/editor-lsp-hover.ts` and add a diagnostic AI scenario. Drive the hover, keyboard popup, and Problems list through the real app. Inspect the resulting composer text and workspace before sending anything to an agent.
5. Run the touched packages' typechecks and tests, Platform boundary lint, design census, and compiler census. Follow `verify-fregat` for screenshots and log evidence.

Ship the shared handoff first, then the three entry points together. This is a change across two repositories, not a label-only UI addition. No new agent execution backend is needed.

## Separate investigation: TS7016 on diffRows.ts

Confirmed on 2026-09-21:

- The workspace uses TypeScript 6.0.3. Its compiler check and a fresh standalone language server both report no errors in `packages/diff/src/diffRows.ts`.
- The deployed, shared language-server process returned the exact TS7016 error through `typescript.tsserverRequest` with `semanticDiagnosticsSync`. Its `projectInfo` named the correct `packages/diff/tsconfig.json`.
- Clearing browser storage does not reset that shared backend process.
- A fresh browser on the full reported route received no `publishDiagnostics` notification. The displayed zero count was not evidence that the backend considered the document clean. The earlier browser screenshot must not be used as a clean-diagnostics assertion.
- Sending `reloadProjects` to the existing server cleared the incorrect result. A subsequent `geterr` published an empty diagnostic array to connected clients. The application was not restarted.
- A disposable linked-package fixture reproduced the stale result under both Node and Bun: start with a declaration, delete its output directory, recreate JavaScript without the declaration, request diagnostics, restore the declaration, and request diagnostics again. Both runtimes retained TS7016 after restoration.
- Editor's `scripts/build-package.ts` uses that output lifecycle: delete `dist`, build JavaScript, then emit declarations. The reproduction establishes that this sequence can leave TypeScript's module resolution stale. The original build timing was not captured.

Platform also had a separate replay defect. The proxy suppresses duplicate `didOpen` notifications for shared documents but did not replay their diagnostics to new owners. The local fix retains the latest publication per open document, replays it to an owner attaching with identical text, and discards it after document changes or closure. Explicitly outdated publications are not retained. Session logs now count diagnostic publications and replays.

The regression test failed before the proxy fix. All 71 proxy tests and the server typecheck passed afterward. The proxy change is local and has not been deployed. It fixes missing diagnostics on reconnect, not TypeScript's declaration-rebuild invalidation.

A durable fix for the declaration issue remains separate. Evaluate resolving workspace imports against source during development or changing Editor's build publication so consumers never observe JavaScript without its declarations. Prove the chosen change against the linked-package reproduction. Do not hide TS7016 or add an ambient declaration that erases the module's types.

## Hover verification

`editor-diagnostic-hover-fix` opens a real TypeScript error, edits the source without saving,
then invokes its hover action with Enter. The resulting draft carries the exact diagnostic
and the unsaved source excerpt. Browser evidence on 2026-09-25 is in
`/work/tmp/fregat-evidence/20260925T192101Z-scenario-editor-diagnostic-hover-fix/`.
Editor action tests also cover pointer/Space activation, pending and failed actions,
progressive hover updates, Escape focus and stale diagnostic refusal.
