# @singapore-editor/find

Find and replace plugin for `@singapore-editor/core`.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/find
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createEditorFindPlugin } from '@singapore-editor/find'
import '@singapore-editor/core/style.css'
import '@singapore-editor/find/style.css'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [createEditorFindPlugin()],
})
```

## Exports

- `createEditorFindPlugin` registers find, replace, and match-selection commands.
- `createEditorFindContributionProviders` exposes the find widget and capability providers.
- `EDITOR_FIND_FEATURE` and `EDITOR_FIND_FEATURE_ID` expose the find feature capability token.
