# @singapore-editor/plugin-ui

Shared hover tooltips and anchored popups for Singapore editor plugins.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/core @singapore-editor/plugin-ui
```

## Usage

Show a standalone tooltip. Editor plugins can also register shared hover participants.

```ts
import { createTooltipController } from '@singapore-editor/plugin-ui/tooltip'
import '@singapore-editor/core/style.css'

const tooltip = createTooltipController({
  document,
  themeSource: document.body,
  reentryElement: document.body,
})
tooltip.show({
  anchor: new DOMRect(24, 80, 100, 20),
  hoverText: '**Hello** from a plugin',
  theme: null,
})
// Call tooltip.dispose() when removing the popup.
```

## API highlights

- `EDITOR_HOVER_PARTICIPANT` lets plugins answer into the shared hover.
- `createTooltipController()` controls a tooltip.
- `createAnchoredSurface()` places a popup beside an anchor.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/plugin-ui/overview/)

## In the Singapore family

`@singapore-editor/core` owns the editor view. Plugins use this package to share hover content and position popups.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
