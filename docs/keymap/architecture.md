# Keymap architecture

Owner decisions of 2026-09-29, after Mod+B in a Markdown editor ran `markdown.bold` and silently
took the key from Toggle sidebar. Research behind them: `/work/reports/keymap-architecture/`
(prior art in VS Code, Zed, Helix, CodeMirror, SilverBullet and Obsidian; TanStack Hotkeys
against our runtime; an inventory of today's Editor, Platform, ghostty-webgpu and TUI keymaps).
Plans [203](../../plans/203-fregat-hotkeys.md), [204](../../plans/204-editor-on-fregat-hotkeys.md),
[205](../../plans/205-ghostty-on-fregat-hotkeys.md) and [206](../../plans/206-platform-one-keymap.md)
carry the work. This page also owns preset, host-input and display policy; older delivery
receipts remain in Git history and the [historical baseline](baseline.md).

## The model

- **One library, no keymaps inside.** `@fregat/hotkeys` is our fork of TanStack Hotkeys: its API
  shape and pure key functions, with our trie, editor-grade chords and Zed's context resolution.
  It lives in Fregat's `hotkeys/`, mirrored to its own public repo
  ([207](../../plans/207-one-repo-with-mirrors.md)). Local consumers use the workspace;
  standalone consumers qualify a pinned dependency artifact while npm remains deferred.
  The core is DOM-free; adapters turn browser and terminal input into its key events.
- **Every product is standalone on the library** and ships its own defaults. The Editor follows
  CodeMirror: a minimal built-in base, packs exported as data (VS Code, Markdown, …) and the
  user's object on top. ghostty-webgpu ships a small baseline. Hosts import, modify and pass back
  those packs, the way they use the Editor's spellcheck and highlighting services.
- **Inside Fregat, Platform owns one keymap for everything.** The Editor and ghostty-webgpu join
  Platform's dispatcher as focus nodes that publish context and handle commands; they bind
  nothing themselves. There is no `enabled: false`.
- **Resolution copies Zed.** Contexts stack along the focus path (three or four deep). A binding
  scores by the deepest context its predicate matches; the focused layer wins, even over a user
  binding in a shallower context, so a user rebinds the focused layer's key. A command that
  declines falls through to the next candidate. Pending chords belong to the focus they started
  under and replay on mismatch. `null`/`unbind` remove a default.
- **Context keys copy Zed**: one predicate language (`Editor && extension == md`,
  `Workspace > Terminal`) owned by the library. It replaces the four condition systems.
- **No architectural guard against shadowing.** Prevention is curated defaults. Settings may show
  which binding hides which as information, never as a gate.
- **Presets:** `ours` starts as an exact copy of Zed and evolves with the owner's preferences;
  `zed` stays an exact copy; `vscode` exists for familiarity. The Markdown pack is off in regular
  editing; a future rich Markdown view may turn it on.
- **Terminal follows Zed:** the terminal layer lists the keys it sends to the shell; everything
  else it does not bind reaches the app, and unbound text keys reach the shell. The default layer
  is minimal. An opt-in pack sends every Ctrl key to the shell for heavy terminal users.
- **TUI:** moves onto the library for shared infrastructure only. Its keymap stays as is and may
  break; a terminal-native keymap belongs to the TUI redesign, not these plans.

## Presets and authored bindings

`keybindings.preset` selects `ours`, `zed` or `vscode`, with `ours` as the default. The Zed
translation pins its upstream commit, retains context predicates and command arguments, and
records actions with no Fregat equivalent. `ours` initially shares that translation. `vscode`
combines explicit app rows with named Editor packs; a change to the Editor's standalone defaults
does not implicitly change a host preset. Regular presets exclude Markdown formatting bindings.

`keybindings.overrides` is an ordered application-scoped list. A row assigns a command,
reserves a key with `command: null`, or removes a command's default with `unbind`:

```json
[
  { "keys": "Mod+B", "command": "workspace.toggleSidebar", "context": "Workspace" },
  { "keys": "Mod+K", "command": null, "context": "Editor" },
  { "keys": "Mod+S", "unbind": "workspace.saveFile", "context": "Workspace" }
]
```

Each row applies in its predicate context. Defaults in a deeper matching context can still
win. Settings reports configured bindings, unmapped upstream actions and shadowing using the
dispatcher's `bindingsForInput` results. Menus, palette rows, tooltips and held-modifier badges
read the same resolved bindings.

## Focus and terminal input

The window owner builds `Workspace` and its area nodes. Hosted Editors and terminals attach
their own child nodes, publishing live context and registering commands. Specialized widgets
attach below their owning Editor when they need its context. Element registrations stack: the
deepest node wins, equal depths use registration order, and detaching restores the remaining
owner. Changing focus cancels a pending chord.

Commands validate availability and mutation policy at execution. Bare F1–F12 remain available
in text fields through authored contexts; native text editing, composition and widget navigation
retain their own input behavior. Shortcut actions, including chat stash, question digits, commit
and file-tree selections, register commands in the window dispatcher.

Terminal extension input claims run synchronously before native encoding. A host command consumes
the key once; unhandled input reaches the terminal once. `terminal.sendKeystroke` carries either
`{keystroke}` or `{text}`, preserving the preset's payload. Native protocol replies bypass host
claims. `terminal.shellKeys` adds the exported shell pack at application scope.

The existing browser event path exposes `observeKeys` for press/release ownership. The terminal
tracks native-owned presses so a claimed release reaches the original native owner once, even
when focus has moved. Blur, hidden-page and disposal reset that ownership. Hosted terminals add
no second keyboard listener or matcher.

## Verification and host limits

The coordinated release checks standalone packs, hosted focus routing, contextual overrides,
terminal press/release ownership and text composition. Browser scenarios cover Markdown sidebar
toggle, editor history navigation, Linux shell Ctrl+B and chord cancellation on focus changes.
Typing traces compare the same large fixture and host identity; matcher callback timing and
input-to-paint latency are recorded separately.

Browsers can intercept reserved tab shortcuts before a page sees them; headless delivery alone
does not qualify a desktop or macOS browser. AltGraph input and physical-key fallback need their
own browser coverage. Native device verification keeps its separate execution grants.

The initial `ours` deviation keeps the approved document-navigation keys: Mod+[ and Mod+] dispatch `workspace.navigateBack` and `workspace.navigateForward` at Workspace depth. The four source rows record this choice; `zed` retains the pinned Editor indent/outdent bindings.

An unbound nonprintable chord prefix waits for the next key. Bound prefixes use the continuation timeout; printable text prefixes follow the replay contract. Focus, blur and pointer changes cancel a pending chord.

## Terminal original input connection

The main terminal exposes one `connectInput` lease. `attachTerminalHotkeys` connects the
existing Terminal focus node and live native modes to that lease, independently of general
extension registration. It owns its open subscription, key observer and focus-node disposal;
the hosted window retains its dispatcher and binding data. Standalone terminals own one
dispatcher with their default pack and authored overrides.

Original DOM key events retain identity and reach the finite owner before native composition
or byte encoding. Original text, paste and composition commits share the same boundary. A
finite claim stops forwarding; a pass reaches explicitly interested general contributions and
then native once. Generated terminal commands and native replies bypass both original-input
routes. Terminal or connection disposal during a callback stops that event before forwarding.

The landed general extension APIs remain a separate peer-owned surface. Connecting hotkeys
constructs no manager. The finite lease rejects a second owner and its old disposer cannot
remove a replacement. Worker finite connections reject asynchronously; this wave does not
activate worker hotkeys or transfer a failed general-manager performance qualification.
