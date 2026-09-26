# RUNTIME-02 protocol survey: OpenCode (`opencode`)

Upstream read at T3 Code `7a12aff4` (2026-09-25); `OpenCodeAdapter.ts` changed 15 lines since the plan pin.
Measured with OpenCode `1.18.32`, with `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`
pointed at a scratch directory. Nothing was logged in and no prompt was sent.

## Install

- Distributed as a native binary: GitHub releases (`anomalyco/opencode`, the ACP registry pins
  `opencode-linux-x64.tar.gz` with a sha256), npm, Homebrew, and `opencode upgrade [target]` for self-update.
- Upstream requires at least `1.14.19` (`opencodeRuntime.ts:42`) and checks `opencode --version`
  (`Layers/OpenCodeProvider.ts:450-492`). Its maintenance resolver is package-managed (npm/brew/self).
- This machine: `~/.local/bin/opencode` is an Omarchy mise shim (`aqua:anomalyco/opencode`); the first call
  installed 1.18.32 (see the findings in `runtime.md`). The shim adds 20–170 ms: 313–459 ms against 288–291 ms
  direct for `--version`, three runs each.

## Transport and events

Upstream does not use ACP for OpenCode. It runs the HTTP server and talks to it with `@opencode-ai/sdk/v2`.

- Spawn: `opencode serve --hostname=127.0.0.1 --port=<free>`, ready when stdout prints
  `opencode server listening` (`opencodeRuntime.ts:81,688`). Config comes from `OPENCODE_CONFIG_CONTENT`
  (default `{}`) and the optional `OPENCODE_SERVER_PASSWORD` (`:51-78`). Settings may instead name an external
  `serverUrl` and password (upstream `OpenCodeSettings`).
- Measured: ready in 1611 ms, 309 MB RSS idle. `GET /global/health` → `{"healthy":true,"version":"1.18.32"}`.
  Without a password the server warns "server is unsecured". The OpenAPI document at `/doc` lists 162 paths,
  including a newer `/api/session/{id}/…` family next to the legacy `/session/{id}/…` routes the SDK uses.
- Events: server-sent events from `client.event.subscribe` (`GET /event`), reconnecting on `server.connected`
  (`Layers/OpenCodeAdapter.ts:2764-2790`). Types handled: `session.created/updated/deleted/status/error/compacted`,
  `message.updated/removed`, `message.part.delta/updated/removed`, `todo.updated`, `permission.asked/replied`,
  `question.asked/replied/rejected` (`:2224-2650`).
- Turns: `session.promptAsync` (`POST /session/{id}/prompt_async`), slash commands via `session.command`,
  interrupt via `session.abort`, compaction via `session.summarize` (`:3254,3276,3381,3577`).
- `opencode acp` also exists. Measured `initialize`: `loadSession`, `sessionCapabilities { close, fork, list, resume }`,
  image prompts, one auth method `opencode-login`; 677–707 ms to answer, 321–431 MB RSS idle.

## Approvals and permissions

- The runtime mode becomes a per-session permission ruleset, sent on `session.create` and re-sent with
  `session.update` on resume (`opencodeRuntime.ts:508-535`; `Layers/OpenCodeAdapter.ts:2915,2942,2958`).
  `full-access` allows `*` and `external_directory`; otherwise `*` asks, reads and search tools are allowed,
  `.env` reads ask, `bash` asks, and edits are `allow` under `auto-accept-edits`, `ask` otherwise.
- A `permission.asked` event opens a request; the reply is `permission.reply({ requestID, reply: "once" | "always" | "reject" })`
  (`:1792,1818-1900`). In `full-access` the adapter replies `once` itself. Pending permissions and questions are
  re-read with `permission.list` / `question.list` after a reconnect (`:2077-2143`).
- OpenCode's `question` tool is native user input (`question.asked` → reply or reject).

## Sessions and resume

- Resume cursor `{ sessionId }`. Start adopts it with `session.get`; a not-found starts fresh, any other error
  fails the start. When the stored session belongs to another directory it is forked into the requested one, so a
  thread that moved into a worktree keeps its history (`:2837-2970`).
- Rollback: forks the retained conversation instead of calling native revert, because revert also rewrites
  workspace files (`:3915-3960`). This is the only one of the four with rollback.
- Upstream spawns one server per chat session. Status probes and text generation share one server per instance
  that closes after 30 s idle (`OpenCodeServerOwner.ts:11`). The server takes the directory per request, so one
  server per instance could carry every session; at about 310 MB a server, that matters on this machine.

## Models and auth

- Catalog: `GET /provider` returns every models.dev provider plus `connected`. Upstream reports authenticated when
  `connected` is non-empty (`Layers/OpenCodeProvider.ts:543-566`). Models are `providerID/modelID`.
- Credentials live in `$XDG_DATA_HOME/opencode/auth.json` (`opencode providers` / `opencode auth`), so a second
  account is a second `XDG_DATA_HOME`. Measured with zero credentials: `connected: ["opencode"]` with 7
  zero-cost models (`big-pickle`, `space-bunny-free`, `mimo-v2.6-flash-free`, `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free`, `ling-3.0-flash-fin-free`, `muse-spark-1.3-contributor-free`). A live smoke test
  needs no account and no paid credit.

## On our layer

HTTP, not ACP: a server owner per instance, the SDK client (`@opencode-ai/sdk`, one dependency, `cross-spawn`;
its `fetch` is injectable, which is where tests plug in), the SSE-to-runtime-event mapper, permission rules per
runtime mode, the `question` bridge, rollback by fork, and compaction by `summarize`. `serverPassword` is a
secret and goes to the secret store. Upstream's OpenCode-only files: `OpenCodeAdapter.ts` 4048 lines,
`opencodeRuntime.ts` 1100, `OpenCodeProvider.ts` 569, `OpenCodeDriver.ts` 294, `OpenCodeServerOwner.ts` 185.
