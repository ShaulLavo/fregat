# Terminal hotkeys

`hotkeys()` is a public host-side extension. It uses `@fregat/hotkeys` with the main terminal native owner. Load it explicitly for an interactive standalone terminal:

```ts
import { Terminal, hotkeys } from 'ghostty-webgpu'

const terminal = await Terminal.create({
  extensions: [hotkeys()],
})
await terminal.open(container)
```

Extensions listed during creation attach when the host opens. `terminal.use(hotkeys())` also
attaches synchronously to an already open terminal. Its handle disposes the registration.

## Standalone bindings

`terminalDefaultPack` exports platform-indexed binding data. macOS uses Cmd+C/V/A/K for copy,
paste, select all and clear. Linux and Windows use Ctrl+Shift+C/V/A/K. Font size uses Cmd on
macOS and Ctrl elsewhere: `=`, `Shift++`, `-` and `0`.

Overrides follow the library's binding format:

```ts
hotkeys({
  mode: 'standalone',
  bindings: [{ keys: 'Ctrl+Q', command: 'terminal.clear', context: 'Terminal', source: 'user' }],
})
```

Clipboard commands use the owning window's Clipboard API. An embedder can supply
`clipboard: { readText, writeText }` and `onError(cause, operation)`. Copy declines when the
selection is empty. Paste completion and queued font changes stop on disposal.
Clear erases the display and scrollback while preserving native protocol modes.

## Hosted focus adapter

Pass the existing window dispatcher and the Workspace parent:

```ts
terminal.use(
  hotkeys({
    mode: 'hosted',
    dispatcher: windowKeymap.hotkeys,
    parent: windowKeymap.parentFor('terminal'),
    platform,
  }),
)
```

The extension adds a `Terminal` focus node and its commands. The host owns all binding data
and the single matcher/listener. `terminalShellKeysPack` is exported opt-in data for Ctrl+A–Z
and readline Alt keys. `terminalDefaultPack` is also available to hosted presets.

The node reads `terminal.inputModes` synchronously before matching. It publishes `Terminal`,
`mode: normal | alternate`, and `mouse: off | on`. The main entry reads existing native screen and mouse state before matching.

## Native input ownership

An unbound key reaches native encoding once. A shallower application binding claims its key;
a deeper `terminal.sendKeystroke` binding sends it to the shell. Arguments are exactly
`{ keystroke: string }` or `{ text: string }`. Keystrokes accept the library's `Ctrl+B` notation
and Zed's `ctrl-b` notation. Invalid arguments decline the command.

Original DOM events arbitrate through the extension's synchronous claim/pass contribution
before native encoding. Resolved commands use `sendGeneratedInput`, which sends a
typed key, text or paste directly to the native execution owner. Native terminal replies bypass
extension input contributions. Composition remains native text input.

The adapter subscribes directly to `dispatcher.observeKeys({ beforeKey, reset })`. It remembers
native-selected physical presses and forwards their matching release once before the dispatcher
consumes it. Focus movement retains the original terminal owner. Blur, hidden, `releaseAll`,
dispatcher disposal and extension disposal clear that ownership. Disposal removes the node,
commands and observer; the terminal execution owner remains in place.

## Packaging

The consumer uses `catalog:`. The root workspace supplies the reviewed exact hotkeys version. The standalone family catalog
resolves its pinned artifact. Pack with Bun so the published manifest
contains the resolved version. Publication and mirror cutover follow the root roadmap.
