# Plan 097: Carry operation owners and source revisions through async workflows

Implementation note, 2026-09-12: Plan 096 implemented helper and module ownership changes after the recorded source baseline. Re-run this plan's drift check before implementation. Application environment connections and persistence remain at app scope; environment UI and discovery moved into their feature. See [web layering](../docs/web-layering.md).

Status: proposed; Plan 098 prerequisite completed and verified; implementation has not started.
Refreshed against Platform `3c935f6a` plus the completed, uncommitted Plan 098 changes on
2026-09-12. The linked Editor baseline remains `6492651`. Priority P1, effort L across several
bounded changes, implementation risk medium. No dependency on completing the duplication
plans, but coordinate overlapping files with Plans 091, 093, 094, and 096.

## Completed prerequisite

[Plan 098's implementation reference](../docs/document-and-tab-domain.md) records the model,
cache version 21 reset, five characterized corrections, verification, and baseline limitations.
Its focused lifecycle, identity, cache, address/history, recovery, and environment gates pass.
Web typecheck, build, configured lint, and actual CLI calibration pass. Expanded DOM and
prepared-open browser failures match the original checkout, as listed in the reference.

Use these settled APIs:

- `apps/web/src/lib/documents/utils/{types,identity,tabs,capabilities}.ts`: `DocumentRef`,
  `DocumentKey`, `TabId`, `FilesystemPath`, `FileResource`, membership, and static save capability.
- `features/editor/state/workspace-document-service.ts`: live records have `key` and `target`;
  views have `documentKey` and `tabId`. Filesystem stamps carry an explicit `path`.
- `features/editor/state/document-state.tsx`: `liveDocumentsByKey`, `dirtyDocumentKeys`,
  and file/settings/unsynced constructors that derive identity and synchronization state.
- `features/editor/state/save-service.ts`: saves take `DocumentKey`; settings saves return
  the actual acknowledgement. A document key does not encode operation revision evidence.
- `features/editor/state/workspace-state.tsx`: typed `selectedTabContent`, `openTabContents`,
  history, closed tabs, and reopen scroll. Navigation uses `openTabContent`/`selectContent`.
- `lib/file-server.ts` and `lib/file-system-types.ts`: filesystem operations and prepared
  request fields accept `FilesystemPath`; wire schemas stay unchanged.
- `lib/coalesced-log.ts`: shared queue, protected by the installed web-boundaries lint plugin.

`097-source-baseline.sha256` records the settled Platform source inputs. It includes uncommitted
Plan 098 work because no commit was requested. Before implementation, verify these hashes and
reconcile any changed APIs. Async ownership, lifetime, provenance, and commit changes remain here.
The execution order **098 → 097** is now satisfied for starting this plan.

The outcome is one captured owner from the first operation read through preparation,
confirmation, persistence, recovery, and local completion. Changes calculated from a source
keep that source's revision. A newer read cannot certify an older calculation.

This is a planning artifact. Work in the existing checkouts when implementation is requested;
do not create branches, commits, pushes, or PRs without a separate instruction.

## Grounding and constraints

Search's immediate bug is already fixed by `79bfd3e6`. In
`apps/web/src/features/search/hooks/use-replace.ts` (`useWorkspaceSearchReplace`), the hook captures
`clientForQueryClient(useQueryClient())`; its read callback passes that client explicitly.
`utils/replace-runner.ts` carries disk versions into the workspace-edit request. Preserve
the existing wrong-machine and planning-to-preparation drift regressions.

The remaining defects and permissive contracts are:

| Area                | Current evidence                                                                                                                         | Consequence                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search construction | `features/search/utils/replace-runner.ts` (`WorkspaceSearchReplaceContext`) accepts independent read, live-document, and apply callbacks | A caller can assemble inconsistent owners.                                                                                                                              |
| Source provenance   | `features/editor/state/workspace-edit-service.ts` declares `sourceFileVersions?`; `resolveTextOperation` checks supplied entries         | Omitting evidence remains a valid API call.                                                                                                                             |
| Preview actions     | `workspace-edit-service.ts` exposes parameterless `confirmPreview()` and `cancelPreview()`                                               | An old callback can act on a newer active preview. Cancellation has the same shape.                                                                                     |
| Host validation     | `workspace-edit-service.ts` uses `assertPreparedRequestCurrent` and `assertWorkspaceEditProvenanceCurrent`                               | Originating-document validity and pre-commit cancellation are not independent required checks. A local-only edit has no abortable HTTP request to enforce cancellation. |
| Conflict resolution | `features/workspace/utils/conflict-editor-resolution.ts` (`applyConflictEditorResolution`) uses default clients for create/write/refetch | Requests can cross machines while the editor/cache remain on the original owner.                                                                                        |
| Conflict completion | `applyConflictEditorResolution` refetches, force-replaces documents, discards the resolution key, and removes the conflict               | New edits or a newer conflict incarnation can be discarded while an earlier resolution finishes.                                                                        |
| Search completion   | `buffer-state.tsx` (`finishReplace`) and `hooks/use-replace.ts` settle and refresh by root                                               | An earlier completion can change a reset buffer or newer request at the same root.                                                                                      |
| TUI replacement     | `apps/tui/src/search/state/replacement.ts:13` returns ownerless operations; `:52` accepts a fresh client/root at apply time              | Its API permits retargeting a prepared plan. Current keyed UI lifetime avoids a demonstrated switch bug.                                                                |
| Navigation reads    | Terminal `hooks/use-links.ts` (`statTerminalLinkTarget`) and picker `hooks/use-path-input.ts` use ambient `statPath`                     | Validation can use a different owner than the intent it later completes.                                                                                                |
| Delayed logging     | `lib/file-server.ts` (`queueReadSuccessLog`) queues reads by path without owner; workspace-edit events omit owner                        | Events can be attributed to the selected machine or coalesced across machines.                                                                                          |
| LSP producer        | Linked Editor `packages/lsp-plugin/src/serverSet.ts:118,240,310` and `src/plugin.ts:793` capture or replace provenance after responses   | Older calculations can acquire newer source evidence.                                                                                                                   |

Web paths above are relative to `apps/web/src` unless fully qualified. Evidence is from
source inspection, not runtime reproduction during planning. Recent local logs were inspected;
the sampled records did not supply evidence for these races. No tests ran during planning.

Keep the existing ownership foundations:

- `docs/federated-environments.md:59` makes persisted `EnvironmentId` the identity and an
  endpoint its route. Validated endpoint replacement preserves Client and QueryClient objects.
  Each HTTP request captures its endpoint at invocation. Do not freeze an endpoint URL for an
  entire multi-request operation or introduce another environment registry.
- `features/editor/state/runtime.ts` (`createEditorRuntime`) already composes document store, root generation,
  FileSyncService, and WorkspaceEditService. `utils/file-sync-ports.ts` (`createFileSyncPorts`) binds reads and all
  mutation transitions to one explicit client. Extend these owners.
- The existing edit engine owns locks, preview, commit, compensation, undo, redo, and recovery.
  Its server checks snapshot preconditions at preparation and revalidates the complete target
  set before mutation. Preserve those checks and their existing transaction protocol.
- Git's staged discard captures one client across unstage/discard. Git commit completion
  clears only its captured draft revision. Worktree deletion uses domain-specific HEAD/status
  fingerprints. Terminal startup captures owner and activity lifetime. Preserve these patterns.

## Chosen design

Let the retained workspace-edit service own host-computed text changes from their first source
read. A callback receives a narrow source reader; the service owns its lifetime and consumes
the resulting source-bound edits. Search supplies matching logic, not transport dependencies.

Illustrative caller shape:

```ts
await workspaceEdits.applyTextChange({
  source: 'search-replace',
  signal,
  prepare: async (operation) => {
    const source = await operation.readText(path)
    const replacement = workspaceSearchReplacePlan({
      matches,
      query,
      replaceText,
      text: source.textSnapshot,
    })
    return {
      label,
      requireConfirmation: true,
      targets: [{ source, edits: replacement.edits }],
    }
  },
})

workspaceEdits.confirmPreview(preview.operationId)
workspaceEdits.cancelPreview(preview.operationId)

const plan = await prepareReplacement({ client, query, matches, replacement, signal })
await applyReplacement(plan)
```

Search still owns match counts and its completion message. The service must settle errors,
empty changes, and cancellation even when the planner throws. Callers do not need a manual
begin/dispose protocol. A caller can require confirmation; it cannot suppress confirmation
that the existing engine requires.

Derive these types from the caller's needs:

```ts
import type { FilesystemPath } from '@/lib/documents/utils/types'

interface TextChangePreparation {
  readText(path: FilesystemPath): Promise<TextChangeSource>
}

declare const textChangeSourceBrand: unique symbol

interface TextChangeSource {
  readonly [textChangeSourceBrand]: true
  readonly path: FilesystemPath
  readonly textSnapshot: TextSnapshot
}

interface TextChangeTarget {
  readonly source: TextChangeSource
  readonly edits: readonly TextEdit[]
}
```

The source object itself is opaque and service-issued. Freeze its exposed metadata and keep
its evidence in an operation-owned WeakMap keyed by exact source-object identity. A caller
cannot copy an object, substitute its path/snapshot and retain valid evidence. The private
evidence representation is a discriminated union of live-document and disk-file
sources. Live evidence includes the `DocumentKey`, its file resource, path ownership, buffer revision and exact
snapshot. Disk evidence includes the version returned with the exact content used to calculate
the edits. Every source also belongs to one operation and captured root generation. Use
existing document stamps and file-version types; do not create parallel counters for them.
The service validates issued objects at its input boundary, including runtime identity checks
for sources from another operation. TypeScript brands alone do not distinguish two runtime
instances of the same owner type.

Capture the retained service owner, root descriptor/generation, operation ID and cancellation
signal before invoking the planner. Repeated reads of the same target in one operation use
the same captured source. Reject a stale root after a read and before publishing a preview.
Do not reacquire the current root at the later apply boundary.

The planner enters the existing preparing slot/controller/event before its first await, so
busy admission, supersession and cancellation cover its reads. Close the reader when the
callback settles; an escaped callback cannot read or submit afterward. Take ownership of the
accepted target/edit data before preview so retained caller references cannot mutate it.
Before publishing, verify the planner still owns the current preparation slot.
Reject duplicate canonical targets in this host-computed API; search already groups by path.
Keep LSP's ordered multiple operations on one target supported by its separate adapter.

The host request has separate computed-text and language-server variants. Search no longer
manufactures `serverId: 'workspace-search'`, `originVersion: 0`, or an LSP guard. The LSP adapter
keeps real lane provenance and feeds the existing internal preparation engine. Remove the old
optional `sourceFileVersions` contract once its callers migrate. Do not expose two competing
public APIs for the same host-computed change.

Use the existing `operationId` for confirmation while one operation has one immutable preview.
A changed preparation gets a new operation ID. A stale confirm/cancel token is a no-op with no
effect on the newer operation. Repeated confirmation cannot run a second commit.

### What a revision proves

There is no universal revision string shared by files, buffers, Git and UI intents.

| Source                                                            | Required evidence and behavior                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host-computed disk edits                                          | File content and version captured together; reject drift before preview and at server commit.                                                                                                                                                                                                                         |
| Host-computed live edits                                          | Exact captured document/snapshot and path ownership; opening, closing, replacing or editing the source cannot silently change its basis.                                                                                                                                                                              |
| Synchronized LSP documents                                        | Capture lane source catalog before the request; preserve it through response, lazy resolve, preview and commit. Validate origin and affected known documents.                                                                                                                                                         |
| Null-version LSP target absent from the request-time lane catalog | Producer revision is unknown whether the target is closed or live. Preserve rejection of dirty live targets without exact evidence. Eligible clean targets require preview against a captured host snapshot, with snapshot and path ownership checked through commit. This proves preview-to-commit consistency only. |
| Versioned LSP target without matching lane evidence               | Reject. Never reinterpret a lane version as a disk version.                                                                                                                                                                                                                                                           |
| Search result selection                                           | Capture query/options/replacement and result generation once. Existing ranges are selectors checked against captured content before preview; the stream currently provides no exact disk revision from the original search. Preserve matching semantics and do not claim otherwise.                                   |
| UI completion                                                     | Request identity and buffer/conflict/draft incarnation decide whether a completion can update current state. These are separate from persistence success.                                                                                                                                                             |

Rejecting all unversioned LSP edits would be a separate product decision. Adding versions to
the search protocol would also be separate work. Neither limitation should be hidden by
inventing provenance from a later read.

### Lifetimes and completion

- Selecting another environment does not retarget an operation. Preserve current domain
  cancellation policy and retained-runtime behavior; do not equate "inactive" with "invalid".
- A workspace root change invalidates pre-commit work, including A to B to A. Generation,
  not path equality, establishes freshness.
- Check cancellation and originating-source validity at acceptance and immediately before
  commit. Retain the existing revalidation after async server preparation and lock acquisition.
- Check cancellation before issuing server commit, or before the first document mutation for
  local-only changes. Server preparation alone has not crossed this boundary. After commit
  dispatch or a local mutation, finish or compensate on the original owner even when the UI
  disappears. An aborted UI signal is not proof of rollback. Keep existing post-commit inverse
  receipts for undo; the original source evidence is stale after a successful edit.
- Late completion can reconcile the original cache where valid, but cannot overwrite a newer
  search run, input, conflict, document or draft. Do not report cancelled after a proven commit.

### Placement and alternatives

Keep the engine in `features/editor/state/workspace-edit-service.ts`. Place the narrow public
text-change interface in `lib/workspace-edits/utils/text-change.ts` and its context in
`lib/workspace-edits/providers/text-change-context.ts`. A focused hook under `hooks/` exposes
that interface to search. The existing editor provider publishes the same service instance
through this interface; do not construct a second service. Keep its concrete-service context,
LSP host/document-sync context, preview and recovery wiring in editor. The shared interface
cannot import, extend or derive types from `@/features/*`. Editor and search both consume it.
Do not move the whole engine or export its private prepared-target structures.

Keep matching/transforms in search utilities. Move conflict's stateful coordination out of
`workspace/utils/` into its owning feature's `state/` and supply retained runtime dependencies
through its owner. Use existing FileSync/document reconciliation rather than another save engine.
Keep the TUI owned plan beside its search workflow; share no new abstraction merely because
both hosts have a replacement dialog.

Two complete shapes were considered. An immutable public `OperationContext` passed through
all stages makes ownership inspectable, but still asks callers to assemble the correct read,
document and commit dependencies. The chosen service-owned planner hides that coordination.
It adopts immutable source evidence from the data-context design and keeps it private. A public
manual operation handle was also considered; the managed callback avoids abandoned lifetimes.
A global operation framework or universal revision registry would duplicate existing owners.

## Implementation units

The Plan 098 prerequisite above is satisfied. Execute each unit
with its focused verification before proceeding. Within this plan, independent Editor work in
unit 5 can run alongside Platform work; both are required for the final claimed scope.

### 1. Require transport ownership at reusable boundaries

Remove default `getClient()` from `lib/file-server.ts`, `lib/server-sockets.ts`, and these
feature modules: `git/utils/{api,blob-diff-query}.ts`, `settings/utils/api.ts`,
`logs/utils/api.ts`, `chat/utils/{checkpoint-diff-query,composer-skills,provider-auth-query}.ts`,
`file-picker/{data-helpers,picker-search}.ts`, `search/utils/providers.ts`, and
`command-palette/document-symbols.ts`. Remove active-origin defaults from
`features/editor/utils/language-server-plugin.ts`
and `state/language-server-connection-pool.ts`. Socket lifetime signals must come from the same
captured owner as the client. Update every direct caller in this unit; do not add compatibility
overloads or move the ambient lookup to the caller's next helper.

Use the query execution context's client for reads, mutation execution context's owner for
mutations, retained runtime for services, and explicit primary owner for application settings.
Keep `getClient` as a selected-owner/test boundary, not a helper fallback. Preserve legitimate
composition, font policy and diagnostic-display lookups outside the migrated operation paths.

Fix conflict's client capture before its debounce starts and propagate it through all filesystem
requests. Fix terminal-link and picker validation to retain both owner and navigation intent
across the await, using existing intent sequencing. Latest-render callbacks must not silently
transfer a pending intent to another owner.

Verification: web typecheck plus narrow ownership tests and new two-server conflict/navigation
regressions. Search the migrated files for ambient defaults; expected zero. Compile errors
identify remaining callers, not permission to restore a default.

### 2. Make search preparation owned by WorkspaceEditService

Implement the managed planner and private source receipts using the service's FileSyncService,
document store and captured root. Migrate `features/search/utils/replace-runner.ts` and
`hooks/use-replace.ts` together. Derive persistence preconditions directly from the captured
sources. Remove independent read/document/apply callbacks, synthetic LSP provenance and the
optional source-version map. Keep the existing replacement matcher and transaction engine.

Verification: search runner and hook tests; editor service tests filtered to provenance, root
and preparation. Add real-server coverage with two distinct servers containing the same
relative paths, and prove the second server remains unchanged. Exercise drift during initial
reads, between planning and service preparation, and during confirmation. Include live-to-disk
and disk-to-live transitions, a source from another operation, a forged source with substituted
path/snapshot, duplicate canonical targets, planner exceptions, an escaped late read, and a
paused planner A superseded by B. Verify retained arrays cannot change an accepted preview.

### 3. Bind preview actions and local completion to the initiating operation

Change confirmation/cancellation and all dialog/test callers to require the displayed operation
ID. Extend host transition validation for the source variant, originating document and aborted
signal, including edits that have no persistence leg. Keep cleanup after the commit boundary.

Give search replacement a request token that identifies the originating buffer incarnation,
result generation and captured inputs. Guard finish/fail/refresh and `finally` with that token.
Root strings and resettable run counters alone are insufficient for a reset-to-the-same-root
case. Settlement must not leave a parked buffer permanently running: settle its matching
operation on the owning buffer, and apply user-visible messages only to the matching incarnation.

Verification: preview-dialog, editor service and search-buffer/hook tests. Prove A's stale
confirm/cancel cannot affect B, repeated confirmation commits once, root A to B to A fails,
origin-only drift rejects, aborted local-only preview does not mutate, and an old completion
cannot refresh or clear a newer request. Preserve existing undo/redo/recovery controls.

### 4. Carry owned preparation through conflict resolution and TUI confirmation

For conflict resolution, capture the conflict incarnation, remote file precondition, resolution
document snapshot and destination document stamp before scheduling work. Revalidate before
writing. Changed/renamed targets already supply `remoteVersion`; keep it. Deleted targets must
retain an expected-absence condition through create, so a file reappearing during the wait
cannot be overwritten.

Use the existing write/reconciliation mechanisms and receipts. A successful write of revision A
does not authorize clearing newer local revision B. After persistence, conditionally reconcile
the captured destination. Remove the conflict and close its resolution document only when
the captured conflict incarnation, resolution snapshot and destination stamp all authorize
completion. Retain changed resolution buffers and dirty target text. Do not use unconditional `forceReplace` followed by
`removeConflict(id)`. Reproduce the race before selecting an existing lease or conditional
snapshot reconciliation; do not hold editor locks across a user confirmation wait.

Make the remaining conflict retryable. If only its resolution buffer advanced to B, retain
that buffer and matching conflict, advance its expected remote base from the acknowledged A
write receipt, release the in-flight marker and schedule the latest marker-free resolution
through the existing debounce. Never derive this base from an unrelated later refetch. If the
conflict incarnation or destination document changed, retain their current state and surface
an unresolved conflict instead of automatically retrying over those changes.

In TUI, make the prepared replacement plan privately retain client, root, signal and immutable
operations. `applyReplacement(plan)` cannot accept a replacement owner. Prevent replay of the
same prepared plan by sharing its first submission promise or returning an explicit consumed
result. Preserve `commitWorkspaceEdits` cleanup and its independent post-commit cleanup signal.

Verification: gated conflict write/refetch tests and TUI replacement tests. Edit the resolution
buffer, destination or conflict record during the wait and assert newer data survives. Recreate
a deleted file and assert conflict. Prove TUI applies only to its prepared root/server; preserve
stale-preview, nested-root and cancellation-after-commit tests.
Extend the surviving-resolution-buffer test through a second successful resolution, proving
the retained state is usable and the old write is not replayed.

### 5. Preserve request-time provenance in the linked Editor package

In `/work/projects/Editor/packages/lsp-plugin/src/serverSet.ts`, capture each lane's synchronized
source catalog immediately before sending initial code-action requests, for both single-lane
and fanout paths. Preserve that original catalog through `codeAction/resolve`; never refresh
an old action's guard after its response. In `src/plugin.ts`, capture rename provenance before
`textDocument/rename`, after confirming the prompt's originating document is still current.

Guard the origin and affected known sources, not every unrelated document in the captured
workspace. The catalog contains synchronized documents only; retain the explicit closed-target
limitation described above. Keep host environment identity out of the runtime-neutral Editor
package; its lane owns producer provenance and the Platform adapter owns environment/root.

Replace `test/serverSet.test.ts:200`'s response-time-capture expectation, which currently accepts
a slow response against a newer revision. Extend server-set, code-action and rename tests with
delayed responses, lazy resolution and secondary-document drift. Run the package's focused
Vitest cases and typecheck. Rebuild its linked distribution using its existing package build
before running the Platform LSP integration controls, since exports resolve through `dist`.
In Platform, add a clean-live unknown-source control, dirty-live rejection and closed-to-live
transition test so unknown provenance cannot accidentally become certified during adaptation.

### 6. Enforce and observe the contract

Add focused lint import restrictions for the migrated reusable modules so they cannot import
ambient owner selectors. Prefer existing oxlint configuration to a custom scanner. Required
parameters and opaque receipts enforce the other boundaries. Include representative compile-time
checks for missing owner/source evidence, not tests that duplicate ordinary implementation details.

Pass the captured owner to `WorkspaceEditOperationEvent` when its scope is created, including
operations initiated by an inactive retained runtime. Include root generation, operation ID,
source kind, affected-source counts and stale/cancel outcomes on that one event. Keep text and
credentials out of telemetry. Capture file read/tree log ownership before awaiting or coalescing,
and include owner in queue keys so identical paths on two machines cannot merge.

Verification: targeted operation-event and file-server/log tests, plus lint on changed modules.
Queue operations for A and B at the same path, switch selection before flush, and assert
separate correctly attributed records. Update ownership documentation and this plan's status
with the actual gates passed; do not claim the two protocol limitations have disappeared.

## Verification commands

Commands below are taken from package scripts/configuration and existing test paths. They are
planned gates, not tests already run. Use `-t` for a named scenario where a file is large; only
run the files relevant to the unit being changed. Apps use Bun; the runtime-neutral Editor
package uses its plain Vitest script. No new dev server is needed.

| Working directory            | Command                                                                                                                                                                                                                            | Plausible failure caught                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Platform root                | `bun run --cwd apps/web typecheck`                                                                                                                                                                                                 | Missing explicit-owner callers, source variant mistakes, provider boundary mistakes. |
| Platform root                | `bun run --cwd apps/tui typecheck`                                                                                                                                                                                                 | An ownerless or retargetable TUI apply call remains.                                 |
| `apps/web`                   | `bun --bun vitest run --project node src/features/search/tests/search-replace-runner.test.ts src/features/search/tests/search-buffer-state.test.ts`                                                                                | Source drift or stale replacement settlement.                                        |
| `apps/web`                   | `bun --bun vitest run --project dom src/features/search/tests/use-replace.test.tsx src/features/editor/tests/workspace-edit-preview-dialog.test.tsx`                                                                               | Owner switching or stale dialog action.                                              |
| `apps/web`                   | `bun --bun vitest run --project node src/features/editor/tests/workspace-edit-service.test.ts src/features/editor/tests/workspace-edit-operation-event.test.ts`                                                                    | Origin/cancellation/receipt checks or owner attribution regress.                     |
| `apps/web`                   | `bun --bun vitest run --project node test/integration/workspace-edit.test.ts`                                                                                                                                                      | Real host/server transaction behavior changes.                                       |
| `apps/web`                   | `bun --bun vitest run --project dom src/features/workspace/tests/conflict-operation-ownership.test.tsx src/features/terminal/hooks/tests/use-terminal-links.test.tsx src/features/file-picker/tests/path-input-ownership.test.tsx` | Conflict and navigation races; first and third files are new.                        |
| `apps/web`                   | `bun --bun vitest run --project dom src/features/git/hooks/tests/environment-ownership.test.tsx`                                                                                                                                   | Explicit-client migration breaks queued Git ownership.                               |
| `apps/tui`                   | `bun --bun vitest run src/search/tests/replacement.test.ts`                                                                                                                                                                        | Prepared plan ownership, stale disk source, cleanup after cancellation.              |
| `apps/server`                | `bun --bun vitest run src/fs/tests/workspace-edit.test.ts -t 'rejects last-target drift after prepare'`                                                                                                                            | Whole-set commit revalidation is accidentally weakened.                              |
| Editor `packages/lsp-plugin` | `bun run test -- test/serverSet.test.ts test/codeActions.test.ts test/plugin.test.ts`                                                                                                                                              | Response-time recapture or stale resolve/rename acceptance.                          |
| Editor `packages/lsp-plugin` | `bun run typecheck` then `bun run build`                                                                                                                                                                                           | Types or linked exports do not match the companion change.                           |
| Relevant package             | `bunx oxlint <changed-source-files>`                                                                                                                                                                                               | New ambient imports or invalid React wiring.                                         |
| Platform root                | `git diff --check`                                                                                                                                                                                                                 | Invalid patch whitespace.                                                            |

Use the real in-process `server` and `client` fixtures from `apps/web/test/fixtures.ts`, with
`test/server.ts:makeTestServer` for the second owner and `test/render.tsx` for providers. Model
two-owner setup on `features/git/hooks/tests/environment-ownership.test.tsx:20`. Gate real
requests in test transport factories rather than mocking feature/server modules or opening
sockets. Restore previously installed clients in cleanup. Add shared gates/builders under
`test/factories/`. Create `src/lib/tests/file-server-ownership.test.ts` for the file-log
regression and run `bun --bun vitest run --project node src/lib/tests/file-server-ownership.test.ts`
from `apps/web`. Assert persisted bytes and retained store state, not only which
callback ran. Record pre-existing failures separately and compare baseline deltas.

## Scope, drift and completion

Source changes are limited to the named Platform runtime/edit/search/conflict/TUI modules,
their shared interfaces/providers, the listed client/socket/LSP/API helpers, their direct
callers for the required-argument migration, corresponding tests/factories, lint configuration,
and ownership documentation. The Editor companion touches lsp-plugin producer/provenance code
and its focused tests. Read its own AGENTS instructions before implementation.

Do not redesign Git commands, terminal startup, search matching/regex behavior, worktree
fingerprints, federation storage, the server journal, or native Swift code. Do not introduce
server-side environment IDs, persistent operation state, cache migrations, generic revision
strings, or a second transaction engine. New projects, caches and build output stay on `/work`.

Start by checking both checkouts' status and drift:

```sh
sha256sum -c plans/097-source-baseline.sha256
git diff --stat 3c935f6a -- apps/web apps/tui packages/client-core plans/097-async-operation-ownership.md
git -C /work/projects/Editor diff --stat 6492651..HEAD -- packages/lsp-plugin
```

Reconcile changed symbols with the evidence above before editing. Update the plan if the live
architecture changes the design; do not create shims to keep a stale sketch working. If exact
producer revision is required for closed LSP targets or original search results, revise scope
around a protocol change before claiming that stronger guarantee. If existing conflict
reconciliation cannot preserve newer local text, resolve that design explicitly before replacing
it with unconditional writes or force-replacement.

Completion requires all of these:

- [x] Plan 098 completed before implementation began; its verification evidence and the refreshed
      document API anchors and drift baseline are recorded here.
- [ ] No reusable helper in the migrated set falls back to selected environment ownership.
- [ ] Search source reads and application come from one retained service operation.
- [ ] Every host-generated text edit carries service-issued source evidence; the optional map
      and synthetic search LSP fields are removed.
- [ ] Preview confirmation/cancellation requires its rendered operation ID at every caller.
- [ ] Origin, target, root-generation and cancellation regressions pass, including local-only edits.
- [ ] Search and conflict completion cannot clear or overwrite a newer operation/incarnation.
- [ ] TUI apply cannot accept a new client/root, and duplicate confirmation cannot resubmit.
- [ ] LSP request-time guards survive lazy resolution and delayed responses in the linked package.
- [ ] Two-server assertions prove original-owner persistence, cache reconciliation and log attribution.
- [ ] Focused checks above pass for their changed areas, with baseline failures recorded separately.
- [ ] No compatibility APIs, duplicate transaction state machines or unrelated changes remain.

Plan 091 may move file-server errors; 093 may consolidate Git hooks; 094 owns web/TUI replacement
semantics; 096 may move shared web modules. Reconcile those moves while keeping their behavioral
changes separate. Consume Plan 098's completed document and tab model and coalesced-log move.
This plan owns operation capture/provenance and its regressions. The required **098 → 097**
execution order is recorded in `PLAN.md`.
