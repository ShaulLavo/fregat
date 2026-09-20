# LIFE-05 implementation design

Source pin: `references/t3code` commit `7445aa733ada33e45289e5aa5055f79142556513`.
Status: read-only design. Active order and its re-entry timestamp are absent locally. This note does not claim behavioral parity.

## Domain fields and commands

Add nullable `activeOrderKey` and `unsettledAt` to `apps/server/src/db/schema.ts` and `migrations.ts`; contracts `chat-model.ts` lifecycle entries and snapshots; server orchestration `read-model.ts`, `snapshot-query.ts`, `projection-pipeline.ts`; client-core `chat/types.ts` and `writers.ts`. Preserve current rewind and optional-question fields.

Add `session.active.reorder` command and `session.active-reordered` event through `packages/contracts/src/orchestration-commands.ts`, `orchestration-events.ts`, `index.ts`, orchestration `command-receipts.ts`, `decider.ts`, and client command builders. Explicitly refresh only the reviewed local command census in `test/parity/t3code/operations.json`.

Pinned upstream `apps/server/src/orchestration/decider.ts:864–900` permits active reorder only when the row is not archived/deleted, not pinned, and not explicitly settled. Snoozed alone does not reject a reorder or wake the row. A duplicate key retains `updatedAt`.

Pinned upstream `apps/server/src/orchestration/projector.ts:500–531` clears both `activeOrderKey` and `unsettledAt` on settlement. Unsettle stamps `updatedAt` into `unsettledAt` unless the prior override was already `active`, in which case it preserves the prior anchor. Snooze and unsnooze retain keys.

## Exact sorting policy

Source: `packages/client-runtime/src/state/threadSort.ts:27–47,281–356` and `apps/web/src/components/Sidebar.logic.ts:974–985` at the pin.

- Pinned: keyed rows first, key ascending by plain string comparison. Keyless rows last, creation timestamp descending; malformed timestamps become zero. Equal keys or times tie by session ID ascending, then environment ID ascending. Keyless pins do **not** sort by `pinnedAt` or `unsettledAt`.
- Active: keyless rows first, descending maximum of valid `createdAt` and `unsettledAt` timestamps (malformed becomes zero). Keyed rows follow, key ascending. Identity ties use session ID then environment ID ascending. Ordinary activity does not move rows.
- Settled: descending valid `settledAt`; absent/invalid settlement falls back to the latest valid `latestUserMessageAt`, turn `requestedAt`, `startedAt`, or `completedAt`; then valid `updatedAt`. No valid timestamp becomes zero. Pinned upstream ties by ID ascending.

Replace the uniform `packages/client-core/src/chat/rail/session-order.ts` policy with shelf-specific comparators. Reuse existing lifecycle timestamp helpers only where their behavior matches these rules.

## Key allocation

Replace the keyed-only truncation in `packages/client-core/src/chat/rail/reorder.ts` with a planner accepting desired visible IDs, all retained keys by scoped ID, and the moved ID.

Pinned upstream `threadSort.ts:244–279` uses a midpoint when immediate neighbors have keys or are absent. It skips reserved keys belonging to hidden rows. Missing neighbor keys or corrupt key ordering materialize all visible rows with spread keys, excluding reserved keys. Hidden rows never receive writes. Include hidden snoozed rows when constructing the reservation map.

Every assignment must belong to a row whose owner supports the destination reorder capability. If any materialized neighbor is unsupported, reject the entire drop plan. Scoped environment/session keys identify rows; every write still dispatches to that row's owning environment.

## Drop transitions and empty targets

Create a pure drop planner in `packages/client-core/src/chat/rail/drop.ts`. Its result is one of `none`, `reorder-pinned`, `pin`, `move-active`, or `settle`, following pinned `Sidebar.logic.ts:190–333`.

- Active target: unpin, explicitly unsettle with reason `user`, unsnooze, then active-key assignments, as applicable.
- Pinned target: pin (which promotes out of settlement and snooze), then extra pin-key assignments. A snoozed row retaining an existing pin needs an explicit reorder assignment because re-pin intentionally ignores a new supplied key.
- Settled target: settle, which clears pin and snooze. Reordering inside settled is a no-op; history stays timestamp ordered.
- Snoozed is never a destination because snoozing requires a wake time. Snoozed rows may leave that shelf.

Empty pinned, active, and settled shelves need real structural targets, with IDs distinct from scoped session IDs. They must not masquerade as sessions. Upstream source: `Sidebar.logic.ts:108–190`. Remove current status-equality and project-equality restrictions where displayed shelves merge rows; dragging never changes session ownership.

## Full optimistic drop

Current web `state/rail-order-intents.ts` holds a single key. Replace that representation for session moves with the full drop: source and destination shelves, transition timestamp, required lifecycle fields, all assigned keys, and original keys. Project all those values together before sorting.

Acknowledgement must wait for canonical destination, required pin/snooze/settlement changes, and every key assignment. A dispatch acknowledgement alone is insufficient. Cancel the preview when the row disappears/archives, membership changes externally, a third-party key lands, or the canonical row moves to a third shelf. A late failure must only clear its own intent, never a newer drag. On partial failure retain successful canonical writes and withdraw unconfirmed optimism. Existing intent resources must include every assigned scoped row.

Pinned source: `Sidebar.tsx:3225–3299,3570–3689`. Commands execute sequentially and stop on failure.

## Ownership and delivery order

1. Root: schema, event/command, projection and lifecycle transition spine, plus server tests.
2. Pure-policy worker: shared sorting, allocation and drop planner with tests, after agreeing signatures with root.
3. UI worker: `apps/web/src/features/chat-mode/state/rail-order-intents.ts`, `rail-order-commands.ts`, `components/session-rail.tsx`, `session-group-header.tsx`, and `session-row.tsx`; integrate structural targets and full intent acknowledgement once planner types stabilize.
4. TUI consumes shared sorting. Additional move actions are a separate scope decision.

The shared `rail/model.ts` integration belongs to one writer at a time. Preserve grouping and lifecycle work already landing there.

## Required evidence

- Server: active eligibility, snoozed reorder without wake, duplicate timestamps, settlement clears key/anchor, explicit re-entry anchor, replay.
- Pure policy: mixed keyed/keyless rows, identity ties across environments, invalid dates, hidden-key collisions, keyless materialization, unsupported neighbors, retained snoozed pins and every destination.
- UI: empty targets, pointer and keyboard drops, multi-owner partial failure, lifecycle-before-key acknowledgement, stale failure versus newer intent, refresh convergence.
- Browser: registered shelf-drag scenario through the real API and UI; read screenshots and name the evidence directory. No parity claim based only on source or typechecks.
