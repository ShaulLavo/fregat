# Async operation ownership

Workspace operations retain their initiating environment, root generation, and source evidence through preparation, confirmation, persistence, and completion. Selecting another machine does not redirect an operation. Changing a workspace root invalidates work that has not committed, including a return to the same path.

This implements Plan 097 on the [document and tab model](document-and-tab-domain.md).

## Transport ownership

Reusable filesystem, Git, settings, logs, chat, picker, search, symbol, and language-server helpers require an explicit client or origin. Socket helpers also require the captured owner's lifetime signal. Query execution supplies its QueryClient's client; retained services supply their runtime's client. Application settings use the primary owner.

[The lint configuration](../.oxlintrc.json) prevents migrated helpers from importing selected-owner fallbacks. Type checks in `transport-contracts.test-d.ts` and `replacement.test-d.ts` cover missing owners and retargeted confirmation.

Terminal link validation captures its navigation intent and client before awaiting stat. A later click supersedes the earlier intent. Picker validation retains its initiating navigation callback and ignores completion after an owner change.

## Computed text changes

[WorkspaceEditService](../apps/web/src/features/editor/state/workspace-edit-service.ts) owns `applyTextChange`. Its managed callback receives `readText(path)` and returns edits against the issued source. The callback enters the preparing slot before its first read. Supersession and cancellation close the reader and settle the operation even if the planner does not finish.

The [shared interface](../apps/web/src/lib/workspace-edits/utils/types.ts), context, and hook expose the existing retained service to search. They do not construct another service or import editor implementation types.

An already-aborted request never invokes its planner. If the planner aborts during invocation, its returned promise remains observed so cancellation cannot leak an unhandled rejection.

An operation keeps its issued sources in a private WeakMap. A source from another operation, a copied source, or a substituted snapshot cannot authorize edits. Repeated reads of a path share the same source. Accepted edits are copied before preview, and duplicate targets are rejected.

Live sources retain their document stamp, buffer snapshot, and path ownership revision. Disk sources retain the version returned with the exact text. Preparation rejects source changes and open/close transitions; the server validates disk preconditions again before commit.

The language-server adapter has a separate request variant. Search does not manufacture LSP server IDs or revisions, and the optional source-version map no longer exists.

## Confirmation and completion

Preview actions require the rendered `operationId`. An older dialog cannot confirm or cancel a newer operation. Repeated confirmation submits one commit.

Origin, affected sources, root generation, and cancellation are checked before commit, including edits that only affect live documents. After disk commit dispatch or the first local mutation, cleanup finishes or compensates on the original owner. UI cancellation does not prove rollback. Undo and redo retain the existing transaction receipts.

Search replacement captures a token with the buffer incarnation, result generation, query, and replacement input. Completion settles its owning buffer, including a parked buffer, but cannot refresh or overwrite a newer search or clear a newer request.

[ConflictEditorResolutionCoordinator](../apps/web/src/features/workspace/state/conflict-editor-resolution.ts) captures the conflict record, resolution snapshot, destination stamp, path ownership history, and root before debounce. It checks them before writing and uses the write acknowledgement to reconcile the destination. A newer destination or conflict remains unresolved. If only the resolution text advances, the coordinator keeps that buffer, advances its remote base from the acknowledged write, and schedules the latest marker-free text after releasing the in-flight marker. A root change prevents that automatic retry.

Conflict writes and creates carry a mutation ID issued by the retained FileSyncService. The workspace event handler recognizes only IDs issued by that runtime. It preserves tree and Git invalidation while leaving document and conflict reconciliation to the acknowledgement. IDs remain recognizable after acknowledgement and editor unmount, so delayed events cannot invalidate a pending retry. Events from other owners remain external.

The server waits for a correlated write to finish before sampling its native watcher notifications. Content hashes on marked targets distinguish duplicate notifications from different external bytes, even when size and modification time match. Failed writes release waiting notifications. An external recreation refreshes the existing conflict for that path, so a deleted-file resolution cannot finish behind a separate conflict record.

Deleted files use exclusive creation. A recreated file cannot be overwritten. The server's create acknowledgement now returns a version bound to the submitted content, matching ordinary writes. This small server change is required for retry correctness: a later stat cannot certify an unrelated writer's bytes as the resolution's base.

[TUI replacement plans](../apps/tui/src/search/state/replacement.ts) privately retain their client, root, signal, and frozen operations. `applyReplacement(plan)` accepts no replacement owner and returns the same submission promise on repeated calls.

## LSP provenance and limits

The linked Editor package captures each lane's synchronized document catalog before code-action and rename requests. Lazy code-action resolution preserves that catalog. Producer and host checks validate the origin and affected known documents, including create/delete targets and both rename endpoints. A resource operation cannot adopt a newer host snapshot to certify an older request. Unrelated document edits do not invalidate the operation.

Two protocol limits remain:

- An unversioned LSP target absent from the request-time catalog has unknown producer revision. Eligible clean targets require preview against a captured host snapshot. Dirty targets without exact evidence are rejected. This proves preview-to-commit consistency, not the producer's original basis.
- Search results carry match locations without an exact disk revision from the original search. Replacement validates those selectors against its captured text and preserves the existing matching behavior.

## Logs and verification

Workspace-edit events carry captured environment/machine identity, root generation, operation ID, source kind, target counts, and stale/cancel outcomes. File read/tree events capture identity before awaiting; queues for separate clients cannot merge identical paths. Conflict resolution emits one completion event for persistence and reconciliation, without file text.

[`scripts/verify-operation-ownership.sh`](../scripts/verify-operation-ownership.sh) runs the focused ownership gates. Tests use real in-process servers, transport gates, actual persisted bytes, retained buffers, and log output. Coverage includes source forgery, cross-operation sources, root A to B to A, delayed confirmation, cancellation, newer UI state, two-server persistence, and the conflict's second successful write. Conflict tests drive the actual filesystem event stream through workspace reconciliation. Server controls cover Parcel and Node watchers, duplicate events, large creations, symlink aliases, unchanged-stat external edits, and failed-write cleanup.

Implementation started from Platform `b94336c2`. Fourteen recorded source hashes had drifted after the document model and layering work; current APIs were reconciled before editing. The Editor checkout's unrelated core and documentation changes were preserved. Existing focused baselines passed. New conflict, LSP, navigation, and create-acknowledgement regressions were observed failing before their fixes.

The initial verification passed the combined ownership gates, including TUI replacement and the linked Editor's 62 provenance cases. The review fixes passed 123 focused tests across the edit engine, conflict/event handling, native watchers, transaction controls, workspace integration, and the search hook. Web and server typechecks, production builds, exact-file formatting and lint, and Knip passed.

The mesh release is `20260912T182004Z-b94336c2-plan097-review-fixes` at [Platform](https://omarchy.mesh.shaulavo.dev/platform). The candidate and live browser checks report no page errors, console errors or warnings, failed HTTP responses, or loopback requests. The orchestration WebSocket receives frames, and the served entry asset matches the release hash. Build logs, focused verification logs, review reproductions, and `deployment.json` are retained in `/work/platform-production/releases/20260912T182004Z-b94336c2-plan097-review-fixes/`.
