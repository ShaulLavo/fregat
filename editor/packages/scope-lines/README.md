# @singapore-editor/scope-lines

Scope-line view contribution plugin for `@singapore-editor/core`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/scope-lines
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createScopeLinesPlugin } from '@singapore-editor/scope-lines'
import '@singapore-editor/core/style.css'
import '@singapore-editor/scope-lines/style.css'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [createScopeLinesPlugin()],
})
```

## Exports

- `createScopeLinesPlugin` renders vertical guides for visible syntax scopes.
- `ScopeLinesPluginOptions` controls mode, active-scope rendering, minimum span, and custom classes.
