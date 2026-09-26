# Plan 183: Platform as Claude Code's IDE in its own terminals

Status: **placeholder, low priority.** Split out of [Plan 140](140-editor-agent-advantage.md)
question 1 on 2026-09-26 (owner). Nothing here authorizes implementation.

## Scope

A `claude` process started in a Platform terminal gets the editor selection, diagnostics and diffs,
as it does inside VS Code. Platform writes `~/.claude/ide/<port>.lock` and sets
`CLAUDE_CODE_SSE_PORT` in terminal environments, and serves the IDE protocol on that port. Chat
sessions are out of scope: they get diagnostics through harness hooks (Plan 140 Phase 4).

## Before planning

The lock file lives in the user's shared `~/.claude`, so a crash must not leave a stale lock that a
VS Code window or another Platform server would pick up. Research the protocol from the
Claude Code IDE extension and its lock-file lifecycle first.
