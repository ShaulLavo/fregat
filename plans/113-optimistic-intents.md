# One optimistic primitive: intents, projection, and acknowledgement

Status: **implemented 2026-09-13 — primitive, delay dial, hold diagnostics, and the rail, file tree, chat and settings migrations landed.** Git stage and unstage stay as they are by decision.

Five places in the web app show the user a change before the server has confirmed it. Each one
was written on its own, and each one re-solved the same four problems: how the pending change is
represented, how reads see it, when it is allowed to disappear, and what happens when the server
says no. The answers differ per feature for no domain reason.

| Site                | Pending representation                                           | Reads see it through                        | Disappears when                                      | On failure                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings            | `packages/client-core/src/settings/intent-store.ts` intent queue | `projectSettings(confirmed, active)` replay | Stream or response acknowledges the mutation id      | Moves to a `failed` list with retry, discard, supersession                                                                                       |
| Chat messages       | `features/chat/state/chat-optimistic-store.ts` per-session map   | Every consumer merges the map by hand       | The server projection contains the message id        | `onFailed` removes it; no timeout, so a message the stream never carries stays forever                                                           |
| Rail order          | `features/chat-mode/state/rail-order-store.ts` override maps     | `sessionRailModel({ orderOverrides })`      | `settleWhenProjected` sees the key in the projection | `release` on dispatch failure; no timeout                                                                                                        |
| File tree           | The `FileTreeModel` row is moved before the request              | The tree is the view                        | `onSettled` refetch                                  | Hand-written `tree.move(to, from)` and `tree.remove` in `use-fs-actions.ts`, with a comment admitting the refetch cannot correct a failed rename |
| Git stage / unstage | None. `mutationKey` exposes process pending only                 | `useIsMutating`                             | —                                                    | Toast                                                                                                                                            |

Settings is the only one with the full set of guarantees, and the only one with tests for the
awkward cases: a failure after a newer intent on the same key, an acknowledgement that arrives
before the HTTP response, a duplicate acknowledgement. The other four would each need those tests
too, and that is the tell that the mechanism belongs in one place.

The design rule this plan adopts is the one that makes optimism safe at all: **an optimistic change
can never outlive its envelope.** It exists from submission until the server acknowledges it, the
transport fails, a newer change on the same resource supersedes it, or a timeout gives up on it.
There is no fifth exit. The UI chooses the affordance (a greyed row, a moved row, a spinner); the
primitive owns the consistency.

## Why not `useOptimistic` and transitions

React 19 ships `useOptimistic(passthrough, reducer)` and async `startTransition` actions, and the
question of whether they are the substrate was asked before designing anything. They are not, for
four reasons that each rule it out alone:

1. **The optimistic state is component-local.** Chat's optimistic messages are read by the chat
   view, the plan follow-up provider, and the rail. Settings' projection is read by every
   `useSettingValue`. `useOptimistic` gives each component instance its own overlay, so two views
   of one datum would disagree, and a view that mounts after the click never sees the change at
   all. The overlay has to live with the data.
2. **It reverts on transition end, not on acknowledgement.** The optimistic value is discarded
   when the action promise resolves. Our acknowledgement is a stream event or a projection update
   that arrives after the response, sometimes seconds after. Bridging that means awaiting the
   acknowledgement inside the action, which is exactly the `until` mechanism this plan builds, so
   `useOptimistic` would add a second lifetime on top rather than replace one.
3. **No failure retention.** Settings keeps failed intents with retry and discard, and marks one
   superseded when a newer write on the same key lands. `useOptimistic` has no failed state; the
   value just snaps back.
4. **Our confirmed data is not React state.** It is TanStack Query cache and zustand stores.
   `useOptimistic` wants the confirmed value as a prop, and an action that only touches external
   stores still has to route through React state to be seen.

What React does give us for free is the **process-side pending flag**. `useTransition`'s
`isPending` stays true for the whole async action, including an awaited acknowledgement, and it
keeps the previous UI interactive. That is the affordance for the control that was clicked, and
the tree's delete dialog uses it. Data-side pending (this row has an unconfirmed change) comes from
the queue, by resource.

## The primitive

Three framework-neutral modules in `packages/client-core/src/optimistic/`, generalized from the
settings intent store with the settings-specific parts removed.

**`queue.ts` — `createIntentQueue<TPatch>()`.** A zustand vanilla store holding `active` and
`failed` intents. An intent carries an id, a monotonic sequence, the domain's `patch`, the
`resources` it touches, a `status` of `pending` or `acknowledged`, whether the transport has
settled, and a `settled` promise resolving to `acknowledged`, `failed`, or `discarded`. The
operations are `submit`, `acknowledge`, `settleTransport`, `fail`, `retry`, `discard`,
`discardFailed`, `reset`. The two-phase exit (`acknowledged` and `transportSettled` both required
before removal) is kept because settings needs it: the stream can acknowledge before the response
lands, and the intent must stay visible to the response handler so it is not treated as unknown.
Supersession is computed from `resources` with a caller-supplied intersection predicate; the
default is string equality.

**`projection.ts` — `projectIntents(confirmed, intents, apply)`.** Replays pending intents in
sequence order over the confirmed value. Returns the confirmed value by identity when nothing is
pending, so selectors and `useSyncExternalStore` see no change.

**`run.ts` — `runIntent(queue, patch, options)` and `waitUntil(...)`.** The lifecycle in one
place: submit, perform the transport with the domain's retry policy, mark the transport settled,
optionally wait until an acknowledgement predicate over a subscribable source is satisfied or a
timeout elapses, then acknowledge or fail. The timeout failure is a structured error
(`client.OPTIMISTIC_ACK_TIMEOUT`) so the log says what was waited for and how long. Every run
emits one wide event with transport duration, acknowledgement wait, attempt count, outcome and
resources, which is the raw material for the hold diagnostics in
[§ Diagnostics](#diagnostics).

There is no React wrapper. A component that wants process-side pending wraps its `runIntent`
call in `useTransition` directly (the tree's delete dialog does), and features read their queue
through `useSyncExternalStore` or zustand's `useStore(queue, selector)`, deriving the projected
value in their own selectors the way the rail model takes `orderOverrides`.

## What landed

1. **Rail order.** `rail-order-store.ts` was already an intent queue in disguise: `place` was
   submit, `release` was discard, `settleWhenProjected` was `until`. It is now
   `rail-order-intents.ts`, a queue of placements with the overrides derived from pending intents
   and a 10 s acknowledgement timeout where the subscription used to be open-ended.
2. **File tree.** `state/tree-intents.ts` and the pure `utils/tree-patch.ts`. The pane renders the
   projected model; a refused create, rename, duplicate, delete or drop-move disappears from the
   projection instead of being put back by hand. The drop-move path turned out to be a second
   hand-rolled optimistic path (a direct query-cache write with a receipt to restore) and became a
   `move` intent like the rest. `until` is the refetched tree reflecting the patch.
3. **Chat messages.** `state/chat-message-intents.ts` and `state/place-chat-message.ts`. The three
   send paths call one runner; `until` is the projection carrying the message id, with the 10 s
   timeout that closes the phantom-message case. The `clearResolvedOptimisticMessages` effect is
   gone.
4. **Settings.** `settings/intent-store.ts` is now an instance of the generic queue: the patch is
   `{ owner, request, initiator }`, the intent id is the mutation id, and supersession keeps its
   per-owner scope by prefixing every resource key with the owner. Owner, admission, stream and
   the web actions kept their shape; only field paths moved.

Git stage and unstage were considered and left alone: process pending on the button is the
honest affordance there, and the status list is refetched fast enough that predicting it buys
nothing the delay dial could not disprove. Other places that dispatch a command and wait, and so
are candidates for the same primitive when someone feels the wait, are session archive, pin and
rename in the rail, project registration, and the raw settings text write.

## Prerequisite: a delay dial

None of this can be judged at localhost latency, and the mesh means the app is used from other
devices. `developer.simulatedLatencyMs` (application scope, advanced visibility) delays every HTTP request
through the treaty fetcher in `lib/client.ts` and every orchestration socket request through the
RPC client's `beforeRequest` hook. The value reaches the transports through
`lib/simulated-latency.ts`, fed by `SimulatedLatencyBridge` under the settings owner, because `lib/`
cannot read a setting. With the dial off the hook returns nothing, so sends stay synchronous up to
the socket and the transport tests keep their timing. The acceptance test for each migration is:
set it to 3000, exercise the feature, and confirm the UI holds, the affordance appears, and a
failure reverts cleanly.

## Diagnostics

`lib/optimistic/hold-diagnostics.ts` wraps every queue (`watchIntentHolds`). It knows when an
intent went pending and when it left, and logs two warnings as wide events with a `fix` field so an
agent reading `logs/` knows what to change:

- **Silent hold** (`optimistic.silent_hold`). An intent pending for 150 ms while no `role="status"`
  or `aria-busy` element is on the page. Every loader primitive renders `role="status"`, so a DOM
  query at the threshold is the registry.
- **Long hold** (`optimistic.long_hold`). An intent pending past 5 s. The affordance should have
  escalated to a fallback.

These are the first runtime diagnostics for the platform, in the sense Solid 2's dev diagnostics
use the term: the runtime noticing a UX rule was broken and saying which one.

## Verification

The primitive has unit tests for every exit in `packages/client-core/src/optimistic/tests/`, and
the hold watcher in `apps/web/src/lib/optimistic/tests/`. Each migration kept its feature tests
(rail drag, tree pane and fs actions including the browser flow, chat view and timeline, settings
actions, projection, stream and ownership) with assertions moved to the new field paths, plus new
cases for the tree patch and the chat queue. The whole web suite, client-core, layering lints,
design census, generated files and knip pass. What has not been done is a session with the dial at
3000 ms on each feature; that is the next person's first hour with this.

## Decisions taken

- Acknowledgement timeouts: 10 s for rail, tree and chat; none for settings, whose stream is the
  acknowledgement and reconnects on its own.
- Git stage and unstage stay non-optimistic (see above).
