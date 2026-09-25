# 145 · Hooks: what ran and what it returned

- Status: Steps 1–3 DONE 2026-09-25 (lane L3); step 4 ships with mcp-status's session section.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

When a hook runs in a session, the turn shows it: which hook, for which event, and its outcome.
A blocking or failing hook shows its output, so "the agent refused to edit" has a visible cause.
For Codex, the session can also list the hooks configured for its checkout.

## What exists today

- Claude: the adapter maps `hook_started`, `hook_progress` and `hook_response` to `hook.started`,
  `hook.progress` and `hook.completed` (`claude.ts` `handleSystemMessage`). `claudeQueryOptions`
  does not set `includeHookEvents`, so only SessionStart and Setup hooks are reported.
- Codex: the adapter maps `hook/started` and `hook/completed` to the same events (`codex.ts`
  ~1110, ~1337).
- Ingestion drops them: `activitiesForRuntimeEvent` in
  `orchestration/provider-runtime-ingestion.ts` has no `hook.*` case and returns `[]` by default.

## Harness support

- Claude (verified, `sdk.d.ts`): `includeHookEvents?: boolean` — "When true, `hook_started`,
  `hook_progress`, and `hook_response` system messages will be emitted for all hook event types
  … SessionStart and Setup hook events are always emitted". No SDK call lists configured hooks.
- Codex (verified in installed 0.156.1; absent from our pinned schema): `hooks/list` with `cwds`.

## Decisions

- **D1 — Which runs are shown.** Decided 2026-09-25: recommendation (completion wave). Recommended: a hook that blocked, failed or produced output gets
  a timeline row; a silent success is counted on the turn, not listed. PreToolUse hooks fire on
  every tool call, and one row each would bury the conversation.
- **D2 — Configured-hook list.** Decided 2026-09-25: recommendation (completion wave). Recommended: Codex only, from `hooks/list`. For Claude, say that
  hooks are configured in its settings files; do not parse those files ourselves.

## Steps

1. Set `includeHookEvents: true` in `claudeQueryOptions`. Measure the event volume on a normal
   turn in the wide event first (`bun run logs`), and keep D1's filtering server-side.
2. Ingestion: add `hook.started` / `hook.completed` cases producing a `hook` activity for D1's
   rows, and a per-turn hook count.
3. Web: render the hook row in the work log with its output collapsed; add the count to the turn
   summary.
4. Codex schema refresh (see the index) with `hooks/list`; a query for the session's checkout,
   shown in the session's details.

## Landed (steps 1–3)

- `includeHookEvents: true` in `claudeQueryOptions`. Claude reports a block as `outcome: 'error'`
  with `exit_code: 2` and repeats stderr inside `output` (measured live); the adapter maps exit 2
  to `blocked`, and ingestion collapses equal streams.
- Codex hook notifications are `{ run: HookRunSummary }` in 0.157; the adapter used to read flat
  fields, so every Codex hook was `unknown`/`Hook` with a random id. It now parses the generated
  schema and names the hook after its source file.
- Ingestion lists a hook that blocked, failed or produced output (`hook.completed`) and counts the
  silent ones into one `hook.summary` row at turn end; the turn summary adds "Ran N hooks".
- Scenario `claude-hook-rows` (real Haiku, a fixture PreToolUse hook that blocks Bash).

## Verification

- Ingestion tests: a failed PreToolUse hook produces one visible row; ten silent successes produce
  a count and no rows.
- Real run: a project `PreToolUse` hook that exits 2 on `Bash(rm:*)`; ask the agent to delete a
  file; the turn shows the blocking hook and its message.
- `bun run agent:browser look` on that turn.

## Not copied

- A Platform hook runner or plugin system (OpenCode plugins): the harnesses run hooks; we display
  them.
