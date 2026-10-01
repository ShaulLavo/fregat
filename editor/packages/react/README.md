# @singapore-editor/react

react bindings for [`@singapore-editor/core`](../editor/README.md). `useEditor` builds a controller from props, `EditorHost` mounts it, and the editor follows your props as they change

## try it

```sh
npm install @singapore-editor/core @singapore-editor/react react react-dom
```

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

the editor reopens the document when `documentId`, `documentMode`, `languageId` or `revision` changes. bump `revision` to load new text under the same id, or set `textSyncMode: 'incremental'` to sync each new `text` into the open document

options like `theme`, `tabSize`, `wordWrap`, `selection` and `plugins` are props too, and update the live editor

## reading state

```tsx
const isDirty = useEditorSelector(controller, (store) => store.state?.isDirty ?? false)
```

`useEditorSelector` re-renders only when its slice changes. `controller.commands` has `focus`, `setText`, `edit`, `setSelection`, `dispatchCommand` and the find commands. `controller.getEditor()` gives you the `Editor` itself

## more

- [core](../editor/README.md), for what the editor and its options do
- [solid bindings](../solid/README.md)
