# @fregat/react-hotkeys

react hooks for [`@fregat/hotkeys`](../hotkeys). a hook registers a shortcut while its component is mounted and always calls the latest callback, so it sees current props and state. everything from the core is re-exported, so one import is enough

## try it

not on npm yet. clone the repo and `bun link`, or depend on it as `workspace:*` inside fregat. needs react 18 or newer

```tsx
import { formatForDisplay, useHotkey, useHotkeySequence } from '@fregat/react-hotkeys'

function Document({ onSave }: { onSave: () => void }) {
  useHotkey('Mod+S', () => onSave())
  useHotkeySequence(['G', 'G'], () => window.scrollTo(0, 0))

  return <button onClick={onSave}>Save {formatForDisplay('Mod+S')}</button>
}
```

`Mod` is Command on mac and Control elsewhere. `formatForDisplay` prints `⌘ S` or `Ctrl+S` to match

scope a shortcut to an element, or switch it off without unregistering

```tsx
import { useRef } from 'react'
import { useHotkey } from '@fregat/react-hotkeys'

function Modal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useHotkey('Escape', () => onClose(), { enabled: open, target: ref })
  return open ? <div ref={ref}>…</div> : null
}
```

## other hooks

- `useHotkeys([{ hotkey, callback, options }])` and `useHotkeySequences`, for a list that changes length
- `useHotkeyRecorder({ onRecord })` and `useHotkeySequenceRecorder`, for a "press a shortcut" settings field
- `useKeyHold('Shift')`, `useHeldKeys()`, `useHeldKeyCodes()`, for what is held right now
- `useHotkeyHint('Mod+S')`, true while held modifiers reveal that shortcut, for badge overlays
- `useHotkeyRegistrations()`, every live registration, for a shortcut list or palette
- `<HotkeysProvider defaultOptions={{ hotkey: { preventDefault: false } }}>` sets defaults for the hooks below it

## more

- [core README](../hotkeys/README.md): the registry, focus-aware keymaps, display and recording
- [keymaps](../hotkeys/docs/keymaps.md): contexts, ranking and chord rules

forked from [TanStack React Hotkeys](https://github.com/TanStack/hotkeys), MIT. license in [LICENSE](LICENSE)
