# E066: Collaborative text with one ordering host

Source paths in this document are relative to [`editor/`](../editor/) unless qualified.

- Status: In progress
- Kind: Implementation
- Owner: Editor
- Priority: P2
- Effort: XL
- Dependencies: none. The [WebRTC plugin](e067-webrtc-collaboration-plugin.md) and the
  [Delta DB plan](delta-db-implementation-plan.md) build on it.
- Inspected baseline: `1e066d38b6455b45d406fce175f902152a58295b` (Fregat main, 2026-10-08)
- Research: [collaborative editing research](../docs/collab-editing/README.md), lanes A–E

## Outcome

Several people or agents edit one document at once and every copy ends with the same text.
Concurrent typing at one spot does not interleave, and Undo reverts only your own edits, even
after others have edited around them. The editor core stays network-agnostic: it emits edits,
applies remote ones and reconciles. A transport carries them: the WebRTC plugin (E067), or
Fregat's server (Delta DB).

## Current code

From [lane A](../docs/collab-editing/a-textbuffer-mapping.md) and
[lane C](../docs/collab-editing/c-undo.md):

- A piece points at `(buffer, offset)` in a chunk (`packages/textbuffer/src/pieceTableTypes.ts`).
  That pair names a UTF-16 code unit locally, but buffer numbers come from the snapshot-local
  `nextBufferSequence` (`buffers.ts`), so two copies, or two edits of one retained snapshot, mint
  the same number for different text.
- Deleted-anchor resolution returns a visible gap edge, and inserts never land between two
  tombstones (`anchors.ts`, `tree.ts`). E006 compaction folds tombstone runs into textless
  stand-ins (`compaction.ts`, `standIns.ts`). Anchors keep their behaviour, but the exact order
  of deleted characters, which "insert after deleted X" needs, is lost.
- `order` is a local fractional label with whole-tree renumbering (`orders.ts`). It never has
  to be shared when the host orders edits.
- Typing extends the newest piece in place (`tree.ts` coalescing). Replace hides and inserts in
  one transaction (`edits.ts`).
- Undo is the E017 graph of whole-document snapshots with offset-space inverse edits
  (`packages/editor/src/history.ts`, `documentSession.ts`); E018 persists it and restores it
  when the file's content hash matches.
- Edit consumers (tree-sitter, LSP sync, decorations, spellcheck, minimap, find) already consume
  published changes without checking where they came from
  ([lane E](../docs/collab-editing/e-fregat-host-and-delta-db.md#edit-consumers)). The edit
  chain they read is bounded to 128 entries and may compose changes, so it is not an edit log.

## Scope

- Global character identity, edits in ID terms, FugueMax placement at the host, participant
  reconciliation, undo of one's own edits, and the core API a transport uses.
- An in-memory transport for tests, and the ported upstream suites.

Not in scope: network transports (E067), Fregat's server host, disk and agent edits (Delta DB),
rich text, permissions, and a host-free ordering (gated below).

## Design

Decisions (owner, 2026-10-08): Matthew Weidner's model,
[Collaborative Text Editing without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html);
any participant can be host; the edit format stays CRDT-ready; port Loro's, Yjs's, Diamond
Types' and Fugue's test suites. The research settles the rest:

- **Identity.** Each UTF-16 code unit gets a `CharId { bunch, counter }`. A bunch is a run of
  counters reserved once, when the edit is written, outside any snapshot, so replay never mints
  new IDs. Sequential typing extends its bunch. Identity runs map onto storage buffers through a
  snapshot-consistent index; storage IDs stay numeric on hot paths, and the reverse index serves
  the local half of ID → offset lookup. Edits that would split a surrogate pair are rejected at
  the authoring edge.
- **Edit format.** One envelope per user transaction:
  `{ document, epoch, id: { actor, seq }, lamport, deps, change }`, where `change` is
  `insert { start, originLeft, originRight, text }`, `delete { spans }`, or `replace` carrying
  both as one atomic unit. Origins are the author's neighbours at writing time, including
  tombstones, as FugueMax defines them, and are never rewritten during replay. `deps` is a causal
  frontier, separate from `lamport`. Deleting an already-deleted ID is harmless; duplicate
  envelopes are dropped by `id`.
- **Placement.** The host integrates inserts with FugueMax
  ([lane B](../docs/collab-editing/b-placement-and-tests.md#6-recommendation)): Fugue's
  parent/side tree, with right siblings ordered by the reverse sequence order of their right
  origins and ties broken by ID. The wire keeps two origins and the tree is derived internally.
  A small explicit parent/side implementation serves as a test oracle.
- **Tombstones.** Collaborative documents keep exact tombstone order. E006 stand-in compaction
  is off for them; text reclamation stays on, with confirmed and pending snapshots retained.
  Compacting identity metadata waits for a protocol rule that proves no future edit can name
  those IDs.
- **Exact structural edits.** New textbuffer primitives insert beside a located piece boundary
  (splitting hidden ranges as needed) and delete exactly the targeted ID fragments. Neither goes
  through visible offsets.
- **Host and participant.** The host validates `deps`, applies each envelope as one persistent
  edit, assigns a sequence number and broadcasts it. A participant holds
  `{ confirmed snapshot, frontier, host sequence }` plus its pending queue. On host messages it
  restores the confirmed snapshot by reference, applies the host's edits, drops acknowledged
  pending ones and replays the rest. Consumers see one coherent published transition, never the
  intermediate states.
- **Undo.** Each character records its inserting edit and every deleting edit. It is visible
  when its insert is active and no delete of it is active (Zed's rule,
  [lane C](../docs/collab-editing/c-undo.md#1-how-zed-loro-and-yjs-do-it)). Undo and redo send
  `setEffects { command, [{ op, active }] }` with explicit target states, so a duplicate never
  flips a result. The E017 graph keeps its branches, but a node means "these of my edits are
  active", never a whole-document state; checkout deactivates the departing path and activates
  the target path in one host transaction. Remote edits never enter local history, never clear
  redo and never remove branches. Selections are stored as character-ID gaps. Persisted history
  is restored only when the document identity matches, not the content hash. Same-ID revival
  keeps anchors (jump history, comments) pointing at returned text.
- **Core API.** A transaction stream with origin (local, replay, remote, undo); an atomic
  reconcile call that replaces the confirmed base and replays pending edits without echo, extra
  history or an IME break; ID ↔ offset conversion; and remote anchors for cursors. They attach
  through [E027](e027-extension-hooks.md)'s hooks and cost nothing to documents without
  collaboration ([lane D](../docs/collab-editing/d-webrtc-plugin.md#5-plugin-attachment-points-and-missing-core-hooks)).

## Steps

1. **Spike.** A scratch host and three participants on the in-memory transport, FugueMax on the
   explicit-tree oracle, random concurrent edits checked against a plain string model. Record the
   `bench:input` typing baseline before any textbuffer change.
2. **Identity runs.** `CharId` allocation, the run ↔ storage index, coalescing only within one
   bunch, and stand-in compaction off for collaborative documents.
3. **Exact structural edits** and the edit envelope, with authoring-edge conversion from offsets.
4. **Host and participant**, with FugueMax on two origins, `deps` validation, deduplication and
   atomic reconcile.
5. **Undo of my edits**: deletion provenance, `setEffects`, the E017 graph change, ID-gap
   selections and identity-keyed persistence (E018).
6. **Core API and consumers**: the transaction stream, reconcile, ID ↔ offset and remote anchors
   through E027; syntax, LSP sync, decorations, spellcheck, minimap and find fed remote edits.
7. **Ported suites**, in [lane B's ranked order](../docs/collab-editing/b-placement-and-tests.md#62-ranked-suites-to-port-first),
   with a third-party notices file and per-file provenance. Leave out the Fugue B4 editing trace,
   whose licence is unresolved.

## Verification

- Steps 2 and 3: textbuffer suites pass, and an ID edit applied to two snapshots, including
  inserts after deleted characters, gives identical text, anchors and IDs.
- Step 4: Loro's four `fugue.rs` interleaving cases, the three-replica Yjs counterexample (`ab`
  stays adjacent), Loro's tombstone-origin cases and the `AXYBN`/`xaaaabn` regressions pass (under FugueMax the
  `AXYBN` history yields `AYXBN`, checked against the Fugue reference; Loro's literal reflects
  original Fugue's sibling order). The
  Yjs five-user disconnect scheduler, adapted to one host and optimistic participants, converges
  over 10,000 seeded rounds.
- Step 5: lane C's Loro and Yjs undo cases, independently written scenarios for Zed's visibility
  rule (Zed's text tests are GPL and are not copied), and its 14 Singapore cases pass, including two
  overlapping deletes undone separately and a duplicate acknowledgement.
- Step 6: in a browser test, a remote edit updates highlighting, folds, diagnostics and a
  decoration. At 0, 100 and 1,000 inert plugins, uninterested extensions get zero transaction
  callbacks.
- Throughout: `bench:input` keystroke cost stays within the 8.3 ms bar and within noise of the
  step 1 baseline, alone and with 1, 10 and 100 pending edits during a remote arrival.

## Delivery (2026-10-08 wave)

- Steps 1–4, 6 and 7 are delivered: `@singapore-editor/collab` with FugueMax, Host,
  Participant and simulator (#950); textbuffer character identity and exact structural edits
  (#952); `TextbufferEngine` (#967); ported Loro, Yjs and Diamond Types suites (#955); editor
  transaction stream and atomic reconcile (#963); reconcile cost on fragmented history within
  budget (#1010: 100 pending edits on 100,000 lines from ~75 ms to under 1 ms, experiment);
  editor binding (#1026).
- Reconcile takes the exact edits as input; there is no character-diff fallback (#963 review).
- Step 5 is delivered: author-selective undo with deletion provenance and `setEffects`
  (#971, #993), driven by the E017 branching graph with the E019 viewer, character-ID-gap
  selections and E018 persistence keyed by document identity (#1078).
- All seven steps are delivered. Open follow-ups: the host-free upgrade gate below, identity
  compaction for long sessions, and Fregat's server as host (Delta DB).

## Risks and decisions

- **Host-free upgrade gate.** Build a host-free ordering (FugueMax over `deps` with no host)
  only if the ported long-offline suites produce merges the owner rejects. The envelope already
  carries what it needs. `collab/test/order-independence.test.ts` checks 1,024 distinct causal
  schedules per authored edit set through Host and direct engine integration, including owned
  undo effects, against the pinned FugueMax oracle. The host does not improve placement for the
  same authored set. Arbitrary concurrent writes to one owner's effect state remain last-arrival
  wins; the test documents that accepted-envelope counterexample separately.
- **Retained metadata grows** with edit history while tombstones stay exact. Measure piece and
  identity-run growth over long sessions before deciding on identity compaction.
- **Replay cost** grows with the pending queue; a long offline queue is the main latency risk.
  Replay may run in slices if it exceeds the frame budget.
  - Approved follow-up, 2026-10-09: measure and reduce repeated pending replay during rejoin.
    Reproduce with `COLLABORATION_LONG_RUN=1 bun run --cwd editor/packages/collab test
test/offline-order.test.ts --project textbuffer -t 'effects=false, adapter=document'
--reporter verbose`, through the host's job runner. Two groups author 2,000 edits each;
    the production document emitted `4001 total; 2000 unchanged losing-branch envelopes
replayed; four peers; zero rejected/blocked/pending`, then exceeded the original
    120-second test timeout at 241 seconds in a shared-machine run. The long-run timeout is
    now 600 seconds; default cases remain small. Ordering and edit loss were ruled out by
    text, retained-ID, visible-ID, acceptance and replay-envelope assertions.
    Start at `editor/packages/collaboration/src/document.ts:159` and
    `editor/packages/collab/src/participant.ts:161,242`: single-record confirmations restore
    confirmed state and replay the remaining queue. Count replayed operations at 1, 10, 100,
    1,000 and 2,000 pending edits before changing batching or reconciliation; preserve the
    existing correctness assertions. The engine fixture batches projection in stress mode,
    while the production document still confirms each record normally.
- **Host-rejected edits** that later pending edits depend on need a defined outcome: pending
  dependants are rejected with them and surfaced, never re-placed by offset.
- **Unicode contract.** Code-unit IDs with whole-pair edits follow Loro's contract. Yjs's
  surrogate-splitting expectations are not ported.
- **Licences.** Loro (MIT; its `diff/` subtree is Apache-2.0), Yjs (MIT), Diamond Types (ISC;
  confirm the notice before copying fixtures) and Fugue (MIT; `fugue/` is Apache-2.0).
