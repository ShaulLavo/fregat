# @fregat/hotkeys

Keyboard shortcuts for editors. Key parsing, matching and display from
[TanStack Hotkeys](https://github.com/TanStack/hotkeys), plus a chord trie, context resolution
modelled on [Zed](https://zed.dev) and editor-grade chord handling. The core never touches the
DOM: adapters turn browser and terminal input into `KeyInput`. The package ships no keymap.

```sh
npm install @fregat/hotkeys
```

## A standalone dispatcher with one layer

A dispatcher holds a keymap and a tree of focus nodes. Nodes handle commands; bindings name them.

```ts
import { createBrowserDispatcher } from '@fregat/hotkeys'

const hotkeys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+S', command: 'file.save' },
    { keys: 'Mod+Shift+P', command: 'palette.open' },
  ],
})
const app = hotkeys.createNode({
  commands: {
    'file.save': () => save(),
    'palette.open': () => openPalette(),
  },
})
hotkeys.attachElement(app, document.body)
```

## Focus nodes with nested contexts

Each node publishes a context. The path from the outermost node to the focused one forms the
context stack, and a binding's `context` is a predicate over it: identifiers, `key == value`,
`!=`, `!`, `&&`, `||`, parentheses and `>` for descendant. Candidates rank by the deepest
context their predicate matches, then by source (`user` over `pack` over `default`), then later
entries first. The focused layer wins, so `Mod+B` below makes text bold in a Markdown editor and
toggles the sidebar everywhere else.

```ts
const hotkeys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+B', command: 'sidebar.toggle', context: 'Workspace', source: 'default' },
    {
      keys: 'Mod+B',
      command: 'markdown.bold',
      context: 'Editor && extension == md',
      source: 'pack',
    },
    // The user takes the key back from the Markdown pack:
    { keys: 'Mod+B', unbind: 'markdown.bold', context: 'Editor', source: 'user' },
  ],
})
const workspace = hotkeys.createNode({
  context: 'Workspace',
  commands: { 'sidebar.toggle': () => toggleSidebar() },
})
const editor = hotkeys.createNode({
  parent: workspace,
  context: 'Editor extension=md',
  commands: { 'markdown.bold': () => bold() },
})
hotkeys.attachElement(workspace, shellElement)
hotkeys.attachElement(editor, editorElement)
```

`command: null` removes a key for equal and weaker sources where its context matches. Nothing
refuses a collision: `bindingsForInput(compileKeymap(entries, platform), keys, stack)` reports
what a key would run under a context stack, for settings screens.

## Chords

Strokes separated by spaces form a chord. The prefix never reaches the page. A prefix that is
itself bound waits one second for its continuation, then runs its own binding; an unbound prefix
waits for the next key. A key that does not continue the chord ends it: the longest bound
buffered prefix runs, the other buffered keys go to your `replay` hook, and the new key is
matched from scratch. A pending chord belongs to the focus it started under and ends on focus
change, blur, a hidden tab or pointer down.

```ts
const hotkeys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+K', command: 'search.open' },
    { keys: 'Mod+K Mod+C', command: 'comment.add' },
  ],
  onPendingChange: (pending) => showChordHint(pending?.keys ?? null),
  onSequence: (event) => log('chord', event.outcome, event.elapsedMs),
})
```

## A declining handler

A handler that returns `false` passes the command to the next ancestor, and then the key to the
next candidate binding. When nothing takes the key it goes to default input handling.

```ts
editor.handle('editor.indent', () => {
  if (!hasSelection()) return false // Tab falls through to the next binding
  indent()
})
```

## Terminals

`keyInputFromTerminalKey` reads keys parsed from terminal input (OpenTUI's `KeyEvent` shape:
legacy escapes and the Kitty protocol). Legacy Alt arrives as Alt, never as the desktop Meta
key. A terminal host forwards keys through the DOM-free dispatcher and sends replayed keys to the
shell.

```ts
import { createDispatcher, keyInputFromTerminalKey, terminalKeyEffects } from '@fregat/hotkeys'
import type { TerminalKeyLike } from '@fregat/hotkeys'

const hotkeys = createDispatcher<TerminalKeyLike>({
  keymap: [{ keys: 'Control+K S', command: 'settings.open' }],
  effects: terminalKeyEffects,
  replay: (input, event) => shell.write(encode(event)),
})
hotkeys.createNode({ commands: { 'settings.open': () => openSettings() } }).focus()

renderer.keyInput.on('keypress', (event) => {
  if (!hotkeys.handleKey(keyInputFromTerminalKey(event), event)) shell.write(encode(event))
})
```

## One-call hotkeys

TanStack's registration API runs on a dispatcher per document. Arrays register chords.

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

const handle = getHotkeyRegistry().register('Mod+S', () => save())
getHotkeyRegistry().register(['G', 'G'], () => scrollToTop())
handle.unregister()
```

`@fregat/react-hotkeys` wraps it as `useHotkey`, `useHotkeys`, `useHotkeySequence` and friends.

## Keys and display, from TanStack

`parseHotkey`, `normalizeRegisterableHotkey`, `validateHotkey`, `areHotkeysEqual`,
`detectPlatform`, `Mod` (Command on macOS, Control elsewhere), physical keys as `[KeyS]`,
layout fallback to `event.code` on non-Latin layouts, IME and AltGr handling,
`formatForDisplay`, `formatHotkeySequence`, `HotkeyRecorder`, `HotkeySequenceRecorder` and
`KeyStateTracker`.

## Performance

`bun bench/lookup.ts` on an editor-shaped 255-binding table (Bun 1.4, Linux, one run; JIT noise
is about ±50% at this scale):

| Measure                                                           | Time                              |
| ----------------------------------------------------------------- | --------------------------------- |
| `trieStep`, plain `q` (unbound)                                   | 0.005–0.010 µs                    |
| Editor trie today, same table and key                             | 0.007–0.018 µs                    |
| `dispatcher.handleKey`, plain `q`                                 | 0.046 µs                          |
| `dispatcher.handleKey`, bound `Control+E` with context resolution | 0.11 µs                           |
| `compileKeymap`, 255 / 2,550 / 25,500 bindings                    | 0.69 / 1.05 / 0.83 µs per binding |

Construction is linear in the binding count. For comparison, a linear `matchesKeyboardEvent`
scan over the Editor's 255 bindings costs about 83 µs per key.

## Licence

MIT. Forked from TanStack Hotkeys (MIT, © 2026 Tanner Linsley); see [LICENSE](LICENSE) and the
[workspace README](../../README.md) for the upstream commit.
