# @singapore-editor/minimap

A worker-rendered file overview with scroll controls for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

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

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [createMinimapPlugin({ side: 'right', showSlider: 'always' })],
})
editor.setText('const value = 1\n')
```

## API highlights

- `createMinimapPlugin()` adds the overview.
- `side` chooses its edge.
- `showSlider` controls the viewport marker.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/minimap/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add this plugin for a file overview beside the text.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://singapore.shaulavo.dev/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
