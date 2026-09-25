# Keyboard modes

`keybindings.preset` picks the keyboard mode: **Platform** (`default`, the default) or **VS Code**
(`vscode`). Both start from VS Code's bindings, and user overrides apply on top of either. This
records what Plan 080 changed, per host, and what each mode does differently.

`Mod` is Cmd on macOS and Ctrl on Linux and Windows. `Alt` is Option on macOS.

## Before and after

| Action                      | Before (both presets)                                    | Platform                                                        | VS Code                                                                           |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Toggle sidebar              | `Mod+B` toggled Files; from chat it opened the workbench | `Mod+B`: whole sidebar with its rail; in chat, the session rail | same                                                                              |
| Select tab or chat 1–9      | chats only, `Mod+Alt+1`–`9`, chat mode only              | `Mod+1`–`9`: editor tab in the workbench, chat in chat mode     | macOS `Ctrl+1`–`9`, Linux/Windows `Alt+1`–`9`, plus `Mod+Alt+1`–`9`               |
| Previous / next tab or chat | chats only, `Mod+Alt+[` / `Mod+Alt+]`                    | `Mod+Alt+[` / `Mod+Alt+]`, both modes                           | macOS `Mod+Alt+←/→`, Linux/Windows `Ctrl+PageUp/PageDown`, plus `Mod+Alt+[` / `]` |
| Sidebar panel 1–9           | none                                                     | `Mod+Alt+1`–`9`; repeating the shown panel's number hides it    | none (VS Code's named-view keys stay, e.g. `Mod+Shift+E`)                         |
| Focus editor group 1–3      | `Mod+1`–`3` reserved from the browser, no command        | unbound (`Mod+digit` selects tabs)                              | `Mod+1`–`3`                                                                       |
| Editor pack                 | Platform: native pack. VS Code: VS Code pack             | VS Code pack, folding differs on macOS (below)                  | VS Code pack                                                                      |

The numbered and adjacent commands are shared: `workspace.selectItem1`–`9`, `workspace.nextItem` and
`workspace.previousItem`. One override moves the key for tabs and chats together. The captured
screen decides the target: the active group's tab strip in the workbench (focus in the sidebar or
terminal included), the rail's displayed order in chat (focus in the tool pane included).
Next and previous wrap; an empty slot changes nothing. Panel keys never select chats.

## Platform's differences from VS Code

1. Numbered tabs and chats on `Mod+1`–`9`, where VS Code focuses editor groups.
2. Numbered sidebar panels on `Mod+Alt+1`–`9`: Files, Git, Search, Logs, Chat.
3. On macOS, folding keeps the native chords, because VS Code's `Cmd+Option+[` / `]` is item
   navigation here: fold `Mod+K Mod+[`, unfold `Mod+K Mod+]`, fold recursively `Mod+K Mod+Shift+[`,
   unfold recursively `Mod+K Mod+Shift+]`.

Both modes share the chat extension of `Mod+B` (the session rail) and the held-modifier badges.

## Editor pack change for Platform mode

Platform mode moved from the native pack to the VS Code pack. Against the native pack:

- Removed: `Mod+Shift+F` format document (`Shift+Alt+F` remains).
- Linux and Windows folding: fold `Mod+Shift+[`, unfold `Mod+Shift+]`, fold recursively
  `Mod+K Mod+[`, unfold recursively `Mod+K Mod+]` (were `Mod+K Mod+[`, `Mod+K Mod+]`,
  `Mod+K Mod+Shift+[`, `Mod+K Mod+Shift+]`). macOS is unchanged, per difference 3.
- Remove manual folding ranges: `Mod+K Mod+.` (was `Mod+K Mod+Shift+,`).
- Added: `Mod+K Mod+I` hover, `Mod+K Mod+C` comment line, `Shift+F12` references, `Alt+F12` peek
  definition, `Mod+F12` go to implementation, `Mod+K F12` definition to the side, `F8` / `Shift+F8`
  next and previous problem, `Mod+Shift+\` jump to bracket, `Alt+Z` word wrap, `Mod+K Mod+X` trim
  trailing whitespace, `Tab` accepts a visible inline suggestion.

## Sidebar visibility

`Mod+B`, the titlebar toggle and a repeated panel number hide the whole sidebar: rail, pane and
resize handle. Clicking the pressed rail tab or the pane header's Hide hides the pane and keeps
the rail. Reopening restores the selected panel and its width. Focus outside the sidebar stays
where it is; focus inside it moves to the active editor, or to the composer in chat.

## Held-modifier badges

Holding exactly the modifiers of a live single-stroke binding badges its targets at once: editor
tabs of the active group (workbench), the first nine session rows (chat), and the sidebar rail's
tabs. With the sidebar hidden, a strip of the numbered panels overlays its edge until release.
Extra modifiers, release, blur, paste and a hidden page clear them. A badge follows an override,
and an unbound or two-stroke override removes it. Targets carry `aria-keyshortcuts`.

Adapted from T3 Code (`references/t3code` at `f5ef0ddb`, `shortcutModifierState.ts` and
`Sidebar.tsx`): the same exact-modifier rule and stale-flag guard, with no 200 ms delay, and hints
in the terminal because Platform's terminal hands these keys to the app. T3's running interface was
not inspected; the comparison is from source.

## Host limitations and checks

- **Browser tabs.** In a normal browser tab the browser may take `Mod+1`–`9` and `Ctrl+PageUp/PageDown`
  for its own tabs before the page sees them. Headless Chromium delivers them, which proves nothing
  about a real tab or the desktop app. Owner check pending on the Mac desktop app and a browser tab.
- **macOS Option.** `Cmd+Option+digit` and `Cmd+Option+[` resolve through the matcher's physical-key
  fallback, as the Mod+Alt session keys did before. Owner check pending on the Mac.
- **Windows AltGr.** Windows reports AltGr as Ctrl+Alt, and the matcher's physical-digit fallback
  then reads AltGr+2 on a German layout (`²`) as `Mod+Alt+2`. Panels 1–5 are exposed; slots 6–9
  decline and let the character through. Linux reports AltGr without Ctrl+Alt. A fix belongs in the
  shared Editor matcher (skip the physical fallback when `AltGraph` is down).
