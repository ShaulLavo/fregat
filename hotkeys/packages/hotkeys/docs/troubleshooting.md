# troubleshooting

a shortcut that does not fire usually fails in one of a few places. start at the top

## nothing fires

1. **the node is not attached.** with `createBrowserDispatcher`, a key focuses the deepest node attached to an element on the event path. call `attachElement(node, element)` for every node you expect to receive keys
2. **the key is outside the root.** the dispatcher listens on `root`, which defaults to `document`. keys pressed outside an element `root` are ignored
3. **something stopped the event first.** the dispatcher skips a `keydown` whose `defaultPrevented` is already set. set `capture: true` to hear keys before descendant handlers
4. **the handler declined.** a handler that returns `false` passes the key on. check for a stray `return false`
5. **it runs on a different platform.** `Mod` is Command on macOS and Control elsewhere. without `navigator` (SSR, tests) the platform is `linux`. pass `platform: 'mac'` to override it

## it works outside inputs but not inside

`getHotkeyRegistry().register` skips a shortcut while a text field has focus unless you set `ignoreInputs: false`. the default is `true` for bare keys and for Shift and Alt combinations. Control and Meta combinations, and Escape, still fire inside inputs

in react the same option goes in the third argument, and a provider can set it for every hook:

```tsx
useHotkey('G', goToTop, { ignoreInputs: false })

<HotkeysProvider defaultOptions={{ hotkey: { ignoreInputs: false } }}>{app}</HotkeysProvider>
```

a dispatcher has no `ignoreInputs`. a bound key runs wherever focus is, text fields included, so a bare-key binding also fires while someone types unless its `context` leaves that field out. give the field's node a context such as `TextInput` and bind with `Workspace && !TextInput`. `acceptsTextInput` is narrower: it makes a printable chord prefix pend with a timeout, and `replay` types the character back if no chord follows

## the wrong binding wins

print what the dispatcher sees:

```ts
console.log(hotkeys.contextStack()) // outermost to focused
```

then compare it with the binding's `context` and with the ranking rules in [concepts](concepts.md#ranking). the deepest matching context wins before source or table order. `bindingsForInput` reports what a key sequence would run under a given stack, which is useful in a settings screen or a test

## a chord ends too early

log how it ended:

```ts
createBrowserDispatcher({
  keymap,
  onSequence: (event) => console.log(event.keys, event.outcome, event.elapsedMs),
})
```

| outcome                                   | meaning                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `completed`                               | a bound chord ran                                                               |
| `timeout`                                 | a bound prefix waited `timeoutMs` (1 second by default) and ran its own binding |
| `unmatched`                               | the next key did not continue the chord                                         |
| `unavailable`                             | `isAvailable` filtered the bindings out                                         |
| `blur`, `hidden`, `pointer`, `superseded` | the window lost focus, the tab hid, a pointer pressed, or focus moved           |
| `disabled`, `disposed`                    | the runtime was turned off or torn down                                         |

## characters vanish after a chord prefix

an unmatched prefix hands its buffered keys to `replay`. in the browser, text fields get the character back. in a terminal host you pass `replay` yourself and write the encoded key to the shell

## the same shortcut warns about a conflict

a second registration of the same keys on the same target logs a warning, and both handlers run. set `conflictBehavior` to `'replace'` to swap the old one, `'error'` to throw, or `'allow'` to silence the warning

## holding a key repeats the callback

set `requireReset: true` on a single-stroke registration. it fires once per press and re-arms when the key or a modifier is released
