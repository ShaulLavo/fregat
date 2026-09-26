# Plan 140: The editor is the agent's advantage

## Status and authorization

- Status: RESEARCH PLAN — scope agreed by the owner 2026-09-24; the research phase rewrites
  "Phases" before implementation. Research questions 3–5 answered 2026-09-25 (research 140, see
  "Research findings"): the `/ide` route does not work for Platform's sessions, and diagnostics
  feedback goes through harness hooks without plan 087. Questions 1–2 are answered on lane L8
  (PR #33).
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
  to audit. Decided 2026-09-25: recommendation (completion wave). Setting `chat.activeFileContext`
  (application scope, off).
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

### Research answers (2026-09-25, lane L8)

1. **Attach home:** a narrow context in `lib/composer-attach` (`ComposerAttach`,
   `useAttachToComposer(rootPath)`), implemented by chat (`features/chat/state/composer-attach.ts`,
   `createComposerAttach(bus)`) and mounted by `providers/composer-attach-provider.tsx`. Commands
   reach the same implementation through `WorkspaceCommandRuntime.composer`.
2. **Editor seams:** no Editor change. A command reads the active tab's view from the document
   store (`getEditorView(tabId)` → `view.getSelections()`), resolves anchors with
   `resolveSelection` from `@singapore-editor/core/document`, and reads only the selected range
   with `getTextSnapshot().readRange`. `keymap/` registers the commands with
   `when: ['fileBackedTab']` and an editor-pane key.
   3–5. Not answered in this wave: they decide P4 and P5, which wait on plans 087/088 (parked).

## Phases (provisional)

1. Shared attach action with workspace identity (also unblocks plan 139 phase 1).
   **Done 2026-09-25 (lane L8):** `lib/composer-attach` holds the context and
   `useAttachToComposer(rootPath)`; chat implements it (`useComposerAttach`, mounted by
   `providers/composer-attach-provider.tsx`). Inbox entries carry `{ environmentId, rootPath }` and
   a composer takes only its own workspace's.
2. Editor selection and file to chat; active-file chip.
   **Done 2026-09-25 (lane L8):** `workspace.addSelectionToChat` (`Mod+L` in the editor; the
   file when nothing is selected) and `workspace.addFileToChat`, both in the editor text menu;
   `chat.activeFileContext` shows the active file as a removable chip and sends it as a mention.
   Scenario `editor-add-to-chat`.
3. Fix with AI, per `docs/diagnostic-ai-fix-plan.md`.
   **Done 2026-09-25 (lane L8):** the shared handoff (`lib/diagnostic-ai`: request model,
   bounded excerpt with unsaved text, stale-range refusal `DIAGNOSTIC_CHANGED`, keyed mutation
   `diagnosticAiMutationKeys.fix`; `state/diagnostic-fix.ts` behind `DiagnosticFixProvider`) and
   the Problems list entry (a per-row button, and `Mod+.` on the active problem so the tree keeps
   one Tab stop), and the keyboard diagnostic popup (`DiagnosticPeekFixButton`, reading the
   tracked range against the text as it is now). Scenario `problems-panel-rows` covers both.
   **Hover done (lane L7):** generic per-diagnostic Editor actions call L8's shared draft
   mutation. The caller was reverted while Platform #33 was pending and restored on
   2026-09-26 after #33 reached main. The `editor-diagnostic-hover-fix` scenario proves the
   exact diagnostic and unsaved source reach the draft through keyboard activation.
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

## Research findings (2026-09-25)

Research 140 answered questions 3–5 against origin/main `9f3438258`. PR #33 (lane/L8) has a
newer plan with answers to questions 1–2 and Phases 1–3 marked done. Those answers are not
repeated here, and the Phase 4–5 proposals below assume them. Probes and raw output are in
`/work/tmp/research/140/` (`probe-sdk.ts`, `probe-lsp.ts`, `probe-disk.ts`, `real-*.json`).
Versions: Claude Code 2.1.282, `@anthropic-ai/claude-agent-sdk` 0.3.281, codex-cli 0.157.0
(`references/codex` at `a0b85c7a`), TypeScript 7.0.2 (`typescript-go`),
typescript-language-server 6.0.0 over TypeScript 5.9.3.

### Q3: Harness IDE integration. The `/ide` route does not work for Platform sessions.

**Claude Code.** An IDE runs a WebSocket MCP server and advertises it with a lock file
`~/.claude/ide/<port>.lock`, or `$CLAUDE_CONFIG_DIR/ide/` when that variable is set. The file
holds `{ workspaceFolders, pid, ideName, transport: "ws", authToken }`. The CLI connects to it as
an MCP client named `ide` (config type `ws-ide`). Evidence comes from strings in the 2.1.282
binary.

- CLI → IDE: `getDiagnostics`, `openDiff`, `close_tab`, `closeAllDiffTabs`, and an
  `ide_connected` notification. IDE → CLI: `selection_changed {selection, text, filePath}`,
  `at_mentioned`, `log_event`.
- Diagnostics: before each Write or Edit, the tracker takes a baseline with
  `getDiagnostics({uri})`. The call has a 500 ms timeout, and baselines turn off after three
  timeouts in a row. At the next model request it calls workspace `getDiagnostics({})` with a
  2 s timeout. It keeps only entries that are new since the baseline, and only for files it
  edited. It sends them as a `<new-diagnostics>` attachment capped at 4,000 characters.
  Cross-file errors are never reported.
- Discovery and connection run only in the interactive REPL. They live in Ink hooks, which run
  when `autoConnectIde` is set, `CLAUDE_CODE_SSE_PORT` is set,
  `CLAUDE_CODE_AUTO_CONNECT_IDE=true`, or the user types `/ide`. The tracker has one initializer,
  `handleQueryStart`, and it has one call site: the REPL's `_runImpl`.
- **Measured under the SDK:** `probe-sdk.ts ide` gave the session a connected in-process MCP
  server named `ide` with a `getDiagnostics` tool, then had the model write a file. The result was
  0 `getDiagnostics` calls, and the model reported no diagnostics ("NONE"). The tool only showed
  up as an ordinary model tool, `mcp__ide__getDiagnostics`. SDK sessions never run the
  diagnostics tracker, so an IDE server gives Platform's chat sessions nothing automatic.

**Codex.** `/ide` exists only in the TUI (`codex-rs/tui/src/ide_context/`, last change
`dbf47885`). On each prompt it requests `ide-context` over length-prefixed JSON on
`~/.codex/ipc/ipc.sock`, or on the legacy `$TMPDIR/codex-ipc/ipc-<uid>.sock`. The response
carries the active file, its selections and selected text, and the open tabs (`ide_context.rs`).
The TUI writes this as text ahead of `## My request for Codex:` (`ide_context/prompt.rs`). There
are no diagnostics. Platform drives Codex through app-server, where none of this runs, and
Platform already writes the prompt itself; composer chips (Phase 2) cover the same ground.

**Answer:** neither IDE protocol can carry scopes 2–5 to Platform's agents. D2 moves to hooks
(Q5), and neither hook route needs plan 087.

### Q4: Feedback timing. Read diagnostics after the tool result, per edited file.

Measured with `probe-lsp.ts` on a real project, `apps/server` (2,172 files). The edit removes a
parameter from `samePath` in `src/utils/path.ts`. That leaves one error in the edited file
(TS2304) and one in an importer, `src/lsp/typescript/shared/boundary.ts` (TS2554). Edits went to
the server in memory, and each run is one warm-up plus 5 break/fix rounds.

| Server                              | Delivery                         | Cold (first open, includes project load) | Warm, edited file | Warm, open importer | Publishes per change    |
| ----------------------------------- | -------------------------------- | ---------------------------------------- | ----------------- | ------------------- | ----------------------- |
| TypeScript 7.0.2 (`tsc --lsp`)      | pull (`textDocument/diagnostic`) | 118 ms                                   | 4–7 ms            | 7–10 ms             | none (pull only)        |
| ts-language-server 6 + tsserver 5.9 | push                             | 2,021 ms                                 | 364–373 ms        | 372–389 ms          | exactly 1 per open file |

- TypeScript 7 pushes nothing for documents. It advertises `diagnosticProvider`
  (`interFileDependencies: true`, `workspaceDiagnostics: false`). It also answers a pull for a
  file nobody opened, which caught the importer's TS2554 in 114 ms from a cold start
  (`probe-unopened.ts`). Platform's server proxy caches only pushed diagnostics
  (`apps/server/src/lsp/proxy-session.ts:1439`). Today only the browser's
  `PullDiagnosticsController` pulls, for the active document
  (`Editor packages/lsp-plugin/src/pullDiagnostics.ts:19`). So the server holds no
  TypeScript 7 diagnostics at all.
- A disk edit has to be announced before the pull. `probe-disk.ts` wrote the broken file to a
  disposable copy of `apps/server`, and an immediate pull returned the stale result (0 errors).
  With `workspace/didChangeWatchedFiles`, or a `didOpen` of the disk text, sent first, three
  runs of each found both errors in 5–6 ms. The proxy's watcher sends that notification after
  its own 50 ms flush (`watched-files.ts:20`) plus filesystem-event latency, so the feedback
  path must send the notification itself and not wait for the watcher.
- A whole-project check (`tsgo --noEmit -p apps/server`) took 1.0 s and 1 GB. That is
  affordable at turn end, and too slow and too large to run per edit.
- The references wait on the tool result too. OpenCode opens the file and waits for its
  diagnostics: a 150 ms debounce and a 5 s cap, with only the edited file reported
  (`packages/opencode/src/lsp/client.ts:13`, `tool/edit.ts:198`, `adee738`). Crush allows 1 s
  for the first change, then a 300 ms settle, capped at 5 s
  (`internal/lsp/client.go:624`, `7265494`). Claude Code allows 2 s.

**Answer:** the event is the tool result (PostToolUse). The next checkpoint comes too late,
because the agent has already moved on. TypeScript needs no settle delay: a pull answers
synchronously, and push servers publish exactly once per change. "Caused by this edit" means
the edited file's errors minus that file's baseline. On pull servers, take the baseline in
PreToolUse (about 5 ms). On push servers, use the last cached publish. Importers are left out, as
in Claude Code and OpenCode. Finding them is plan 088 C3 ("affected-reference queries").

### Q5: Hooks. Claude has in-process hooks; Codex has config-declared hooks.

**Claude.** `Options.hooks` takes callbacks for 33 events (`sdk.d.ts:895`), with an optional
per-matcher `timeout` in seconds (`sdk.d.ts:907`). The CLI calls back over the stdio control
channel (`hook_callback`). PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Stop,
SubagentStop and UserPromptSubmit can return `additionalContext`. PostToolUse can also replace the
tool output (`updatedToolOutput`, `sdk.d.ts:2603`). PostToolBatch fires once per batch of
parallel tool calls (`sdk.d.ts:2554`).

- **Measured end to end** (`probe-sdk.ts hook`, Haiku 4.5): a PostToolUse hook on `Write|Edit`
  returned `additionalContext` containing a marker string. The model quoted the marker verbatim
  in its reply.
- **Cost per call** (`probe-sdk.ts nohook|cost`, 5 sequential Bash `true` calls per run, one run
  each): the SDK handled each callback in 0–1 ms. The hook ran 1–3 ms after the `tool_use`
  block streamed. From `tool_use` to `tool_result` took 7–9 ms with or without hooks, so the
  added latency is below what this setup can measure. A 281-character reminder is about 60
  tokens, and it stays in history, so later requests read it again from cache. Total input
  tokens over the run went from 133,040 to 134,946 (+1.4%). CLI 2.1.282 does not send the
  `issued_at` timestamp that the protocol schema declares, so the CLI → SDK leg could not be
  timed on its own.

**Codex.** Hooks are stable and on by default in 0.157 (`features/src/lib.rs:1214`). They are
declared in config, and no client callback exists. Events: PreToolUse, PermissionRequest,
PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, UserPromptSubmit, SubagentStart,
SubagentStop, Stop and Interrupt (`config/src/hook_config.rs`). There are two handler types:
`command`, which reads JSON on stdin and writes JSON with `additionalContext` on stdout, and
`mcp_tool` (`hook_config.rs:163`). The default timeout is 600 s. `apply_patch` hooks also match
`Write` and `Edit` (`core/src/tools/hook_names.rs:34`).

- Platform can declare a hook per thread, because `thread/start` and `thread/resume` accept
  `config` overrides, which load as the `SessionFlags` layer. A hook from that layer runs only if
  it is trusted (`hooks/src/engine/discovery.rs:714`).
- The `bypass_hook_trust` override also trusts hooks that a cloned repository ships
  (`discovery.rs:178`), so Platform must not use it. Session flags can carry
  `hooks.state.<key>.trusted_hash` for Platform's own hook (`hooks/src/config_rules.rs:26`).
  `hooks/list` reports the hash.
- A `command` handler spawns a process. `curl` or `bun` startup measured 4–6 ms.
- Platform already maps `hook/started` and `hook/completed` (`codex.ts:1101`).
- Not verified live: the Codex account has no credit until 2026-09-26.

### Decisions

- **D2 — Recommendation:** use harness hooks, served by a server-owned diagnostics reader. Do not
  use `/ide` or plan 087.
  - Claude: in-process PreToolUse (baseline) and PostToolUse (`additionalContext`) hooks.
  - Codex: a session-flags PostToolUse `command` hook that calls a loopback route on Platform's
    server with a per-session token. Pin its trust hash; never set `bypass_hook_trust`.
- **D3 — Recommendation (unchanged; now measured):** add context, never deny. Latency is
  negligible, and the cost is tokens that stay in history. Remind once per session per tool
  kind, matching `Grep|Glob`, not on every call.
- **New D4 — Feedback content.** Recommendation: send errors only, for edited files only, and
  only the ones new since that file's baseline. Cap them at 10 per file, 30 in total and 4,000
  characters (the same caps as Claude Code's own LSP attachment). Attach nothing when the budget
  runs out; do not send a stale answer.
- **Setting:** `agent.diagnosticsFeedback`, boolean, `application` scope, default on. It changes
  what reaches the agent, which is why `window` scope is ruled out. Register it in the phase that
  wires its consumer.

### Which scopes move under 087/088

- Scope 5 (diagnostics feedback) no longer depends on 087.
- Cross-file ("affected reference") diagnostics and revision-aware freshness stay in 088 C3.
- An on-demand diagnostics tool the agent calls stays in 087. Claude alone could get one from an
  in-process `createSdkMcpServer`, but that would duplicate 087.
- Scope 6 still waits for 088's symbol tools. Only its hook mechanism is settled here.

### Owner questions

1. **Platform as Claude Code's IDE inside its own terminals.** Platform could write
   `~/.claude/ide/<port>.lock` and set `CLAUDE_CODE_SSE_PORT` in terminal environments. A
   `claude` process started in a Platform terminal would then get the selection, diagnostics and
   diffs the same way it does in VS Code. This is the one place `/ide` does work. Options:
   (a) a separate plan later, (b) not wanted. Recommendation: (a), at low priority. It writes
   into the user's shared `~/.claude` directory, and it helps terminal sessions only, not chat.
   Decided 2026-09-26: owner — (a): its own plan, [Plan 183](183-claude-ide-in-terminals.md), low priority.

### Proposed phases (4 and 5; Phases 1–3 are in PR #33)

4. Diagnostics feedback, by hooks.
   - 4a. Server diagnostics reader, `apps/server/src/lsp/agent-diagnostics.ts`. It connects an
     in-process `LspProxySocket` to the pooled backend through `LspSessionPool`. It must reuse the
     running backend's initialize contract, because a different contract spawns a sibling server.
     For each edited path, notify the change, then pull (`diagnosticProvider`) or wait for the next
     push. The budget is 1.5 s per batch. It emits one wide event, `agent.diagnostics`, with
     provider, file count, errors before and after, pull or push, milliseconds and timed out, and
     no messages or paths. No client mutation, so no mutation key.
   - 4b. Claude: `apps/server/src/provider/adapters/utils/claude-diagnostics-hooks.ts`, passed as
     `hooks` from `claudeQueryOptions` (`claude-query-options.ts:111`). PreToolUse takes the
     baseline and PostToolUse returns `additionalContext`, both on
     `Edit|Write|MultiEdit|NotebookEdit`. Register `agent.diagnosticsFeedback` here.
   - 4c. Codex: first run the session-flags hook live on codex-cli ≥ 0.157. Then add `config.hooks`
     plus the trust state in `threadStartParams` and `threadResumeParams` (`codex.ts:2661`),
     a loopback route beside `provider/routes.ts`, and a hook script shipped with the server
     bundle.
   - Verify: a server test on a real temp workspace with a real TypeScript server, where an edit
     introduces a type error and the hook's output carries it. Cover both pull (TypeScript 7) and
     push (tsserver).
5. Symbol-tool steering (after 088). A PreToolUse reminder on `Grep|Glob` (Claude) and a
   PreToolUse `command` hook (Codex), sent once per session per tool kind.
