# @singapore-editor/minimap

Worker-backed minimap plugin for `@singapore-editor/core`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/minimap
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createMinimapPlugin } from '@singapore-editor/minimap'
import '@singapore-editor/core/style.css'
import '@singapore-editor/minimap/style.css'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [createMinimapPlugin()],
})
```

## Exports

- `createMinimapPlugin` adds the minimap view contribution.
- `EditorMinimapOptions` configures side, size, autohide behavior, slider visibility, and section
  headers.
- `@singapore-editor/minimap/style.css` contains the minimap stylesheet.
