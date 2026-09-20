# Terminal

Shell tabs in the bottom panel, one PTY per tab, registered against the workspace checkout.

## Sub-features

Open tab, type, resize, rename, close (kills the shell), process title in the tab.

## How to get to it (user POV)

The bottom panel's Terminal tab. `address` parameter `bottom=terminal` opens it.

## Driving it with agent:browser

`scenario terminal-background` opens the terminal in code mode, switches to chat mode, and checks that both terminals have the same computed ancestor background layers. Screenshots capture both modes. It does not type into either shell.

## Gotchas

Registration is a query keyed by root path; the first tab per root pays it. Terminal input is binary WebSocket frames, not JSON.
