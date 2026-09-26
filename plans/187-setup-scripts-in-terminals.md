# Plan 187: Setup scripts run in visible terminals

## Status and authorization

- Status: PROPOSED 2026-09-26, ready. Follow-up to Plan 126 EXT-04 (lane L9), from the
  2026-09-26 direction audit, item 5.
- Decided 2026-09-26: owner — "Setup scripts (L9, EXT-04): run them in visible terminals like
  T3, not as hidden server children."
- Effort: M. Server change; deploy with `--server`.

## Today

`apps/server/src/orchestration/setup-runner.ts` runs the setup script as `sh -c` in its own
process group, with the server's whole `process.env`, stdout and stderr piped, and keeps the last
40 lines on the worktree's `setup` field. Nobody can watch it, type into it or read more than 40
lines. Record: [repository delivery, EXT-04](126-t3code-alignment/repository-delivery.md#ext-04-project-scripts-and-worktree-setup),
which already notes "upstream runs it in a terminal".

## How T3 Code does it

`references/t3code` at `295d7cba` (2026-09-26):

- `apps/server/src/project/ProjectSetupScriptRunner.ts:340–430` opens a terminal owned by the
  thread (`terminalId` `setup-<scriptId>`, cwd the worktree) through `TerminalManager.open`, with
  `projectScriptRuntimeEnv` (`packages/shared/src/projectScripts.ts:58–71`: `T3CODE_PROJECT_ROOT`,
  `T3CODE_WORKTREE_PATH`) plus `NO_COLOR=1`, `FORCE_COLOR=0`, then types the command into it.
- Completion: `wrapCommandForCompletion` (`:170–190`) wraps the command per shell (posix, fish,
  PowerShell) so it prints a random sentinel with the exit code; `observeTerminalCompletion`
  (`:205–260`) subscribes before the write and reads the sentinel from the output.
- A clean run closes the idle terminal and keeps its history; a failed run keeps the shell open
  (`:417–424`). `WorktreeSetupTracker.ts` and `WorktreeSetupCard.tsx` show the stage and a tail.

## Outcome

The setup script runs in a real terminal of the session's worktree. The user can open it, watch
the full output, type into it and interrupt it with Ctrl+C, and a failed run stays open to look at.
Foreground setup still gates the first turn; stop, retry and the setup card keep working.

## Scope

1. **Run through the terminal service.** Replace the `Bun.spawn` in `setup-runner.ts` with a
   server-opened terminal on the worktree (a fixed id such as `setup`), started before any client
   attaches, as T3 does. It lives in the PTY host (Plan 149), so it survives a server restart and a
   late viewer gets the ring.
2. **Environment.** The environment every terminal gets, plus `PLATFORM_PROJECT_ROOT`,
   `PLATFORM_WORKTREE_PATH`, the two `T3CODE_*` names, `NO_COLOR` and `FORCE_COLOR`. The setup
   runner's own env assembly goes away (see the open question).
3. **Exit code.** Port T3's sentinel wrapper per shell; the exit code drives `setup.state`
   (`running`, `succeeded`, `failed`, `cancelled`), `worktree.SETUP_FAILED` and the turn gate.
4. **Visible and interruptible.** The setup card and the worktree manager open that terminal.
   Ctrl+C in it, or Stop setup, ends the run as `cancelled`. Success closes the idle shell and keeps
   its history; failure keeps it open.
5. **Trust model unchanged.** Only saved scripts run; `t3.json` runs nothing until the user
   imports it (EXT-04's explicit import). The script's command is typed into the terminal exactly
   as saved.
6. Delete the piped-child path and the 40-line tail once the card reads the terminal.

## Open question

1. Terminals today also inherit the server's `process.env` (`terminal/service.ts:105`). Whether
   server-only variables (for example `PLATFORM_HOME`, `NODE_ENV=production`) should be stripped
   from every terminal is a terminal-service question, raised here and decided outside this plan.

## Verification

- `apps/server/src/orchestration/tests/worktree-setup.test.ts` on the terminal path with the
  injected PTY factory: foreground success, failure, cancel by Ctrl+C and by Stop, retry once,
  background beside the first turn; the sentinel under posix and fish.
- `scenario worktree-setup-import` extended: the setup terminal opens from the card, shows the
  output, Ctrl+C cancels, a failure stays open. Screenshots read, evidence directory named.
- `bun run gates`; `bun run deploy --server`.
