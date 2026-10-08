# React and Solid

Use the adapter for your framework so the editor mounts and disposes with its component. You need a client-side component and the core stylesheet.

## React

Install the core and adapter alongside React and React DOM.

```sh
npm install @singapore-editor/core @singapore-editor/react react react-dom
```

`useEditor` creates a controller from props. `EditorHost` mounts it.

```tsx
import { EditorHost, useEditor } from '@singapore-editor/react'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const controller = useEditor({
    document: {
      documentId: 'example.ts',
      text: 'const value = 1\n',
      languageId: 'typescript',
    },
  })
  return (
    <EditorHost
      controller={controller}
      style={{ height: '32rem', display: 'flex', flexDirection: 'column' }}
    />
  )
}
```

The view reopens the document when its identity or revision changes. Bump `revision` to load new text for the same id, or use `textSyncMode: 'incremental'` to synchronize each new text value. Keep plugin instances stable across component renders.

Use `useEditorSelector` to subscribe to the slice of controller state your UI reads. `controller.commands` exposes editor actions, and `controller.getEditor()` returns the mounted editor.

## Solid

Install the Solid adapter alongside Solid.

```sh
npm install @singapore-editor/core @singapore-editor/solid solid-js
```

`createEditor` returns the element ref and state accessors. Call it inside a component or Solid root so its owner controls cleanup.

```tsx
import { createSignal } from 'solid-js'
import { createEditor } from '@singapore-editor/solid'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const [wordWrap, setWordWrap] = createSignal(false)
  const controller = createEditor({
    document: { documentId: 'example.ts', text: 'const value = 1\n', languageId: 'typescript' },
    wordWrap,
  })
  return (
    <>
      <button onClick={() => setWordWrap(!wordWrap())}>Toggle wrapping</button>
      <div
        ref={controller.element}
        style={{ height: '32rem', display: 'flex', 'flex-direction': 'column' }}
      />
    </>
  )
}
```

Options accept a value or accessor. Changing the `wordWrap` signal updates the mounted editor. `controller.commands` exposes editor actions and `controller.editor()` returns the editor.

## If it doesn't work

### The container is empty

Check the ref or `EditorHost` binding, the container height, flex layout and the stylesheet. In an SSR application, mount this component on the client.

### New text for the same document id is ignored

Update the document revision when replacing that document's contents. Check the React adapter's text synchronization option if every prop update should edit the document.

Continue with [documents and sessions](documents.md), or the generated [React](/docs/reference/api/react/overview/) and [Solid](/docs/reference/api/solid/overview/) references.
