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

## working on it

from this folder, after `bun install` at the repo root

```sh
bun run verify
```

`verify` typechecks, builds, runs the vitest suite and a smoke test against the built package

## more

- [how it works](docs/design.md): the trees, the reverse index, the buffer log, anchors, compaction, line endings
- [benchmarks](docs/benchmarks.md) against vscode's text buffer, and how to run them
- every export is in [src/index.ts](src/index.ts)
- ideas taken from [fredbuf](https://github.com/cdacamar/fredbuf), [zed's anchors](https://zed.dev/blog/zed-decoded-text-coordinate-systems#anchors) and [vscode's piece tree](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation)
