# @singapore-editor/panes

resizable split panes for plain dom elements. give it a container and its panes, and it puts a drag handle between each pair and sizes them in percentages. zero dependencies

## try it

```sh
npm install @singapore-editor/panes
```

```ts
import { ResizablePaneGroup } from '@singapore-editor/panes'
import '@singapore-editor/panes/style.css'

const group = new ResizablePaneGroup(document.querySelector<HTMLElement>('#panes')!, {
  orientation: 'horizontal',
  panes: [
    {
      id: 'files',
      element: document.querySelector<HTMLElement>('#files')!,
      defaultSize: 30,
      minSize: 15,
    },
    { id: 'editor', element: document.querySelector<HTMLElement>('#editor')! },
  ],
  onLayoutChanged: (layout) => localStorage.setItem('layout', JSON.stringify(layout)),
})
```

a pane without `defaultSize` shares what the others leave. `onLayoutChange` fires on every move while dragging, `onLayoutChanged` once the drag ends. a key press or `setLayout` fires both

handles are `role="separator"` with aria values. focus one and use the arrow keys (`keyboardStep`, 5% by default) or Home and End

`group.getLayout()` and `group.setLayout({ files: 25, editor: 75 })` read and write sizes by pane id. `createHandle` swaps in your own handle element. `group.dispose()` takes it all back out

## more

- [the singapore repo](../../README.md), with the editor and its other packages
