# @singapore-editor/solid

Solid bindings and reactive controls for the Singapore editor.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/solid solid-js
```

## Usage

Render this component in your app. Its host element gives the editor a fixed height.

```tsx
import { createEditor } from '@singapore-editor/solid'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const controller = createEditor({
    document: { documentId: 'example.ts', text: 'const value = 1\n', languageId: 'typescript' },
  })
  return <div ref={controller.element} style={{ height: '400px' }} />
}
```

## API highlights

- `createEditor()` creates a controller inside a Solid owner.
- `controller.element` mounts the view.
- `controller.state()` reads the current editor state.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/solid/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. This optional package adds Solid lifecycle and state bindings. Choose the other plugins your app needs.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
