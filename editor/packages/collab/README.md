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

Indexed lookups and path copies cost logarithmic time in run/piece count. Ancestry
and subtree-boundary searches jump whole segments. Their cost depends on branch
depth, and sibling insertion copies the touched parent's child array. Highly
fragmented or adversarial histories can therefore cost more than straight typing;
this is not a worst-case logarithmic placement guarantee. Edits never enumerate
all document characters or materialize the document text. `text()` deliberately
materializes the visible projection when a consumer requests it.

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
