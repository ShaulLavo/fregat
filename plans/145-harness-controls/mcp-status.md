# 145 · MCP server status and sign-in

- Status: PROPOSED.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

A session shows which MCP servers it has and each one's state: connected, failed (with the
error), needs sign-in, pending or disabled. A failed server can be reconnected and a server that
needs auth can be signed in, from the session.

## What exists today

- Sessions do load the user's MCP servers: `claudeQueryOptions` passes
  `settingSources: ['user', 'project', 'local']`. Only the health probe neutralises MCP
  (`claudeProbeOptions` in `claude.ts`: `mcpServers: {}`, `strictMcpConfig: true`,
  `ENABLE_CLAUDEAI_MCP_SERVERS: 'false'`).
- Codex emits `mcp.status.updated` and `mcp.oauth.completed` (`codex.ts` ~1385–1399, from
  `mcpServer/startupStatus/updated` and `mcpServer/oauthLogin/completed`). Ingestion turns a
  failed status or a failed sign-in into a `runtime.warning` row
  (`orchestration/provider-runtime-ingestion.ts`, `mcpStatusActivity`,
  `mcpOauthCompletedActivity`); successful updates are quiet (`QUIET_ACTIVITY_KINDS` in
  `apps/web/src/features/chat/utils/activity-visibility.ts`).
- Claude emits no MCP status event. Its `init` message carries `mcp_servers: { name, status }[]`,
  forwarded whole as `runtime.configured` (`handleInitMessage`, `claude.ts`), which nothing reads
  for MCP.
- There is no list, no reconnect and no sign-in action.

## Harness support

- Claude (verified, `sdk.d.ts`): `mcpServerStatus()` returns `name`, `status`
  (`connected | failed | needs-auth | pending | disabled`), `serverInfo`, `error`, `config`;
  `reconnectMcpServer(name)`; `toggleMcpServer(name, enabled)`. The 0.3.269 types have no MCP
  sign-in call, so a Claude `needs-auth` server shows its state and a `fix` telling the user to
  sign in with `/mcp` in Claude Code. Re-check after an SDK bump.
- Codex (verified in installed 0.156.1; absent from our pinned schema): `mcpServerStatus/list`
  (`threadId`, paging), `mcpServer/oauth/login` (`name`, `threadId`, `scopes`),
  `config/mcpServer/reload`.

## Decisions

- **D1 — Where it lives.** Recommended: a per-session MCP section reached from the session header,
  rendered with `ListRow`; failures keep their existing timeline warning.
- **D2 — Toggle.** Recommended: reconnect and sign-in only. Enabling or disabling a server edits
  the user's harness config and belongs with a config plan, not a status view.

## Steps

1. Codex schema refresh (see the index), adding the three methods.
2. Adapter query `mcpStatus(sessionId)` behind a capability flag; Claude calls `mcpServerStatus()`
   on the live query, Codex calls `mcpServerStatus/list`. Normalise to one contract type.
3. Adapter mutations `reconnectMcpServer` (Claude `reconnectMcpServer`; Codex
   `config/mcpServer/reload`) and `signInMcpServer` (Codex `mcpServer/oauth/login` only).
4. Invalidate the status query on `mcp.status.updated`, `mcp.oauth.completed` and on the
   mutations' settle.
5. Web section with pending (`LoadingState`) before empty, an `EmptyState` only for "no servers".

## Verification

- Server tests with a fake live query returning each status, and the Codex test client.
- Real run: configure a stdio MCP server with a wrong command; the section shows it failed with the
  error; fix the config, reconnect, it shows connected.
- `bun run agent:browser look` on the section for both providers.

## Not copied

- An MCP gallery or registry (VS Code `contrib/mcp`): servers come from the user's harness config.
