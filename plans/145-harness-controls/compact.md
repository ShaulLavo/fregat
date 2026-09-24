# 145 · Manual compaction (pointer)

- Status: POINTER — owned by Plan 126, not executed here.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Owner

Manual compaction is already planned as one chain in Plan 126:

- `plans/126-t3code-alignment/runtime.md` **RUNTIME-05** — the runtime operation, busy rejection
  and ordered follow-ups (ledger: wave 4, open).
- `plans/126-t3code-alignment/interaction.md` **INTERACTION-06** — the composer control that keeps
  the draft (ledger: wave 4, open).

Execute it there. This file exists so the harness-controls index is complete, and records only
what the 2026-09-24 survey adds.

## What the survey adds

- Codex: `thread/compact/start` (`threadId`) is in the installed `codex-cli 0.156.1` schema but not
  in our pinned one; RUNTIME-05 needs the Codex schema refresh described in the Plan 145 index.
- Automatic compaction is already rendered: Claude `compact_boundary` becomes
  `conversation.state.changed` with `state: 'compacted'` (`claude.ts` `handleSystemMessage`), and
  Codex `thread/compacted` is handled in `codex.ts`.
- Claude has no compaction call in the SDK types. Whether `/compact` sent as a prompt compacts a
  Claude session is unverified. Check before RUNTIME-05 designs the Claude half:
  1. Confirm `compact` is in the probed command catalog (`claudeSlashCommands` in `claude.ts`).
  2. Send `/compact` in a live Claude session.
  3. In `bun run logs`, look for the `compact_boundary` notification and a
     `conversation.state.changed` event with `state: 'compacted'` for that session.

## Not copied

- Sending a literal `/compact` string to a provider that does not treat it as a command
  (INTERACTION-06 already warns against this).
