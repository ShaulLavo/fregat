# @singapore-editor/panes

Resizable split panes for browser DOM elements.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/panes
```

## Usage

```ts
import { ResizablePaneGroup } from '@singapore-editor/panes'
import '@singapore-editor/panes/style.css'

const host = document.createElement('div')
host.style.cssText = 'height: 400px; width: 100%'
document.body.append(host)
const group = new ResizablePaneGroup(host, {
  orientation: 'horizontal',
  panes: [
    { id: 'files', element: document.createElement('div'), defaultSize: 30 },
    { id: 'editor', element: document.createElement('div') },
  ],
})
// Call group.dispose() when removing the panes.
```

## API highlights

- `ResizablePaneGroup` owns panes and drag handles.
- `getLayout()` reads sizes by pane ID.
- `setLayout()` changes the split.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/panes/overview/)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
