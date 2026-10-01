# @singapore-editor/paged

a read-only viewer model for UTF-8 files too big to load into the editor. it reads byte ranges on demand, keeps a bounded page cache and a sparse line index, and hands back windows of rows

experimental. it has its own document contract: no editing, history, saving or language features

not on npm yet. it lives in the [singapore](../../README.md) workspace

## try it

give it a source that can read byte ranges. here, a `File` from an `<input type="file">`

```ts
import { PagedDocument, type RangeSource } from '@singapore-editor/paged'

const revision = String(file.lastModified)
const source: RangeSource = {
  id: file.name,
  revision,
  byteLength: file.size,
  async readBytes(start, end) {
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer())
    return { revision, bytes }
  },
}

const document = new PagedDocument(source)
const view = document.createView()
const indexing = document.initialize()

const first = await view.readLines(0, 24) // renders while the index is still scanning
await indexing
const far = await view.readLines(1_000_000, 24)
const copied = await view.copyRange(far.rows[0].offset, far.rows[0].offset + 100)

view.dispose()
document.dispose()
```

each row is `{ line, offset, text }`. offsets are UTF-16 positions in the raw decoded file, BOM and CR included. a window says `truncated: true` when a long line hit the size cap

a view's next read cancels its previous one. pass your own `AbortSignal` as the last argument to cancel a single request

## more

- [source contract, positions, cancellation and memory limits](docs/contract.md)
- [the measurement behind it](../../docs/performance/e015-paged-proof.md)
