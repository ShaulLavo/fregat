# @singapore-editor/highlighting

Worker-based syntax highlighting for Singapore editors, diffs, and code snippets.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/highlighting
```

## Usage

```ts
import { createHighlightingService, highlightLines } from '@singapore-editor/highlighting'

const service = createHighlightingService()
const text = 'const value = 1\n'
const result = await service.highlight(text, { language: 'typescript' })
for (const line of highlightLines(text, result.tokens)) {
  console.log(line.map((segment) => segment.text).join(''))
}
await service.dispose()
```

## API highlights

- `createHighlightingService()` creates a service for code snippets or shared views.
- `highlightLines()` splits tokens into line segments.
- `createHighlightingPlugin()` connects the service to an editor.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/highlighting/overview/)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://singapore.shaulavo.dev/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
