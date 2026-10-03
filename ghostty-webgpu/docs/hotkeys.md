# Terminal hotkey adapter foundation

This is the prepared Plan 205 adapter. The completed cutover connects it through the
Plan 286 host input contributions in both Plan 287 entries. The shared input owners
provide that connection. Existing core matching stays in place until that cutover.

## Binding packs

`src/extensions/hotkeys/packs.ts` defines `terminalDefaultPack`, indexed by `mac`,
`linux`, and `windows`. Each row has `Terminal` context and `default` source.
macOS uses Command for clipboard actions. Linux and Windows use Ctrl+Shift.
Select all and clear use the clipboard modifier. Font controls use Command on macOS
and Ctrl on Linux and Windows, with equals or plus to increase, minus to decrease,
and zero to restore the font size recorded when the adapter attaches.

`terminalShellKeysPack` has `pack` source. It sends Ctrl+A through Ctrl+Z and readline
Alt keys to `terminal.sendKeystroke`. A host adds these rows to its window keymap.

Standalone registration builds one small BrowserDispatcher with the platform pack
and the supplied override rows. User rows use `user` source. A null command reserves
a key; `unbind` removes a particular command at the specified context.
Hosted registration receives the window dispatcher and a parent node. It creates
one Terminal child node and adds no bindings or key listeners.

## Commands

The focus node handles these commands:

- `terminal.copy` writes the native selection to the supplied clipboard.
- `terminal.paste` reads the supplied clipboard and uses native bracketed paste.
- `terminal.selectAll` selects retained terminal text.
- `terminal.clear` erases scrollback and the viewport, and moves the cursor home.
  Native terminal modes remain active.
- `terminal.fontSizeIncrease`, `terminal.fontSizeDecrease`, and `terminal.fontSizeReset`
  update the native appearance. Font actions serialize across async acknowledgements.
- `terminal.sendKeystroke` accepts exactly `{ keystroke: string }` or `{ text: string }`.
  Zed payloads such as `ctrl-b` keep their meaning. The text variant sends exact bytes.

Malformed payloads decline. An unbound key passes to the terminal. A shallower host
binding handles the key unless a deeper Terminal binding sends it to native input.
An event and its release are sent once, including native Kitty repeat and release.
Clipboard completion checks the attachment signal before using the terminal.

## Host contract

`registerTerminalHotkeys` takes the terminal public command operations, its element,
an abort signal, and a synchronous `readState()` with `alternateScreen` and
`mouseReporting`. Its node reads the state when the dispatcher captures context.
`mode` is `normal` or `alternate`; `mouse` is `on` or `off`.

The hosted options also take `observeKeys(observer)`, an unsubscribe function from
the window dispatcher's `beforeKey` multiplexer. The same dispatcher observes each
release before its document capture listener swallows claimed keys. Standalone
registration uses its own `beforeKey`. The callback adds no matcher or DOM listener.

The input contribution calls `registration.claim(event)` synchronously before native
encoding. Disposal removes the observer, element registration, and focus node.
Standalone disposal also removes its owned dispatcher and bindings.

The extension factory, public pack exports, confirmed native mode snapshot, and
legacy API deletion depend on the landed host seam. The browser preparation tests
use the current DomInputController callback as a test bridge. This bridge is removed
when those tests exercise `Terminal.use(hotkeys(...))` in both terminal entries.
