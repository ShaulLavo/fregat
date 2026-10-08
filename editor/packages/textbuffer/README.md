# @singapore-editor/textbuffer

the text storage under singapore's editor. a piece table kept in persistent AVL trees, so every edit returns a new snapshot and the old one stays valid

deleted text stays in the tree as tombstones, which lets anchors find their place again after the text around them is gone. no runtime dependencies

## try it

```sh
npm install @singapore-editor/textbuffer
```

```ts
import {
  createPieceTableSnapshot,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from '@singapore-editor/textbuffer'

const original = createPieceTableSnapshot('hello')
const edited = insertIntoPieceTable(original, 5, ' world')
const branch = insertIntoPieceTable(original, 0, 'say ')

materializePieceTableFullText(original) // 'hello'
materializePieceTableFullText(edited) // 'hello world'
materializePieceTableFullText(branch) // 'say hello'
```

hold on to a snapshot to keep that version. edit an older one to branch

anchors follow text through edits. bias decides which side of replacement text a deleted anchor lands on

```ts
import {
  anchorAt,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

const doc = createPieceTableSnapshot('abc')
const anchor = anchorAt(doc, 1, 'right')
const replaced = insertIntoPieceTable(deleteFromPieceTable(doc, 1, 1), 1, 'XX') // 'aXXc'

resolveAnchor(replaced, anchor) // { offset: 3, liveness: 'deleted' }
```

offsets count UTF-16 code units. rows and columns start at zero (`offsetToPoint`, `pointToOffset`, `readPieceTableLine`). loading folds CRLF to LF and remembers the original ending, so run inserted text through `normalizeLineEndings()` first and save with `pieceTableDocumentText()`

`/debug` has `validatePieceTreeInvariants` and other inspection helpers. `/diagnostics` takes an optional diagnostic sink. `/internal/*` is for tests and can change at any time

## collaborative character identity

opt in when loading a collaborative document. give every replica the same first ID for the original normalized text

```ts
import {
  CharIdAllocator,
  createPieceTableSnapshot,
  insertByCharId,
  deleteByCharId,
  charIdAt,
} from '@singapore-editor/textbuffer'

const original = createPieceTableSnapshot('abc', {
  normalized: true,
  charIds: { bunch: 'document-bootstrap:0', counter: 0 },
})
// Supply a random session-unique actor. Keep this allocator outside snapshot history.
const author = new CharIdAllocator(crypto.randomUUID())
const left = charIdAt(original, 0)!
const insertion = {
  start: author.generateAfter(left, 2),
  text: 'XY',
  at: { after: left },
} as const
const edited = insertByCharId(original, insertion) // aXYbc
const replay = insertByCharId(original, insertion) // same IDs after rollback
const deleted = deleteByCharId(edited, [{ start: left, count: 2 }]) // XYc
```

`CharId { bunch, counter }` names one UTF-16 unit. `charIdAt` reads a visible unit's ID; `locateCharId` finds its piece, storage unit, visible gap and liveness, including hidden characters. `charIdSpansInRange` converts a visible selection into identity spans and rejects boundaries inside surrogate pairs

`applyCharIdEdit(snapshot, { delete: spans, insert: insertion })` applies both halves of a replacement in one persistent edit. placement is `{ after: id | 'start' }` or `{ before: id | 'end' }`. the ordering engine chooses that exact structural boundary; it can name hidden characters. deletion hides only the supplied IDs, preserving other text inserted between them. already-hidden targets are harmless; unknown IDs and duplicate insertion IDs throw before changing the snapshot

identity-enabled snapshots require authored IDs for every insertion. ordinary offset deletion still works. collaborative documents keep exact tombstone order and skip stand-in compaction; text reclamation remains available. retain every snapshot you still need before reclaiming shared storage. identity metadata and hidden line-break indexes survive freed text

## working on it

from this folder, after `bun install` at the repo root

```sh
bun run verify
```

`verify` typechecks, builds, runs the vitest suite and a smoke test against the built package

the seeded structural-model test checks two seeds with 40 edits each by default. run the full six-seed, 1,800-edit sweep with the collaboration stress flag; each seed runs as a separate test with the default timeout

```sh
COLLAB_STRESS=1 bun run test src/charIds.test.ts
```

## more

- [how it works](docs/design.md): the trees, the reverse index, the buffer log, anchors, compaction, line endings
- [benchmarks](docs/benchmarks.md) against vscode's text buffer, and how to run them
- every export is in [src/index.ts](src/index.ts)
- ideas taken from [fredbuf](https://github.com/cdacamar/fredbuf), [zed's anchors](https://zed.dev/blog/zed-decoded-text-coordinate-systems#anchors) and [vscode's piece tree](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation)
