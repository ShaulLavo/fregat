# RUNTIME-02 protocol survey: Cursor (`cursor-agent`)

Upstream read at T3 Code `7a12aff4` (2026-09-25), 14 commits past the plan pin `7445aa73`. Driver files that
changed since the pin: `CursorDriver.ts` (+28, usage history), `CursorProvider.ts`, `cursorUsageLimits.ts`,
`cursorCredentialStore.ts` (new), `acp/AcpSessionRuntime.ts`. Measured with Cursor Agent `2026.09.18-9a7762b`,
extracted into `/work/tmp/research/runtime02/cursor` with `HOME` and `XDG_CONFIG_HOME` pointed at a scratch
directory. Nothing was logged in and no prompt was sent.

## Install

- Official: `curl https://cursor.com/install -fsS | bash` (upstream links `https://cursor.com/docs/cli/installation`,
  `Layers/CursorProvider.ts:158`). The ACP registry entry (`agentclientprotocol/registry`, `cursor/agent.json`)
  ships a per-platform tarball; linux-x64 is `downloads.cursor.com/lab/2026.09.18-9a7762b/linux/x64/agent-cli-package.tar.gz`,
  183 MB compressed, 557 MB unpacked, launched as `./dist-package/cursor-agent acp`.
- The launcher is a bash script over a bundled Node runtime. The CLI names itself `agent`; upstream spawns
  `cursor-agent` (`acp/CursorAcpSupport.ts:56`).
- Updates itself: `cursor-agent update`. Upstream's maintenance resolver runs exactly that against the resolved
  executable (`Drivers/CursorDriver.ts:64-81`).
- Not installed on this machine.

## Transport and events

- ACP over stdio: `cursor-agent [-e <endpoint>] [--force | --auto-review] acp` (`acp/CursorAcpSupport.ts:49-64`).
- Measured `initialize` (protocol 1): `loadSession: true`, `sessionCapabilities: { list }`, no `resume`, no `fork`;
  prompt capabilities `image: true`, `embeddedContext: false`, `audio: false`; MCP over http and sse. One auth
  method, `cursor_login`. `initialize` answered in 296–300 ms; the idle process tree held 206–212 MB RSS
  (two runs, `/proc/*/status` VmRSS summed over the child tree 3 s after `initialize`).
- Events are standard `session/update` kinds (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
  `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`), mapped in
  `acp/AcpRuntimeModel.ts:796-872`.
- Cursor extensions upstream handles: `cursor/ask_question` (a user-input question), `cursor/create_plan` (plan
  approval), `cursor/update_todos` (notification) at `Layers/CursorAdapter.ts:595-685`, and
  `cursor/list_available_models` for the catalog (`Layers/CursorProvider.ts:656`).

## Approvals and permissions

- Runtime mode becomes a launch flag: `full-access` → `--force`, upstream's `auto` → `--auto-review`, everything
  else → none (`acp/CursorAcpSupport.ts:22-30`). Platform has no `auto` mode, so `approval-required` and
  `auto-accept-edits` both launch plain.
- `session/request_permission` becomes a `request.opened`; the reply picks an ACP `optionId` or `cancelled`. In
  `full-access` the adapter answers itself with `allow_always`, else `allow_once` (`Layers/CursorAdapter.ts:310-324,687-765`).
- The CLI keeps its own allowlist in `cli-config.json` (`approvalMode: "allowlist"`, `permissions.allow: ["Shell(ls)"]`
  in a fresh home), so some tool calls never reach the client.

## Sessions and resume

- New: `session/new`. Resume cursor `{ schemaVersion, sessionId }` (`Layers/CursorAdapter.ts:783-786`).
- No `session/resume`, so a resumed thread uses `session/load`, which replays the whole history as
  `session/update` notifications. Upstream swallows the replay behind a gate that ends on the RPC response or on
  2 s without activity (`acp/AcpSessionRuntime.ts:69,796-870`).
- Rollback is refused: "Cursor ACP sessions do not support provider-side rollback" (`Layers/CursorAdapter.ts:1221-1234`).
  Capabilities `{ sessionModelSwitch: "in-session", supportsConversationRollback: false }` (`:1273`).
- A `sendTurn` during a running prompt is a steer: the adapter folds it into the running turn (`:970-1010`).

## Models and auth

- Model: ACP `session/set_model` with the base id, then `session/set_config_option` for each parameter
  (`acp/CursorAcpSupport.ts:103-136`). The CLI accepts bracket parameters such as
  `claude-opus-4-8[context=1m,effort=high,fast=false]` (`--help`).
- Status: `cursor-agent about --format json`, falling back to plain `about` (`Layers/CursorProvider.ts:1089-1099`);
  `status` prints "Not logged in" in a fresh home.
- Auth is the CLI's own: `cursor-agent login` (browser; `NO_OPEN_BROWSER` suppresses the open), or
  `CURSOR_API_KEY` / `--api-key`. Config lives in `$XDG_CONFIG_HOME/cursor/cli-config.json` (measured), so a second
  account is a second `XDG_CONFIG_HOME` or `HOME` in the instance environment. Upstream has no in-app sign-in for
  Cursor. Its usage meter reads the macOS keychain token (`cursorCredentialStore.ts`), gated by a setting.

## On our layer

Needs the shared ACP client (see the RUNTIME-02 findings in `runtime.md`) plus: the `session/load` replay gate,
the three `cursor/*` extension handlers, parameterized model options through `set_config_option`, and
`XDG_CONFIG_HOME` in `credentialPaths` for the credential watcher. Upstream's Cursor-only files: `CursorAdapter.ts`
1289 lines, `CursorProvider.ts` 1270, `CursorDriver.ts` 253, `acp/Cursor*.ts` about 300.
