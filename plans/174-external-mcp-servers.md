# Plan 174: Managed external MCP servers

Status: **RESEARCH DONE 2026-09-26 — no second MCP manager: both harnesses already list, add,
remove, toggle, reconnect and sign in; Platform adds a richer status view, a machine-level MCP
page that writes each harness's own config, per-session off switches, a trust gate for Claude
project servers, and sign-in from any device.** Unscheduled. Split out of
[Plan 087](087-stateless-mcp.md) on 2026-09-26 (087 keeps our own tool endpoint).

## Question

Plan 087's former M2 (a Platform-owned MCP client: definitions as settings, import, process
lifecycle, OAuth, catalog) and M3 (external tools in chat through a Platform gateway) would
duplicate what Claude Code and Codex already do. What does Platform add on top, and does any of
it need a second MCP manager?

**Answer: no.** Every capability below is reachable through the harness's own SDK, app-server
API or CLI. The one thing a Platform-owned client would add, a gateway that both providers call,
duplicates each harness's own approval flow, tool search and OAuth store, and the harnesses would
still run their own servers beside it. The gaps are all presentation, trust, and reach (sign-in
from a phone), which Platform fills by driving the harness.

## Research method

Read at Platform `c130dd35a`. Sources: Claude Agent SDK 0.3.281 `sdk.d.ts` (Platform's lock),
Claude Code CLI 2.1.282, Codex CLI 0.157.0 and `references/codex` at `e72da2b5` (pulled
2026-09-26; the MCP methods below are identical at `rust-v0.157.0`), `references/t3code`
`295d7cba`, `references/opencode` `696f41b`, and what Plan 145 shipped (`e92e76b64`).

Probes ran against throwaway config homes only (`CLAUDE_CONFIG_DIR` and `CODEX_HOME`/`HOME`
under `/work/tmp/research2/174/`), with a 20-line stdio fixture server, a missing binary, and
unreachable HTTP servers. No model turn ran; Claude got an invalid API key. The scripts are
`claude/probe*.mjs` and `codex/probe*.mjs` there (disposable).

## What each harness exposes

| Capability                  | Claude (SDK 0.3.281 / CLI 2.1.282)                                                                                                                                                                                                                                    | Codex (app-server 0.157.0)                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where definitions live      | `$CLAUDE_CONFIG_DIR/.claude.json` (`user`; `projects[cwd].mcpServers` = `local`), checkout `.mcp.json` (`project`), plugins, claude.ai connectors, managed policy                                                                                                     | `$CODEX_HOME/config.toml` `[mcp_servers.*]`, project `.codex/config.toml` (trusted projects only), plugins, managed requirements                                                                                                              |
| Status, live session        | `query.mcpServerStatus()`: name, status (`connected/failed/needs-auth/pending/disabled`), error, `scope`/`source`, `serverInfo`, `config`, tool list with annotations. No push stream                                                                                 | `mcpServerStatus/list {threadId}`: runtime status, auth status, tools, resources, templates, `httpOrigin`, `toolsError`; push `mcpServer/startupStatus/updated`                                                                               |
| Status, no session          | CLI `claude mcp list` (health-checks every server, 0.6 s with 5 fixture servers); or a never-yielding `query()` probe, first `mcpServerStatus()` 386 ms, later calls 7 ms                                                                                             | `mcpServerStatus/list` without `threadId` (starts the servers to list tools); `config/read {cwd, includeLayers}` gives values plus the source file per key, spawns nothing                                                                    |
| Add / edit, persistent      | CLI `claude mcp add-json -s user\|local\|project <name> <json>`; `add-from-claude-desktop`. SDK has no persistent writer (`updateSettings` allows only `outputStyle`/`effortLevel`)                                                                                   | `config/batchWrite` / `config/value/write` to `config.toml` (or a given file), optimistic `expectedVersion` (`configVersionConflict` on a stale write), `reloadUserConfig`                                                                    |
| Remove                      | CLI `claude mcp remove -s <scope> <name>`                                                                                                                                                                                                                             | `config/batchWrite` with `value: null` deletes the table (measured)                                                                                                                                                                           |
| Add for one session only    | `Options.mcpServers` at start, `query.setMcpServers()` live (scope `dynamic`; replaces a same-named user server, measured)                                                                                                                                            | `thread/start\|resume\|fork` `config.mcp_servers.<name>` (not persisted; must be re-sent on every resume, Plan 087 M0)                                                                                                                        |
| Turn off, persistent        | `query.toggleMcpServer(name, false)` writes `projects[cwd].disabledMcpServers` in `.claude.json`: **per checkout**, seen by later sessions and the CLI in that cwd, not elsewhere (measured)                                                                          | `mcp_servers.<name>.enabled = false` in `config.toml` (global) or a trusted project's `.codex/config.toml`                                                                                                                                    |
| Turn off, this session only | Flag settings at start: `settings.deniedMcpServers` (any scope) and `settings.disabledMcpjsonServers` (project) remove the server from the session. Applying them live with `applyFlagSettings` does **not** disconnect a connected server (measured); a restart does | `thread/start` `config.mcp_servers.<name>.enabled = false` → `disabled` for that thread only; a second thread in the same app-server stays `connected` (measured)                                                                             |
| Reconnect                   | `query.reconnectMcpServer(name)`                                                                                                                                                                                                                                      | `config/mcpServer/reload` (reloads every server)                                                                                                                                                                                              |
| OAuth sign-in               | CLI `claude mcp login [--no-browser] <name>` (prints the URL and reads the pasted redirect URL); `logout`. No SDK control request. Tokens stay in the harness credential store                                                                                        | `mcpServer/oauth/login {name, threadId?}` → `authorizationUrl`, completion as `mcpServer/oauthLogin/completed`. Streamable HTTP only (stdio → `-32600`, measured). Redirect is `http://127.0.0.1:<port>/callback` on the app-server's machine |
| Import                      | `add-from-claude-desktop` (Mac/WSL)                                                                                                                                                                                                                                   | `externalAgentConfig/detect\|import` detects Claude's user `.claude.json` and project `.mcp.json` servers and migrates them into `config.toml` (measured)                                                                                     |
| Call a tool without a turn  | control request `mcp_call`                                                                                                                                                                                                                                            | `mcpServer/tool/call`                                                                                                                                                                                                                         |

Upstream products: **t3code** manages no external servers. It injects its own `t3-code` endpoint
per session and turns Codex status and OAuth notifications into activity rows, the same thing
Platform does today. **opencode** is itself the harness, so it owns an MCP client. Its app lists
servers with a per-server on/off toggle (`/mcp`, runtime connect/disconnect), and its server has
an OAuth `authCallback` endpoint that takes the authorization code from the client. That is the
shape of the phone-safe sign-in below. Server definitions still come from its config file and CLI.

## What Platform does today

Plan 145 shipped a per-session header popover (`features/chat/components/session-mcp-list.tsx`,
`mcp-server-row.tsx`) over `GET /providers/sessions/:id/mcp`, plus reconnect and Codex sign-in
(`apps/server/src/provider/session-control-routes.ts`, `provider-service.ts:853`). It maps each
server to `{name, status, error}` (`packages/contracts/src/provider.ts:250`). Nothing else exists.

## Findings that shape the build

1. **Claude SDK sessions start unapproved project servers.** A checkout `.mcp.json` stdio server
   that `claude mcp list` shows as "Pending approval" was `connected` in an SDK `query()` from the
   same cwd, with `hasTrustDialogAccepted: false` and `enabledMcpjsonServers: []` (probe 3). So
   opening a cloned repository in Platform and starting a Claude chat runs the commands in its
   `.mcp.json`. Codex ignores an untrusted project's `.codex/config.toml` (its `projfix` never
   appeared), and `enableAllProjectMcpServers: false` does not stop Claude either (probe 4).
   `settings.disabledMcpjsonServers: [names]` does. This is a live exposure, not a missing feature.
2. **Claude MCP failures never reach the chat.** Codex failures arrive as
   `mcpServer/startupStatus/updated` and become a warning row
   (`provider-runtime-ingestion.ts:1294`). Claude has no status stream. Its `init` message is
   forwarded only as `runtime.configured` (`claude.ts:1459`), so a failed or signed-out Claude
   server is visible only if the user opens the popover.
3. **The popover discards most of what both harnesses report.** It drops scope/source (which file
   the server came from), transport, tool list and auth state. Claude's `config` also carries
   headers and env, so anything beyond the name must be redacted before it reaches the web.
4. **Claude needs-auth rows have no action.** The row says to run `/mcp` in Claude Code. The CLI's
   `claude mcp login --no-browser` prints the URL and reads the pasted redirect URL, so Platform
   can drive it. Not verified end to end: it needs an OAuth-protected fixture server.
5. **Codex sign-in only works in a browser on the server machine.** The redirect goes to
   `127.0.0.1:<port>` on the machine running the app-server. From the phone through the mesh, the
   redirect lands on the phone's own loopback and fails. The app-server has no method to accept a
   pasted callback, but the Platform server can replay the pasted callback URL against its own
   loopback.
6. **Turning a server off means different things.** Claude's native toggle persists per checkout.
   Claude's per-session switch works only at CLI start. Codex's per-thread switch must be re-sent
   on every resume and fork, which Plan 087 already has to do for its own endpoint. Claude user
   servers have no global "off" short of removal (`deniedMcpServers` works, but Claude then
   reports "blocked by enterprise managed policy", the wrong words for a user's own choice).
7. **Everything is per provider instance and per machine.** Claude reads `CLAUDE_CONFIG_DIR` and
   Codex reads `CODEX_HOME` per instance (`provider/drivers/*.ts`), and a federated machine has
   its own. A management page is scoped by environment and instance, like the provider section.
8. **Name clashes.** A dynamic Claude server replaces a same-named user server, and a Codex
   per-thread override merges into a same-named `config.toml` entry (Plan 087 hazard 1). The name
   `platform` stays reserved for Plan 087's endpoint. The add form refuses it.

## Decisions

- Decided 2026-09-26: research recommendation — **the harness config is the only store.**
  Platform keeps no MCP server list of its own and registers no settings key per server. Server
  definitions are harness data (Plan 145's principle), and a copy would drift from what
  `claude mcp` and `codex mcp` edit.
- Decided 2026-09-26: research recommendation — **writes go through the harness's own writer**:
  `claude mcp add-json|remove -s <scope>` run with the instance's environment, and Codex
  `config/batchWrite` with `expectedVersion`, followed by `config/mcpServer/reload`. Platform never
  edits `.claude.json` or `config.toml` text itself. The Claude trust gate may write
  `enabledMcpjsonServers` into the checkout's `.claude/settings.local.json`, a documented
  settings key in a file Claude itself treats as local.
- Decided 2026-09-26: research recommendation — **secrets stay where the harness keeps them.**
  Header and env values go into the harness file as typed, as `claude mcp add -H` does. The UI
  masks them, and status never forwards `config.headers`/`config.env` to the web. Secret-store
  references (Codex `bearer_token_env_var`, Claude `${VAR}` expansion fed from the instance
  environment) are a follow-up once someone needs them.
- Decided 2026-09-26: research recommendation — **"off for this session"** is Codex per-thread
  `config.mcp_servers.<name>.enabled = false`, and Claude flag settings at CLI start
  (`deniedMcpServers` for user/local/dynamic, `disabledMcpjsonServers` for project). A change
  applies at the next CLI start, and Platform restarts an idle Claude CLI at once. Claude's
  per-checkout `toggleMcpServer` is offered as a separate "Off in this checkout" action, because
  that is what it does.
- Decided 2026-09-26: research recommendation — **copy between harnesses** is one translation in
  both directions (stdio command/args/env, HTTP url/headers), written through each writer. Codex's
  `externalAgentConfig/import` is not used: it migrates whole sets and also moves hooks, skills
  and agents.

## Proposed phases

Each phase ships and deploys on its own; phases 1, 3, 5 and 6 change the server
(`bun run deploy --server`).

1. **Status that says where and why (S–M).** Extend `providerMcpServerSchema` with `source`
   (open string: `user/project/local/dynamic/plugin/claudeai/managed/…`), `transport`
   (`stdio | http | sse | sdk`), `origin` (HTTP origin only), `tools` (names), `auth`
   (`unsupported | signed-in | signed-out | unknown`). No config values. Claude: after `init` and
   at each turn end, read `mcpServerStatus()` and emit `mcp.status.updated` when a server moves
   to `failed` or `needs-auth`, so Claude failures get the same warning row as Codex. Files:
   `packages/contracts/src/provider.ts`, `provider/adapters/claude.ts`, `codex.ts`,
   `features/chat/components/mcp-server-row.tsx`, `utils/mcp-status.ts`; scenario
   `claude-session-tools` asserts the failure row.
2. **Trust gate for Claude project servers (M, blocked on Q2).** At Claude CLI start, read the
   checkout's `.mcp.json` names and Claude's approval (`enableAllProjectMcpServers`,
   `enabledMcpjsonServers` in the user, project and local settings files). Unapproved names go
   into `settings.disabledMcpjsonServers`, and the popover lists them as "Not approved" with
   Approve, which writes `enabledMcpjsonServers` to `.claude/settings.local.json` and restarts
   the idle CLI. Files: `provider/adapters/utils/claude-query-options.ts`, a new
   `provider/adapters/utils/claude-project-mcp.ts`, chat popover. Scenario: a fixture repository
   whose project server stays off until approved.
3. **MCP servers settings page (M).** A Settings › MCP servers page per machine and provider
   instance: rows grouped by source, with status, tools, auth and the file each row lives in.
   Server: `GET /providers/instances/:id/mcp` reads through a probe process (the Claude
   capability probe's never-yielding `query()` plus `mcpServerStatus()`; Codex `config/read` for
   origins plus `mcpServerStatus/list` without a thread), cached as a TanStack query with a
   staleTime. Row actions: reconnect, sign in (Codex now, Claude after phase 6), remove. Files: new
   `apps/server/src/provider/mcp-config-routes.ts` and `provider-service.ts` methods,
   `features/settings/components/mcp-section.tsx` + rows, `utils/query-keys.ts`/`mutation-keys.ts`.
4. **Add and copy (M).** An add/edit dialog (stdio: command, arguments, environment; HTTP: URL,
   headers) with targets Claude user/local/project and Codex user. Writes go through
   `claude mcp add-json` and `config/batchWrite`, then running Codex sessions get
   `config/mcpServer/reload` and Claude rows say "Applies to new sessions". "Also add to Codex /
   Claude" on a row copies it through the same translation. Refuses `platform` and names already
   used in the target. Scenario: add in both, see both connected in a new session, remove.
5. **Off for this session (M).** A popover switch per server. Stored on the session projection
   (migration) as a list of names, re-sent on every Codex start/resume/fork (the same `config`
   path as Plan 087's endpoint) and as Claude flag settings at CLI start. The switch's
   description names the checkout-wide alternative. Files: orchestration session projection,
   `provider-command-reactor.ts`, both adapters, popover. Scenarios per provider.
6. **Sign in from any device (M, blocked on Q3).** Claude: run `claude mcp login --no-browser
<name>` with the instance environment, show its URL as "Open sign-in page", then take the
   final page address the user pastes and write it to the CLI's stdin. Codex: the same paste
   field. The server replays the pasted URL only when its host is loopback and its port and
   `state` match the pending `mcpServer/oauth/login`. On the server machine's own browser, both
   complete without pasting. First step: an OAuth-protected fixture server to verify the Claude
   `--no-browser` exchange.

## Owner questions

1. **Scope of this plan.** (a) Harness-backed only: phases 1–6, no Platform MCP client; (b) also
   build 087's old M2/M3, a Platform-owned client and gateway that both providers call;
   (c) status only, phases 1–2, and users edit config with the CLIs.
   **Recommendation: (a).** Every listed capability exists in both harnesses, and a gateway would
   duplicate their approval, tool search and OAuth stores.
   Decided 2026-09-26: owner — (a).
2. **Claude project servers in untrusted checkouts.** Platform's Claude sessions run a
   repository's `.mcp.json` commands without the approval the CLI asks for. (a) Gate them:
   unapproved project servers stay off until approved in Platform (phase 2); (b) keep running
   them and show their source; (c) never load project servers in Claude sessions.
   **Recommendation: (a).** It matches the CLI's own rule and Codex's trusted-project rule, and
   costs one click per repository.
   Decided 2026-09-26: owner — (a). A live security gap: phase 2 runs first in the next wave.
3. **Sign-in from the phone.** (a) Build the paste-back sign-in for both harnesses (phase 6);
   (b) sign in only from a browser on the server machine, as today, with the row saying so.
   **Recommendation: (a).** The mesh is the daily surface, and today's Codex sign-in fails from
   any other device.
   Decided 2026-09-26: owner — (a).
