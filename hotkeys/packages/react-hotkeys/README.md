# @fregat/react-hotkeys

React hooks for registering, recording, and displaying keyboard shortcuts with @fregat/hotkeys.

Part of [Fregat hotkeys](https://github.com/ShaulLavo/fregat/tree/main/hotkeys).

## Install

```sh
npm install @fregat/react-hotkeys react react-dom
```

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

- `useHotkey()` registers a shortcut for the component lifetime.
- `useHotkeySequence()` registers a chord.
- `useHotkeyRecorder()` records a shortcut for a settings field.
- `HotkeysProvider` sets hook defaults.

[Exported API](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/react-hotkeys/src/index.ts) · [Keymap guide](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md)

## In the hotkeys family

`@fregat/hotkeys` owns shortcut matching and dispatch. This optional package adds React hooks and re-exports the core API. Use React 18 or newer.

[Main README](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/README.md)

## License

MIT. Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys). [License](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/react-hotkeys/LICENSE)
