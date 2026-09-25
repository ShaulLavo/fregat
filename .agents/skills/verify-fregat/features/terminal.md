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

`scenario bottom-panel-persistence` counts `/terminal` socket opens and closes across every ordinary way of hiding a terminal: the Problems tab, Mod+J, another chat-mode tool, closing the chat tool pane, and Workbench → Chat → Workbench. None may close a socket, entering chat mode may not open one, and the workbench terminal must measure the same when it comes back. Terminals are kept by `lib/keep-alive`, so a parked one is still in the DOM under a `hidden` element; select the visible one.

- `terminal-offline-host`: a disposable committed repository, an interrupted orchestration socket and an offline browser. Checks the unavailable notice and that the host DOM node survives disconnection and reconnect. Runtime reconstruction remains owned by the existing terminal mount lifecycle.
