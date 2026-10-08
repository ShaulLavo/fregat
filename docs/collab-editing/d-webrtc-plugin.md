# D — WebRTC collaboration plugin

## Sources and inspected revisions

| Source                                             | Commit                                     |
| -------------------------------------------------- | ------------------------------------------ |
| Fregat/Singapore                                   | `1e066d38b6455b45d406fce175f902152a58295b` |
| yjs/y-webrtc                                       | `c411f1d7223b68f3c6fc9c5901a19819a17db667` |
| yjs/y-protocols                                    | `73b2ff75486c9879843718dc6c7fc52d63aea4fe` |
| automerge/automerge-repo                           | `8b178e75ecca89f78465196ef786aa844da57aec` |
| loro-dev/loro                                      | `c00c9fa501f8d32f68d6255eacb7035a67fb6ab6` |
| simple-peer v9.11.1, read remotely without cloning | `f1a492d1999ce727fa87193ebdea20ac89c1fc6d` |

Reference checkouts:

- `references/y-webrtc`
- `references/y-protocols`
- `references/automerge-repo`
- `references/loro`

Recommendations below are **proposals**, not implemented or experimentally verified behavior.

## 1. Transport options

### What y-webrtc provides

The signaling server is a small WebSocket topic broker. Clients subscribe to room topics and publish announcements or encrypted signaling payloads. It broadcasts publications to room subscribers; the client filters sender and recipient IDs. It does not order document edits or store a document history. The inspected server keeps topic memberships in memory, uses a 30-second WebSocket ping interval, and leaves authentication as an unimplemented upgrade-handler comment.

Evidence:

- [Signaling server, lines 12–137](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/bin/server.js#L12-L137).
- [Client announcement, recipient filtering and SDP handling, lines 466–558](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L466-L558).

The bundled server is self-hostable through its `y-webrtc-signaling` executable. Another server can implement the same subscribe/publish protocol, or a Singapore-specific signaling adapter can use an existing application WebSocket service. WebRTC itself does not prescribe the signaling transport.

Evidence:

- [Package executable, lines 33–35](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/package.json#L33-L35).
- [MDN: signaling transport and opaque SDP forwarding](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling).

**Important documentation drift:** y-webrtc’s README lists three signaling defaults, while its actual inspected constructor defaults to **`wss://y-webrtc-eu.fly.dev`**. Do not copy either list into Singapore. Availability of those public services was not tested.

Evidence:

- [README options, lines 70–90](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/README.md#L70-L90).
- [Actual constructor defaults, lines 597–606](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L597-L606).

### Manual offer/answer mode

A manual mode is practical for two peers:

1. Gather an offer and its ICE candidates.
2. Export one invitation blob.
3. Import it at the other peer.
4. Return an answer blob.
5. Import the answer at the initiating peer.

This is **signaling-server-free**, not signaling-free: the user carries the signaling messages. Disabling trickle ICE permits consolidated SDP exchange. Subsequent reconnects or ICE restarts still need a signaling path.

Evidence:

- [simple-peer v9.11.1 implementation](https://github.com/feross/simple-peer/blob/f1a492d1999ce727fa87193ebdea20ac89c1fc6d/index.js): `trickle` defaults to true; with trickle disabled, offer/answer emission waits for ICE completion.
- [MDN: arbitrary signaling transport and renegotiation](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling).

**Recommendation:** keep manual pairing as an optional diagnostic/private-session adapter. It is a poor default for an automatically healing mesh: every new pair can require another exchange.

### STUN and TURN

The WebRTC browser API defaults to an empty ICE-server list. y-webrtc supplies no explicit ICE configuration by default; it delegates to simple-peer. The inspected simple-peer v9.11.1 supplies Google and Twilio **STUN** URLs, with no TURN server. Its configuration merge is shallow: an explicitly supplied `iceServers` array replaces those defaults.

Evidence:

- [WebRTC specification, RTCConfiguration](https://www.w3.org/TR/webrtc/#rtcconfiguration-dictionary).
- [y-webrtc peer creation, line 184](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L184).
- [simple-peer pinned source](https://github.com/feross/simple-peer/blob/f1a492d1999ce727fa87193ebdea20ac89c1fc6d/index.js): `Peer.config` and constructor configuration merge.

STUN assists discovery of reachable addresses. It cannot guarantee a direct path through restrictive NATs or enterprise firewalls. TURN supplies a relay when direct connectivity fails; TCP/TLS-to-TURN options matter where outgoing UDP is blocked.

Evidence: [RFC 8656 §§1, 3.1–3.2](https://www.rfc-editor.org/rfc/rfc8656).

**Recommendation:** require an explicit ICE configuration at the transport boundary. Offer a documented TURN-capable deployment, including credential refresh. A “works on my LAN” reproduction is not sufficient qualification for remote collaboration.

### Topology and practical room size

y-webrtc attempts a mesh until each peer reaches `maxConns`; its actual default is **20–34 connections per peer**. The README explains that indirect propagation can connect larger populations but disconnected clusters cannot be excluded. Its anecdote about 100 conference clients is not a tested Singapore capacity guarantee.

Evidence:

- [Topology discussion, README lines 48–57](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/README.md#L48-L57).
- [Actual connection limit, line 604](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L604).

A full mesh requires `n(n−1)/2` peer connections: 28 at eight peers, 120 at sixteen peers. Those are topology counts, **not performance measurements**.

**Recommended initial scope:** small rooms, with eight peers as a proposed qualification target. Retain a complete small-room mesh for membership and handoff, while routing submissions to the host and confirmations outward from it. Avoid gossiping every edit redundantly over every link.

A pure star reduces connections to `n−1`, but when its host disappears, followers have no established links to one another. It needs independently available discovery and fresh connections before election. A sparse larger-room mesh also needs forwarding, deduplication and membership reconciliation; it is extra protocol scope.

### Framing, ordering and reliability

WebRTC data channels default to ordered, reliable delivery when neither `maxPacketLifeTime` nor `maxRetransmits` is set. Ordering is **per channel/stream**, not a total order across senders or different channels.

Evidence:

- [MDN createDataChannel defaults](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createDataChannel).
- [RFC 8831 §§6.3–6.4](https://www.rfc-editor.org/rfc/rfc8831).

Use one reliable ordered channel for the initial protocol: control, submissions, confirmations and history transfer. Application sequencing remains necessary because reconnects create new channels and multiple peers submit independently.

Proposed envelope:

```text
version, roomId, documentId, senderSessionId,
messageId, epochId, type, payload
```

For large transfers, use bounded binary chunks with transfer ID, chunk index/count, declared total length and final digest. Respect the negotiated SCTP message-size limit. Limit individual chunks conservatively: RFC 8831 recommends at most 16 KB without message interleaving. Apply queue backpressure using `bufferedAmount` and `bufferedamountlow`; channel delivery does not mean an edit was accepted or recorded.

Evidence:

- [RFC 8831 §6.6](https://www.rfc-editor.org/rfc/rfc8831).
- [MDN maxMessageSize](https://developer.mozilla.org/en-US/docs/Web/API/RTCSctpTransport/maxMessageSize).
- [MDN bufferedAmountLowThreshold](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold).

An unordered, partially reliable presence channel is a later optimization. It requires presence clocks and baseline identity regardless, and separate channels still share association-level congestion control.

Evidence: [RFC 8831 §§5, 6.1](https://www.rfc-editor.org/rfc/rfc8831).

### Reconnect

y-webrtc removes closed peer connections and reannounces discovery. It sends Yjs sync and awareness state when a replacement connection opens. Its provider `connected` flag explicitly does **not** prove connectivity to a physical peer.

Evidence:

- [Connection lifecycle, lines 192–230](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L192-L230).
- [Status semantics, lines 644–650](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L644-L650).

Singapore needs its own resumable state exchange: room/document genesis, epoch, confirmed tip, operation deduplication and outstanding local proposals. Re-send pending proposals with their original IDs. Show discovery, peer connectivity and document synchronization as distinct states.

Automerge’s WebSocket adapter separates reconnection from synchronization and deliberately drops sends on non-open sockets, relying on higher-level sync to replay. That is useful architecture evidence, **not permission to drop Singapore’s sole copy of an operation**.

Evidence: [Automerge WebSocketClientAdapter, lines 63–123 and 172–190](https://github.com/automerge/automerge-repo/blob/8b178e75ecca89f78465196ef786aa844da57aec/packages/automerge-repo-network-websocket/src/WebSocketClientAdapter.ts#L63-L190).

## 2. Recommended stack

**Build a separate Singapore collaboration package with a transport-neutral session and replaceable adapters. Do not use `WebrtcProvider` as the document engine.**

Suggested layers:

1. **Host-ordered collaboration session:** character identity, accepted history, pending proposals, reconciliation and host authority.
2. **Editor attachment:** local transaction capture, remote application, selection conversion and view lifecycle.
3. **WebRTC adapter:** discovery, SDP/ICE exchange, peer links, framing and backpressure.
4. **BroadcastChannel adapter:** same-browser peers using the same protocol.
5. **Presence model and view contributions.**
6. **Host-provided configuration and credentials.**

y-webrtc’s provider is coupled to a Y.Doc, Yjs sync protocol and Yjs awareness. Borrow its discovery/security lessons; directly adopting its provider would import an additional document-consistency engine.

Evidence:

- [y-webrtc update handler, lines 342–351](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L342-L351).
- [Provider constructor, lines 594–625](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L594-L625).

Use the browser’s native `RTCPeerConnection` behind a narrow adapter. Simple-peer is an alternative if implementation effort warrants it, but its STUN defaults must be overridden explicitly.

Automerge provides the strongest reusable separation: `connect`, `send`, `disconnect`, readiness and peer/message events. The inspected repository has WebSocket, BroadcastChannel and MessageChannel packages; I did not find a first-party WebRTC package in that package inventory.

Evidence: [NetworkAdapterInterface, lines 19–82](https://github.com/automerge/automerge-repo/blob/8b178e75ecca89f78465196ef786aa844da57aec/packages/automerge-repo/src/network/NetworkAdapterInterface.ts#L19-L82).

Loro likewise demonstrates byte-oriented export/import independently of transport. Its Quill example simulates multiple peers in one process, exchanges version-relative updates and resynchronizes when a peer’s online flag returns. **It is not a production WebRTC transport example.** Loro’s separate ephemeral store reinforces separating presence from persisted document data.

Evidence:

- [Loro README sync example, lines 89–126](https://github.com/loro-dev/loro/blob/c00c9fa501f8d32f68d6255eacb7035a67fb6ab6/README.md#L89-L126).
- [Quill simulated transport, lines 44–80](https://github.com/loro-dev/loro/blob/c00c9fa501f8d32f68d6255eacb7035a67fb6ab6/examples/loro-quill/src/App.vue#L44-L80).
- [EphemeralStore subscriptions, lines 254–303](https://github.com/loro-dev/loro/blob/c00c9fa501f8d32f68d6255eacb7035a67fb6ab6/loro-js/src/runtime/ephemeral.ts#L254-L303).

Loro’s website sync tutorial returned HTTP 403; no claim here relies on its inaccessible contents.

## 3. Host election protocol

### Safety boundary

The owner’s requirement allows each partition to have a host. Consequently, **confirmation cannot mean irreversible global consensus**. It means accepted on the current branch. A branch-confirmed operation can become pending after rejoin.

The Weidner article provides stable character IDs, tombstones and server reconciliation—undo pending operations, apply authoritative operations, redo pending operations. It does **not** specify host handoff or partition recovery.

Evidence: [Text without CRDTs — “Some Corrections,” “Client Side,” “Flexible Operations,” “Decentralized Variants”](https://mattweidner.com/2025/05/21/text-without-crdts.html).

### Election approaches

| Approach                                    | Useful property                                                         | Limitation here                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Bully election                              | Simple election/answer/coordinator messages and deterministic ID winner | Classical assumptions include known membership and reliable bounded communication; browser suspension and partitions violate them |
| Newest confirmed state, then lowest peer ID | Matches the owner’s preference and favors an existing history holder    | Edit number alone cannot distinguish conflicting histories with the same length                                                   |
| Raft-like terms and host claims             | Fences stale messages and distinguishes authority generations           | Terms alone do not provide Raft safety                                                                                            |
| Full quorum-based Raft                      | Majority elections and replicated-log rules provide stronger safety     | Minority partitions cannot keep committing; contradicts both-sides-active requirement                                             |

Evidence:

- [Bully algorithm](https://en.wikipedia.org/wiki/Bully_algorithm).
- [Raft paper §§5.1–5.4](https://raft.github.io/raft.pdf), downloaded and text-extracted during research. Majority voting, log freshness and majority replication are material to its guarantees.

### Proposed minimal state

```text
Peer:
  peerSessionId
  maxObservedTerm

Authority:
  term
  hostPeerId
  epochId

Confirmed history:
  genesisId
  parent/checkpoint lineage
  confirmedDepth
  tipHash
  canonical accepted operations
  original submitted intents
  operation-ID deduplication outcomes

Pending:
  original operation ID
  dependencies
  stable character IDs / tombstone targets
  original intent
```

Use a fresh random peer-session ID on restart. Give operations `(authorSessionId, authorCounter)` identities. Keep host authority separate from content identity.

`confirmedDepth` is a branch-history depth inherited across handoffs, not an epoch-local counter. Even equal depths require lineage/hash comparison.

### Proposed message types

| Message                             | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `HELLO`                             | Protocol, room/document genesis, identity, current authority and confirmed tip |
| `HOST_PULSE`                        | Host authority, tip and membership observation                                 |
| `ELECTION_OFFER`                    | Candidate’s available confirmed history and peer ID                            |
| `HOST_CLAIM`                        | Selected host, new term/epoch and parent tip                                   |
| `SUBMIT`                            | Deduplicated original edit intent and dependencies                             |
| `CONFIRM`                           | Ordered canonical outcome: accepted, transformed or rejected                   |
| `HAVE`                              | Acknowledges possession of a confirmed tip; not a quorum commit                |
| `HISTORY_REQUEST` / `HISTORY_CHUNK` | Retrieve missing prefix/checkpoint and identity metadata                       |
| `RECONCILE_OFFER`                   | Frozen branch descriptor for competing-history comparison                      |
| `RECONCILE_COMMIT`                  | Chosen base history and new authority epoch                                    |
| `PRESENCE`                          | Ephemeral state                                                                |
| `LEAVE` / `HANDOFF`                 | Best-effort clean departure and successor proposal                             |

Each confirmation should include sequence/depth, predecessor hash, operation ID and outcome. Deduplication must include rejected outcomes so retransmission cannot later apply an already-rejected intent differently.

### Host failure and clean handoff

**Failure proposal:**

1. Suspect the host using heartbeat loss and connection failure. A timeout proves suspicion, not a crash.
2. Continue collecting local pending edits.
3. Exchange candidate histories with reachable peers.
4. Within the same verified history lineage, choose the freshest available confirmed tip; break equal-tip ties by lowest peer ID.
5. Obtain the candidate’s complete history before making it authoritative.
6. Claim a new epoch with `term = maxObservedTerm + 1`.
7. Resume submissions and confirmations.

**Clean handoff proposal:** stop assigning new sequence numbers, flush the final confirmed tip to the successor, receive `HAVE`, and announce the new authority. New local input remains pending during the short transition.

Terms fence old traffic but do not override the branch-selection rule. A high term from repeated failed elections must not automatically defeat a more complete history.

### Split brain and rejoin

Detect conflicting authority or history through `HELLO`, `HOST_PULSE`, predecessor-hash mismatch, or equal-depth/different-tip observations. Do not wait for visible text differences.

On rejoin:

1. Pause confirmation on the branches being reconciled; new input remains pending.
2. Freeze and exchange complete branch descriptors.
3. Compare verified history depth, then lowest branch-host peer ID; use tip hash as a final deterministic tie-breaker.
4. Choose one branch history as the authoritative base.
5. Create a new reconciliation epoch above observed terms.
6. Archive the losing branch.
7. Convert its unique extra intents into pending proposals and replay.

This is an **eventual-convergence protocol proposal**, not a proof of unique leadership under asynchronous partitions. A pairwise reconciliation cannot know that every other partition has been discovered. Later competing branches require another reconciliation. Membership, concurrent reconciliation and freeze semantics need explicit state-machine design and simulation before implementation claims.

### Losing-side replay

A text snapshot or offset-only suffix is insufficient.

Preserve:

- Original authored intents and globally unique operation IDs.
- Dependency order across operations.
- Stable inserted character IDs and deleted-character tombstones.
- The common ancestor/checkpoint.
- Canonical results and identity mapping where a host transformed an operation.

Replay procedure:

1. Save the losing suffix and local unconfirmed queue before changing the editor.
2. Install the winning confirmed state.
3. Exclude operation IDs already represented in the winning history.
4. Put the remaining losing intents into the pending queue.
5. Replay in dependency order, retaining their IDs.
6. Let the new host assign new confirmation positions.
7. Surface unresolved references as pending conflicts; do not substitute guessed offsets.

Dependent inserts must follow the operation creating their target. If a host rejects or transforms that creation, dependent operations need an explicit resolution policy.

A surviving peer must also be able to recover intents authored by a departed peer. Deduplication permits redundant resubmission, but designate a replay sender to avoid unnecessary traffic.

## 4. Presence

### y-protocols behavior

Awareness is a separate state-based ephemeral protocol:

- Per-client JSON state, monotonic clock and locally observed update time.
- Null state means offline.
- Local state renews after roughly 15 seconds.
- Remote active state expires after 30 seconds.
- The implementation checks expiry every three seconds.
- Newer clocks replace older state.
- Equal-clock null messages can remove a remote state.
- `change` signals changed visible state; `update` also signals renewals.
- Active-state removal retains clock metadata; it is not complete metadata GC.

Evidence:

- [Awareness implementation, lines 13–93 and 106–139](https://github.com/yjs/y-protocols/blob/73b2ff75486c9879843718dc6c7fc52d63aea4fe/src/awareness.js#L13-L139).
- [Removal and encoding, lines 172–210](https://github.com/yjs/y-protocols/blob/73b2ff75486c9879843718dc6c7fc52d63aea4fe/src/awareness.js#L172-L210).
- [Receive semantics, lines 246–299](https://github.com/yjs/y-protocols/blob/73b2ff75486c9879843718dc6c7fc52d63aea4fe/src/awareness.js#L246-L299).

The current upstream constructor borrows identity/lifecycle from a Y document. Reuse the semantics or codec deliberately; do not create a hidden Y.Doc solely to supply presence identity without weighing the dependency cost.

Proposed Singapore presence:

```text
peerSessionId, presenceClock, documentId, epoch/tip,
displayName, colour, focusedViewId,
selections[{ anchorCharacterId, headCharacterId, biases }],
status
```

Use stable character references, not unversioned offsets. Remote optimistic cursor positions may target characters whose edits have not arrived yet; retain them until resolvable. Election liveness should be independent of the 30-second presence expiry.

Keep clock/tombstone metadata for the room session, bound peer churn, and clear it when the room is disposed. GC earlier than that requires a session-incarnation/replay policy.

### Same-browser tabs

y-webrtc broadcasts same-browser state through BroadcastChannel and suppresses redundant WebRTC connections to discovered local peers by default. Its room-password encryption also covers BroadcastChannel payloads.

Evidence:

- [BroadcastChannel encryption, lines 249–250 and 332–339](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L249-L339).
- [Local-peer filtering, lines 499–504](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L499-L504).

BroadcastChannel requires the same origin **and storage partition**. It is not a bridge between unrelated embedded contexts.

Evidence: [MDN Broadcast Channel API](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).

Recommendation: represent tabs as ordinary protocol peers with distinct session IDs, replacing their direct network edge with BroadcastChannel. Deduplicate by operation/message identity across adapters. Do not initially add a special “one networking tab owns all tabs” leader, which would introduce another election problem.

## 5. Plugin attachment points and missing core hooks

### Existing plugin construction

The editor has both lower-level `EditorPlugin` contribution registration and the experimental `createPlugin` authoring model.

- Spellcheck combines view, edit and capability contributions.
- `plugin-ui` builds per-view hover controllers with disposal and command contributions.
- `createPlugin` provides per-view scope, watched inputs, owned disposables, edit application and experimental text gates.

Evidence:

- `editor/packages/spellcheck/src/plugin.ts:14–38`
- `editor/packages/plugin-ui/src/hoverPlugin.ts:27–65`
- `editor/packages/editor/src/createPlugin.ts:131–198`
- `editor/packages/editor/src/public/extensions.ts:64–85`

**Proposed API:** `createCollaborationPlugin({ session, transport, presence, … })`. The session is explicitly shared across views of the same collaborative buffer; view attachments own their individual selections and overlays.

The simple path must work with `new Editor(element)` plus plain plugin options. `openDocument` must remain optional.

Evidence: `editor/AGENTS.md:19–24`.

### Existing edit stream and revision support

There are useful hooks already:

- Buffer subscriptions publish revision-before/after, prior text snapshot, sync point, coarse origin and source-view ID.
- Contribution contexts expose snapshots and changes since a sync point.
- View contributions receive content changes.
- Public edit application exists.
- Document-session edit options support skipping history.

Evidence:

- `editor/packages/editor/src/documentSession.ts:148–162, 260, 324–332`
- `editor/packages/editor/src/plugins.ts:706–718, 772–785, 680–684`
- `editor/packages/editor/src/createPlugin.ts:150–155`

**Caution:** the synchronization edit chain has a 128-entry bound and can return composed changes. It is not a durable, exact authored-operation log. The transport must capture its own complete collaboration records.

Evidence: `editor/packages/editor/src/editor/editChain.ts:14–47`.

### Existing remote-cursor and presence UI surfaces

Selections can use owner-scoped highlights or tracked decorations. Cursor carets/name labels can use per-view DOM contributions, range geometry, tracked points and viewport/layout notifications. No new generic “presence UI framework” is needed.

Evidence:

- `editor/packages/editor/src/plugins.ts:531–541, 615–634, 737–744, 884–903`
- `editor/packages/editor/src/editor/decorationStore.ts:34–58, 94–112`
- `editor/docs/architecture/e050-host-obligations.md:6–24`

Remote caret visibility across folding, wrapping, injected rows and horizontal chunking still needs browser qualification. The inspected APIs demonstrate attachment opportunities, not a completed remote-cursor renderer.

### Missing or insufficient contracts

1. **Exact transaction subscription through the plugin surface.**  
   Expose all logical text transactions with pre-edit snapshot, atomic edit batch and author/origin metadata, including typing, IME, paste, commands, undo and programmatic changes. Coalesced view changes are insufficient as the only operation source.  
   Evidence: `editor/packages/editor/src/plugins.ts:168–173, 706–718`; `editor/packages/editor/src/documentSession.ts:148–162`.

2. **Explicit collaboration-origin application.**  
   Coarse `external | view` origin does not distinguish remote confirmations, optimistic replay, rollback and local programmatic commands. Public plugin `applyEdits` does not expose history/origin options.  
   Evidence: `editor/packages/editor/src/documentSession.ts:158–159, 324–332`; `editor/packages/editor/src/plugins.ts:781–785`; `editor/packages/editor/src/createPlugin.ts:150–155`.

3. **Atomic reconciliation.**  
   A public network-agnostic batch must replace the confirmed base and replay pending operations without intermediate paints, echoes, extra undo entries or disturbed IME ownership. Calling ordinary undo repeatedly is not the desired contract. This specific collaboration transaction is absent from the inspected plugin contexts.  
   Evidence: `editor/packages/editor/src/plugins.ts:772–808`; `editor/packages/editor/src/createPlugin.ts:131–162`.

4. **Transportable character identity bridge.**  
   Existing tracked points and branded revision scopes are local API values. The collaboration engine needs explicit stable-ID/offset conversion and snapshot/checkpoint identity serialization, owned by the host-ordered data model.  
   Evidence: `editor/packages/editor/src/plugins.ts:507–520, 624–628`; `editor/packages/editor/src/editor/editChain.ts:3–18`.

5. **Collaborative undo policy.**  
   Remote confirmation and replay must not become ordinary local undo entries. Local undo should submit a new intent for the author’s operation, not rewind everybody to an old shared snapshot. `history: 'skip'` is a useful primitive, not the complete policy.  
   Evidence: `editor/packages/editor/src/documentSession.ts:170–181, 324–345`.

E027 remains an Approved design inventory with unfinished implementation items; it is not proof that all desired hooks shipped. E050 explicitly records completed public contracts. Inspect current code rather than interpreting either plan as blanket coverage.

Evidence:

- `plans/e027-extension-hooks.md:5–14, 26–46, 63–85`
- `editor/docs/architecture/e050-host-obligations.md:1–18`

### Extension cost budget

Register only the inputs a collaboration attachment consumes. Existing contribution routing caches recipients by update kind; omitted `inputs` subscribes to every kind.

Evidence:

- `editor/packages/editor/src/plugins.ts:646–684`
- `editor/packages/editor/src/editor/viewContributions.ts:395–417`
- `editor/packages/editor/src/createPlugin.ts:35–59`

Proposed qualification: 0/100/1,000 inert plugins must produce zero transaction/presence callbacks for uninterested extensions. Serialize only the operation, not a full document, on typing. Network, encryption and presence throttling stay off the synchronous edit path. No idle collaboration timers when unattached.

## 6. Security and configuration

### Room passwords, DTLS and E2E

y-webrtc derives an AES-256-GCM key from the password using PBKDF2/SHA-256, 100,000 iterations and the room name as salt. It encrypts signaling payloads and BroadcastChannel messages. Room topic names remain visible.

**It does not separately AES-encrypt document bytes sent over the WebRTC data channel.** Those are protected by WebRTC’s DTLS transport.

Evidence:

- [Key derivation and encryption](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/crypto.js#L14-L64).
- [Signaling encryption](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L466-L473).
- [Direct data-channel sending](https://github.com/yjs/y-webrtc/blob/c411f1d7223b68f3c6fc9c5901a19819a17db667/src/y-webrtc.js#L146-L162).
- [RFC 8831 §§1, 5–6](https://www.rfc-editor.org/rfc/rfc8831).

Authenticated signaling matters because DTLS authenticates the negotiated endpoint; an untrusted signaling broker must not silently replace that endpoint. A room secret protects outsider access but is not a per-user identity system. Members sharing the secret can impersonate another member unless identity is authenticated separately.

Presence is not intrinsically authenticated either.

Evidence: [y-protocols security note, PROTOCOL.md lines 176–178](https://github.com/yjs/y-protocols/blob/73b2ff75486c9879843718dc6c7fc52d63aea4fe/PROTOCOL.md#L176-L178).

TURN relays do not terminate peer-to-peer DTLS. However, when a future server becomes an actual editor peer/host, it receives plaintext as a participant. Advertising document secrecy from that host would contradict its ordering/edit-policy responsibilities.

Evidence: [RFC 8656 §3.4](https://www.rfc-editor.org/rfc/rfc8656); [RFC 8831 §5](https://www.rfc-editor.org/rfc/rfc8831).

### Proposed security baseline

- Random opaque room IDs; no file paths or document titles in discovery topics.
- High-entropy invitation secrets delivered outside the signaling broker.
- Authenticated signaling messages bound to room, peer session and connection generation.
- Replay detection and bounded decoding, transfers, pending queues and history claims.
- Validate history possession before accepting “newest confirmed” claims.
- Render peer names as text; validate colours.
- Treat room members as trusted in the minimal model. Byzantine-member election protection is out of initial scope.
- If application E2E beyond WebRTC endpoints is required later, define it separately with authenticated peer identities and key rotation.

These are recommendations, not a completed security review.

### Settings

The standalone plugin takes supplied signaling URLs, ICE servers, transport policy and credentials. It must have **no silent public-server defaults**.

Fregat registers user-visible configuration in its settings registry and injects values into the standalone plugin. Room secrets and TURN credentials go through the secret store; renewable credentials should use a credential-supplier interface.

Evidence: `CLAUDE.md:64–68`.

Do not introduce hardcoded endpoints or environment-only knobs. Signaling and TURN configuration must remain usable outside Fregat.

## 7. Open questions

1. **What exactly does “confirmed” promise?** Branch acceptance is compatible with active partitions; irrevocable global commitment is not.
2. **Which character-ID engine and checkpoint format will the other lanes choose?** Transport cannot implement reliable replay before this is specified.
3. **How long must losing suffixes, intents and tombstones survive?** Unlimited offline replay conflicts with aggressive history compaction.
4. **How are concurrent three-way reconciliations resolved?** The proposed message vocabulary is sufficient to express them, but the state machine and convergence argument are unverified.
5. **How are transformed/rejected parent operations handled during dependent replay?** Explicit conflict outcomes are required.
6. **What should collaborative undo mean for host-transformed edits?**
7. **How are view attachments deduplicated over one shared buffer, including the simple editor path?**
8. **Who supplies signaling/TURN credentials and admission policy?** Defaults cannot be left to public y-webrtc services.
9. **Which platform hosts a future server peer?** A Node server needs a supplied WebRTC implementation or another transport adapter; do not make browser core depend on it.
10. **What room-size/network qualification is accepted?** Eight peers is a proposed starting target, not measured capacity.

**Bottom line:** the transport should be a small replaceable adapter around a separate host-ordered collaboration session. Presence and plugin rendering can reuse substantial existing infrastructure. The critical missing work is the exact transaction/origin/reconciliation contract and the branch-history protocol—not establishing a data channel.
