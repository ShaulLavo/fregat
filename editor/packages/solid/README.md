# @singapore-editor/solid

Solid bindings for `@singapore-editor/core`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/solid solid-js
```

## Usage

```tsx
import { createEditor } from '@singapore-editor/solid'
import '@singapore-editor/core/style.css'

export function EditorPanel() {
  const controller = createEditor({
    document: {
      documentId: 'example.ts',
      text: 'const value = 1;\n',
      languageId: 'typescript',
    },
  })

  return <div ref={controller.element} />
}
```

`element` is a ref callback. The binding creates the editor after Solid mounts the component and
disposes it when the Solid owner is cleaned up. Call `createEditor` inside a component or Solid root.

## Exports

- `createEditor` creates a Solid-owned editor controller.
- The controller exposes Solid accessors for editor state, snapshots, text, change metadata, and
  command helpers.
