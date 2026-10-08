# @singapore-editor/react

React components and hooks for mounting and controlling the Singapore editor.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/react react react-dom
```

## Usage

Render this component in your app. Its host element gives the editor a fixed height.

```tsx
import { EditorHost, useEditor } from '@singapore-editor/react'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const controller = useEditor({
    document: {
      documentId: 'example.ts',
      text: 'const value = 1;\n',
      languageId: 'typescript',
    },
  })

  return <EditorHost controller={controller} style={{ height: '32rem' }} />
}
```

## API highlights

- `useEditor()` creates a controller from props.
- `EditorHost` mounts its view.
- `useEditorSelector()` subscribes to a state selection.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/react/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. This optional package adds React lifecycle and state bindings. Choose the other plugins your app needs.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
