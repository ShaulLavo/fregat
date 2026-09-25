# Chat

Agent sessions per project, with a rail of projects and sessions, worktrees, and the composer.

## Sub-features

Create session, send a message, stop the agent, rename, archive, delete, project rename and delete, worktree cleanup, session search.

## How to get to it (user POV)

The chat mode button in the window toolbar, or an address URL with `/chat/`.

## Driving it with agent:browser

`scenario sidebar-settings-button` checks Settings in both workspace modes and verifies chat's tool pane still collapses and reopens without losing its shared app actions.

`scenario chat-follow-up` creates a verification session with the selected provider, sends a correction after commentary while a shell command runs, then closes only that session's runtime through the command API and resumes it with another message. It uses real provider tokens and leaves its transcript for inspection. `caches` shows chat mutations while an action is in flight; `bun run logs --area chat` shows the command wide event.

`scenario chat-timeline` reads an existing conversation without sending messages, verifies that measured rows do not overlap, scrolls to earlier content, and returns to the latest message. It requires an existing transcript longer than the viewport.

`scenario chat-icon-hints` hovers the model-options control, opens its menu, attaches a temporary image and opens its preview, then stashes and removes a draft prompt. Each control must show the shared tooltip without a native title. It clears its local draft and sends no message.

`scenario archive-lifecycle` creates its own empty session, archives it through the menu, opens it from archive, reloads, and explicitly restores it. It removes only its own session. Pending approval and late provider activity are covered by the real-engine lifecycle tests and the session-rail component test; this browser scenario does not inject provider events.

`scenario checkpoint-rewind` creates a disposable real-provider session, sends one no-tools prompt, and rewinds through the conversation-only action. It verifies merged draft text and pruned history, then deletes its session. Uses provider tokens. File/index isolation and provider rejection are checked by real-engine checkpoint tests.

## Gotchas

`scenario checkpoint-states` needs no tokens: it runs the native checkpoint fixture in a disposable repository registered as its own project. Turn 1 edits a file, so the timeline card and the Turn panel list it; turn 2 edits nothing, so the Turn panel reads `No changed files in turn 2` and the transcript gains no card. Both surfaces take their sentence from `lib/checkpoint-availability.ts`; missing, error and pending are component-tested because a live server cannot be made to produce them without corrupting its projection.

`scenario session-actions-surfaces` creates one metadata-only session (no provider turn) and drives the shared session actions from every surface: Rename from the rail row, Pin/Unpin and Rename from the chat stage header, then Rename, Snooze/Unsnooze, a cancelled Delete and Archive from the editor sidebar chat header. Each result is read back from the server's shell snapshot; the session is deleted at the end. Rename runs only after its menu has closed — an open popup pulls focus back and the field would blur shut.

`scenario chat-diff-syntax --url <session-diff-address>` checks painted syntax colors in a session checkpoint diff.

Commands dispatch over the orchestration socket when it is live and over HTTP otherwise. The HTTP path refetches the shell snapshot itself.

- `mcp-approval`: isolated fake native Codex provider, advertised app-access choices after reload, permanent approval wire reply, and session/provider cleanup. No external app access.
- `claude-approval-rules`: real Claude CLI (Haiku) in approval-required mode on a disposable repository; the command approval offers session and always rules, "Always allow in this project" writes `.claude/settings.local.json`, and a second session runs the same command unasked. Spends two short Haiku turns.
- `codex-approval-rules`: the same drive with real Codex (GPT-5.5): the approval offers the proposed execpolicy amendment, choosing it writes `~/.codex/rules/default.rules`, a second session runs unasked, and the rules file is restored byte for byte.

`scenario session-unread` uses two disposable sessions and one short provider turn to verify completion while away, return-to-read, manual unread across reload, and a timer wake that survives visits until acknowledged. Both sessions are deleted. Background-tab suppression and monotonic scoped visits also have focused hook/store tests.

`scenario session-search` searches hidden message text in a disposable real-provider session and rejects stale results after changing the query. `session-search-environments` repeats this against a second connected environment and fails its prerequisite if only one owner is available. Both remove their own session. Two-server hook tests cover identical IDs, disconnects and delayed older results.

- `project-grouping`: two existing connected owners sharing a Git repository; switches grouping modes, checks owner counts in delete previews without confirming, restores settings. Requires multi-owner live fixture.

- `async-questions`: isolated native asynchronous questions; running answer steers, idle answer starts a turn, pending state survives reload, message-only dismiss persists. Native message payloads captured; temporary provider/session/processes removed.

- `session-lifecycle`: pin/settle/active menus, invalid custom snooze, timer-only shelf move, bulk snooze and Undo, provider-session snooze/unsnooze. Uses disposable sessions; bulk skipped/failed retention is covered by real-server DOM tests.
- `background-liveness`: isolated native parent/child lifecycle; completed parent with live child remains Working, idle child becomes Ready, late metadata stays Ready across reload. Removes own provider/session/processes.
- `spinner-palette`: isolated native turn left running under Sage dark then light; screenshots the rail, header and timeline `Spinner`s drawing from the theme primary. Run with `--scale 2` to read the bands. Restores appearance settings.

- `session-ordering`: pointer moves through empty pinned/settled shelves, active key persistence through reload, keyboard promotion to empty pinned shelf. Two-owner partial rejection uses real in-process server tests.

- `session-navigation`: disposable single-owner clipboard path/branch/session-ID values, archive-to-draft, background archive route preservation, delete survivor navigation; cleans up all fixtures. Two-owner live proof needs a second connected owner.

- `session-titles`: isolated native provider JSON title generation, regeneration, delayed-result/manual rename race, reload, visible invalid-output failure and retry. Restores only its project title-model override and removes its provider/session/processes.

- `file-attachments`: user upload, reload draft recovery, native provider file bytes, transcript text preview and exact download; isolated fixture and settings cleanup.

- `chat-stash-context`: image-only stash, complete image/file draft swap, reload recovery, isolated native file delivery and retention of the separate draft. Terminal-context pairing has a focused store/composer check; this scenario does not simulate terminal selection.
- `chat-claude-catalog`: the Claude list read from the running CLI — current models with Fable 5.1 first, retired ones under the collapsible Legacy row, Opus 5.5 options with the Fast mode switch, its bolt on the trigger, a level description tooltip and 1M, Fable 5.1 without Fast. Restores the project default model.
- `chat-draft-context-strip`: the strip under a new session's composer on a fixture repo with one linked worktree — workspace menu, New worktree with a picked base branch, and moving the draft into the linked worktree and back with its text. The machine menu shows only when the project is on two connected machines.
- `chat-usage-meter`: first the real `/providers/usage` read (asserted 200, screenshot `real-read` shows whatever the account holds; the server probes Claude `get_usage` and Codex `account/rateLimits/read`), then fixed windows — warning or spent tone on the trigger, the tooltip naming the tightest window and its reset, one popover row per live window (a passed reset is hidden) the `Checked …` footer, then "View usage" opening Settings › Usage. The fixture route spends no allowance.
- `settings-usage`: Settings › Usage — the real `/providers/usage/history` read (asserted 200, screenshot `real-read`), then a fixed month: headline with the unpriced-token note, 30 day slots with a bar tooltip, one row per model and purpose, automatic catalog estimates, and an unknown model shown as Price unavailable. There is no price editor.
- `chat-composer-narrow`: the editor's chat side panel dragged from 600 to 200px (12 steps) with the usage gauge stubbed in; fails if any composer control leaves the row or wraps to a second line, and prints each control's width. Calibrated: the earlier rows (one 380px tier; later a wrapping row) fail it.
- `provider-model-options`: advertised Standard and provider service tiers, future reasoning IDs, clearing to provider defaults, and model-change reconciliation through real composer choices and exact native `turn/start` parameters. Restores the project model preference and removes its provider/session/processes.

- `chat-queue`: isolated native provider and owned terminal. Checks default FIFO queueing, one message per tool boundary, pending approval hold/resume, Send now, Restore, and text/file/terminal recovery before a held interrupt rejects. It sends the recovered payload through the real provider pipeline and checks exact file bytes. Restores settings and removes its session, provider and terminal. Queue reload persistence is not expected.

`session-notifications --headed` verifies completion notices on the browser host: focused-other-session toast and scoped Open session, background native construction and favicon badge, native click/focus cleanup, reload-history silence and archived suppression. It uses an isolated delayed native provider and restores notification settings. Browser permission and native construction are exercised; actual desktop popup delivery and macOS/Windows bridges require host-specific evidence.

`composer-defaults` checks the Plan picker and built-in slash commands are hidden by default, context occupancy remains hidden after real native usage, opting in exposes both, disabling preserves the unsent preference, and a hidden-mode send reaches the native provider as `default`. Rich editing, keyboard preference modes and large-paste folding are separate open work.

- `response-delivery`: native paragraph delivery preserves full reasoning in an expanded activity and after reload; owned fixture cleanup.

- `draft-recovery`: two distinct unsent identities, image/file-capable draft recovery after reload, retained new-worktree choice, and discard without clearing the other draft. Does not send provider turns or create worktrees.

`scenario chat-card-narrow` drags the stage/tool split to its narrowest and checks the assistant changed-files card. The `+/-` counts are a ticker, which cannot shrink or ellipsize, so the header wraps its buttons to a second row rather than letting the counts paint over View diff.

`scenario chat-disclosure-settle` opens and closes the first collapsed disclosure it finds in an existing transcript. The row holding it must not move, and rows must not overlap. `scenario chat-composer-insert` uses a fixture repo. It sends a diff line through "Ask the agent about these lines" and drops a tree path onto the composer. Both must land in the composer with focus. It also checks that `data-compact` on the action row matches the measured width, in the side panel and in the chat stage. The drop is a synthesized `DragEvent` with the tree's `text/plain` payload.
