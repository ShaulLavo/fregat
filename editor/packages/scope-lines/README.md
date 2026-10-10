# @singapore-editor/scope-lines

Indent guides, sticky headers, and bracket pair colors for the Singapore editor.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/scope-lines
```

## Usage

```ts
import { Editor } from '@singapore-editor/core/editor'
import {
  createBracketColorsPlugin,
  createScopeLinesPlugin,
  createStickyScrollPlugin,
} from '@singapore-editor/scope-lines'
import '@singapore-editor/core/style.css'
import '@singapore-editor/scope-lines/style.css'

const host = document.createElement('div')
host.style.height = '400px'
document.body.append(host)

const editor = new Editor(host, {
  plugins: [createScopeLinesPlugin(), createStickyScrollPlugin(), createBracketColorsPlugin()],
})
editor.setText('const value = 1\n')
```

## API highlights

- `createScopeLinesPlugin()` draws indent guides.
- `createStickyScrollPlugin()` keeps enclosing headers visible.
- `createBracketColorsPlugin()` colors bracket nesting.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/scope-lines/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Add these plugins to show enclosing scopes and bracket nesting.
Bracket pair colors need a syntax plugin. Indent guides and sticky headers can use indentation.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
