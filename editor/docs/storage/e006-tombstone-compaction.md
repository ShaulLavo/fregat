# E006: Tombstone compaction

Maintenance now shrinks the position metadata of the current snapshot, not only its text. Runs of
tombstones become a few textless **stand-ins**, and the reverse index leads the dropped tombstones'
entries to them. Every anchor resolves to exactly the offset and liveness it did before, in the
compacted snapshot and in every snapshot edited from it. Snapshot identity, text, revision and
visible pieces do not change. After 20,000 paragraph replacements the current tree holds 4 pieces
instead of 20,002. What still grows with edit count is about 22 bytes per insertion, down from
about 259. This completes E006; [text reclamation](e006-text-reclamation.md) was the first milestone.

## Where text lands

Deleted-anchor resolution depended on the tree's shape. An insert descended to the first node
whose span reached its offset and landed after it, which could be a tombstone. Four trees built
over the same four pieces (`prefix `, two deleted inserts, `suffix`) sent one insert to two
different slots, so a left-biased anchor in the second deleted insert resolved to 8 in one tree
and 7 in the others. Nothing chose between them but AVL balance.

An insert now lands right after the last visible piece ending at its offset, or at the front of
the document ([`tree.ts`](../../packages/textbuffer/src/tree.ts)). Replacements already placed
their text immediately before the first hidden piece. So no text ever lands between two
tombstones, and every edit today produces the same sequence whatever the tree's shape. The only
code that landed at a piece's start was a surrogate snap moving an offset onto the first unit of
a piece; it now retries one unit left, as a snap across two pieces already did.

The landing change alternated with its parent commit on one quiet machine, 15 samples per
workload ([summary](../../examples/stress/results/reclamation/positions-landing-bench.json),
raw runs beside it). Medians in milliseconds, baseline / candidate / baseline / candidate:

| Workload | Singapore median | Ratio to vscode-textbuffer |
| --- | ---: | ---: |
| Sequential typing | 0.433 / 0.425 / 0.420 / 0.436 | 0.67 / 0.69 / 0.67 / 0.68 |
| Random insertions | 1.876 / 1.869 / 1.835 / 1.807 | 1.59 / 1.50 / 1.55 / 1.52 |
| Random replacements | 2.607 / 2.332 / 2.673 / 2.300 | 1.80 / 1.65 / 1.87 / 1.62 |
| Mixed edit churn | 2.927 / 2.664 / 2.943 / 2.689 | 2.28 / 2.15 / 2.35 / 2.21 |
| ASCII replacements | 2.341 / 2.080 / 2.588 / 2.115 | 1.69 / 1.51 / 1.80 / 1.54 |
| Anchor density | 10.58 / 10.97 / 10.53 / 11.03 | — |

Replacement-heavy lanes got 9–18% faster; typing and large pastes did not move. Anchor density
is 4% slower in both pairs. That lane has two modes about 10% apart that change with warmup
count ([E046](../performance/e046-one-walk-rows-and-cuts.md)), so this is recorded, not
explained. `bench:check` passes its structural budgets.

## What a tombstone still answers

A tombstone holds no visible text. It matters only to a deleted anchor, which reads where its
gap scan stops: leftwards and rightwards over newer pieces, to the first piece whose buffer is no
newer than its own. Text only lands next to visible pieces, so within a run of adjacent
tombstones nothing is ever inserted, and the boundaries on either side of a visible piece are
the only places new text can appear.

For a tombstone in run `R`, a scan ends in one of these ways, which no later edit can merge or
split:

- **Sealed:** it stops inside `R`. Nothing can ever land between, so it contributes nothing.
- **At a visible piece:** each piece is its own case; text can land on either side of it.
- **In another run:** anywhere in one run of tombstones is the same stop, since nothing lands
  inside a run.
- **Past an end:** the front of the document takes inserts, so it is its own case. The end
  behind a trailing run takes none, so a scan leaving a trailing run is sealed.

Two tombstones of a run that stop alike on both sides resolve alike forever. The proof is the
list above: a later edit can only add pieces newer than every threshold at the boundaries of
visible pieces, hide visible pieces, or merge runs. None of that separates two scans that stopped
in the same place.

## The stand-ins

[`compaction.ts`](../../packages/textbuffer/src/compaction.ts) reads the tree in order once and
finds, for every piece, the nearest piece before and after it with a buffer no newer
(two monotonic stacks). That gives each tombstone its pair of stops. Tombstones are grouped by
pair, and each group becomes one stand-in whose buffer field is a threshold: the oldest buffer in
the group. Groups open only on the left go first by falling threshold, then the one open both
ways, then groups open only on the right by rising threshold. Left-open tombstones are the run's
prefix minima and right-open ones its suffix minima, so the order they are met in is already that
order and nothing is sorted. A group sealed both ways becomes a
stand-in with a threshold no scan stops at, placed between neighbours on both sides. Scans from
outside the run stop at its oldest piece, which the arrangement keeps.

Original tombstones cannot become stand-ins: an original anchor is found by summing the original
buffer's piece lengths. A group's original tombstones merge into one tombstone over their
contiguous range, placed beside its stand-in so the open side stays open.

Each run's arrangement is checked before anything is published: every slot must stop both scans
where its group's tombstones did, the oldest buffer must survive, and the original ranges must
chain. A slot is sealed on a side when a slot there is no newer, which prefix and suffix minima
answer in one pass. An open slot's threshold is the buffer of one of its own group's tombstones,
open on that side, so its scan leaves the run and stops where theirs did. A run that fails is
kept and counted as `unverified`. No test, soak or benchmark has counted one.

A pass yields after every 1,024 units of work: pieces read, stack entries popped (one piece can
pop every piece before it), members grouped, slots arranged and checked, stand-ins built, entries
pointed at them, and pieces joined into the tree in balanced blocks. A run of any length therefore
never holds a maintenance slice.

A run is replaced only when it gets shorter. Stand-ins take the orders of the run's first
pieces, and the replacement path-copies the tree around each run with `join`, so the rest of the
tree stays shared with history. The snapshot is republished in place: `root`, `reverseIndex` and
`pieceCount` change on the same object, which keeps leases, receipts and prepared transactions
valid. Rebuilt nodes carry an epoch no lineage reaches, so every later edit copies them.

## The reverse index

A compacted tombstone's entries name the **identity** of its group's stand-in, not an order. A
stand-in keeps its identity in its otherwise unused `start` field, and a small persistent
[table](../../packages/textbuffer/src/standIns.ts) held with the index maps each identity to its
stand-in's current order. Identities are small integers counted down from below the lowest order
any piece may take, so an entry that names one stays an unboxed V8 small integer; the insert that
would take an order below that floor relabels instead.

Orders and identities move separately, so neither kind of work reads old insertions' entries:

- **A pass** gives each new stand-in the identity of one it replaces and folds the others into
  it, smaller groups into larger, so an identity is at most one step from a live one and is moved
  at most log2 times over its life. Only the entries of real tombstones the pass compacts are
  written, in batches between yields.
- **A relabel**, inside the edit that ran out of room, writes the entries of the pieces in the
  tree and the table rows of the stand-ins in it, copying each touched index node once.

A stand-in accepts any anchor its entry leads to; a live piece still checks the anchor's offset.
Only stand-ins are ever targets, and the relabel finds them by shape: no edit makes a piece of
length 0. `resolveAnchorLinear`, the reference that uses no summaries, asks the index only for a
compacted anchor's stand-in.

The first version pointed entries at orders. Any pass or relabel then had to read every entry
ever made: after 100,000 compacted insertions a relabelling keystroke took 45.6 ms of CPU time on a
125-piece tree, and a pass grew from 42 to 794 steps over 200,000 one-character insertions. Both
now depend on the tree alone: 1 ms and 34 steps.

## In the editor

[Buffer maintenance](../../packages/editor/src/textStorageMaintenance.ts) compacts the current
snapshot's tombstones and then reclaims text, in the same sliced quiet-time job. A pass is due
after 128 Ki deleted code units, as before, or once the current tree has grown by 4,096 pieces
and by a quarter since the last pass. The second trigger exists because backspacing makes a
tombstone per code unit while deleting very little text; the quarter keeps each pass's walk of the
tree paid for by the edits since the last one.

Only the current snapshot is compacted. History keeps the trees it recorded, which share nodes
with each other, and lets them go as it moves on; every later state is edited from the compacted
tree. Compacting each history state separately would copy the paths every one of them shares.

## Evidence

[Headless runs](../../examples/stress/results/reclamation/positions-headless.json) drive a real
buffer and session with real maintenance, saving every 500 cycles, against a control that never
maintains. They hold deleted anchors throughout and assert that each resolves exactly as in the
control. Pieces are the current tree after clearing history; heap is Bun's live JSC heap after a
forced collection, with the default 200 history states still held.

| 20,000 cycles | Pieces, control → compacted | Heap with history, control → compacted |
| --- | ---: | ---: |
| Paragraph replaced at one spot | 20,002 → 4 | 39.1 MB → 2.6 MB |
| Word typed and backspaced per unit, 64 spots | 80,064 → 192 | 20.2 MB → 3.8 MB |
| Scattered inserts, deletes and replacements | 35,315 → 2,838 | 10.4 MB → 2.9 MB |
| `x` appended between deleted `y`s | 60,001 → 40,001 | 77.9 MB → 52.7 MB |

The first two stop growing after their first pass: 4 and 192 pieces at 1,000, 5,000 and 20,000
cycles. Scattered edits leave 2,913 pieces at 5,000 cycles and 2,838 at 20,000. Those are the
visible fragments of a 4.5 K-unit document that twenty thousand random edits have cut up, plus a
stand-in or two between them. The appends keep one piece per `x` and one stand-in per cycle,
each in a class of its own; their large heap is the same in the control and was not examined. The
longest maintenance slice was 2.8 ms of thread CPU time. Heap after clearing history moves with
collection timing in these runs, and is not used.

**Maintenance latency.** Appending `x`, then appending and deleting `y` twice, blocks each
cycle's tombstones with a different visible piece, so one trailing run keeps a stand-in per cycle
and every pass plans all of it. The first version checked each slot against every other and walked
the blocker chain per slot, and planned a run without yielding. The
[probe](../../examples/stress/reclamation-positions-latency.mjs) compacts every 1,000 cycles and
times each step of the job in thread CPU time, best of three processes
([before](../../examples/stress/results/reclamation/positions-latency-before.json),
[after](../../examples/stress/results/reclamation/positions-latency-after.json)):

| Document length | Longest step, first version | Longest step now |
| --- | ---: | ---: |
| 4,000 characters | 19.9 ms | 1.5 ms |
| 8,000 characters | 79.6 ms | 1.6 ms |
| 16,000 characters | 496 ms | 2.0 ms |

The remaining growth is collection work that rises with the heap: labelled by phase, the slow
steps fall in every phase alike. The textbuffer tests, the maintenance tests and the headless
runs fail when a step or slice reaches 16 ms of this thread's CPU time; CPU time, because a busy
machine stretched wall-clock slices to 65 ms with nothing else changed.

[Per-insertion cost](../../examples/stress/results/reclamation/positions-per-id.json): fifty
spots each take an insert that is deleted again, in fresh Node processes, with text reclamation
in both. The slope between 20,000 and 100,000 insertions is 22 bytes each with compaction and
258 bytes without. Entries that name one identity are not merged, which is what keeps a pass off
old entries; the first version merged them and measured 9 bytes.

The [soak](../../examples/stress/results/reclamation/positions-soak.json) runs 400 seeded
sessions of 800 edits against an uncompacted control: inserts, deletes, replacements and
multi-edit batches, surrogate halves, empty documents, repeated edits at one spot that exhaust
order gaps, and undo to earlier states with anchors made on abandoned branches dropped. Some
passes are stepped partway, as maintenance slices them, then overtaken by the next edit and
finished afterwards on the state they began on. Every anchor resolved alike after every edit
through 115,068 compactions, 7,928 of them overtaken after at least one step, that removed
468,621 tombstones; the linear reference and the inspector agreed every 50 edits. Every finished
pass is counted, including those that finish during their first steps, and the last pending pass
is drained. An earlier run under the identity table failed five seeds: folding a group whose only
folded identity was 0 read it as empty and left 0 two steps away. That is fixed and tested.

In the tests, [`compaction.test.ts`](../../packages/textbuffer/src/compaction.test.ts) runs the
same differential check, overtaken passes included, for 16 seeds of 400 edits and 2
surrogate-heavy seeds of 1,500. It covers original text, order relabels beside stand-ins,
transient lineages and churn at several spots, and rebuilds one piece sequence under every root
to show an insert lands in one place; the landing it replaced gives three answers there. Its
relabel test holds anchors inside the compacted text, which dropping the stand-ins' entries
turns into offset 0. Three more fail on the first version: a relabel after 50,000 insertions,
a pass late against early in a long history, and a pass beside 64 fragmented buffers it leaves
alone. The maintenance tests check identity, revision, deleted anchors and undo across a pass,
and the piece-growth trigger. The inspector now checks stand-ins, the gaps they leave in a
buffer's pieces, and entries that lead to them.

## What still grows

- **One reverse-index slot and one chunk-map entry per insertion ever made,** about 22 bytes
  together in V8, and a table row per stand-in identity. Buffer ids are what anchors store, so removing either needs ids renumbered, which
  only the anchor lifetime contract in the [investigation](e006-reclamation-investigation.md) would
  allow.
- **History** holds the trees it recorded until it moves past them: up to the history limit plus
  the edits since the last pass.
- **Line indexes** of chunks that still hold text keep the offsets of deleted breaks, as before.

An anchor made on a branch that was later abandoned can name a buffer id the current branch
reused. Such an anchor was already meaningless, and compaction can change which wrong offset it
gets. The tests drop anchors from abandoned branches for that reason.

## Reproduce

After building workspace dependencies:

```sh
bun run --cwd packages/textbuffer build
bun run --cwd packages/textbuffer test
bun run --cwd packages/textbuffer bench:check
bun run --cwd packages/editor test --project node test/storageMaintenance.node.test.ts
bun run --cwd packages/editor bench:reclamation-positions
node --expose-gc examples/stress/reclamation-positions-per-id.mjs
node examples/stress/reclamation-positions-soak.mjs 400 800
node examples/stress/reclamation-positions-latency.mjs
bun run --cwd packages/textbuffer bench -- --only sequential-typing,random-replacements --samples 15
```
