# Terminal

Shell tabs in the bottom panel, one PTY per tab, registered against the workspace checkout.

## Sub-features

Open tab, type, resize, rename, close (kills the shell), process title in the tab.

## How to get to it (user POV)

The bottom panel's Terminal tab. `address` parameter `bottom=terminal` opens it.

## Driving it with agent:browser

No scenario yet. A proof types `echo verify-$RANDOM` and reads it back from the terminal DOM, then closes the tab and confirms the PTY is gone via `bun run logs --area terminal`.

## Gotchas

Registration is a query keyed by root path; the first tab per root pays it. Terminal input is binary WebSocket frames, not JSON.
