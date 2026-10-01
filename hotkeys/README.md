# hotkeys

Development happens in the [Fregat monorepo](https://github.com/ShaulLavo/fregat/tree/main/hotkeys).
This repository mirrors its `hotkeys/` folder. Submit changes to Fregat.

keyboard shortcuts for editors and apps. you bind keys to commands, it matches key presses, runs multi-key chords like `Mod+K Mod+C`, and picks the binding that fits whatever has focus, the way zed does

it also formats shortcuts for display and records new ones from the keyboard. the core never touches the dom; small adapters feed it browser or terminal keys. it ships no keymap of its own

## try it

not on npm yet. clone it and `bun link`

register a shortcut. `Mod` is Command on mac and Control everywhere else

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

const hotkeys = getHotkeyRegistry()
const save = hotkeys.register('Mod+S', () => saveFile())
hotkeys.register(['Mod+K', 'Mod+C'], () => addComment()) // a chord: Mod+K, then Mod+C

save.unregister()
```

same key, different job depending on focus. the deepest focused context wins, so `Mod+B` bolds text in the editor and toggles the sidebar everywhere else

```ts
import { createBrowserDispatcher } from '@fregat/hotkeys'

const keys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+B', command: 'sidebar.toggle' },
    { keys: 'Mod+B', command: 'text.bold', context: 'Editor' },
  ],
})
const app = keys.createNode({ commands: { 'sidebar.toggle': () => toggleSidebar() } })
const editor = keys.createNode({
  parent: app,
  context: 'Editor',
  commands: { 'text.bold': () => bold() },
})
keys.attachElement(app, document.body)
keys.attachElement(editor, editorElement)
```

show it in a menu or tooltip

```ts
import { formatForDisplay } from '@fregat/hotkeys'

formatForDisplay('Mod+Shift+S', { platform: 'mac' }) // '⇧ ⌘ S'
formatForDisplay('Mod+Shift+S', { platform: 'linux' }) // 'Ctrl+Shift+S'
```

in react, `useHotkey('Mod+S', () => saveFile())` registers for the life of the component

## packages

- [`@fregat/hotkeys`](packages/hotkeys), the core: parsing, matching, chords, contexts, display, recorders, held-key state
- [`@fregat/react-hotkeys`](packages/react-hotkeys), react hooks over the core

## running the repo

```sh
bun install
bun run verify
```

from inside fregat, `bun run --cwd hotkeys verify`

## more

- [core api: focus nodes, chords, terminals, recorders](packages/hotkeys/README.md)
- [keymap rules: context predicates, ranking, unbinding](packages/hotkeys/docs/keymaps.md)
- [lookup benchmarks](packages/hotkeys/docs/performance.md)

forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys), MIT. license in [LICENSE](LICENSE)
