# Keymap architecture

Owner decisions of 2026-09-29, after Mod+B in a Markdown editor ran `markdown.bold` and silently
took the key from Toggle sidebar. Research behind them: `/work/reports/keymap-architecture/`
(prior art in VS Code, Zed, Helix, CodeMirror, SilverBullet and Obsidian; TanStack Hotkeys
against our runtime; an inventory of today's Editor, Platform, ghostty-webgpu and TUI keymaps).
Plans [203](../../plans/203-fregat-hotkeys.md), [204](../../plans/204-editor-on-fregat-hotkeys.md),
[205](../../plans/205-ghostty-on-fregat-hotkeys.md) and [206](../../plans/206-platform-one-keymap.md)
carry the work. This page supersedes the ownership model in [delivery.md](delivery.md).

## The model

- **One library, no keymaps inside.** `@fregat/hotkeys` is our fork of TanStack Hotkeys: its API
  shape and pure key functions, with our trie, editor-grade chords and Zed's context resolution.
  It lives in its own repo below the Editor, ghostty-webgpu and Platform, so each stays
  standalone. The core is DOM-free; adapters turn browser and terminal input into its key events.
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
