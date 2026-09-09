# TUI Agent view

The Agent view connects the terminal client to the same orchestration engine, provider adapters,
and conversation projection as the web app. It provides the missing prompt and session stage.
Plan 082 completed on 2026-09-07.
The [TUI README](../apps/tui/README.md#start-an-agent-conversation) describes the controls.

## Runtime and ownership

`packages/client-core/src/chat/` owns the normalized projection, event writers, selectors, command
builders, pending requests, plans, provider models, and rail derivations. Web consumers import
these modules directly. `ChatOwner` manages shell and selected-session snapshots over the existing
TUI RPC connection. A second socket or a reduced TUI event reducer is not required.

Connection identity, snapshot generation, and selection lifetime gate asynchronous results.
Reconnecting restores snapshots before continuing event replay. A delayed detail request cannot
replace another session, and disposal prevents later publication. Accepted commands remain
accepted even when the follow-up read fails.

The stage stores drafts by conversation or checkout in the environment's local SQLite store.
Text, attachments, model choice, modes, stash, and an unacknowledged command survive navigation.
Retry reuses the retained command ID when acceptance is unknown. A confirmed rejection retires
that ID so the next attempt can succeed after the blocking condition clears. Acceptance clears
only the submitted content, including when navigation remounts the stage during the request.

## Native surfaces

The session rail provides project registration, project scope, title and transcript search,
read markers, collapse, ordering, bulk selection, rename, archive, restore, and delete. Its letter
shortcuts apply only when the rail owns focus. Provider dialogs use the actual model catalog,
advertised reasoning options, and supported account actions.

The prompt submits the native textarea value, including keystrokes received before React's next
render. Tab completion reads checkout files and provider commands or skills. The stage supports
local and clipboard image attachments, external prompt editing, stash, prompt history, access mode,
plan mode, and stop. Native atomic extmarks compact large pastes while retaining their complete
content for submission and undo. The prompt inbox preserves terminal excerpts until consumed by
the selected checkout's draft.
Approvals and questions wait for a pause in typing before taking focus. Secret input stays masked.
Plan implementation keeps the source plan identity when starting in the current or a new session.

The timeline renders bounded windows of source messages and grouped activities. Its layout cache
keys heights by content version and available width. Earlier and later controls traverse every
loaded window, and earlier pagination reads more server history. The stage exposes context usage,
runtime errors, changed files, checkpoint revert, and full transcript export. Export reads all
pages independently of the displayed window and does not change the selected session.
Command reconciliation retains loaded pages after a complete event replay. History replacements
invalidate those pages so older imported messages can be read again from the server.

The rail and stage share the screen below 100 columns. Both retain native focus registration so
the toggle command can reach a hidden pane. Overlays retain their command target and consume
typing. Opening a file pushes the workbench with the selected checkout as its root. Back restores
the conversation, and chat addresses preserve project and session identity.
The `sess ` palette prefix opens matching sessions from any screen. Exact command titles and IDs
rank ahead of matches in another command's category.

## Terminal sessions

Shell terminals use the selected checkout. Claude resume uses the server-configured executable,
canonical session ID, and private provider environment. The server stops the SDK runtime and
reserves the session before spawning the CLI. Another viewer attaches to the same PTY. Detached
terminals retain ownership until the PTY exits, and an unavailable executable never falls back
to a shell.

Before launch, the server persists the provider history IDs and terminal lease in SQLite. On CLI exit, it appends newly authored
messages without replacing platform turns, plans, or checkpoints. History read failures keep the
reservation and produce a visible error. Reconnect retries the same finalization without spawning
a second CLI. Source IDs and deterministic command receipts prevent duplicate appends after a
committed operation loses its acknowledgement.
Server startup retries pending history synchronization for confirmed CLI exits. If the previous
process's exit is unconfirmed, ownership stays blocked and the conversation displays an error.

The reservation prevents concurrent SDK turns, checkpoint reverts, and deletion of the session
or its project. The server owns this boundary for every client. Raw attach and terminal restoration
reuse the [workbench terminal implementation](tui-workbench.md).

## Verification

The native tests drive real in-process Elysia routes. Deterministic provider replies use the
production `MockProviderAdapter`. PTY and provider process substitutes are restricted to the
external process boundary.

| Behavior                                                                                  | Evidence                                                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Prompt submits once, streams a reply, and survives workbench navigation                   | [Stage](../apps/tui/src/agent-stage/tests/stage.test.tsx)                                                                        |
| Real completions and intentional approval or secret-answer input                          | [Composer](../apps/tui/src/agent-stage/tests/composer.test.tsx), [requests](../apps/tui/src/agent-stage/tests/requests.test.tsx) |
| Long transcripts traverse both directions and preserve scroll during streaming and resize | [Timeline](../apps/tui/src/agent-stage/tests/timeline.test.tsx)                                                                  |
| Lost acknowledgements, selection races, disposal, full export, and source-plan updates    | [Owner](../apps/tui/src/agent/tests/owner.test.ts)                                                                               |
| Native rail actions, bulk failure, and stale search results                               | [Rail](../apps/tui/src/agent-rail/tests/rail.test.tsx), [state](../apps/tui/src/agent-rail/tests/state.test.ts)                  |
| Model selection and provider account lifecycle                                            | [Picker](../apps/tui/src/agent-models/tests/picker.test.tsx), [auth](../apps/tui/src/agent-models/tests/auth.test.ts)            |
| Default prompt, narrow layouts, history, and addresses                                    | [Screen](../apps/tui/src/agent/tests/screen.test.tsx), [navigation](../apps/tui/src/agent/tests/navigation.test.ts)              |
| Canonical CLI resume, exclusive ownership, TTL, rejection, and cleanup                    | [Terminal sessions](../apps/server/src/terminal/tests/agent-session.test.ts)                                                     |
| Terminal selection survives palette focus and reaches the correct prompt                  | [Terminal context](../apps/tui/src/terminal/tests/agent-context.test.tsx)                                                        |
| Reconnect reuses the existing shell                                                       | [Terminal reconnect](../apps/tui/src/terminal/tests/reconnect.test.tsx)                                                          |

The working verification artifacts and decision trail are under `/work/tmp/platform-tui-agent/`.
The full TUI suite passes 282 tests across 86 files. The final composer checks pass 11 tests;
terminal/provider checks pass 58 tests, and migrated web logic checks pass 168 tests. TUI and
server builds, TUI lint and formatting, and client-core, server, and web typechecks pass.
The live check rebuilt and restarted the existing server on port 3301, wrote a native Agent frame,
and launched the desktop terminal. Structured TUI logs confirm the interactive connection is live.
Worktree creation and cleanup are covered by the [TUI worktree record](tui-worktrees.md).
Distribution with machine selection (084) remains a separate slice in the [strategy](tui-plan.md).
