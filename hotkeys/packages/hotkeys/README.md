# @fregat/hotkeys

keyboard shortcuts for editors and apps, with no framework and no dom in the core. it parses and matches keys, runs chords, resolves bindings against the focused context the way [zed](https://zed.dev) does, and formats shortcuts for display. adapters turn browser and terminal input into its key events. it ships no keymap

react hooks live in [`@fregat/react-hotkeys`](../react-hotkeys)

## try it

clone the repo and `bun link`, or depend on it as `workspace:*` inside Fregat

### one-call shortcuts

the registry listens on the document. arrays are chords

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

const hotkeys = getHotkeyRegistry()
const save = hotkeys.register('Mod+S', () => saveFile())
hotkeys.register(['G', 'G'], () => scrollToTop(), { ignoreInputs: true })
save.unregister()
```

a callback that returns `false` passes the key on to the next registration

### a keymap with focus

a dispatcher holds a keymap and a tree of focus nodes. bindings name commands; nodes handle them. a key from inside an attached element resolves against that node's context and its ancestors'

```ts
import { createBrowserDispatcher } from '@fregat/hotkeys'

const keys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+Shift+P', command: 'palette.open' },
    { keys: 'Mod+K Mod+C', command: 'comment.add', context: 'Editor' },
  ],
})
const app = keys.createNode({ commands: { 'palette.open': () => openPalette() } })
const editor = keys.createNode({ parent: app, context: 'Editor' })
editor.handle('comment.add', () => addComment())

keys.attachElement(app, document.body)
keys.attachElement(editor, editorElement)
```

`keys.setKeymap(entries)` swaps the table, e.g. after the user edits their bindings

use `readContext` for values that change with editor or plugin state. the dispatcher reads it once per node when it captures context for a key, including chord continuations and timeout replay

```ts
const editor = keys.createNode({
  parent: app,
  readContext: () => ({
    identifiers: canComment() ? ['Editor', 'canComment'] : ['Editor'],
    values: { mode: currentMode() },
  }),
})
```

`editor.context()` also reads the current context. `readContext` supplies the full context; nodes with static context can update it through `setContext`

### display and recording

```ts
import { HotkeyRecorder, formatForDisplay } from '@fregat/hotkeys'

formatForDisplay('Mod+Shift+S', { platform: 'mac' }) // '⇧ ⌘ S'
formatForDisplay('Mod+Shift+S', { platform: 'windows' }) // 'Ctrl+Shift+S'

const recorder = new HotkeyRecorder({ onRecord: (hotkey) => saveBinding(hotkey) })
recorder.start() // Ctrl+Shift+K on linux records 'Mod+Shift+[KeyK]'
```

`Mod` is Command on mac and Control elsewhere. `[KeyK]` is a physical key, matched by position whatever the layout; the recorder writes these unless you pass `recordBy: 'key'`. logical keys on non-latin layouts fall back to `event.code`

## more

- [keymaps](docs/keymaps.md): context predicates, ranking, unbinding, declining handlers, chord rules, terminals
- [performance](docs/performance.md): lookup and compile benchmarks
- also exported: `parseHotkey`, `validateHotkey`, `areHotkeysEqual`, `findHotkeyConflicts`, `formatHotkeySequence`, `HotkeySequenceRecorder`, `KeyStateTracker`, `detectPlatform`

forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys), MIT. license in [LICENSE](LICENSE)
