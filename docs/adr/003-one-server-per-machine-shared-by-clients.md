# 003. Run one server per machine and share it between clients

Status: accepted
Date: 2026-10-03 (the owner accepted the installed-app contracts)

## Context

Fregat has several clients for the same work: browser tabs, the desktop window, the terminal client and a paired phone. A terminal or an agent turn should not depend on which window started it, and closing a window should not kill a running agent.

The earlier desktop shell, built on Electrobun, was removed on 2026-10-03 in favor of a launcher that opens an installed browser app or a native system webview.

## Decision

Each machine runs one server per state home, and every client connects to it. The desktop launcher reuses a running service or registers an operating-system-activated one, then opens a window on it. The window is the installed Chromium app, or on macOS the native WebKit host. Closing a client leaves the server and terminals running. The terminal host is a separate process that owns the PTYs, so a server restart keeps them.

## Alternatives considered

- **A server bundled in each desktop window.** It is the simplest packaging. It lost because sessions and terminals die with the window and two windows cannot show the same work.
- **A launcher that injects a bridge into the page.** It gave the desktop window extra abilities. It lost because an installed app opened from the Dock has no launcher, so the same features must work with no injected globals.

## Consequences

- Browser, desktop, TUI and phone see the same sessions. The [architecture page](../architecture.md) shows the layout.
- The web app, the server, the launcher and remote machines ship together. Code that handles a version mismatch between them is out of scope, and a refresh or restart fixes a mismatch. AGENTS.md states this rule for contributors.
- On Linux, a server restart keeps terminals and replays their output. The same behavior on macOS has not been verified. See [terminal host](../terminal-host.md).
- Remote machines run the primary's server release, described in [remote server releases](../remote-server-releases.md).
