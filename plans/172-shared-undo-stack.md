# Plan 172: Shared undo with an integrated action API

## Status and authorization

- Status: Approved. Refreshed 2026-10-03 after the owner reviewed
  [async-history-stack](https://github.com/kettanaito/async-history-stack).
- Priority: P2.
- Original authorization: 2026-09-25, Plan 126
  [LIFE-13](126-t3code-alignment/lifecycle.md). Owner decisions were resolved 2026-09-26.
- Owner direction, 2026-10-03: make the integrated action API the default. Expose the smaller
  operations it uses for cases where explicit composition significantly simplifies the code.
  Both forms use the same implementation and correctness contracts.
- Delivered: pane-specific undo routing on 2026-09-26 and web session notice expiry on
  2026-09-27. The shared controller extraction and workspace bookkeeping migration remain open.
- TUI notice-lifetime changes remain deferred to the TUI redesign, per the 2026-09-27 decision.

## Outcome

Provide one reusable implementation for linear operation history, instantiated per domain.
The default API executes an action, captures its reversible entry, and records it within the
same serialized operation. Undo and redo use that domain's execution scope and return the next
valid inverse entry.

Expose the lower-level execution and recording operations for transactions that benefit from
explicit control or work whose effects are already accepted. Prefer the integrated API for
ordinary reversible actions. Use the lower-level form when it significantly simplifies the
integration. If ordinary actions repeatedly need that form, improve the default API.

Preserve the owner's separate-domain decision: session actions and workspace edits have their
own histories. Focus determines which command handles Mod+Z. An editor or file-tree command
with empty history keeps ownership of the key.

## Current code

The 2026-10-03 audit inspected Platform `6d8e768703c1bfc92091dbdd41c9171d5942f263`.
Implementation units re-read their owning files before changing them.

| Consumer             | Current owner and behavior                                                                                                                                        | Work in this plan                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Session lifecycle    | `packages/client-core/src/chat/rail/lifecycle-undo.ts` combines receipt policy and a stateful controller. Web and TUI share it.                                   | Extract generic state and adopt the integrated action API.                                    |
| Shared stack         | `packages/client-core/src/history/undo-stack.ts` has `emptyUndoStack`, `pushUndo`, `takeHistory`, and `finishHistory`. Lifecycle is its only production consumer. | Add explicit discarded entries and shared removal/update operations.                          |
| Multi-file edits     | `apps/web/src/features/editor/state/workspace-edit-service.ts` owns two mutable arrays, capped at 20 groups, plus live buffer receipts and server results.        | Share bookkeeping while keeping transaction, recovery, and resource ownership in the service. |
| File-tree operations | `apps/web/src/features/workspace/state/file-operations.ts` queries the durable server journal and reverses its guarded head.                                      | Preserve server authority and existing scoped mutations.                                      |
| Editor text and CSV  | Editor owns a branching snapshot graph, persistence, and workspace-edit barriers. CSV uses the same buffer and graph.                                             | Preserve this implementation.                                                                 |
| Composer editing     | Web uses Lexical history. TUI uses OpenTUI textarea history.                                                                                                      | Composer migration remains in [Plan 171](171-composer-on-our-editor.md).                      |

Lifecycle batches already support partial success, revision rebasing, and selective reversal of
an older batch when later batches affect different sessions. Each web batch has a five-second
notice and expires when that notice closes. A claimed reversal remains valid while queued.
TUI history remains memory-only with its current lifetime.

Workspace groups pin buffer transaction receipts. Eviction, redo invalidation, clear, and stale
removal release those receipts and durable staging. Failed staging cleanup remains owned by the
service for retry. Server-epoch replacement clears client workspace history.

The file journal survives restart, enforces path guards and a shared head across windows, and
retains stable file operations for 24 hours. The client reads that history through TanStack.

## Scope and boundaries

Extract the linear-history core in `packages/client-core/src/history/`. Keep lifecycle receipt,
batch, revision, and navigation policies in the lifecycle adapter. Keep workspace reversal,
leases, provisional server commits, barriers, and recovery in `WorkspaceEditService`.

Browser navigation stays with TanStack Router. Editor text branches, cursor selections, and
anchored jumps retain their domain models. Prompt/search recall, recency lists, git history,
transcripts, and terminal replay remain separate kinds of history. This plan creates no shared
recall utility, merged app timeline, new persistence scheme, or client copy of server history.

## Design

### Integrated action API

The intended calling style is:

```ts
await sessionHistory.push(async () => {
  const receipt = await archiveSession(ref)
  return reversibleSession(receipt)
})

await sessionHistory.undo()
await sessionHistory.redo()
```

These examples specify the call shape; Unit 1 finalizes helper names and types. The action
returns a reversible entry after its effects settle. An entry can hold typed receipts, metadata,
and execution functions that close over domain resources. Receipts and cache settlement fit
naturally inside this API.

A successful reversal supplies the next inverse entry. This supports fresh server receipts and
updated revision checks. Lifecycle execution reads the entry's current metadata so revision
rebasing does not leave a closure using an obsolete expected revision.

### Lower-level composition

Implement the integrated API using the same recording and transition operations exposed to
explicit integrations. Provide `record`, named `undo` and `redo`, targeted removal/expiry,
retention/update, and clear operations. Callers supply completed entries and use their existing
domain execution boundary when explicit composition makes the transaction easier to follow.

Keep generic take/finish mechanics inside the controller. Domain adapters define selection,
dependency checks, rebasing, and reversal outcomes. Both API forms share limits, entry identity,
invalidation, cleanup accounting, and protection against stale asynchronous finishes.

### Scheduling and state ownership

Configure one domain executor for the integrated API. In web and TUI it uses the existing
TanStack mutation scope and mutation keys. Execute, settle the cache, and record the accepted
entry before releasing that scope. Undo and redo enter the same scope once.

The lower-level form records within its caller's equivalent serialization boundary. Handle
already accepted external effects under the domain's ordering and validity rules. Avoid nesting
a second mutation with the same scope behind a mutation that is waiting for it. Introduce no
history-owned queue or pending flag beside TanStack.

One vanilla zustand store owns observable controller state. React reads it with `useStore` and
selectors. Remove the lifecycle controller's listener set and separate zustand mirror in the
same migration. The core keeps no React, application feature, or server imports.

### Failure, invalidation, and cleanup

Define explicit outcomes for applied reversal, no change, stale history, partial success, and
recovery-required state. Distinguish a rejection with no effects from a failure after effects
may have committed. Preserve the adapter's recoverable entry and locks when its outcome requires
recovery. Do not make lifecycle's per-row forget behavior the default for every domain.

Define when an entry is claimed, removed, replaced by its inverse, or discarded. New forward
entries clear redo after acceptance. A rejected action without effects preserves existing
history. Dependent batch changes reverse in reverse application order. Partial application
returns the actual reversible subset or enters domain recovery.

Invalidation, expiry, clear, disposal, and server-epoch replacement during an in-flight step
must prevent stale results from republishing entries. Release resources after their active
owner settles. A canceled wait or an AbortSignal alone proves no rollback of committed effects.

Pure stack operations return discarded entries explicitly. Include capacity eviction, cleared
redo, targeted removal, retention, and clear. The owning adapter releases resources and retains
failed asynchronous cleanup for retry. Unit 1 defines ownership transfer when an entry becomes
its inverse, so shared resources are released exactly once.

Retain current limits: 50 session batches and 20 workspace groups. Preserve memory-only client
lifetimes and the server journal's existing retention policy.

### Library comparison and dependency decision

Learn from async-history-stack's action-returning-an-inverse API, asynchronous traversal, and
explicit grouping. The source audit used upstream commit
[`aa59886419efd252b58697e209258465615a45c1`](https://github.com/kettanaito/async-history-stack/tree/aa59886419efd252b58697e209258465615a45c1).

Bounded source probes found that merged setters `0 → 1 → 2` undo to `1`, because reversal uses
forward order. A later merged failure can leave an earlier effect applied without an undo entry.
Automatic merging delays execution until the window ends. These behaviors need different
contracts for our consumers. Grouping must preserve immediate execution and define partial
failure and compensation explicitly.

Build on the owned stack and controller. This plan adds no async-history-stack dependency.
Neither receipts nor closures prevent the integrated API. Avoid another broad library survey;
resolve remaining contract questions with the two real consumers below.

## Execution checklist

### Delivered behavior

- [x] Route app-level undo through panes that yield ownership, preserving text-entry and pane undo.
- [x] Give each web session batch its own Undo/Redo notice and expire it when the notice closes.
- [x] Audit current histories and compare the upstream API and implementation.
- [x] Record the owner's integrated-default and lower-level-composition direction.

### Unit 1: Specify the entry and execution contracts

- [ ] Define typed entries, inverse results, identity, selection policy, resource ownership, and
      failure/recovery outcomes from the current lifecycle and workspace consumers.
- [ ] Specify `push`, `record`, named undo/redo, removal/expiry, retention/update, and clear as two
      compositions of the same controller operations.
- [ ] Walk archive, lifecycle batch, and multi-file transaction call sites through both forms.
      Keep the common action concise and the complex transaction explicit.
- [ ] Define scope admission, cache settlement, registration, in-flight invalidation, and cleanup
      order. Prove the integrated and explicit forms each enter one execution scope.

Acceptance: both consumers fit the contract without losing their existing domain guarantees.
Helper names and types can be chosen here without another owner approval round.

### Unit 2: Extract and prove the shared core

- [ ] Extend pure stack operations with discarded-entry results and retention/update operations.
- [ ] Extract the controller into `packages/client-core/src/history/undo-history.ts`, using one
      vanilla zustand store and the configured domain executor.
- [ ] Implement the default action API from the lower-level operations. Cover successful
      registration, fresh inverse receipts, rejected actions, and stale in-flight completions.
- [ ] Verify disposal ownership for eviction, redo clearing, removal, clear, and inverse transfer.

Acceptance: both API forms produce identical history state and cleanup obligations for equivalent
operations. Execution failures cannot silently turn committed effects into empty history.

### Unit 3: Migrate session actions first

- [ ] Move ordinary archive, settle, snooze, and unpin actions onto the integrated API. Retain
      explicit composition only where it materially simplifies a batch or navigation integration.
- [ ] Keep receipt-authoritative restoration, revision rebasing, reverse batch order, partial
      success, independent-batch selection, claimed entries, and web notice expiry in the adapter.
- [ ] Migrate web and TUI together onto the shared controller, removing the old listener/store
      bridge and obsolete stack/controller code. Preserve the TUI's existing lifetime and UX.
- [ ] Verify undo pressed during an action queues behind acceptance and registration. Verify
      rejection, conflicts, notice expiry, redo, and repeated reversal return fresh receipts.

Acceptance: ordinary callers use the default API, and current web/TUI semantics remain intact.

### Unit 4: Migrate workspace bookkeeping

- [ ] Reproduce [#493](https://github.com/ShaulLavo/fregat/issues/493), the unconfirmed direct
      concurrent undo concern, with overlapping undo/redo and a recovery case. Fix it within this
      unit if confirmed. If ruled out, record the evidence and close the issue with a reason.
      Keep the issue open if the bounded reproduction is inconclusive.
- [ ] Replace workspace array bookkeeping with the shared operations. Use the lower-level form
      where it simplifies provisional server commits, live buffer reversal, and recovery.
- [ ] Preserve barriers, path invalidation, server-epoch clearing, held leases, cleanup retries,
      and domain cache settlement. Route direct calls through the same execution guarantees.
- [ ] Delete superseded bookkeeping and verify no second journal or transaction owner was added.

Acceptance: workspace transactions retain exact recovery and resource behavior while reusing the
core. The two consumers determine whether the default API needs refinement before wider use.

## Verification and delivery

For each unit, run the narrow tests that cover its plausible failures through host-local
[heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill. Use real state and domain fixtures. Exercise disposal with retained resources,
not callbacks that merely mirror the implementation.

Use existing lifecycle tests in `packages/client-core/src/chat/rail/tests/` and web session-undo
tests. Extend workspace edit service tests for explicit composition, failure/recovery, pending
invalidation, and exact receipt cleanup. Keep tests portable and avoid mocking our own modules.

For the session migration, run the `session-undo` browser scenario. For workspace integration,
run `file-tree-undo` and `editor-undo-barrier`. Recheck `search-input-undo` when routing or text-entry
ownership changes. Read the screenshots back. Use `caches` evidence for changed cache settlement.
Record delivery evidence in `docs/` and completed unit status here.

Before declaring each implementation unit done, run required gates, commit owned paths, push,
and deploy to the mesh. Server changes require dev verification and the server restart deployment
path. This planning refresh changes documents only; implementation checkboxes remain open.
