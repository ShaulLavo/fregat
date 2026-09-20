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

- `terminal-history`: capture-owned shell IDs only; real output, second viewer replay, reconnect, shared Clear, empty replay afterward, and Restart shell replacing process state while both viewers stay connected. Explicitly clears and kills only its own terminals. Server-restart restoration remains a separate integration check.

`scenario bottom-panel-persistence` counts `/terminal` socket opens and closes across every ordinary way of hiding a terminal: the Problems tab, Mod+J, another chat-mode tool, and collapsing the chat tool pane. None may close a socket, entering chat mode may not open one, and the reopened bottom panel must measure what it did before. A collapsed panel keeps its children, so the scenario waits on the panel's extent rather than on visibility. Switching Workbench ↔ Chat still remounts the workbench terminal; the scenario counts that half separately.
