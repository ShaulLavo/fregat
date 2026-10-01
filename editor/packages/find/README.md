# @singapore-editor/find

find and replace for the singapore editor. a widget in the top right corner, matches painted in the text and on the minimap, regex and case-preserving replace

## try it

```sh
npm install @singapore-editor/core @singapore-editor/find
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createEditorFindPlugin } from '@singapore-editor/find'
import '@singapore-editor/core/style.css'
import '@singapore-editor/find/style.css'

const editor = new Editor(document.querySelector('#editor')!, {
  plugins: [createEditorFindPlugin()],
})
```

ctrl/cmd+f opens it. the editor's default keymap already binds next, previous, and the case, whole word, regex, in-selection and preserve-case toggles

from code, `editor.openFind()`, `editor.findNext()`, `editor.replaceAll()` and friends drive the same widget

## options

`createEditorFindPlugin(options)` takes:

- `loop`, wrap around at the ends. default `true`
- `seedSearchStringFromSelection`, `'always'` (default), `'selection'` or `'never'`
- `findOnType`, search while typing in the widget. default `true`
- `cursorMoveOnType`, move to the first match while typing. default `true`
- `autoFindInSelection`, `'never'` (default), `'always'` or `'multiline'`

## more

- `createEditorFindContributionProviders` hands back the view, command, capability and edit providers for hosts that register contributions themselves
- `EDITOR_FIND_FEATURE` is the capability token, for `editor.getFeature(EDITOR_FIND_FEATURE)`
- [the editor](../../README.md)
