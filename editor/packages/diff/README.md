# @singapore-editor/diff

Stacked and split diffs with inline changes for the Singapore editor.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/diff
```

## Usage

Compare two versions and project the changed rows. Use `createDiffPlugin()` to render them in an editor.

```ts
import { createStackedProjection, createTextDiff, joinRenderLines } from '@singapore-editor/diff'

const file = createTextDiff({
  oldFile: { path: 'note.ts', text: 'const value = 1\n' },
  newFile: { path: 'note.ts', text: 'const value = 2\n' },
})
const projection = createStackedProjection(file)
console.log(joinRenderLines(projection.rows))
```

## API highlights

- `createTextDiff()` compares two file versions.
- `createDiffPlugin()` projects stacked or split rows.
- `parseGitPatch()` reads a Git patch.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/diff/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add this plugin to display changes between two file versions.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
