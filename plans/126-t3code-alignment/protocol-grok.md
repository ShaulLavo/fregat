# RUNTIME-02 protocol survey: Grok (`grok`, Grok Build)

Upstream read at T3 Code `7a12aff4` (2026-09-25). Since the plan pin `7445aa73`, `GrokDriver.ts` gained 92 lines
(update resolver, usage), `GrokAdapter.ts` changed 79 and `grokUsageLimits.ts` 173. Measured with `grok 1.0.41
(4220f3b224a6)`. Nothing was logged in and no prompt was sent.

## Install

- npm package `@xai-official/grok` (bin `grok`); the ACP registry entry `grok-build/agent.json` launches it as
  `npx @xai-official/grok@1.0.41 agent stdio`. On a Unix npm install a postinstall step swaps the Node entry for a
  native binary. The CLI also installs itself under `GROK_HOME` (default `~/.grok`); here that is a 166 MB
  binary at `~/.grok/bin/grok-1.0.41`.
- Updates itself with `grok update`, which finds its own installer. Upstream runs it against the resolved
  executable with the instance environment and reads "latest" from npm (`Drivers/GrokDriver.ts:46-71`).
- This machine: `~/.local/bin/grok` is an Omarchy shim that runs `mise use -g npm:@xai-official/grok` and then the
  tool. The first call installed grok 1.0.41 (see the findings in `runtime.md`). After that the shim adds about
  40 ms per launch: 63–80 ms through the shim against 25–26 ms direct for `--version`, three runs each.

## Transport and events

- ACP over stdio: `grok agent stdio`, with the permission mode as a flag (`acp/GrokAcpSupport.ts:33-46`):
  `approval-required` → `--permission-mode default`, `auto-accept-edits` → `acceptEdits`, upstream's `auto` →
  `auto`, `full-access` → `agent --always-approve stdio`. The CLI also offers `dontAsk`, `bypassPermissions` and
  `plan`.
- Measured `initialize` (protocol 1): `loadSession: true`, `sessionCapabilities: { list, resume, close }`, prompt
  capabilities `embeddedContext: true`, `image: false`; MCP over http and sse. `_meta` carries the model catalog
  (`grok-4.6` default, `grok-4.5`, each with reasoning efforts `xhigh`/`high`/`medium`/`low`, 500k context), the
  slash-command catalog (`compact`, `always-approve`, `context`, `session-info`, `deep-research`, `workflow`,
  `goal`), hook capabilities and `agentVersion`. `initialize` answered in 251–254 ms; the idle tree held
  256–263 MB RSS.
- xAI extensions upstream handles: `x.ai/ask_user_question` and `x.ai/exit_plan_mode`, each also under a `_`
  prefix (`Layers/GrokAdapter.ts:1045,1104`); the `_x.ai/session/prompt_complete` notification settles a prompt
  whose RPC response is late (`acp/XAiAcpExtension.ts:429-438`); background shell and monitor tasks become
  `task.*` events (`acp/XAiBackgroundTasks.ts`).
- Headless alternatives exist and are not what upstream uses: `grok -p … --output-format streaming-json` (one ACP
  session update per line) or `streaming-messages-json` (Anthropic Messages wire format).

## Approvals and permissions

Same ACP bridge as Cursor: `session/request_permission` → `request.opened` → `optionId` or `cancelled`. The
initialize response advertises blocking hook decisions (`deny`, `block`) on `pre_tool_use`, `stop` and
`subagent_stop`; upstream does not use them.

## Sessions and resume

- Resume cursor carries the ACP session id (`Layers/GrokAdapter.ts:989-1010`). Upstream resumes with
  `session/load` even though Grok advertises `session/resume`, so it pays for the history replay.
- The CLI has its own resume (`grok --resume <id>`, `--fork-session`, `--session-id` for a new UUID), which is what
  an "Open in terminal" action would run.
- Rollback refused: "Grok ACP sessions do not support provider-side rollback yet" (`Layers/GrokAdapter.ts:2141-2154`).
  Capabilities `{ sessionModelSwitch: "in-session", supportsConversationRollback: false }` (`:2190`). Steering
  sends `session/cancel` and then the new prompt, serialized (`:158-166,1534-1560`).

## Models and auth

- `grok models` prints login state and the model list without starting an agent; upstream parses its text
  (`Layers/GrokProvider.ts:243-287,460`). Here it printed "You are not authenticated." and the two models.
- Auth: `XAI_API_KEY` in the environment → ACP auth method `xai.api_key`; otherwise upstream sends
  `cached_token` (`acp/GrokAcpSupport.ts:14-18,63-67`). Grok 1.0.41 advertises only `grok.com` in `authMethods`,
  so upstream's `cached_token` is not in the list this version returns. A port should pick the method from the
  `initialize` response, and a logged-in smoke test has to confirm which one succeeds.
- `grok login` / `grok logout` are the CLI's own. Everything lives under `GROK_HOME`, so a second account is a
  second `GROK_HOME` in the instance environment. Upstream sets `GROK_OAUTH2_REFERRER=t3code` on every spawn
  (`acp/GrokAcpSupport.ts:57-60`).

## On our layer

Shared ACP client plus: the four `x.ai` handlers, background tasks mapped to our `task.*` events, the
`prompt_complete` fallback, `grok models` parsing for status, and auth method selection from `initialize`.
`XAI_API_KEY` is a secret: it goes to the secret store and is injected at spawn, never into
`providers.instances.environment`. Upstream's Grok-only files: `GrokAdapter.ts` 2206 lines, `GrokProvider.ts`
579, `GrokDriver.ts` 223, `acp/XAi*.ts` and `acp/GrokAcpSupport.ts` about 1030.
