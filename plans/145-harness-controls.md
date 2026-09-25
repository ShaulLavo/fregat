# Plan 145: Surface the controls the harnesses already have

## Status and authorization

- Status: PROPOSED — eight small plans; approval-rules implemented 2026-09-25 (PR #29).
- Priority: P2 overall; approval rules and fork are P1 (see the table).
- Effort: eight S–M plans. Each ships and deploys on its own.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.
- Every plan changes the server except where noted: deploy with `bun run deploy --server`.

## Outcome

Claude Code and Codex already fork conversations, remember approval rules, report MCP servers,
run background tasks, run hooks, load custom agents, compact context and keep full transcripts.
Platform drives both harnesses but shows few of these controls. After this plan each one is
reachable from the app, backed by the harness that owns it.

## Principle

Surface the harness; do not reimplement it. A control reads and writes the harness's own state
through its SDK or app-server API. Platform adds a view, a command and a TanStack mutation, not
a second store. When only one harness supports a control, the control is capability-gated per
provider and the other provider shows a disabled reason; it is never faked.

## Sub-plans

| Plan                                                         | Outcome                                                         | Claude                                             | Codex                                                  | Size | Status            | Depends on                               |
| ------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ---- | ----------------- | ---------------------------------------- |
| approval-rules                                               | "Always allow" writes a real rule; "for this session" holds     | `updatedPermissions` from `canUseTool` suggestions | `acceptWithExecpolicyAmendment` (not in pinned schema) | M    | DONE (`89c58188`) | none (server requests are not generated) |
| [fork](145-harness-controls/fork.md)                         | Fork a session from any turn into a new session                 | `forkSession(id, { upToMessageId })`               | `thread/fork`                                          | M    | PROPOSED          | Codex schema refresh                     |
| [mcp-status](145-harness-controls/mcp-status.md)             | See each MCP server's state; reconnect or sign in               | `mcpServerStatus()`, `reconnectMcpServer()`        | `mcpServerStatus/list`, `mcpServer/oauth/login`        | M    | PROPOSED          | Codex schema refresh                     |
| [background-tasks](145-harness-controls/background-tasks.md) | List a session's background tasks and stop one                  | `background_tasks_changed`, `stopTask(taskId)`     | `thread/backgroundTerminals/*` (experimental API only) | S–M  | PROPOSED          | none                                     |
| [hooks](145-harness-controls/hooks.md)                       | See which hooks ran in a turn and what they returned            | `includeHookEvents`, `hook_*` messages             | `hooks/list`, `hook/started`, `hook/completed`         | S    | PROPOSED          | Codex schema refresh for `hooks/list`    |
| [custom-agents](145-harness-controls/custom-agents.md)       | Browse a project's agent definitions and start a session as one | `supportedAgents()`, `agent` option                | to verify                                              | S–M  | PROPOSED          | none                                     |
| [compact](145-harness-controls/compact.md)                   | Manual compaction (owned by Plan 126)                           | `/compact` path to verify                          | `thread/compact/start`                                 | —    | POINTER           | Plan 126 RUNTIME-05, INTERACTION-06      |
| [export](145-harness-controls/export.md)                     | Export a transcript as Markdown or JSON                         | n/a (Platform projection)                          | n/a (Platform projection)                              | S    | PROPOSED          | none (web-only)                          |

### Codex schema refresh

Done 2026-09-25 (lane L3). The pin is `rust-v0.157.0` (`00c972ed…`), matching the installed
`codex-cli 0.157.0`. `CLIENT_REQUEST_METHODS` now carries `thread/revert` (upstream removed
`thread/rollback`), `thread/fork`, `thread/compact/start`, `hooks/list`, `mcpServerStatus/list`,
`mcpServer/oauth/login` and `config/mcpServer/reload`; the generator reads optional params
(`params?: X | undefined`, published as `Nullable<X>`). Later plans only add their methods.

## Suggested order

1. **approval-rules** — the Claude "Allow for this session" button may not hold for the session
   today (see that plan), and without rules approval-required mode is too tedious to use.
2. **fork** — also gives Claude a conversation rewind it does not have
   (`prepareRollbackSession` throws in `claude.ts`), and is the data-model step toward the
   compare view `docs/product-vision.md` holds in reserve.
3. **mcp-status**, **background-tasks**, **hooks** — read-mostly views over events we already
   receive.
4. **custom-agents**, **export**.
5. **compact** executes as Plan 126 RUNTIME-05 and INTERACTION-06, not here.

## Shared conventions

- Each control is a TanStack mutation (reads are queries) with a key from the owning feature's
  `utils/mutation-keys.ts` / `utils/query-keys.ts`; pending state comes from `useIsMutating`.
- Server operations go through the provider adapter interface (`apps/server/src/provider/types.ts`)
  with a capability flag, so the web can gate the control per provider instance.
- Errors come from a `defineErrorCatalog` entry with a user-facing `fix`; runtime facts go in
  `internal`.
- A new user-facing knob is a registry entry in `packages/contracts/src/settings/keys.ts`.
  Anything that reaches execution (approval rules, agent choice) is `application` or `machine`
  scope, never `window`.
- UI follows the design language: `ListRow`, `ToolPane`, `OrbitLoader`, tokens only, pending
  before empty.
- Verification per plan: the narrowest server test through the adapter's `createQuery` seam or
  the Codex test client, then `bun run agent:browser look` (or a new scenario under
  `scripts/agent/scenarios/`) on the changed surface, `bun run logs` for the wide event, and the
  evidence directory named in the report.

## Not copied

- Public share links (OpenCode `share`): the transcript would sit on a third-party server.
- An LLM judging tool risk, or OpenCode's generated command-arity table: parse against fixed rules
  or let the harness match its own rules.
- Codex experimental APIs beyond background terminals (queue, realtime, goal, memory): they move
  too fast; revisit when stable.
- A Platform-owned hook or plugin layer: the harnesses own hooks; we display them.
