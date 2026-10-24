# server

The Fregat machine server, built on Bun and Elysia. One server per machine and state home owns the filesystem, Git, language servers, terminals, agent sessions, settings and the SQLite database. Every client connects to it: the [web app](../web/), the [desktop launcher](../desktop/), the [terminal client](../tui/) and paired phones.

From the repository root:

```sh
bun run dev:web                  # server and web app together
bun run --cwd apps/server dev    # server only, restarts on source changes
bun run --cwd apps/server test
```

It listens on `127.0.0.1:3001` by default (`PORT`). Development state lives in `~/.platform-dev`, and production state in `~/.platform`. The Codex protocol types are generated: run `bun run --cwd apps/server codex-protocol:check` to confirm they are current.

The [architecture](../../docs/architecture.md) shows where the server sits. [Session domain](../../docs/session-domain.md), [terminal host](../../docs/terminal-host.md) and [filesystem boundaries](../../docs/filesystem-boundaries.md) cover its main parts.
