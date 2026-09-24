# 145 · Custom agents: browse and start as one

- Status: PROPOSED.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

The composer lists the agent definitions available to a session (project and user
`.claude/agents`, plugin agents), with their descriptions. A new session can start as one of them,
which applies that agent's prompt, tools and model to the main thread.

## What exists today

- Claude sessions load `settingSources: ['user', 'project', 'local']` (`claudeQueryOptions`), so
  the CLI already knows the definitions and the model can call them as subagents.
- Running child agents render in `apps/web/src/features/chat/components/agents-panel.tsx`.
- Nothing lists the definitions or starts a session as one. The composer's catalogue covers
  `/commands` and `$skills` only (`chat/utils/composer-skills.ts`).
- The Claude `init` message's `agents` list reaches the server inside `runtime.configured` and is
  not read.

## Harness support

- Claude (verified, `sdk.d.ts`): `supportedAgents(): Promise<AgentInfo[]>` with `name`,
  `description`, `model`; the `init` message has `agents?: string[]`; `Options.agent` is "Agent name
  for the main thread … equivalent to the `--agent` CLI flag".
- Codex: the TUI has `/agents` ("open the agent command center") and `/subagents`
  (`codex-rs/tui/src/slash_command.rs`). An app-server method that lists or selects agent
  definitions is not established; verify against `codex app-server generate-json-schema` before
  promising Codex support.

## Decisions

- **D1 — Where the list is read.** Recommended: on the existing command-catalog probe
  (`probeClaudeCommandCatalog` in `claude.ts`, which already runs with the project's `cwd`), add
  `supportedAgents()`. One probe per project, no extra spawn.
- **D2 — Scope of the choice.** Recommended: per session, chosen at start. A remembered default
  agent per project would select a system prompt and tools, so it reaches execution: if it is ever
  added, it is an `application`-scope setting keyed by project, never `window`.

## Steps

1. Extend the command catalog contract with `agents: { name, description, model }[]`, filled from
   `supportedAgents()`; Codex returns an empty list until its support is verified.
2. `ProviderRuntimeStartInput` (`provider/types.ts`) gains an optional `agent`; the Claude adapter passes it as
   `Options.agent`.
3. Composer: an agent picker for a new-session draft, listing names and descriptions; the chosen
   agent shows on the session header.
4. Record the agent in the session's start wide event.

## Verification

- Server test: the catalog probe returns agents from a fake `supportedAgents()`; a start with
  `agent` reaches the query options.
- Real run: a project `.claude/agents/reviewer.md`; it appears in the picker; a session started as
  it follows its prompt (for example, a required first line).
- `bun run agent:browser look` on the picker and the header.

## Not copied

- Programmatic agent definitions written by Platform (`Options.agents`): definitions stay files the
  user owns.
