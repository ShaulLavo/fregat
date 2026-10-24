# Troubleshooting

Fixes for the failures a new checkout hits most often. Each entry quotes the message you see. If yours is not here, read the server's structured logs first with `bun run logs --since 5m`. The command reads `logs/` in your checkout, or the directory in `OBSERVABILITY_DIR`.

## `Cannot find module '@fregat/hotkeys'` when starting the dev server

The server and several packages import the workspace libraries (`packages/hotkeys/`, `packages/singapore/packages/*`, `packages/ghostty-webgpu/`) from their built `dist` output. A fresh install has none. Build them once, then start again:

```sh
bun run build:workspaces
bun run dev
```

Rebuild after you change a library's source, or after you pull changes to `packages/singapore/`, `packages/ghostty-webgpu/` or `packages/hotkeys/`.

## `Port 5173 is in use` or `Port 3001 is in use`

The dev server binds fixed ports so the origin allowlist stays exact: 5173 for the web app and 3001 for the API. Stop the process the message names, then run the command again. To use other ports, set `WEB_PORT` and `PORT` in `.env`.

If the message says the port belongs to a shared dev server route, Mesh holds it. Open the app on that port, or run `bun run dev:unserve` to free the ports for a private `bun run dev`.

## `bun run dev` opens a desktop window and you want only the browser

`bun run dev` starts the web app, the server and the desktop launcher. On macOS the launcher opens a native window. To run only the web app and the server, use:

```sh
bun run dev:web
```

## `Claude Code (claude) is not installed or not on PATH`

The server runs the `claude` or `codex` command from its own environment. Install the CLI ([Claude Code](https://code.claude.com/docs/en/setup), [Codex](https://developers.openai.com/codex/cli/)) and make sure the shell that starts `bun run dev` finds it. For Codex the message reads `Codex CLI (codex) is not installed or not on PATH`.

## `Claude Code is not signed in` or `Codex CLI is not authenticated`

Fregat uses your own CLI login. For Claude Code, sign in from the provider menu in the app, or run `claude auth login`. For Codex, run `codex login`, then try again.

## A phone or second computer shows a pairing screen

Any browser that is not on the machine itself pairs before it gets access. Make a code on the machine, or on a device that is already paired, under Settings › Machines › Pair a device. On the machine you can also run `bun run pair`. A code works once and expires after 5 minutes. [Remote access](remote-access.md) covers getting the server to another device, and the [development guide](development.md#pairing-another-device) covers pairing and reverse proxies. A `403` with `This app address cannot access the machine` means the page's origin is missing from `SERVER_ALLOWED_ORIGINS`.

## Terminals vanished after a server restart

On Linux the terminal host keeps shells running and the new server replays their output. The host exits after 30 seconds with no shell and no client. On macOS the host runs as a detached process, and restart recovery there has not been verified. See [terminal host](terminal-host.md).
