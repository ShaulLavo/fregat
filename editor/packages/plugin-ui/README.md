# @singapore-editor/plugin-ui

Shared hover tooltips, anchored popups and optional touch selection chrome for Singapore editor plugins.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

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
- `createTouchSelectionPlugin()` adds touch edit actions and optional haptics.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/plugin-ui/overview/)

## Touch selection menu

Status: experimental. The menu is in the source only: `@singapore-editor/plugin-ui` 0.1.0 on npm has no touch plugin, and mobile is not a supported target. The gestures it reacts to live in `@singapore-editor/core`. See [Touch selection](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/editor/README.md#touch-selection) for what tests cover.

Add `createTouchSelectionPlugin({ haptics: true })` to the editor's `plugins` option. Import the factory from `@singapore-editor/plugin-ui/touch-selection-plugin`.

The plugin opens a light/dark touch menu after a word, line or document selection gesture settles. Cut, Copy, Paste and Select all use core input commands. Undo and Redo appear when the editable document has the corresponding history. Desktop context menus keep their existing ownership. Removing the plugin removes its menu, styles and listeners; core touch selection continues to work.

`items(context)` appends host actions. Its context contains `selectedText` and `editable`; each item supplies `id`, `label`, optional `disabled` and `failureMessage`, and `run(): void | Promise<void>`. The callback runs in the menu click's activation turn. Pending actions settle before dismissal, and failures keep the action available with retry guidance.

`haptics` defaults to `false`. Supported Vibration API devices get light ticks on selection start, changed word/line snaps and menu appearance. Safari's supported native switch control can tick on a trusted menu tap through an associated hidden switch; keyboard and scripted activations still run the action. Current iOS blocks programmable gesture-time haptics. Physical iPhone feedback from the hidden switch remains unverified. Browser tests cover action dispatch, focus and accessibility on engines exposing that control. See [Browser quirks](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/display/browser-quirks.md#touch-haptic-availability).

## In the Singapore family

`@singapore-editor/core` owns the editor view. Plugins use this package to share hover content and position popups.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
