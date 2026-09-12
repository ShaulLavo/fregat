# Chat fixes and local t3code comparison

Implemented in `/work/projects/platform-chat-parity`, branch `chat-t3code-parity`, from baseline `d4e0c5f9`. The original checkout and running app were left untouched. The comparison covered native provider events, orchestration, child agents, working feedback, transcript grouping and scrolling, the composer, approvals/questions, plans, attachments, Markdown, file navigation, and session recovery.

The captured chat exposed seven child commands without parent-turn ownership, missing child lifecycle feedback, generic labels for 11 of 13 commands, and a reproducible 20px gap. The implementation preserves child identity through native ingestion and projection, exposes an agent inspector, uses the reference command parser, and reduces the gap to 6px. The wider comparison produced the additional fixes below. This report records actual differences and checks, not a percentage-parity score.

## What happened in the last chat

The affected conversation is [the session-diff question from September 12 at 11:46](https://omarchy.mesh.shaulavo.dev/platform/~platform.TtmPUppXzd85vy1E/chat/t/2b3bf54c-030f-42a5-9189-3a9985805b05). Its canonical turn is `turn-37443e90-7cb4-4f4f-86bf-f50b6a45a479`. The parent spawned `/root/explain_diff`, named Locke.

The parent ran six shell commands and one web search. Its two commentary messages plus seven tools explain the nine steps in "Worked for 1m 50s". The child's seven commands entered the projection with `turnId: null`, outside that fold, producing the separate "Ran 7 commands" group. All seven command IDs match the child's native Codex log. Native child start, completion, and interaction events were absent from the chat projection.

The baseline adapter processed child notifications through parent handlers and resolved child turns through a map containing only parent turns. Unsupported subagent items were dropped at ingestion. T3code registers child threads, retains their launching parent turn, intercepts their notifications, and emits child task activity before ordinary parent processing. Its runtime also isolates child status, errors, and token totals.

The baseline command parser rejected compound shell syntax. T3code's actual parser identified an executable for all 13 captured commands. For the four red rows it returned `rg`, `rg`, `nl`, and `rg`. Those labels identify the first meaningful executable, not necessarily the failing stage of a compound command.

| Time, local | Exit code | Actual result                                                                                                        |
| ----------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| 11:47:32    | 0         | `rg` searched nonexistent `apps/web/src/server`. A later command succeeded, so the shell exited zero.                |
| 11:47:48    | 2         | Searches used nonexistent paths including `packages/client-core/src/navigation*` and `apps/web/src/lib/navigation*`. |
| 11:47:58    | 1         | The final `rg` found no matches. Earlier file reads produced output.                                                 |
| 11:48:14    | 0         | `rg` searched nonexistent `apps/server/src/worktree*`. The pipeline still exited zero.                               |

Both applications inspect output diagnostics as well as exit codes. That explains the two red rows with shell exit zero. The agent selected incorrect paths; a search of current prompt and instruction sources found no template containing those stale paths. The repair makes the command, child owner, exit code, and diagnostic visible. It cannot prevent arbitrary invalid commands chosen by the model.

The 20px gap came from 6px wrapper padding on each adjoining row plus an 8px divider margin. It appeared in both the running app and the replay. The corrected transcript uses row-owned spacing following the reference: 6px after folds, 8px after work groups, and 16px around message boundaries. No larger intermittent virtualization gap was reproduced.

Baseline evidence remains local because it includes private conversation data:

- [Native command correlation](/work/tmp/platform-chat-review/routing-evidence.json)
- [Original command labels compared with t3code](/work/tmp/platform-chat-review/command-comparison.json)
- [Measured source replay](/work/tmp/platform-chat-review/before-replay.json)
- [Running app, collapsed](/work/tmp/platform-chat-review/last-chat-top.png) and [expanded](/work/tmp/platform-chat-review/last-chat-expanded.png)

## Provider and child-agent fixes

The comparison used the local reference's `apps/server/src/provider/Layers/CodexSessionRuntime.ts`, `CodexAdapter.ts`, and generated native schemas. Platform changes live in `apps/server/src/provider/adapters/codex.ts`, `state/codex-child-agents.ts`, adapter utilities, `orchestration/provider-runtime-ingestion.ts`, and `packages/contracts/src/chat-agent.ts`.

| Finding                                            | Implemented behavior                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing child registration and ownership           | Register from native thread/spawn/subagent/collaboration events. Exclude root self-activity. Retain the original canonical parent turn across resume and later metadata.                                            |
| Child traffic reaching parent handlers             | Route recognized child notifications first. Buffer pre-registration traffic. Explicit unknown native parent IDs remain unattributed instead of adopting whichever parent is active.                                 |
| Commands overwriting child state/history           | Separate task-state and per-tool activity IDs. Preserve every tool's native command, output, exit code, and canonical item type.                                                                                    |
| Child status/tokens/errors modifying the parent    | Keep running/waiting/idle/interrupted/failed/closed state, usage, settings, model reroutes, and warnings scoped to the child. Do not apply child plans or compaction to the parent. Idle children remain resumable. |
| Stop only interrupting the parent                  | Start parent and all known live child interrupt requests concurrently. A failed child interrupt cannot prevent the parent signal. Track live children before registration.                                          |
| Approval/question IDs losing ownership             | Retain original native RPC IDs and correlate canonical UI request IDs for opening, replying, and resolving. Preserve child identity and parent-turn ownership.                                                      |
| UI question answers violating the native schema    | Convert strings and arrays to native `{ answers: string[] }` values. Validate before removing the pending request.                                                                                                  |
| Native status and verdicts flattened               | Read the status discriminant and retain failed/declined tool outcomes.                                                                                                                                              |
| Duplicate or missing turn completion               | Guard duplicate completion from racing native responses. Emit a terminal event for interrupted turns. Keep canonical mappings needed by late events.                                                                |
| Completed assistant item overtaking its text delta | Handle dedicated native notifications before awaiting the manual fallback. Preserve wire order and avoid duplicating final text. Streaming, buffered, and final-item-only delivery retain their intended behavior.  |
| Pre-registration output retained without bounds    | Cap pending storage at 128 threads, 512 events, and 2 MiB serialized data. Drop oversized events; evict oldest pending thread batches under pressure. Registered history and live Stop targets survive.             |
| Routing failures hard to diagnose                  | Enrich existing wide message/operation logs with native and canonical turn IDs, child scope, routing outcome, pending counters/drops, and interruption targets.                                                     |

Unmatched `serverRequest/resolved` acknowledgements do not invent UI resolutions. A response already emitted its canonical resolution before removing the pending mapping. An unknown native ID has no safe canonical request to resolve. Unknown notification methods still reach the ordinary fallback and existing message log.

The removed untyped `textElements` passthrough had no typed API or callers. Text inputs now send the protocol-required empty text-elements list. No compatibility shim was added.

## Working feedback, history, and scrolling

The reference sources were `packages/client-runtime/src/work-log/commandLabel.ts`, `presentation.ts`, and `apps/web/src/components/chat/MessagesTimeline.tsx` and `MessagesTimeline.logic.ts`. Platform changes live under `apps/web/src/features/chat`.

| Finding                                                   | Implemented behavior                                                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Child work absent from working feedback                   | Keep an agent summary visible after its launching parent turn completes. Remove child tools from the parent work log. A nonmodal inspector shows identity, status, elapsed time, tokens, and expandable commands. |
| Virtualization losing inspector state                     | Keep selection and expansion outside virtual rows. Clicking the transcript does not dismiss the inspector. Narrow windows contain the panel within the viewport.                                                  |
| Old projected tool rows resurrecting a completed child    | Select the current snapshot by `agent.updatedAt`, then revision for timestamp ties. Preserve tool placement separately. A provider restart may reset revisions, so revision alone cannot determine freshness.     |
| Early approvals separated from their eventual child group | Correlate only by later explicit ownership of the same native child thread. Do not infer ownership from the currently active parent. Stored history remains unchanged.                                            |
| Generic compound-command labels                           | Port t3code's parser and 317-case corpus with its MIT notice. Show the executable in live feedback and full commands in history. All 13 captured labels now match the reference.                                  |
| Failures obscuring what actually happened                 | Show exact exit code and diagnostic alongside retained stdout/stderr. Inspect raw output before truncation. Suppress synthetic command echoes before diagnostic matching.                                         |
| A no-match search presented as an unexplained failure     | Recognize a single static `rg`/`grep` exiting 1 without diagnostics as no matches. Preserve exact outcomes for compound commands without guessing which stage failed.                                             |
| Accumulated spacing around completion                     | Remove divider margins and generic row padding. Use the reference's row-specific spacing and matching collapsed estimates.                                                                                        |
| Completed folds flattening large tool histories           | Keep nested expandable groups bounded to half the viewport, up to 18rem. Follow new calls rather than every output update.                                                                                        |
| Reopening a group jumps to a different command            | Save command ID and local offset instead of only scrollTop. Output-only drawers retain horizontal and vertical pixel offsets.                                                                                     |
| Context compaction folded inconsistently                  | Keep a lone compaction visible; let compaction join an existing work fold, including after the final answer.                                                                                                      |
| Same-turn correction resets the working timer             | Place feedback after the latest user correction, but measure from the first user message of that canonical turn.                                                                                                  |

Browser checks falsified the broader suspicion that growing output always breaks reading position. While a group stayed mounted, native browser anchoring retained the visible command. Closing and reopening reproduced the defect: command 17 became command 8. The corrected restoration keeps command 17 within 0.5px without adding another live scroll controller.

The inspector floats at the right edge. It does not add t3code's docked workbench agent control system.

## Composer, requests, plans, and Markdown

The comparison checked t3code's `ChatView.tsx`, `chat/ChatComposer.tsx`, `ComposerPrimaryActions.tsx`, `composerSubmission.ts`, `composerPromptHistory.ts`, `composerDraftStore.ts`, server decider, `ChatMarkdown.tsx`, `markdownImages.ts`, and `codexMarkdownDirectives.ts`.

| Finding                                                        | Implemented behavior                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No follow-up while an agent runs                               | Add `session.turn.steer` targeting the active canonical turn and native Codex `turn/steer` with `expectedTurnId`. Send correction and Stop are separate controls. No second parent run starts.                                        |
| A rejected correction could lose the draft or obscure delivery | Command rejection retains the editor and draft. A correction accepted into history whose provider delivery fails displays "Correction was not delivered" while the original turn continues. Duplicate command receipts do not resend. |
| Plan actions bypass composer availability                      | Share connection, worktree, pending-request, dispatch, and image-preparation gates. Show control loaders.                                                                                                                             |
| Plan validation accepts arbitrary or superseded IDs            | Require the newest actual plan row, matching requested ID, same project, and unimplemented state. Check before attachment preparation and again at serialized commit. Client selection uses the same timestamp/ID ordering.           |
| Concurrent image drops exceed the limit                        | Serialize preparation batches and apply an atomic live-draft limit of eight images.                                                                                                                                                   |
| Send runs before image preparation finishes                    | Publish preparation immediately through shared per-draft state. Block Send and plan actions until all batches finish. Preserve the destination across session switches.                                                               |
| Draft-save errors invisible                                    | Display persistence failures and avoid promising that a failed save succeeded.                                                                                                                                                        |
| Unsent images vanish on reload without explanation             | Explicitly state their memory-only lifetime. Keep base64 out of localStorage. Remove the message when no staged images remain.                                                                                                        |
| Approval/question UI stuck after an accepted response          | Schedule session projection recovery and correlate failures with the current command. Failed replies remain retryable.                                                                                                                |
| Prompt limit checked after optimistic submission               | Validate the complete serialized provider input against Platform's existing limit before dispatch; retain the draft with an explanation.                                                                                              |
| Prompt history recall missing                                  | Use real session user messages for ArrowUp/ArrowDown recall with empty-draft, menu, and caret guards. Strip terminal context.                                                                                                         |
| Local Markdown images fail to load                             | Resolve within the session workspace and use the existing filesystem blob route and lightbox. Retain remote images and show missing-image fallback.                                                                                   |
| Worktree file links use the selected editor root               | Provide the session's canonical root and API path through a narrow context. Validate a reference's relative suffix and map it under that API path for file navigation and image loading.                                              |
| Markdown processor cache keeps the previous workspace          | Pass explicit plugin options so Streamdown's cached processor distinguishes workspace and environment origin.                                                                                                                         |
| Workspace images fail native browser authentication            | Use anonymous CORS for workspace blob requests so the browser supplies Origin. Remote images without CORS headers still work, including in the lightbox. Unknown image size is omitted.                                               |
| Codex file directives render as raw text                       | Convert supported citations using Markdown AST source ranges, including `line_range_start`. Preserve escaped directives and directives inside code, links, images, HTML, and definitions.                                             |

Native steering deliberately differs from the reference's queued `turn/start` architecture. Busy non-Codex sends remain unavailable with an explanation; the adapter API does not pretend those providers support steering. Stale or unsupported requests are rejected before history changes.

The managed-worktree check reproduced two independent mistakes: file references used the selected base editor workspace, and Streamdown reused the first image plugin closure. The fix carries the actual chat workspace and explicit plugin options. A real in-process file route test verifies a managed-worktree citation and PNG while the editor remains at the base workspace.

## Existing behavior checked and preserved

Model and effort choices, project defaults, per-session provider identity, runtime mode, and plan/build mode reach their existing commands. Image MIME validation/compression, file mentions, slash and skill menus, IME Enter protection, Shift+Enter, terminal capture, stash, scoped text drafts, and failed-send recovery remain reachable.

The transcript already supports GFM, math, Mermaid, highlighted code, file links, external link previews/context menus, Markdown selection copying, collapsed user messages, plan copy/download/expand, changed-file trees, and checkpoint diff/revert. Revert confirms and refuses while busy. Earlier history has loading/retry states; missing sessions have a separate state. Session detail recovery and connection feedback are wired. Earlier parity reports claiming these were absent are historical, not evidence of current gaps.

## Verification and reproducible evidence

The focused checks targeted plausible failures in changed paths. Counts below describe separate runs with overlapping coverage; they are not a unique-test total.

| Check                                                                               | Result and evidence                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reference parser and presentation logic                                             | 399 tests passed, including all 317 reference parser cases. Follow-up diagnostic checks passed 22 cases.                                                                                                                                                                                                                                                     |
| Presentation components and scrolling                                               | 28 DOM cases passed; reopening/output restoration follow-up passed 10.                                                                                                                                                                                                                                                                                       |
| Integrated provider, ingestion, steering, and plan checks                           | 75 cases across five files passed. [Saved log](/work/tmp/platform-chat-parity/integration-runtime-tests.log).                                                                                                                                                                                                                                                |
| Final bounded child-buffer integration                                              | Eight cases passed after the final runtime commit. [Saved log](/work/tmp/platform-chat-parity/integration-buffer-tests.log).                                                                                                                                                                                                                                 |
| Integrated agent/timeline/work-log/composer logic                                   | 52 cases across four files passed. This supersedes earlier 41/46-case checkpoints. [Saved log](/work/tmp/platform-chat-parity/integration-timeline-tests.log).                                                                                                                                                                                               |
| Integrated Markdown, composer, request, plan, preparation, and scrolling DOM checks | 59 cases across eight files passed. [Saved log](/work/tmp/platform-chat-parity/integration-dom-tests.log).                                                                                                                                                                                                                                                   |
| Managed-worktree follow-up                                                          | 23 focused cases passed, including the real file route, Markdown cache, and retained-draft retry.                                                                                                                                                                                                                                                            |
| Native adapter through real projection                                              | Exact final text, idle child snapshot, both command results, scoped requests, and canonical ownership verified. [Generated session](/work/tmp/platform-chat-parity/native-session.json).                                                                                                                                                                     |
| Browser replay                                                                      | 6px divider gap at 1100px and 420px, no horizontal overflow, retained command reading position, and no page errors. [Presentation measurements](/work/tmp/platform-chat-parity/presentation-browser-check.json), [captured-chat measurements](/work/tmp/platform-chat-parity/presentation-replay.json).                                                      |
| Final integrated browser proof                                                      | Live-to-idle agent details survive; clicking the parent leaves inspection open; panel fits 390×844. Native projected child shows two commands and no orphan parent work group. Real local PNG returns 200, matches all 68 bytes, and decodes; missing fallback and local/remote lightboxes work. [Proof](/work/tmp/platform-chat-parity/browser/proof.json). |
| Static checks                                                                       | Changed-file formatting/lint and required workspace typechecks passed through commit hooks.                                                                                                                                                                                                                                                                  |

The final browser script bundles actual worktree source and the existing app test-provider stack, then intercepts its proof bundle under the already-running app origin. It does not start a server. Only the remote external image is fulfilled as a network fixture; local image bytes come from the real running filesystem route.

Generate the native snapshot from `apps/server`:

```sh
PLATFORM_CHAT_PARITY_SNAPSHOT=/work/tmp/platform-chat-parity/native-session.json bun --bun vitest run src/provider/adapters/tests/codex.test.ts -t 'projects a native Codex child session'
```

This runs the actual Codex adapter, ingestion, production decider, SQLite event store, projection, and session query. Only the external Codex JSON-RPC process is injected. The test covers streaming, buffered, and final-item-only output; the generated reply is exactly `Hello from app-server`.

Run the browser proof from `apps/web`:

```sh
PLAYWRIGHT_BROWSERS_PATH=/work/cache/ms-playwright \
CHAT_PROOF_URL=https://omarchy.mesh.shaulavo.dev \
CHAT_PROOF_SERVER=https://omarchy.mesh.shaulavo.dev/platform-api \
CHAT_PROOF_NATIVE_SNAPSHOT=/work/tmp/platform-chat-parity/native-session.json \
CHAT_PROOF_SNAPSHOT=/work/tmp/platform-chat-review/session.json \
node scripts/chat-parity-proof.mjs
```

The optional captured-session input contains private local history and is not committed. This machine's proof uses the configured filesystem root `/`, root-relative API paths, and an approved browser Origin. The production mapping uses the session's explicit canonical/API root pair rather than assuming that root.

Inspect [the native projected agent](/work/tmp/platform-chat-parity/browser/native-agent-projection.png), [the narrow inspector](/work/tmp/platform-chat-parity/browser/agents-narrow.png), and [the original session after presentation repairs](/work/tmp/platform-chat-parity/browser/last-chat-replay.png).

## Scope and remaining differences

No paid/live Codex prompt was submitted. Deterministic protocol checks and the real running filesystem route supply the execution evidence. The original app has not been switched to this branch.

The stored old chat still has its original missing child IDs. Its replay proves presentation repairs; the new native adapter-to-projection artifact proves correct attribution for newly ingested events. No migration or healing code rewrites buggy dev history.

T3code still has product capabilities outside these repairs: arbitrary file uploads, per-question attachments, browser/review annotations, artifact-template cards, general app/MCP elicitation forms, and docked side-agent controls. Platform's unsent images remain memory-only, now explicitly disclosed. These differences prevent a claim of complete t3code feature equivalence.

The reference's opportunistic `thread/read` metadata lookup was not copied. Native thread/spawn/settings/reroute metadata is retained; a child without nickname/model metadata uses known path/role or an Agent fallback.

Pending notification bodies are bounded. The separate native live-turn registry deliberately retains potentially running targets until terminal or closed events arrive, so Stop can still reach unregistered children. A malformed provider stream that starts unlimited turns without terminating them can still grow that registry and Stop fan-out. This is a remaining low-severity resilience limit.

Independent review used `gpt-5.6-sol`. It found snapshot-version ordering, native text duplication, stale plan validation, citation escaping, workspace/cache boundaries, and unbounded pending payloads; each has a focused reproduction and an implemented correction. The remaining flags concern the explicit scope and resilience limits above. The append-only [decision trail](chat-t3code-decisions.tsv) records integration choices, corrections, and verification checkpoints.
