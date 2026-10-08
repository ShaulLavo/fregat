# @singapore-editor/gutters

line numbers and fold arrows for the editor's left edge

folds come from the syntax plugin when one is loaded and from indentation otherwise, so the fold gutter works on plain text too

## try it

```sh
npm install @singapore-editor/core @singapore-editor/gutters
```

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createFoldGutterPlugin, createLineGutterPlugin } from '@singapore-editor/gutters'
import '@singapore-editor/core/style.css'
import '@singapore-editor/gutters/style.css'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  plugins: [createLineGutterPlugin(), createFoldGutterPlugin()],
})
```

line numbers take `startLine`, `minDigits`, a css `counterStyle`, or `labelForRow` to print your own label per row

fold arrows take a string, an svg path, or a function that returns a dom node, through `icon`, `expandedIcon` and `collapsedIcon`

```ts
createFoldGutterPlugin({
  icon: { kind: 'svg', viewBox: '0 0 16 16', path: 'M2 5L8 11L14 5Z' },
  iconClassName: 'fold-icon',
})
```

svg icons use `currentColor` and fill their wrapper, so size them through `iconClassName`. the button's `data-editor-fold-state` is `expanded` or `collapsed` for styling. strings and svg icons can be painted from a snapshot before the editor is ready. a dom-node function turns that snapshot off

## Scroll gutters with the text

Gutters stay at the viewport's left edge by default. Set the editor's `gutterScroll` option to
`'content'` to move line numbers, fold arrows and other gutter lanes with horizontal text scrolling.
This is useful for code blocks in documentation and other reading views.

```ts
import { Editor } from '@singapore-editor/core/editor'
import { createFoldGutterPlugin, createLineGutterPlugin } from '@singapore-editor/gutters'

const editor = new Editor(document.querySelector<HTMLElement>('#editor')!, {
  gutterScroll: 'content',
  plugins: [createLineGutterPlugin(), createFoldGutterPlugin()],
})

editor.setGutterScroll('fixed')
```

The option applies to every gutter lane, including `gutterLeadingInset`. Vertical scrolling keeps
lanes aligned with their rows. Word wrap keeps its usual text width and continuation-row labels.
Use `'fixed'` to keep gutters at the left edge.

## more

- `@singapore-editor/gutters/line-gutter` and `/fold-gutter` import one gutter alone, with `line-gutter.css` and `fold-gutter.css` beside them
- `createLineGutterContribution` and `createFoldGutterContribution` return the raw gutter contribution, for hosts that register gutters themselves. gutter cells let clicks through to the text unless the contribution sets `interactive: true`, as the fold gutter does
