# @fregat/react-hotkeys

React hooks for registering, recording, and displaying keyboard shortcuts with @fregat/hotkeys.

Part of [Fregat hotkeys](https://github.com/ShaulLavo/fregat/tree/main/hotkeys).

## Install

Not on npm yet. Build it from source with the [workspace guide](https://github.com/ShaulLavo/fregat/blob/main/docs/development.md#workspace-libraries). Publishing is planned. It declares `react` and `react-dom` 18 or newer as peer dependencies, so it uses the copies your app already has.

## Usage

Render this component in your React app.

```tsx
import { useHotkey, formatForDisplay } from '@fregat/react-hotkeys'

export function SaveButton({ onSave }: { onSave: () => void }) {
  useHotkey('Mod+S', onSave)
  return <button onClick={onSave}>Save {formatForDisplay('Mod+S')}</button>
}
```

`Mod` is Command on macOS and Control elsewhere.

## API highlights

- `useHotkey(keys, callback, options)` registers a shortcut for the component lifetime. Options match `register`, and `target` can be a ref.
- `useHotkeySequence()` registers a chord.
- `useHotkeyRecorder()` records a shortcut for a settings field.
- `HotkeysProvider` sets hook defaults.

[Exported API](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/react-hotkeys/src/index.ts) · [Core API](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/api.md) · [Keymap rules](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md)

## In the hotkeys family

`@fregat/hotkeys` owns shortcut matching and dispatch. This optional package adds React hooks and re-exports the core API.

[Main README](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/README.md)

## Status

Version 0.0.x. The API can change between releases.

## License

MIT. Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys). [License](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/react-hotkeys/LICENSE)
