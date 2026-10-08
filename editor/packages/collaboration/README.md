# Collaboration session

A transport-neutral session for small, trusted full-mesh rooms of up to eight peers.
It chooses an ordering host, recovers after host failure, and preserves both branches'
edits when network partitions rejoin. A confirmation means acceptance on the current
branch. Reconciliation can return a branch-confirmed edit to pending.

This package currently contains the session protocol. WebRTC, BroadcastChannel,
presence rendering and editor attachment follow separately.

## Integration boundary

Construct `Session` with a peer-session ID, room and document IDs, a genesis
checkpoint, a `DocumentEngine`, a send callback and explicit timing/chunk options.
Call `connect` and `disconnect` for direct authenticated links. Call `receive` for
decoded messages and `tick` with a monotonic clock. Submit original edit envelopes
with their original IDs and dependencies. The session interprets identities and
dependencies, while the engine owns the opaque change, its canonical outcome and
history hash.

`DocumentEngine` owns sequencing and applying ordered outcomes, checkpoint/history
export, complete chain verification, atomic base installation, unique-edit recovery,
and EditId deduplication. Rejected outcomes remain in that history. The engine's `sequence` method accepts an
optional session rejection and must record it without applying the change. Missing
dependencies wait for the explicit `dependencyTimeout`; after that bound, their
original edits become rejected conflicts. A later-arriving dependency leaves that
recorded outcome unchanged. The toy engine in
`test/engine.ts` is deliberately an ordered ID/text list, independent of a text CRDT.
The adapter for `@singapore-editor/collab`'s Host and Participant is follow-up work.

The caller supplies a fresh peer ID after a process restart, retains authored intents
and pending work durably if crashes must preserve unsent work, and reconnects using
that new identity. A surviving peer's branch retains edits authored by departed peers.
The session has no timer, editor hook or browser dependency of its own.

## State and convergence

Membership is the current full-mesh link set. Each membership change or host suspicion
freezes confirmation and starts a roster-bound round coordinated by its lowest peer
ID. Every participant supplies its frozen branch. The coordinator fetches and verifies
complete histories before selecting a base. On one lineage, the freshest holder wins
and peer ID breaks ties. Divergent histories compare depth, branch-host ID, then tip
hash. Terms fence authority traffic and never rank history.

The coordinator distributes a base and the union of losing branches' unique original
intents. Peers archive their replaced branch and install the base. The chosen host
waits for every round member's `HAVE` before claiming authority and sequencing pending
work. Replay follows dependencies and preserves IDs. A membership change invalidates
the round. A third partition therefore starts another frozen round rather than
accepting a partially discovered pairwise result as globally final.

Clean handoff freezes the outgoing host, transfers its confirmed tip and pending
intents, and waits for the successor's verified `HAVE`. It then retries the successor
announcement until every connected member acknowledges installation. The successor
relays that announcement so delayed members can recover after the outgoing host
leaves. Removing a follower keeps the current host; removing the host starts election.

Liveness requires eventual delivery, a stable full-mesh component and a ticking clock.
The transport reports closed or failed links through `disconnect`. Pulse suspicion
freezes confirmation and starts a round; a still-listed silent member stalls that
round until delivery resumes or the transport removes its failed link.
This is eventual convergence, with an active host in every stabilized partition.
It provides no quorum-based or Byzantine consensus guarantee. Byte framing,
authentication, message-size bounds, backpressure and retention limits belong to the
transport/production integration. History chunks here are bounded by record count;
the later transport must also enforce its byte limit.

## Checks

From the repository root:

```sh
bun run --cwd editor/packages/collaboration typecheck
bun run --cwd editor/packages/collaboration build
bun run --cwd editor/packages/collaboration test
COLLABORATION_LONG_RUN=1 bun run --cwd editor/packages/collaboration test
```

The default run has 100 deterministic seeds. The long run has 10,000. Each seed
checks stabilized connected components after host crash/restart, two-pair splits or
three-way splits with staggered healing. Links have independent delay, loss and
duplicate delivery. Queued packets can arrive out of order across reconnects.
Every run checks identical confirmed history and text, EditId uniqueness, one host
per component, and settlement of every authored edit as accepted or rejected after
all peers rejoin. Rejected outcomes represent surfaced conflicts in this simulation.
CI runs the default checks and offers the long run through workflow dispatch.
