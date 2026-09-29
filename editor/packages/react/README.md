# @singapore-editor/react

React bindings for `@singapore-editor/core`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/react react react-dom
```

## Usage

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

  return <EditorHost controller={controller} />
}
```

## Exports

- `useEditor` creates and synchronizes an editor controller with React state.
- `EditorHost` mounts the editor into the DOM.
- `useEditorSelector` subscribes to selected editor store values.
