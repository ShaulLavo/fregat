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

`scenario session-branch-drift` runs the same fixture in a new worktree forked from a disposable repository (`newWorktree` in `isolatedNativeScenario`). Turn 1 runs `git checkout -b agent/drift` through the fixture's `git` edit op. When the turn ends, the header worktree chip, the rail row and the Git pane's branch chip must all read `agent/drift`: the server follows the branch through checkpoint capture, and the client refetches git state because the file watcher never sees `.git`.

`scenario session-pull-request-sync` puts `scripts/agent/fixtures/fake-gh.mjs` first on the throwaway server's PATH through `Scenario.prepareServer`, with a draft pull request for any branch. A new-worktree session's worktree must carry `pullRequest.status: found` (#12, draft) on the shell without any request from the page, and the fake's `calls.jsonl` must show a GraphQL request that asked about one branch only: the shared checkout is never looked up.

`scenario session-pull-request-start` registers a checkout whose `origin` is `git@github.com:fregat/fixture.git`, served over a fake ssh from a bare repository holding `feature/seven` and `refs/pull/7/head`, with `fake-gh.mjs` answering `gh pr view 7` and that branch only. The palette's `Start session from pull request…` with the pull request URL must open a session `#7 Seven fix` in a new worktree at the head commit, tracking `origin/feature/seven`, and its header must link `#7`; a commit there, then Fetch and `Push 1`, must land on the bare repository's `feature/seven`.

`scenario worktree-cleanup-on-delete` runs a session in its own worktree, deletes it from the header's Session actions with `Also remove its worktree` switched on, and waits for the checkout to leave the disk while `worktree/<id>` stays in the repository. `apps/server/src/orchestration/tests/worktree-cleanup.test.ts` covers what keeps a worktree: changes, ignored files, another branch, another or archived session.

`scenario session-auto-settle` uses the same fake forge with a merged pull request closed after the session began. The server's settlement sweep, triggered by the pull request sync, must move the session to the Settled shelf with `settledAt` equal to its creation time (it never ran a turn). `createFakeForge` in `scripts/agent/fake-forge.ts` and `committedFixture` in `fixture-workspace.ts` are shared by the three session scenarios.

`scenario session-pull-request-badge` writes a fake gh's answers before the throwaway server starts (branches are `worktree/<id>`, so they are known in advance) and creates six metadata-only sessions, each in its own worktree: open, draft, merged, closed, none, and one in a second repository whose lookup fails. Each rail row's `[data-pull-request-state]` badge and its `title` must match; the none row has no badge; clicking the open badge opens its URL in a new page (routed to a stub). The rail's `scrollWidth` must not exceed its `clientWidth` with those long branch chips.

`scenario session-actions-surfaces` creates one metadata-only session (no provider turn) and drives the shared session actions from every surface: Rename from the rail row, Pin/Unpin and Rename from the chat stage header, then Rename, Snooze/Unsnooze, a cancelled Delete and Archive from the editor sidebar chat header. Each result is read back from the server's shell snapshot; the session is deleted at the end. Rename runs only after its menu has closed — an open popup pulls focus back and the field would blur shut.

`scenario export-transcript` exports one disposable session four ways — Export as Markdown and as JSON from the rail menu, Export Conversation as Markdown from the message menu, and the palette's Export transcript — and reads each download. The session's provider instance does not exist, so its turn fails at once and spends no tokens. The transcript comes from `GET /orchestration/session-transcript`, which is unwindowed: the web itself holds only the latest 200 rows.

`scenario claude-hook-rows` runs real Claude (Haiku) in a fixture repository whose project PreToolUse hook blocks every Bash call, and checks the work log lists `PreToolUse:Bash blocked` with the hook's message under it. Silent successful hooks never get a row; they are counted into one `hook.summary` row at turn end.

`scenario claude-session-fork` and `scenario codex-session-fork` run real providers: three turns each name a fruit, Fork from Here on the second answer opens a `(fork)` session beside the source whose timeline stops at turn 2, and asked for the fruits it answers mango and kiwi, never papaya. The harness fork happens on the fork's first turn.

`scenario claude-manual-compaction` and `scenario codex-manual-compaction` run one real turn, type a draft, and pick Compact Conversation from the session menu. The compaction runs as its own turn (`/compact` for Claude, `thread/compact/start` for Codex), the timeline shows one "Context compacted" row, and the draft is still in the composer. Each takes 15–30 s.

`scenario claude-background-tasks` has real Claude (Haiku) start `sleep 600` and `sleep 700` in the background; the header's Background tasks popover lists both, and stopping one leaves the other. The list polls every 3 s only while the popover is open, since the roster lives in the provider process.

`scenario claude-session-tools` gives real Claude (Haiku) a fixture with two project MCP servers, one working and one whose command does not exist; the header's MCP servers and hooks popover shows Connected, and Failed with the error, and Reconnect runs. `scenario codex-session-tools` reads the same popover for Codex: the user's servers and the fixture's `preToolUse` hook from `hooks/list`. Both need a turn first, since the lists come from the live provider process.

`scenario claude-custom-agent` gives real Claude (Haiku) a fixture with `.claude/agents/reviewer.md`; the new-session strip's Run as menu lists it among the built-in agents, a session started as it opens its reply with the agent's marker line, and the header shows a `reviewer` chip. The shared Editor checkout reloading mid-edit blanks the page; rerun if the page errors name an Editor module.

`scenario claude-context-popover` turns on `chat.contextWindowMeterEnabled` on its throwaway server, runs one real Haiku turn and opens the context ring: a category meter with a legend (System prompt, Messages, …), deferred tools listed apart, and "This session" with tokens and a cost.

`scenario chat-diff-syntax --url <session-diff-address>` checks painted syntax colors in a session checkpoint diff.

`scenario chat-markdown-fence` uses the isolated native fixture to answer with a fenced `ts` block and waits for the fence to paint more than one token colour, the path that loads `shiki/core` and its JavaScript engine lazily. It removes its session and provider. Against the dev page it runs Vite's module graph, not the built `core-*.js` chunks.

Commands dispatch over the orchestration socket when it is live and over HTTP otherwise. The HTTP path refetches the shell snapshot itself.

- `mcp-approval`: isolated fake native Codex provider, advertised app-access choices after reload, permanent approval wire reply, and session/provider cleanup. No external app access.
- `claude-approval-rules`: real Claude CLI (Haiku) in approval-required mode on a disposable repository; the command approval offers session and always rules, "Always allow in this project" writes `.claude/settings.local.json`, and a second session runs the same command unasked. Spends two short Haiku turns.
- `codex-approval-rules`: the same drive with real Codex (GPT-5.5): the approval offers the proposed execpolicy amendment, choosing it writes `~/.codex/rules/default.rules`, a second session runs unasked, and the rules file is restored byte for byte.

`scenario session-unread` uses two disposable sessions and one short provider turn to verify completion while away, return-to-read, manual unread across reload, and a timer wake that survives visits until acknowledged. Both sessions are deleted. Background-tab suppression and monotonic scoped visits also have focused hook/store tests.

`scenario session-search` searches hidden message text in a disposable real-provider session and rejects stale results after changing the query. `session-search-environments` repeats this against a second connected environment and fails its prerequisite if only one owner is available. Both remove their own session. Two-server hook tests cover identical IDs, disconnects and delayed older results.

- `project-grouping`: two existing connected owners sharing a Git repository; switches grouping modes, checks owner counts in delete previews without confirming, restores settings. Requires multi-owner live fixture.

- `async-questions`: isolated native asynchronous questions; running answer steers, idle answer starts a turn, pending state survives reload, message-only dismiss persists. Native message payloads captured; temporary provider/session/processes removed.

- `session-lifecycle`: pin/settle/active menus, invalid custom snooze, timer-only shelf move, bulk snooze and Undo, provider-session snooze/unsnooze. Uses disposable sessions; bulk skipped/failed retention is covered by real-server DOM tests.
- `session-undo`: unpin, settle, snooze and archive with the notice's Undo and with Mod+Z; pin keys and pinned order return, the archived open session reopens, Mod+Z in the composer stays the composer's undo, and an expired notice leaves the key to the browser. Three disposable sessions, deleted afterwards; runs on the throwaway server without a default model.
- `background-liveness`: isolated native parent/child lifecycle; completed parent with live child remains Working, idle child becomes Ready, late metadata stays Ready across reload. Removes own provider/session/processes.
- `spinner-palette`: isolated native turn left running under Sage dark then light; screenshots the rail, header and timeline `Spinner`s drawing from the theme primary. Run with `--scale 2` to read the bands. Restores appearance settings.

- `session-ordering`: pointer moves through empty pinned/settled shelves, active key persistence through reload, keyboard promotion to empty pinned shelf. Two-owner partial rejection uses real in-process server tests.

- `session-navigation`: disposable single-owner clipboard path/branch/session-ID values, archive-to-draft, background archive route preservation, delete survivor navigation; cleans up all fixtures. Two-owner live proof needs a second connected owner.

- `session-titles`: isolated native provider JSON title generation, regeneration, delayed-result/manual rename race, reload, visible invalid-output failure and retry. Restores only its project title-model override and removes its provider/session/processes.

- `file-attachments`: user upload, reload draft recovery, native provider file bytes, transcript text preview and exact download; isolated fixture and settings cleanup.

- `chat-stash-context`: image-only stash, complete image/file draft swap, reload recovery with a decoded staged thumbnail, isolated native file delivery and retention of the separate draft. Terminal-context pairing has a focused store/composer check; this scenario does not simulate terminal selection.
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

## Hostile states

Each surface lists the states it must survive and the scenario that drives each one. All run on the native Codex fixture and spend no provider tokens.

- **Approval panel**
  - The turn is stopped while the approval is open: the panel closes, the fold keeps an "Ended unanswered" receipt across reload, and no answer reaches the agent. `approval-turn-ended`
  - Two windows answer at once, and one double-clicks: exactly one answer reaches the agent and the transcript holds one receipt. `approval-two-tabs`
  - The chat socket drops while the approval is pending: the panel keeps the request, disables its buttons, says it may already have been answered in another window, and recovers on reconnect. `approval-reconnect`
- **User-input panel**: a respond failure that says the request is gone closes it (server tests in `orchestration/tests/session-lifecycle.test.ts`); the async-question paths are `async-questions`.
- **Timeline stream**
  - The live tail pauses on `#`, `## `, an open backtick, a table header without its separator, or a bare list marker: no frame paints that syntax. `stream-ambiguous-tail`
  - A code fence streams in chunks: the coloured token count never drops between frames (Plan 161 3.2 did not reproduce). `stream-code-colour`
- **Stopped turn**: the Stop button, a runtime stop through the command API and a provider failure each read their own status line; the partial answer fades as incomplete; Try again resends the same message; a reader scrolled up keeps their place while the retry answers. `stopped-turn-reasons`. The server-restart line is covered by `orchestration/tests/recovery.test.ts`.
- **Queue**: held follow-ups, Send now and Restore across a pending approval. `chat-queue`
- **Composer**: a dismissed screenshot picker stages nothing and raises no toast; a frame stages one PNG. `chat-screenshot`
- **Changed files**: empty, failed and pending lists. `checkpoint-states` plus component tests.

- `approval-turn-ended`, `approval-two-tabs`, `approval-reconnect`: see Hostile states above.
- `stopped-turn-reasons`, `stream-ambiguous-tail`, `stream-code-colour`: see Hostile states above. The stream scenarios set `chat.responseStreamingMode` to `token` and restore it.
- `chat-screenshot`: the composer attach menu's Screenshot… item with the page's `getDisplayMedia` stubbed by a painted canvas stream; removes its draft image.
- `chat-model-favorites`: stars an offered model and a retired one through `model.setFavorite`, opens the picker's Favorites rail entry, and restores `models.favorites`.
- `chat-background-start`: three Ctrl+Enter starts from a new draft set to New worktree on `release`; each gets its own worktree and the user stays on an empty draft. Deletes its sessions and releases their worktrees.
- `chat-turn-anatomy`: needs no tokens. The throwaway server offers the mock driver (`PLATFORM_AGENT_HARNESS=1`), and the scenario adds a mock provider with `script: 'turn-anatomy'`, which streams reasoning, two plan updates (the second drops a step), four tool calls (one failing with a Bun trace, one with JSON input) and a Reviewer agent with a Checker child. It checks, with a screenshot each: Thinking open while streaming, the live row's height held still while calls arrive, Thought for Ns folded a second later, the settled summary with `1 failed` and a duration, the struck dropped step, the nested agent tree, the one-band Max burst (no rainbow on the trigger) and its band dropped under reduced motion, the `Switched to GPT-5.5 · Max` marker, a reader-opened fold staying open, a fold waiting while the reader is scrolled away, the bigger burst from picking the `ultra` level (Codex's id), Ultrathink picked from the menu as a stored level with the prompt left empty, again from typing `ultrathink` (a new ultra level), the typed word staying painted with the caret after, inside and before it and while typing beside it, ending on its own and not replayed by hover or the menu, the composer word as one drifting rainbow span, the trigger's rainbow drifting only on hover, Ultra and Ultrathink as the only rainbow menu rows, a stack frame opening the editor at its line, then dark mode with the resting rainbow word and cozy density. It removes its own session and provider.
- `chat-artifact-template`: a native-fixture answer with an `::artifact-template{…}` directive renders one card; Use appends the template prompt to the composer once.
- `chat-composer-editing`: with `chat.sendShortcut` set to mod-enter, Enter adds a line and Ctrl+Enter sends; a 40 KB clipboard paste folds into `pasted-text.txt`, and Ctrl+Shift+V pastes it inline. Restores the setting.
- `chat-multiple-models`: Shift+select a second model in a new draft and send; two sessions start on two new worktrees, one per model, and no recoverable draft is left. Deletes the sessions and releases their worktrees.
  `chat-draft-context-strip` also opens Manage worktrees, checks the shared release confirmation and cancels it while retaining the checkout.

`trace chat-stream` uses the isolated native fixture to expand a running command and follow its completed output past the detail height cap. Command output is published on completion; reasoning renders separately. It records the running command, capped output and completed turn without contacting a provider.
