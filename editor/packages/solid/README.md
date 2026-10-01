# @singapore-editor/solid

solid bindings for [`@singapore-editor/core`](../editor/README.md). `createEditor` gives you a ref to put on an element, accessors for the editor's state, and options that can be signals

## try it

```sh
npm install @singapore-editor/core @singapore-editor/solid solid-js
```

```tsx
import { createSignal } from 'solid-js'
import { createEditor } from '@singapore-editor/solid'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const [wordWrap, setWordWrap] = createSignal(false)
  const controller = createEditor({
    document: {
      documentId: 'example.ts',
      text: 'const value = 1;\n',
      languageId: 'typescript',
    },
    wordWrap,
  })

  return (
    <>
      <button onClick={() => setWordWrap(!wordWrap())}>wrap</button>
      <div ref={controller.element} style={{ height: '32rem' }} />
      <p>{controller.state()?.isDirty ? 'edited' : 'saved'}</p>
    </>
  )
}
```

the editor is created after the component mounts and disposed with its owner, so call `createEditor` inside a component or a solid root

`document`, `theme`, `tabSize`, `wordWrap`, `selection` and the other view options take a value or an accessor. the document reopens when `documentId`, `documentMode` or `revision` changes, so bump `revision` to load new text under the same id

`controller.commands` has `focus`, `setText`, `edit`, `setSelection`, `dispatchCommand` and the find commands. `controller.editor()` gives you the `Editor` itself

## more

- [core](../editor/README.md), for what the editor and its options do
- [react bindings](../react/README.md)
