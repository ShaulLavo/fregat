# @singapore-editor/panes

Small DOM utility for resizable pane groups.

## Install

```sh
npm install @singapore-editor/panes
```

## Usage

```ts
import { ResizablePaneGroup } from '@singapore-editor/panes'
import '@singapore-editor/panes/style.css'

const group = new ResizablePaneGroup(document.querySelector('#panes')!, {
  orientation: 'horizontal',
  panes: [
    { id: 'left', element: document.querySelector('#left')!, defaultSize: 40 },
    { id: 'right', element: document.querySelector('#right')!, defaultSize: 60 },
  ],
})
```

## Exports

- `ResizablePaneGroup` mounts accessible split handles and manages percentage layouts.
- `ResizablePaneGroupOptions`, `ResizablePaneLayout`, and related types describe pane and handle
  configuration.
