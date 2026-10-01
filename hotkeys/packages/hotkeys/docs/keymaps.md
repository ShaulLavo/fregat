# keymaps

how a dispatcher picks a binding for a key, and what happens around chords

## contexts

each focus node publishes a context: identifiers and `key=value` pairs in zed's shorthand, such as `'Editor extension=md'`. the path from the outermost node to the focused one forms the context stack

a binding's `context` is a predicate over that stack: identifiers, `key == value`, `!=`, prefix `!`, `&&`, `||`, parentheses, and `>` for descendant (`Workspace > !Terminal`). a binding with no `context` matches everywhere

## ranking

when several bindings match a key, candidates rank by:

1. the deepest context their predicate matches
2. source: `user` over `pack` over `base` over `default`
3. later entries in the table first

so the focused layer wins, and below it the user beats a keybinding pack. here `Mod+B` makes text bold in a markdown editor and toggles the sidebar everywhere else, until the user takes it back

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
    // the user takes the key back from the markdown pack
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

## removing bindings

`{ keys, unbind: 'command' }` removes one key→command pair where its context matches and leaves other commands on those keys. `command: null` removes every binding on the keys for equal and weaker sources where its context matches

nothing refuses a collision. `bindingsForInput(compileKeymap(entries, platform), keys, stack)` reports what a key would run under a given context stack, for settings screens

## declining a command

a handler that returns `false` passes the command to the next ancestor, and then the key to the next candidate binding. when nothing takes the key it goes to default input handling

```ts
editor.handle('editor.indent', () => {
  if (!hasSelection()) return false // Tab falls through to the next binding
  indent()
})
```

`dispatchCommand('editor.indent')` runs a command along the focus path without a key

## chords

strokes separated by spaces form a chord. the prefix never reaches the page

- a prefix that is itself bound waits `timeoutMs` (one second by default) for its continuation, then runs its own binding
- an unbound prefix waits for the next key
- a key that does not continue the chord ends it: the longest bound buffered prefix runs, the other buffered keys go to your `replay` hook, and the new key is matched from scratch
- a pending chord belongs to the focus it started under. it ends on focus change, blur, a hidden tab or pointer down

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

## terminals

`keyInputFromTerminalKey` reads keys parsed from terminal input (opentui's `KeyEvent` shape: legacy escapes and the kitty protocol). legacy Alt arrives as Alt, never as the desktop Meta key. a terminal host runs the dom-free dispatcher and sends replayed keys to the shell

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
