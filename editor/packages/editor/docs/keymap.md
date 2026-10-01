# keymap

## chords

Declare shortcuts as a non-empty `chord` array. Single strokes use the same field.
Each Editor owns its sequence state and cancels it when focus leaves the editor.

```ts
const editor = new Editor(container, {
  keymap: {
    layers: [
      {
        id: 'comments',
        bindings: [
          {
            chord: ['Mod+K', 'Mod+C'],
            command: 'editor.action.commentLine',
            when: ['writable'],
          },
        ],
      },
    ],
  },
})
```

`keymap.preset` selects `default` or `vscode`. The default pack puts folding under
`Mod+K`; the VS Code pack uses its folding shortcuts and adds supported language
navigation, formatting, hover, and comment chords. Packs contain only commands
this Editor implements. `defaultBindings: false` drops the pack and keeps your layers.

## matching order

Later layers precede earlier layers. Rows within a layer keep declaration order,
including rows with the same chord and different `when` conditions. At each stroke,
the runtime captures one context and tries eligible terminal candidates in order
until one dispatch claims the event. A declined candidate runs once, then falls
through. Explicit `preventDefault: true` or `stopPropagation: true` keeps event
ownership even when every eligible command declines. An eligible single stroke wins
over a longer sequence with the same prefix.

An available prefix consumes the event immediately and starts a five-second timer.
After that prefix, completion and unmatched keys stay consumed even if availability
changes. Held keys remain owned through release. Repeats do not extend the timer.
`setKeymap()` replaces bindings and cancels pending state. `enabled: false` disables
shortcuts while native typing, selection, composition, and clipboard handling stay
active. Disabling keeps ownership of consumed keys until release.

## host keymaps

Hosts combining Editor and application commands can import `createKeymapRuntime`
from `@singapore-editor/core/keymap`, supply a DOM root and ordered generic bindings, and
provide synchronous context, availability, and dispatch callbacks. The returned
runtime mounts immediately and exposes `claimKeybinding`, `updateBindings`,
`setEnabled`, `cancel`, and `dispose`. Hosts must call `cancel()` when their exact
command target changes and `dispose()` when its owner unmounts. Embedded editors
then use `keymap: { enabled: false }`; their public commands remain available.

The keymap entry point imports without a DOM. `editor.getKeymapContext()` exposes the
facts used by pack conditions. `editor.getInputElement()` identifies the native
editor input so a host can tell it apart from local widget inputs. Local widgets
handle their own idle key events before the runtime; a widget that stops an event
also prevents an application bubble listener from seeing it.
