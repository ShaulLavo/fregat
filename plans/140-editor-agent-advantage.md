# Plan 140: The editor is the agent's advantage

## Status and authorization

- Status: RESEARCH PLAN — scope agreed by the owner 2026-09-24; the research phase rewrites
  "Phases" before implementation. Diagnostics feedback may move under plans 087/088 once the
  research settles its route.
- Priority: P1. A terminal agent cannot see the editor; Platform is the editor.
- Effort: M for the editor-to-chat half, L with diagnostics feedback. Risk: LOW for the first
  half, MED for anything that changes what agents receive.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (VS Code
  chat attachments, Void, OpenCode, Crush, Serena, NeuralInverse).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

From the editor the user sends a selection, the active file or a diagnostic to the chat in one
action, and it lands in the composer of the right workspace. After the agent edits a file, it
sees the errors that edit caused and fixes them without being told. Agents prefer Platform's
symbol tools over grep once those tools exist.

## What exists today

- `apps/web/src/features/chat/hooks/use-attach-to-composer.ts` is the one capture action
  (`attachText`, `attachTerminalContext`, `attachTextToNewChat`). Its callers are
  `features/git/components/diff-line-comment-action.tsx`, `features/git/components/failure-notice.tsx`
  and `features/terminal/hooks/use-menu.ts`. The editor and workbench have none.
- Those callers are cross-feature imports frozen in `scripts/lint/web-feature-allow.json`
  (the `use-attach-to-composer.ts` entries say "move this shared behavior").
- Composer inbox text entries carry no environment or root; `docs/diagnostic-ai-fix-plan.md`
  step 4 records the cross-workspace risk.
- "Fix with AI" is fully specified in `docs/diagnostic-ai-fix-plan.md` (proposed, not
  implemented): hover, diagnostic popup and Problems (`features/workbench/components/diagnostics-panel.tsx`)
  entry points, one formatter, unsaved-content and stale-range rules.
- Agents receive no diagnostics from Platform. Plan 087 (`plans/087-stateless-mcp.md`) exposes
  Platform tools over MCP; plan 088 (`plans/088-native-code-intelligence.md`, section C3) adds
  revision-aware diagnostics. Both are proposed, not started.
- The Claude SDK accepts `hooks` (`@anthropic-ai/claude-agent-sdk` `sdk.d.ts`, `Options.hooks`);
  the Claude adapter passes none.
- Scenarios to extend: `editor-diagnostics-lifecycle`, `problems-panel-rows`,
  `chat-composer-insert` (`scripts/agent/scenarios/`).

## What the references do

| Reference     | Feature                                                          | Paths                                                                                                   |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| VS Code       | Implicit active-file context, context picker (symbols, problems) | `src/vs/workbench/contrib/chat/browser/attachments/chatImplicitContext.ts`, `chatContextPickService.ts` |
| Void          | Selection helper that sends to chat                              | `src/vs/workbench/contrib/void/browser/voidSelectionHelperWidget.ts`                                    |
| OpenCode      | Edit tool returns the file's LSP diagnostics                     | `packages/opencode/src/tool/edit.ts` (≈ line 198)                                                       |
| Crush         | Diagnostics tool for the agent                                   | `internal/agent/tools/diagnostics.go`                                                                   |
| Void          | Lint errors included in tool results                             | `src/vs/workbench/contrib/void/browser/toolsService.ts` (`includeToolLintErrors`)                       |
| NeuralInverse | Validation after agent edits                                     | `src/vs/workbench/contrib/void/browser/shadowValidationService.ts`                                      |
| Serena        | PreToolUse hooks that nudge from grep and reads to symbol tools  | `src/serena/hooks.py` (`PreToolUseRemindAboutSymbolicToolsHook`)                                        |

## Scope

1. Move `useAttachToComposer` to a shared home and give inbox entries an environment and root.
2. Editor: "Add selection to chat" and "Add file to chat" (command, context menu, keybinding).
3. Active file as an optional context chip in the composer.
4. "Fix with AI" on diagnostics, delivered as `docs/diagnostic-ai-fix-plan.md` specifies.
5. Diagnostics fed back to the agent after it edits a file.
6. Hook-based steering toward Platform's symbol tools, once plan 088's tools exist.
7. Cross-reference only: quoting assistant text into the next prompt is Plan 126 INTERACTION-09
   (`plans/126-t3code-alignment/interaction.md`); this plan does not duplicate it.

## Decisions

- **D1 — Active file: implicit or explicit.** Recommended: a chip the user can see and remove,
  off until they turn it on in a setting. VS Code attaches it implicitly; silent context is hard
  to audit.
- **D2 — Route for diagnostics feedback.** Recommended: decide after research question 3. If the
  harnesses' own IDE integration can carry diagnostics, use it; otherwise wait for plans 087/088.
  Research question 3 runs now (decided 2026-09-25: owner).
- **D3 — Steering strength.** Recommended: add context to the tool call, never deny it. Serena's
  hard deny after N greps breaks legitimate text search.

## Research phase

Decided 2026-09-25: owner — research questions 3–5 are approved to run now. They need no Plan 087;
a yes on the `/ide` route in question 3 removes Phase 4's dependency on 087 (D2).

1. Shared home for the attach action: `lib/` (two-consumer rule is met by git, terminal and
   editor) or the app composition layer, per the diagnostic plan's provider design.
2. Editor seams: where the editor exposes the current selection and document identity to a
   command, and how `keymap/` registers "add to chat" with a `when` clause.
3. Harness IDE integration: Claude Code and Codex both have an `/ide` command. Find how an IDE
   registers with each and what it can supply (selection, open files, diagnostics). If Platform
   can speak those protocols, scopes 2–5 may reach the agent without plan 087.
4. Feedback timing: after which event is a diagnostic "caused by this edit" — the tool result,
   the next checkpoint, or a settle delay after the language server republishes? Measure on the
   TypeScript server with a real edit.
5. Hooks: which SDK hook events Claude exposes in-process (`Options.hooks`), whether Codex has an
   equivalent, and what a PreToolUse reminder costs per call.

Deliverable: rewritten Phases with named files and mutation keys; a statement of which scopes
move under plans 087/088; settings (if any) with scopes — a value that changes what reaches the
agent is `application` or `machine`, never `window`.

## Phases (provisional)

1. Shared attach action with workspace identity (also unblocks plan 139 phase 1).
2. Editor selection and file to chat; active-file chip.
3. Fix with AI, per `docs/diagnostic-ai-fix-plan.md`.
4. Diagnostics feedback, by the route D2 picks.
5. Symbol-tool steering hooks, after plan 088.

## Verification

- `bun run agent:browser look` on the editor context menu, the composer chip and each Fix with
  AI entry point; extend `chat-composer-insert` and `problems-panel-rows`, and add an
  editor-to-chat scenario with a second workspace open.
- Feedback: a server test on a real temp workspace where an edit introduces a type error and the
  agent's next input carries it.
- Logs: one event per attach (source, destination identity, text length); no source text or
  diagnostic messages in logs.

## Out of scope and not copied

- Inline chat (Cmd+I) and next-edit suggestions: separate plans if wanted; they need a
  low-latency model path the CLI agents do not give.
- An LLM-judged risk score on tool calls.
- Denying grep outright (Serena): nudge, do not block.
- Auto-approving tools because they are marked read-only: plan 087 already rules this out.
