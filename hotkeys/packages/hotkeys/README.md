# @fregat/hotkeys

Keyboard shortcut registration, chords, context-aware keymaps, and display formatting for browser and terminal apps.

Part of [Fregat hotkeys](https://github.com/ShaulLavo/fregat/tree/main/hotkeys).

## Install

```sh
npm install @fregat/hotkeys
```

## Usage

Register shortcuts while your view is active, then unregister them when it closes.

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

const hotkeys = getHotkeyRegistry()
const save = hotkeys.register('Mod+S', () => console.log('Save requested'))
const top = hotkeys.register(['G', 'G'], () => window.scrollTo(0, 0))
export function disposeShortcuts() {
  save.unregister()
  top.unregister()
}
```

`Mod` is Command on macOS and Control elsewhere.

## API highlights

- `getHotkeyRegistry()` registers shortcuts and chords.
- `createBrowserDispatcher()` routes commands through focused contexts.
- `formatForDisplay()` formats labels for the current platform.
- `HotkeyRecorder` records a shortcut.

[Exported API](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/src/index.ts) · [Keymap guide](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md)

## In the hotkeys family

The core package has framework-neutral key matching and browser and terminal adapters. Add `@fregat/react-hotkeys` to register shortcuts through React hooks.

[Main README](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/README.md)

## License

MIT. Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys). [License](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/LICENSE)
