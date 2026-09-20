# Running-chat follow-ups and Codex resume

Two differences from local t3code caused the reported failures.

`references/t3code/apps/server/src/orchestration/Layers/ProjectionPipeline.ts` keeps an assistant message completion from settling a turn whose runtime is still running. Platform's `updateAssistantTurn` instead marked the turn completed after commentary, while its runtime and provider-start state stayed running/adopted. The composer offered a correction, and the server rejected it. Production events show commentary completing at 19:08:19 UTC, the rejection at 19:09:42, and the actual provider turn finishing at 19:12:22. The projection now follows the reference and also preserves turns waiting for input.

`openCodexThread` in the reference's `CodexSessionRuntime.ts` requests `excludeTurns: true` and decodes only resume metadata. Platform's nominally raw request still invoked the generated full-response validator, rejecting unrelated history items. Resume now requests no history and validates cwd, model, and thread identity. The regression deliberately returns an unfamiliar historical item despite `excludeTurns`; malformed identity still fails.

## Evidence

- Before, mesh: `/work/tmp/fregat-evidence/20260919T192422Z-scenario-chat-follow-up/`. The inspected `02-follow-up-sent.png` shows Working alongside the exact command rejection and the retained draft.
- After, development: `/work/tmp/fregat-evidence/20260919T192524Z-scenario-chat-follow-up/`. A correction during the running turn and a subsequent completed-turn message both receive replies.
- After, mesh, including runtime closure and resume: `/work/tmp/fregat-evidence/20260919T192749Z-scenario-chat-follow-up/`. The inspected final screenshot shows the resumed reply. Durable events retain provider thread `01a0bb23-b152-7e50-9e9d-4b23a0000361` across two different runtime epochs, proving the follow-up resumed the same conversation. No page errors, failing HTTP responses, or loopback requests were recorded. GPU warnings were present. The CLI's appended log window reads the development log even when targeting mesh; its two workspace connectivity warnings are not mesh chat failures.

The reusable `chat-follow-up` scenario creates its own session and closes only that session's runtime. Its final run, `/work/tmp/fregat-evidence/20260919T192913Z-scenario-chat-follow-up/`, passed all five steps and waits for the final turn to settle before taking the last screenshot, which was inspected. Its appended log window contains no warnings or errors.

## Checks and deployment

55 focused adapter, steering, latest-turn, and session-projection tests passed. Server typecheck, changed-file lint and formatting, and diff whitespace checks passed. The scripts-wide typecheck remains blocked by unrelated DOM typing errors in existing editor, theme, and terminal scenarios; it reported none in the new chat scenario.

`bun run deploy --server --slug=chat-follow-up` built and verified the candidate, restarted the production service, and passed the mesh live check. `/platform/release` confirmed both web and server on `20260919T192636Z-e4ee5f1d-chat-follow-up`.

This repair ports the reference's turn-lifecycle and resume behavior. Platform still uses native `turn/steer` for corrections; t3code sends busy follow-ups through `turn/start`.
