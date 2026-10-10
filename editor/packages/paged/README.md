# @singapore-editor/paged

A read-only UTF-8 file viewer model with byte-range loading and a bounded page cache.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/paged
```

## Usage

This experimental model reads UTF-8 files. Your app renders the returned rows.

```ts
import { PagedDocument, type RangeSource } from '@singapore-editor/paged'

const file = new File(['First line\nSecond line\n'], 'example.txt')
const revision = String(file.lastModified)
const source: RangeSource = {
  id: file.name,
  revision,
  byteLength: file.size,
  async readBytes(start, end) {
    return { revision, bytes: new Uint8Array(await file.slice(start, end).arrayBuffer()) }
  },
}
const document = new PagedDocument(source)
await document.initialize()
const view = document.createView()
console.log(await view.readLines(0, 2))
view.dispose()
document.dispose()
```

## API highlights

- `PagedDocument` indexes a byte-range source.
- `createView()` gives each viewer its own read lifecycle.
- `readLines()` returns a window of decoded rows.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/paged/overview/)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
