# E067: Peer-to-peer collaboration plugin over WebRTC

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: In progress
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: L
- Dependencies: [E066](e066-collaborative-text.md) steps 1–4 and 6; [E027](e027-extension-hooks.md)
  for the hooks it attaches to.
- Inspected baseline: `1e066d38b6455b45d406fce175f902152a58295b` (Fregat main, 2026-10-08)
- Research: [lane D](../docs/collab-editing/d-webrtc-plugin.md)

## Outcome

Two or more people open the same document in any app that embeds Singapore, join one session
and edit together. No server sees or orders their edits. Each person sees the others' cursors,
selections and names. Editing continues when the host leaves, and after a network split both
sides' work survives the rejoin.

## Current code

- Plugins combine view, edit and capability contributions (`packages/spellcheck/src/plugin.ts`,
  `packages/plugin-ui/src/hoverPlugin.ts`, `packages/editor/src/createPlugin.ts`). Contributions
  that declare `inputs` only receive those update kinds (`packages/editor/src/plugins.ts`).
- Remote selections and carets can use owner-scoped highlights, tracked decorations, per-view DOM
  contributions and range geometry (`plugins.ts`, `editor/decorationStore.ts`,
  [E050](../editor/docs/architecture/e050-host-obligations.md)).
- Missing core contracts (exact transaction stream with origin, atomic reconcile, character-ID
  conversion, collaborative undo) belong to E066 step 6.
- y-webrtc is coupled to a Y.Doc; its signaling server is a small topic broker; its code default
  signaling URL differs from its README; it ships no TURN server
  ([lane D §1](../docs/collab-editing/d-webrtc-plugin.md#1-transport-options)).

## Scope

A new package, `@singapore-editor/collaboration`, with
`createCollaborationPlugin({ session, transport, presence })`:

- a transport-neutral session around E066's host and participant;
- a WebRTC adapter on native `RTCPeerConnection`, a BroadcastChannel adapter for same-browser
  tabs, and an optional manual offer/answer adapter for two peers;
- host election, handoff, split detection and rejoin;
- presence: cursors, selections, names and colours;
- an example page that starts or joins a session by link.

Not in scope: accounts, permissions, persistent rooms, a server peer, and rooms over 8 peers.

## Design

- **Topology.** A full mesh, up to 8 peers, so links already exist when a host leaves. Edits
  go to the host; the host sends confirmations out. Edits are not gossiped over every link.
- **Framing.** One reliable ordered data channel. Envelope:
  `{ version, room, document, sender, messageId, epoch, type, payload }`. Large transfers are
  binary chunks of at most 16 KB with transfer ID, index, count, length and digest, respecting
  `maxMessageSize` and `bufferedAmount` backpressure.
- **Messages.** `HELLO`, `HOST_PULSE`, `ELECTION_OFFER`, `HOST_CLAIM`, `SUBMIT`, `CONFIRM`,
  `HAVE`, `HISTORY_REQUEST`/`HISTORY_CHUNK`, `RECONCILE_OFFER`, `RECONCILE_COMMIT`, `PRESENCE`,
  `LEAVE`/`HANDOFF`. Each `CONFIRM` carries depth, predecessor hash, edit ID and outcome
  (accepted or rejected); rejected outcomes are deduplicated too.
- **Election.** Peers suspect the host from missed pulses and closed links. Reachable peers
  exchange offers; within one verified history lineage, the freshest confirmed tip wins and lowest
  peer ID breaks ties. The winner fetches any missing history, then claims `term = max seen + 1`.
  A clean leave hands off: stop sequencing, flush the tip to the successor, wait for `HAVE`,
  announce. Terms fence stale traffic but never override history selection.
- **Split and rejoin.** Conflicting authority shows up as mismatched predecessor hashes, or as
  equal depths with different tips. Peers pause confirmations, exchange frozen branch
  descriptors, and choose the deeper verified history (then lowest host ID, then tip hash). They
  archive the losing branch and turn its unique edits into pending edits, replayed in dependency
  order with their original IDs. Unresolvable references surface as conflicts. "Confirmed" means
  accepted on the current branch, not globally final.
- **Presence.** y-protocols awareness semantics: a per-peer clock, renew every 15 s, expire after
  30 s, and a null state on leave. Selections are character-ID gaps. Presence stays off the
  document log, and host liveness uses its own pulses.
- **Configuration and security.** Signaling URLs, ICE (STUN/TURN) servers, transport policy and
  credentials are required options, with no public defaults. Fregat registers them as settings
  and keeps secrets in its secret store. Room IDs are random; invitation secrets travel outside
  signaling. Signaling messages are authenticated and bound to room, peer session and connection
  generation. Data is protected by DTLS; room members are trusted.
- **Cost.** The plugin declares only the inputs it consumes. Nothing runs when it is not
  attached; network work stays off the synchronous edit path.

## Steps

1. **Session and in-memory transport.** The protocol state machine with simulated links, drops,
   delays and partitions, on E066's host and participant.
2. **Election, handoff, split and rejoin** in that simulation.
3. **WebRTC and BroadcastChannel adapters**, plus a minimal self-hostable signaling server in the
   example.
4. **Presence** and remote cursor rendering through E027 hooks.
5. **Example page**, and Fregat settings registration for signaling, ICE and credentials.

## Verification

- Step 2: seeded simulations of 3–8 peers converge across 10,000 runs that kill the host during
  concurrent typing, split into two pairs and rejoin, and run three-way splits. No edit is lost
  or applied twice.
- Step 3: two browsers on different machines exchange edits through a self-hosted signaling
  server and a TURN relay; same-browser tabs sync over BroadcastChannel without a WebRTC link.
- Step 4: `look` screenshots of two peers' named cursors and selections, read back, including
  folded and wrapped lines.
- Plugin cost: 0, 100 and 1,000 inert plugins show zero collaboration callbacks for documents
  without a session.

## Delivery (2026-10-08 wave)

- Steps 1–4 and the example page are delivered: session protocol with election, handoff and
  split/rejoin (#953); bounded replay window and selective-repeat history recovery (#990);
  WebRTC and BroadcastChannel transports with an encrypted signaling client and a self-hostable
  broker (#982), hardened with per-member admission tokens and per-member, per-address and IPv6
  prefix limits (#1016); presence (#991); the Start/Join example (#1026).
- Fregat settings with credentials from the secret store (#1070); presence clears only on
  confirmed departure (#1076); scoped connection-error recovery in the example (#1074).
- Qualified on 2026-10-08 between Linux Chromium and Mac Chrome and WebKit, direct and
  relay-only through a TURN server (relay/relay candidate pairs on both machines), including a
  host crash mid-typing with takeover and rejoin. The TURN browser test now asserts relay
  traffic (#1072).
- All six steps are delivered. Open follow-up: Fregat has no UI that starts a session yet.

## Risks and decisions

- Owner direction (2026-10-09): in Fregat, peer-to-peer WebRTC collaboration belongs in a Fregat
  plugin once Fregat has plugins; until then it may ship built in and be split out with the other
  pieces leaving the main package. A Fregat UI for starting sessions is not needed yet. The
  server-hosted path (Fregat's server as host) is built into Fregat; see the Delta DB plan.
- Idea (owner, 2026-10-09): choose the host dynamically from network and device conditions so
  hosting is seamless. Today any peer with the full confirmed history can host, election picks the
  freshest history then the lowest peer ID, and clean handoff loses no edits. Sketch: score
  eligible peers (full confirmed history required) by median round-trip time and loss to the other
  peers, connection uptime, and device class or power; hand off proactively when a challenger beats
  the current host by a clear margin for a sustained period (for example 30% for 10 seconds) to
  avoid flapping. A host-free ordering is not needed: FugueMax placement at the host already makes
  merges independent of arrival order.
- Concurrent multi-way reconciliation has no proof yet; step 2's simulation is the gate before
  any adapter work ships.
- Rooms over 8 peers need forwarding and membership reconciliation; deferred.
- Retention of losing branches, intents and tombstones bounds how long a peer can stay offline;
  set with E066's identity-compaction decision.
- A future server peer (Delta DB) sees plaintext as a participant; document secrecy from a host
  is not offered.
