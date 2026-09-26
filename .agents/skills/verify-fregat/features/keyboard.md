# Keyboard modes and navigation

The two keyboard modes (Platform, VS Code), the sidebar toggle, numbered tab/chat/panel keys and the held-modifier badges. [docs/keymap/modes.md](../../../../docs/keymap/modes.md) is the reference.

## How to get to it (user POV)

`Mod+B` or the titlebar sidebar button; `Mod+1`–`9` and `Mod+Alt+[` / `]` for tabs in the workbench and chats in chat mode; `Mod+Alt+1`–`9` for sidebar panels; hold `Mod` or `Mod+Alt` to see the numbers. Settings › Keyboard shortcuts › Keyboard mode switches to VS Code.

## Driving it with agent:browser

Headless Chromium is Linux, so `Mod` is `Control`.

`scenario sidebar-toggle` hides and restores the workbench sidebar from the editor and from the tree (focus stays or moves to the editor), clicks the pressed rail tab (pane hides, rail stays), and toggles the chat session rail. `scenario item-navigation` drives `Mod+digit` and `Mod+Alt+[ ]` through two disposable chats and three editor tabs, from the terminal too, then opens, focuses and hides panels by number. `scenario shortcut-hints` holds the modifiers and reads `[data-shortcut-hint]` on session rows, editor tabs, rail tabs and the closed-sidebar strip, checking that tabs do not move and that an extra modifier clears every badge.

## Gotchas

The chat half of these scenarios creates sessions with no turn, so a throwaway server without providers is enough (`createIdleSessions`). A badge is its own subscriber; if a row re-renders on every modifier press, a badge is reading more than its label.
