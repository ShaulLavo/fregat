# @singapore-editor/collab

Host-ordered collaborative text with optimistic participants and FugueMax placement.
`ReferenceEngine` is the small correctness oracle. `TextbufferEngine` keeps document
text in the persistent Singapore piece table.

```ts
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'
import { Participant, TextbufferEngine } from '@singapore-editor/collab'

const buffer = createPieceTableSnapshot('hello', {
  normalized: true,
  charIds: { bunch: 'shared-document:0', counter: 0 },
})
const engine = new TextbufferEngine(buffer)
const participant = new Participant({
  actor: crypto.randomUUID(),
  document: 'document',
  epoch: '1',
  engine,
})
const edit = participant.local({ offset: 5, deleteCount: 0, text: ' world' })
// Submit edit to the Host; deliver its ordered HostMessages to participant.receive.
```

Replicas bootstrap from the same normalized text and initial character IDs. The
constructor accepts a fresh identity-enabled piece-table snapshot whose original
text has one contiguous identity run. Restore an existing collaboration through
`engine.restore(saved)` so its placement metadata accompanies the text.

## Storage and ordering

Two persistent AVL indexes retain placement runs and branch children. A run stores
its first ID, count, parent, side and right origin. Its remaining characters are an
implicit right-child chain. Branching splits only the touched parent into explicit
segments. Straight typing extends the last segment when its authored IDs and right
origin continue it. Deleted characters retain their position and placement metadata.

Sibling ordering follows FugueMax. Left children sort by ID. Right children sort by
descending structural right-origin position, then ID. Structural comparisons use
`locateCharId`'s piece order and storage unit, including tombstones. The selected
boundary goes to `applyCharIdEdit`; remote deletions target authored ID spans.

Authoring converts the visible selection through `charIdSpansInRange` and rejects
surrogate-pair splits. The right origin is the next structural character after the
visible left neighbour, including deleted characters. Participants reserve IDs with
the textbuffer's `CharIdAllocator` outside snapshot history and replay those IDs.

Snapshot creation retains the piece table and returns the current state object.
Restore assigns that retained state by reference. Neither operation enumerates the
text or placement runs. There is one text store and no per-character placement
object. A bootstrap document of any length occupies one placement run.

Indexed lookups and path copies cost logarithmic time in run/piece count. Each
allocated chain retains its original depth and binary ancestor jumps across chain
boundaries. Splits share that ancestry. An ancestry query takes logarithmically
many indexed jumps; `charIdAfter` finds the structural successor directly in the
piece tree, including tombstones. Subtree-edge searches still descend placement
branches, and sibling insertion copies the touched parent's child array. This
keeps the measured scattered and deep-tail histories bounded while leaving
adversarial sibling fanout and subtree-edge work as separate costs.

`text()` deliberately materializes the visible projection when a consumer asks.
`state()` also includes this explicit text read. Participant subscriptions publish
`ParticipantChange`: frontier, host sequence, pending and blocked edits, plus
`edits: readonly { from, to, text }[]`. These effective edits transform the previous
published projection into the final coherent projection. Offsets refer to the
previous projection, and the shape matches the editor's `TextEdit` and reconcile
options. Acknowledgements with equal text publish an empty edit list. Apply edits
from right to left when maintaining a string projection.

Both engines expose `changesBetween(snapshot)` for the same effective-edit
contract. The reference engine uses a string diff as its oracle. The textbuffer
engine diffs persistent trees, skipping shared subtrees and identical storage
ranges before reading changed text. Subscribers incur one diff after the entire
confirmed-prefix apply and pending replay. Unsubscribed participants retain no
publication snapshot and perform no diff. Subscriber failures are surfaced after
all entitled subscribers receive the committed changes in order; the first thrown
value is preserved.

## Undo and retained provenance

Placement runs may coalesce across authored edits. A separate persistent span index
retains each insertion and every deleting operation, including deletes of hidden
IDs. A character is visible when its insertion is active and all its deletions are
inactive. Bootstrap IDs have an always-active insertion. Atomic `setEffects`
commands validate every desired state before publication; replayed edit and command
IDs are deduplicated. Snapshots retain provenance, operation states and command IDs
alongside the piece table and placement indexes, by reference.

Effect changes visit the affected identity spans and change visibility of retained
piece-table payloads. Each snapshot registers its immutable provenance spans as
reclamation roots, retaining text reachable by future undo/redo effects. Genuinely
expired payloads reject the entire effect batch with `expired-character-payload`,
preserving visibility, operation states and command deduplication. Effect changes
allocate no replacement IDs and keep text in the piece table. Operation and provenance indexes grow with history; acknowledgement-aware
compaction remains a separate concern.

## Checks and bounded performance experiment

```sh
bun run build
bun run typecheck
bun run test
bun run bench
```

The shared fixture runs every unit, simulator and ported upstream suite against
both engines. A paired simulator checks authored envelopes, text, live IDs, hidden
IDs and visible offsets after every apply and restore, including pending replay, undo and redo. An independent scalar visibility model checks each ID before and after deliveries under both engines. `COLLAB_STRESS=1 bun run test` expands the seeded workloads to 10,000 rounds.
Set `COLLAB_STRESS_SHARD=1/8` through `8/8` to divide the simulator, differential
replay, independent visibility and Yjs short-round seed ranges between jobs. The
eight stress CI jobs cover each seed exactly once in those loops, including the
200-seed single-author history comparisons. Other tests run in every job. An
unsharded stress run retains the complete workload; ordinary runs ignore the shard.
`bench/stress-shard-evidence.json` records full-suite shard durations and qualified
CI estimates at twice the local elapsed time.

`Engine.characters()` returns a diagnostic inventory sorted by bunch and counter.
Each record contains the ID, deletion state and visible offset. Hidden IDs retain
their visible gap. The simulator compares these fields and visible text for every
engine factory. Snapshots remain engine-owned restoration data. The inventory
expands IDs on request and stays outside authoring, application and snapshot work.

`bench` requires built textbuffer and collab packages. It measures 500 local
identity-enabled author/apply edits and a single remote arrival with 1, 10 and 100
pending edits on 10,000-line and 100,000-line documents. Setup and exact output
validation stay outside timers. Results are 21 in-process samples after five
warmups. These are storage/protocol experiments; browser rendering and editor
consumer costs need separate input verification.

`bun run bench:fragmented "experiment, shared machine"` measures the fragmented
100,000-line workload at 5,000 and 50,000 retained inserts: five concurrent authors,
scattered or deep-tail placement, and exact-ID tombstones. It reports typing and
reconcile medians/p99 at 1, 10 and 100 pending edits, subscribed publication, method
profiles, run lookups and shared-tree edge visits. Add `--counts` to omit typing
and reconcile timing batches. `bench/fragmented-evidence.json` records an alternating
A/B/B/A experiment, its source fingerprints and the counted-work comparison.
