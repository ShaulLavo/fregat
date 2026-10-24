# Codex CLI (OpenAI) — TUI + app-server deep read

Source: `/work/projects/platform/references/codex` (Rust workspace under `codex-rs/`; npm wrapper under `codex-cli/`). Paths below are relative to `codex-rs/` unless prefixed. Line numbers are from the checked-in snapshot and drift with edits; they are anchors, not contracts.

Scale, so you can calibrate: `tui/` is ~312k lines including tests; the non-test core is roughly `tui/src/lib.rs` 3.7k, `app/` 41k (8.7k of it tests), `chatwidget/` 26k+36k tests, `bottom_pane/` 50k (`chat_composer.rs` alone is 13k), `history_cell/` 8.8k, `streaming/` 4k, `app-server-protocol/` 34k, `app-server/` 52k. There are 857 insta `.snap` files. The composer, the streaming pipeline, and the scrollback insertion are the three subsystems that earned their size; most of the rest is product surface (plugins, pets, rate limits, agents overview) you do not need.

One-line architecture: **the TUI is a JSON-RPC client of `codex app-server`, and by default it embeds that server in-process** (`tui/src/lib.rs:262-296`, `AppServerTarget::{Embedded, LocalDaemon, Remote}`). Every UI action is a typed `ClientRequest`; every model/tool event is a `ServerNotification` or `ServerRequest`. That is the same shape as your plan (TUI as another front end to the Elysia server), so the protocol section is the most transferable part of this report.

---

## 1. Rendering model: inline viewport + scrollback insertion, alt screen only for overlays

### What they do

- **Main chat is inline.** `tui::init()` is documented as "Initialize the terminal (inline viewport; history stays in normal scrollback)" (`tui/src/tui.rs:263`). The viewport is a `Rect` at the bottom of the screen sized to the chat widget's `desired_height` (active streaming cell + bottom pane), re-measured every frame (`tui/src/app.rs:880-920` `render_chat_widget_frame` → `tui.draw_with_resize_reflow(desired_height, ...)`). Committed history is not part of the ratatui buffer at all.
- **Committed history is written into the host terminal's scrollback with raw escape sequences.** `tui/src/insert_history.rs:1-5`: "Codex uses the terminal scrollback itself for finalized chat history, so inserting a history cell is an escape-sequence operation rather than a normal ratatui render." The mechanism (`insert_history.rs:105-215`): set a DECSTBM scroll region covering rows `1..viewport.top` (`SetScrollRegion`, line 333, emits `ESC[t;br`), move the cursor to the row above the viewport, print each pre-wrapped line preceded by `\r\n` so the region scrolls up and rows fall into scrollback, reset the region, restore the cursor. The ASCII diagram at `insert_history.rs:174-186` is the whole idea. If the viewport is not yet at the bottom of the screen it first scrolls the viewport _down_ with reverse-index (`ESC M`, lines 156-170) so history goes above it.
- **Alt screen is reserved for overlays.** `pager_overlay.rs:1-17` ("Overlay UIs rendered in an alternate screen"): the transcript pager (Ctrl+T), `/diff` (`app/event_dispatch.rs:810`), backtrack preview (`app_backtrack.rs:149`), misalignment review. `enter_alt_screen` saves the inline viewport, expands to full screen, and enables "alternate scroll" (`ESC[?1007h`) so wheel becomes arrows (`tui.rs:615-640`); `leave_alt_screen` restores the saved viewport and calls `invalidate_viewport()` because the main screen no longer matches the diff baseline (`tui.rs:642-658`).
- **The config knob is misleadingly named.** `tui.alternate_screen = auto|always|never` (`protocol/src/config_types.rs:658-666`) and `--no-alt-screen` (`tui/src/cli.rs:70-74`) only toggle `alt_screen_enabled` (`lib.rs:1848-1855`, `1653-1655`); when disabled, `enter_alt_screen()` is a no-op and overlays render as a full-height _inline_ viewport instead. The chat itself is never on the alt screen.
- **Synchronized output.** Every frame and every history flush is wrapped in `stdout().sync_update(...)` (`tui.rs:755`, `898`), i.e. `CSI ?2026h/l`, so the terminal never paints a half-scrolled state.
- **Custom `Terminal`.** `custom_terminal.rs` is a fork of `ratatui::Terminal` (header, lines 1-24) adding: a mutable `viewport_area`, `last_known_cursor_pos`, `visible_history_rows` (lines ~135-160); `clear_after_position` (505), `invalidate_viewport` which marks every previous-buffer cell `AlwaysUpdate` because "default-style spaces equal to their previous cells" would let stale terminal content show through (508-518); a smarter `diff_buffers` that finds the last non-blank column per row and emits one `ClearToEnd` instead of many space `Put`s (560-660); and a `draw` that threads OSC 8 hyperlinks through cell symbols (660-740).
- **Terminal-specific scrollback strategies.** `tui/scrollback.rs:17-84`: `Standard` (DECSTBM), `Zellij` (falls back to full-screen insertion when the wrap policy is `Terminal` so Zellij keeps soft-wrap metadata), `FullScreen` for Windows Terminal, because "partial DEC scroll regions can discard rows instead of moving them into Windows Terminal's scrollback" (line 62). `InsertHistoryMode::FullScreen` (`insert_history.rs:117-150`) clears from the viewport top and rewrites.
- **Resize reflow.** Because the terminal owns scrolled-out rows, a width change cannot re-wrap them. They keep every committed cell in memory (`App.transcript_cells: Vec<Arc<dyn HistoryCell>>`, `app.rs:471`) and, after a 75 ms debounce (`transcript_reflow.rs:18`), clear Codex-owned rows and re-emit from source at the new width (`app/resize_reflow.rs:1-16`; row cap via `terminal_resize_reflow_max_rows`). `tui/history_tail.rs:22-90` `replace_visible_history_tail` also rewrites the _last_ rendered cell in place (used when a `/status` card's numbers update after commit).
- **Frame scheduling.** `FrameRequester` → actor `FrameScheduler` coalesces requests and clamps to 120 fps (`tui/frame_requester.rs`, `frame_rate_limiter.rs:13`). Widgets never draw; they call `schedule_frame()` / `schedule_frame_in(dur)` and the loop receives one `TuiEvent::Draw`.
- **What is in the viewport.** `chatwidget/rendering.rs:10-77`: a `FlexRenderable` with the _active cell_ (the in-flight streaming/exec cell, flex 1) above the bottom pane (flex 0). `HistoryCell` (`history_cell/mod.rs:171-290`) is the unit: `display_lines(width)`, `desired_height(width)` (measured with `Paragraph::line_count`), `transcript_lines`, `raw_lines` (copy-friendly mode), `is_stream_continuation`, `transcript_animation_tick`.

### Tradeoffs they document

- Pro (why they did it): native scrollback, native selection/copy, terminal search, history survives exit, `/raw` mode gives copy-friendly plain text (`HistoryRenderMode::Raw`), no home-grown scrollback buffer.
- Con, and the cost is visible everywhere: the terminal owns rows after emission, so reflow, in-place updates, and "clear" all require heuristics (`resize_reflow.rs`, `history_tail.rs`, `history_ui.rs:284-310` `clear_scrollback_and_visible_screen_ansi` because "Terminal.app, Warp do not reliably drop scrollback when purge and clear are emitted as separate backend commands"). Zellij and Windows Terminal need special modes. tmux resize is smoke-tested manually only (`tests/suite/resize_reflow.rs:16-18`, `#[ignore]`). macOS stderr from frameworks paints over the viewport, so they redirect fd 2 (`tui/terminal_stderr.rs:1-6`). Startup must probe the cursor position to anchor the viewport (`terminal_probe.rs`).
- `styles.md` (repo root of the crate) pins the palette: default fg, ANSI cyan for input/selection, green success, red errors, magenta for Codex; explicitly avoids custom RGB, black/white, blue/yellow, enforced by `clippy.toml`.

### Steal / avoid for a Bun TUI

- Steal the split: **a bottom-anchored inline viewport for live state + scrollback insertion for committed cells + alt screen only for pagers.** It is the right model for a chat-first TUI that should feel like a shell, and it matches your product's "inline diff first, escalate to pane/IDE" ladder.
- Steal the exact escape recipe (`DECSTBM 1..top`, cursor to `top-1`, `\r\n` + line, reset, restore cursor) plus the pre-wrap-in-app policy (`HistoryLineWrapPolicy::PreWrap`) with the URL exception (URL-only lines are left unwrapped so terminals can link them, `insert_history.rs:113-125`). Do this against a VT100 emulator in tests from day one (section 9).
- Steal `sync_update` (CSI 2026) around every write, `invalidate_viewport` after any raw write, and the "diff buffers, but clear-to-EOL past the last non-blank cell" optimisation.
- Steal keeping every committed cell in memory as the source of truth and reflowing on width change. Cap it (they cap rows) and debounce.
- Avoid the terminal-name special-casing sprawl unless you observe it: start with Standard, add Windows Terminal/Zellij fallbacks only when a bug report proves them.
- Avoid a `tui.alternate_screen` knob with three values that all mean "chat is inline". If you offer a switch, make it honestly "pager uses alt screen: yes/no".

---

## 2. Event loop and app-event/command architecture

### Structure

- Two message enums: `AppEvent` (`tui/src/app_event.rs`, ~266 variants) is the _inbound_ bus "between UI components and the top-level App loop" (lines 1-9); `AppCommand` (`app_command.rs:25-95`) is the small _outbound_ set of things that become app-server RPCs (`UserTurn`, `Interrupt`, `ExecApproval`, `PatchApproval`, `UserInputAnswer`, `Compact`, `Review`, `SetThreadName`, `RunUserShellCommand`, ...). `AppEvent::CodexOp(AppCommand)` and `AppEvent::SubmitThreadOp{thread_id, op}` carry commands into the loop.
- `AppEventSender` (`app_event_sender.rs`) is a cloneable `UnboundedSender<AppEvent>` with typed convenience methods (`exec_approval`, `interrupt`, ...) and it logs every inbound event to the session JSONL log for replay (`session_log.rs`).
- `App` (`app.rs:449-560`) owns: `chat_widget`, `transcript_cells`, overlay, keymap + chord matcher, per-thread event channels (`thread_event_channels: HashMap<ThreadId, ThreadEventChannel>`), `active_thread_rx`, `pending_app_server_requests`, reconnect state, `commit_animation: Option<Interval>`.
- The loop (`app/startup.rs:83` `App::run`, `select!` at ~790-905) multiplexes: (1) `app_event_rx.recv()`; (2) the _active thread's_ buffered event receiver; (3) `tui_events.next()` (keys, paste, resize, draw, focus, resume) — gated off while startup events are pending so typeahead cannot answer a protected prompt; (4) `app_server.next_event()` (raw `AppServerEvent`); (5) an in-flight reconnect future; (6) periodic timers (rate-limit poll, terminal-title refresh, commit-animation tick). Every arm returns `AppRunControl::{Continue, Exit(reason)}`.
- Server events are routed by thread (`app/app_server_event_targets.rs:7-40`, `44-120`) into a per-thread `ThreadEventStore` (`app/thread_events.rs:40-55`) which buffers notifications/requests for threads that are not currently displayed, coalesces `AgentMessageDelta` up to 4 KB per entry and evicts past 256 KB / capacity (`app/thread_event_buffer.rs:8-10`, `52-80`). Switching threads replays the buffer into a fresh `ChatWidget`. `THREAD_EVENT_CHANNEL_CAPACITY = 32768` (`app.rs:250`).
- `ChatWidget` (`chatwidget.rs:545-560` doc) is the per-session state machine: `handle_server_notification` (`chatwidget/protocol.rs:4`) is one big match from `ServerNotification` to UI mutations; it emits `AppCommand`s via `CodexOpTarget::{Direct(channel), AppEvent}` (`chatwidget.rs:806-810`) — the `Direct` channel exists purely so tests can capture outbound ops.
- `event_dispatch.rs:27` `handle_event` is the exhaustive `AppEvent` match (3.3k lines) that delegates to submodules (`config_persistence`, `session_lifecycle`, `thread_routing`, ...).
- Key handling order (`app.rs:723-870` `handle_tui_event`): offline Ctrl+C/D short-circuit → chord matcher (`app/input.rs:57-105`) → overlay if any → global app bindings → `ChatWidget` → `BottomPane` (view stack, then composer).
- Terminal input plumbing: `tui/event_stream.rs:1-19` explains why they _drop and recreate_ crossterm's `EventStream` around external programs ("it will continue to read from stdin even if it is not actively being polled ... stealing input from other processes"). `TuiEventStream::poll_next` round-robins between the draw broadcast and crossterm to avoid starvation (lines ~300-330).
- Startup: a provisional non-submitting composer is shown while the server boots (`startup_draft.rs:1`), then handed to the real composer as a `ComposerDraftSnapshot` (`chat_composer.rs` doc "Startup Draft Handoff").

### Steal / avoid

- Steal the shape: **one inbound event enum, one small outbound command enum, a cloneable sender, one `select!` loop that owns the terminal.** In TypeScript this is a discriminated union + an async queue; keep the "widgets request a redraw, the loop draws" discipline instead of letting components render.
- Steal per-thread buffered stores with delta coalescing and bounded eviction if the TUI will show more than one session; it is what makes thread switching instant and replayable.
- Steal `CodexOpTarget::Direct` for tests: inject a channel and assert on emitted commands.
- Steal the "protected input boundary" idea in spirit (`startup_protected_input_boundary`, `tui/input_boundary.rs:24-60`): flush buffered typeahead before any prompt that can approve something. Their implementation is heavy; a simpler "discard input queued before the prompt mounted" is enough.
- Avoid a 266-variant event enum handled in a 3.3k-line match. Group by domain from the start (they retrofitted `app/*` submodules). Avoid coupling `ChatWidget` to 200 struct fields (`chatwidget.rs:561-800`); most of those are product features, not chat.

---

## 3. App-server protocol as a client/server contract

Documentation: `app-server/README.md` (3009 lines; the real spec), `app-server-protocol/src/protocol/common.rs` (the macros that define every method), `v2/*.rs` (types), `docs/protocol_v1.md` (older core SQ/EQ model), `codex app-server generate-ts|generate-json-schema` (README:66-73) which emit schemas (`app-server-protocol/schema/{json,typescript}`; stable vs `--experimental`).

### Wire and transports

- JSON-RPC 2.0 with the `"jsonrpc"` header omitted (README:22). Transports (README:24-31, `app-server-transport/src/transport/mod.rs:80-86`): `stdio` (JSONL, default; `stdio.rs`), `ws://IP:PORT` (one message per text frame, "experimental / unsupported"; `websocket.rs`), `unix://` (WebSocket frames over a `$CODEX_HOME/app-server-control/app-server-control.sock`, mode 0600, `unix_socket.rs:22`; also on Windows via a private-DACL directory), `off`. The ws listener serves `/readyz` and `/healthz` and rejects any request carrying an `Origin` header with 403 (`websocket.rs:95-105`) — a deliberate anti-CSRF stance for loopback servers.
- Backpressure: bounded channels of 128 (`transport/mod.rs:22-25`), ws outbound 32 K (`websocket.rs:45-47`); overload returns `-32001 "Server overloaded; retry later."` (README:59-63).
- Auth for non-loopback ws (`transport/auth.rs:27-80`): capability token (file or SHA-256) or signed JWT bearer with issuer/audience/skew. Loopback needs none. Remote clients attach `Authorization` only for `wss://` or `ws://localhost` (`app-server-client/src/remote.rs:119-125`).
- In-process: `app-server/src/in_process.rs:1-40` runs the same `MessageProcessor` over typed channels (no JSON on the hot path, but responses still travel in the JSON-RPC result envelope "to preserve app-server semantics"). `codex-app-server-client` (`README.md`) wraps both in-process and remote behind one `AppServerClient` enum (`src/lib.rs:317-325`) and one `AppServerEvent` stream (`:97-104`), so the TUI cannot tell which it is talking to. `TypedRequestError::{Transport, Server, Deserialize}` (`:122-135`) keeps the three failure classes distinct.

### Lifecycle

- `initialize` once per connection with `clientInfo{name,title,version}` and `capabilities{experimentalApi, requestAttestation, optOutNotificationMethods[], extensions{}}` (`v1.rs:29-70`), then the `initialized` notification. Response: `{userAgent, codexHome, platformFamily, platformOs}` (`v1.rs:70-90`). Anything before is `"Not initialized"`; a second `initialize` is `"Already initialized"` (README:94-100). Experimental methods/fields are gated by the capability and rejected with `"<descriptor> requires experimentalApi capability"` (README:2946-2956).

### Primitives (README:75-92)

- **Thread** = conversation; **Turn** = one user input → agent completion; **Item** = unit of work inside a turn. `Thread` (`v2/thread_data.rs:204-300`): `id` (UUIDv7), `sessionId`, `forkedFromId`, `parentThreadId`, `preview`, `ephemeral`, `historyMode: legacy|paginated`, `modelProvider`, `model`, `reasoningEffort`, `createdAt/updatedAt/recencyAt`, `status`, `path`, `cwd`, `cliVersion`, `source`, `name`, `gitInfo`, `turns: Vec<Turn>` (populated only on resume/read/fork). `ThreadStatus` (`v2/thread.rs:1645-1662`): `notLoaded | idle | systemError | active{activeFlags: [waitingOnApproval|waitingOnUserInput]}`.
- `Turn` = `{id, items, status: completed|interrupted|failed|inProgress, error?}` (`v2/turn.rs:32-37`). `TurnStartParams` (`v2/turn.rs:156-268`): `threadId`, `clientUserMessageId`, `input: UserInput[]`, plus sticky overrides (`cwd`, `approvalPolicy`, `approvalsReviewer`, `sandboxPolicy`|`permissions`, `model`, `effort`, `summary`, `personality`, `serviceTier`, `outputSchema`, `collaborationMode`). `UserInput` (`v2/turn.rs:394-430`): `text{text, textElements[]}`, `image{url}`, `localImage{path}`, `audio`, `localAudio`, `skill{name,path}`, `mention{name,path}`.
- `ThreadItem` (`v2/item.rs:234-420`, README:1889-1925): `userMessage`, `agentMessage{text, phase, delivery: async?, questions?}`, `plan`, `reasoning{summary, content}`, `commandExecution{command, cwd, status, commandActions, aggregatedOutput, exitCode, durationMs}`, `fileChange{changes[{path,kind,diff}], status}`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `webSearch`, `imageGeneration`, `imageView`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`, `functionCallOutput`, `hookPrompt`.

### Methods (158 client requests, `common.rs:506-1430`)

Core subset: `thread/start|resume|fork|read|list|search|loaded/list|archive|unarchive|delete|unsubscribe|name/set|compact/start|shellCommand|rollback|revert|metadata/update`, `thread/turns/list`, `thread/items/list` (pagination), `thread/queue/{add,list,update,delete,reorder,start}` (server-side queued follow-ups, experimental), `turn/start|steer|interrupt|settings/update`, `review/start`, `model/list`, `permissionProfile/list`, `config/read|value/write|batchWrite`, `account/read|login/start|login/cancel|logout|rateLimits/read|usage/read`, `skills/list`, `mcpServerStatus/list`, `fuzzyFileSearch/session{Start,Update,Stop}`, `fs/*`, `command/exec*`, `process/*`, `feedback/upload`, `remoteControl/*`, `project/*`, `threadSection/*`.

### Server → client

- **Server requests** (9, need a response; `common.rs:1696-1850`): `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/permissions/requestApproval`, `item/tool/call` (dynamic tools), `account/chatgptAuthTokens/refresh`, `attestation/generate`, `currentTime/read`. Decision enums (`v2/item.rs:64-82`, `113-122`): command `accept | acceptForSession | acceptWithExecpolicyAmendment{..} | applyNetworkPolicyAmendment{..} | decline | cancel`; file change `accept | acceptForSession | decline | cancel`. `decline` continues the turn; `cancel` interrupts it. Request params carry `threadId`, `turnId`, `itemId`, `startedAtMs`, `approvalId?`, `reason?`, `command`, `cwd`, `commandActions` (parsed for display), `availableDecisions?` (server-chosen option list; `v2/item.rs:1533-1610`).
- **Notifications** (~80, `common.rs:1851-2100`): `thread/started|status/changed|closed|archived|deleted|name/updated|tokenUsage/updated|queue/changed|settings/updated`, `turn/started|completed|diff/updated|plan/updated`, `item/started|completed`, deltas `item/agentMessage/delta`, `item/plan/delta`, `item/reasoning/{summaryTextDelta,summaryPartAdded,textDelta}`, `item/commandExecution/outputDelta`, `item/commandExecution/terminalInteraction`, `item/fileChange/patchUpdated`, `serverRequest/resolved`, `mcpServer/startupStatus/updated`, `account/updated|rateLimits/updated`, `error{error, willRetry, threadId, turnId}`, `warning`, `configWarning`, `deprecationNotice`, `model/rerouted`, `model/safetyBuffering/updated`, `fs/changed`, `fuzzyFileSearch/sessionUpdated`.
- Item lifecycle invariant (README:1871): `item/started` → 0..n item-specific deltas → `item/completed`, and `item/completed` is authoritative. `turn/completed` carries only the final agent message as a summary fallback (README:1885).
- `error` with `willRetry: true` does not fail the turn; `codexErrorInfo` is a closed-ish enum (`ContextWindowExceeded`, `UsageLimitExceeded`, `ActiveTurnNotSteerable{turnKind}`, `HttpConnectionFailed{httpStatusCode}`, ...; README:1953-1988).

### Resumption, forking, pagination

- `thread/resume` returns the thread with `turns` hydrated (deprecated for paginated threads; pass `excludeTurns: true` and page with `thread/turns/list` / `thread/items/list` using `turnsBackwardsCursor`/`itemsBackwardsCursor`; README:380-470). Resuming a running thread "atomically" sends history and subscribes for new updates (`app-server/src/thread_state.rs:60-63` `SendThreadResumeResponse`). Only one app-server process may hold a paginated thread for writing; a second gets `-32600` (README:456).
- `thread/fork` copies history into a new id, snapshots a running source as if interrupted; `ephemeral: true` for in-memory branches (README:498-520). The TUI's Esc-Esc "edit previous prompt" is implemented as a fork before the selected turn (`app_backtrack.rs:1-15`).
- `turn/steer` appends input to the _active_ turn and requires `expectedTurnId` (README:1477-1494; `v2/turn.rs:277-300`); the TUI resyncs on `expected active turn id ... but found ...` mismatch by parsing the error message (`app.rs:735-760`), which is a smell they live with.
- `turn/interrupt` → `turn/completed{status: interrupted}` is the only completion signal (README:1375-1387).

### Multiple clients on one server

- The server tracks `live_connections` and per-thread `connection_ids` (`app-server/src/thread_state.rs:286-330`, `534-582`). `thread/start|resume|fork` auto-subscribe the calling connection; when a thread is created the server attaches listeners for **all initialized connections** (`app-server/src/lib.rs:1195-1215`). Notifications are `Broadcast` or `ToConnection` envelopes (`outgoing_message.rs:96-105`); thread-scoped sends go to the subscribed connection set (`ThreadScopedOutgoingMessageSender`, `:117-160`).
- Server requests (approvals) are sent to the thread's subscribers; when any client answers, the server emits `serverRequest/resolved{threadId, requestId}` so the others dismiss their modal (README:1999-2004; `BottomPaneView::dismiss_app_server_request`, `bottom_pane_view.rs:135-141`; `app/app_server_requests.rs:52-72`). Pending requests are _replayed_ to a connection that subscribes later (`outgoing_message.rs:362` `replay_requests_to_connection_for_thread`).
- `thread/unsubscribe`; a thread with no subscribers and no activity unloads after `thread_unload_delay_secs` (default 60) and emits `thread/closed` (README:669-704).
- Stdio is "single client mode": stdin EOF shuts the server down (`lib.rs:741`, `1060-1072`). Socket/ws modes are multi-client, with a graceful-restart signal path that waits for running turns to finish.
- Daemon: `codex app-server daemon start|restart|stop|bootstrap --remote-control` (`app-server-daemon/README.md`); every command prints one JSON object; pidfile + lock under `CODEX_HOME/app-server-daemon/`. The TUI probes the default socket for 50 ms at startup (`tui/src/lib.rs:452-489`) and silently falls back to embedded if the daemon is absent or refuses (`:490-530`). Reconnect after a drop: fresh client, `initialize`, `thread/resume` with `PreserveExistingThread`, backoff `[0,1,2,4,8]s` under a 120 s deadline, and "no user operation is retried" (`tui/src/app/reconnect.rs:1-4`, `53-56`).

### Auth

- Auth is a server concern surfaced as RPCs (README:2572-2895): `account/read` → `{account: {type: chatgpt|apiKey|...}, requiresOpenaiAuth}`, `account/login/start{type: apiKey|chatgpt|chatgptDeviceCode|amazonBedrock...}` → for browser flow returns `{loginId, authUrl}` and the server hosts the localhost callback; device-code returns `{verificationUrl, userCode}` and "the frontend owns the UX"; `account/login/completed` and `account/updated{authMode, planType}` notifications; `account/logout`. `clientInfo.name` is also the compliance-log identity (README:170-176).

### Steal / avoid

- Steal the three-level model **thread → turn → item** with `item/started` / deltas / `item/completed` and "completed is authoritative". Your event-log/projection spine already matches it; expose it over the wire the same way.
- Steal **server-initiated requests for approvals** (a real JSON-RPC request with an id, not a notification plus a follow-up call) + `serverRequest/resolved` for multi-client dismissal + replay of pending requests to late subscribers. This is exactly the shape you need for "answer in the GUI or the TUI, whichever is open".
- Steal `clientUserMessageId` on every user input so a client can reconcile its optimistic echo with `item/completed{userMessage.clientId}`.
- Steal the explicit `initialize` handshake with `optOutNotificationMethods` (a TUI does not want `item/reasoning/textDelta` for every model) and the schema-generation command (`generate-ts`); a TS TUI should import the same contract types the web client uses from `packages/contracts`, not a second hand-written copy.
- Steal the daemon discovery + embedded fallback pattern only if the TUI must work without the server running; otherwise prefer "connect or fail loudly".
- Avoid parsing error _messages_ to recover state (`active_turn_steer_race`, `app.rs:735-760`). Put `actualTurnId` in structured error `data`.
- Avoid 158 methods. Their surface grew with the product; a thread/turn/item core plus approvals, list/resume, and config is enough for a first TUI.

---

## 4. Composer / bottom pane UX

### Architecture

- `BottomPane` (`bottom_pane/mod.rs:1-17`, struct at 222-260) owns the `ChatComposer` and a `view_stack: Vec<Box<dyn BottomPaneView>>` of modals/popups that _replace_ the composer while retaining its draft. Routing (`mod.rs:717-820`): if a view is on the stack, keys go to it (Esc first offered as `on_ctrl_c` cancellation unless the view `prefer_esc_to_handle_key_event`); otherwise inline banners, then the interrupt binding while a task runs, then the composer.
- `BottomPaneView` trait (`bottom_pane_view.rs:20-160`): `handle_key_event`, `is_complete`, `completion() -> Accepted|Cancelled`, `on_ctrl_c`, `handle_paste`, `pre_draw_tick(now)`, `next_frame_delay`, `try_consume_approval_request` (a view can absorb a new approval into itself), `dismiss_app_server_request`, `terminal_title_requires_action`, `keymap_contexts`.
- Renderables compose via a tiny layout trait `Renderable { render, desired_height(width), cursor_pos, cursor_style }` with `FlexRenderable`, `ColumnRenderable`, `InsetRenderable` (`render/renderable.rs:15-31`). Height-first layout: everything reports its height for a width, and the viewport is sized to the sum.

### Multiline editing

- `ChatComposer` module doc (`bottom_pane/chat_composer.rs:1-230`) is the spec; read it in full. Highlights: `Enter` submits, `Tab` queues while a task runs (else submits), `Ctrl+J`/`Shift+Enter` newline (Shift+Enter requires keyboard-enhancement), `!` prefix enters shell mode, Vim mode with normal/insert/replace/operator-pending and `/`-search (`textarea/vim*.rs`), a single-entry kill buffer that survives submit so `Ctrl+K` ... `Ctrl+Y` works across a send (`textarea.rs:1-17`).
- `TextArea` (`bottom_pane/textarea.rs`) owns text, "element" ranges (atomic placeholders that the cursor cannot enter: `[Pasted Content N chars]`, `[Image #N]`, mentions), wrap cache, and hyperlink carry-over across wrapped rows.
- History (`chat_composer_history.rs:1-18`): Up/Down merges persistent cross-session text history (fetched from the server by offset) with local in-session entries that retain attachments; `Ctrl+R` reverse search with query-independent batched fetches.
- Large-input guard: `LARGE_PASTE_CHAR_THRESHOLD = 1000` (`chat_composer.rs:365`); larger pastes become a placeholder element and the payload is stored in `pending_pastes` and expanded at submit.

### Slash commands, `@` mentions, `$` skills

- `SlashCommand` enum (`slash_command.rs:12-90`) with `description()`, `supports_inline_args()`, `available_during_task()`, `available_in_side_conversation()`, `is_visible()` (platform/debug gating). Order of the enum is the popup order ("DO NOT ALPHA-SORT", line 13). The popup (`command_popup.rs`) filters as you type and hides aliases; numeric shortcuts pick rows.
- File search: `file_search.rs:1-6` — the composer emits `AppEvent::StartFileSearch(query)` on every `@token` change; `FileSearchManager` keeps one `codex-file-search` session, updates the query per keystroke, and results carry the query so stale results are dropped (`file_search_popup.rs:60-70` `set_matches` ignores non-matching query). Mentions v2 (`bottom_pane/mentions_v2/`) unify files, skills, plugins, apps in one popup.
- Popup rows are a shared `GenericDisplayRow {name, match_indices, description, category_tag, disabled_reason, display_shortcut}` (`selection_popup_common.rs:44-60`) rendered by `ListSelectionView` (supports side-by-side detail panel, tabs, numeric shortcuts).

### Paste and images

- Bracketed paste arrives as `TuiEvent::Paste`; CRLF normalised at the app layer (`app.rs:797-804`). For terminals without bracketed paste (Windows), `paste_burst.rs:1-140` is a pure state machine that reclassifies rapid `KeyCode::Char` streams as a paste, holds the first ASCII char briefly to avoid flicker, never holds non-ASCII (IME), and keeps an "Enter means newline" window after a burst.
- Images: `Ctrl+V`/`Alt+V` reads the clipboard via `arboard` (files preferred over bitmap), encodes PNG to a temp file, and attaches it as `[Image #N]` (`clipboard_paste.rs:49-90`, `chatwidget/interaction.rs:86-110`). Pasted text that is a path to an image file is also attached (`chat_composer.rs:1267` `handle_paste_image_path`). Remote image URLs from history render as non-editable rows above the textarea (doc "Remote Image Rows").
- Copy: `/copy` and `Ctrl+O` pick OSC 52 over SSH, else native clipboard, else WSL PowerShell, else OSC 52; Linux keeps an `arboard` lease alive because X11/Wayland clipboards vanish when the owner exits (`clipboard_copy.rs:1-19`). Markdown copies also put HTML on the clipboard (`clipboard_html.rs`).

### Approvals and questions

- `ApprovalOverlay` (`approval_overlay.rs:1-13`, `71-77`) wraps `ApprovalRequest::{Exec, Permissions, ApplyPatch, McpElicitation}` in a `ListSelectionView` with per-kind options built from the server's `availableDecisions` (or heuristics, `app.rs:340-380`); it queues multiple requests, and MCP elicitation keeps Esc = Cancel regardless of keymap. Contract 1: selection always emits an explicit decision event.
- Anti-mis-click: an approval that arrives within 1 s of composer typing is _delayed_ until typing stops (`APPROVAL_PROMPT_TYPING_IDLE_DELAY`, `bottom_pane/mod.rs:209`, `1635-1670`), and the startup boundary discards queued typeahead before a prompt mounts.
- `request_user_input` gets a dedicated overlay (`request_user_input/mod.rs:1-8`): per-question options + notes, typing jumps to notes, Enter advances, last question submits, unanswered-questions confirmation. Async questions (agent asks without ending the turn) render _inline_ above the composer with an expand toggle rather than stealing focus (`async_questions/mod.rs:1-3`).

### Queued messages, steer, interrupt

- `InputQueueState` (`chatwidget/input_queue.rs:20-50`): `queued_user_messages` (Tab while running), `pending_steers` (submitted via `turn/steer`, not yet echoed), `rejected_steers_queue` (steer refused because turn kind not steerable, retried later), `user_turn_pending_start`. A `PendingInputPreview` renders them above the composer (`pending_input_preview.rs`), and the `edit_queued_message` binding pops the newest back into the composer (`interaction.rs:120-132`).
- Esc interrupts the running turn (`interrupt_turn` in `ChatKeymap`); double-press-to-quit is implemented but disabled (`DOUBLE_PRESS_QUIT_SHORTCUT_ENABLED = false`, `mod.rs:213`) because "requiring a double press to quit feels janky".
- `InterruptManager` (`chatwidget/interrupts.rs:1-30`) queues prompt overlays that arrive while another interrupt (modal) is visible.

### Status and hints

- `StatusIndicatorWidget` (`status_indicator_widget.rs:1-8`): one live row above the composer with animated header ("Working"/"Thinking: <bold reasoning header>"), elapsed clock, interrupt hint, inline background-process summary, wrapped details up to 3 lines. It is hidden the moment streamed assistant text starts committing (`chatwidget/streaming.rs:40-45`).
- `footer.rs:1-45`: pure function of `FooterProps` → lines; `FooterMode::{HistorySearch, QuitShortcutReminder, ShortcutOverlay ('?'), EscHint, ComposerEmpty, ComposerHasDraft}`; width-based collapse rules for a single line; contextual mode shows the user-configurable status line (`/statusline` picker, `status_line_setup.rs:1-22`: model, cwd, git branch, context %, limits, thread title) and the active agent label.
- Terminal title is also driven from state (`terminal_title.rs:1-16`, sanitised for control/bidi chars), with "Action Required" when a modal blocks.

### Steal / avoid

- Steal the **view stack over a retained composer**, the `BottomPaneView` trait surface (especially `pre_draw_tick`, `next_frame_delay`, `try_consume_*`, `dismiss_app_server_request`), and height-first `Renderable` layout.
- Steal atomic placeholder elements for large pastes/images/mentions with byte-range `textElements` sent to the server; it keeps the wire text small and the composer editable.
- Steal the file-search session pattern (one long-lived fuzzy session, per-keystroke query update, results tagged with query). Your server already has search; expose it as a session RPC.
- Steal the typing-idle approval delay and typeahead discard; they are cheap and prevent the worst class of "I approved by accident" bugs.
- Steal `availableDecisions` from the server; the client should render what the server says is possible.
- Steal the footer-as-pure-function with an explicit `FooterMode` and collapse rules.
- Avoid the paste-burst machine unless Windows-without-bracketed-paste is a target; it is 600 lines of heuristics. Avoid a full Vim emulator in v1 (their `textarea/vim*.rs` is thousands of lines); ship Emacs-style bindings and add Vim later behind a flag.

---

## 5. History cell rendering

- **Cells.** `HistoryCell` (`history_cell/mod.rs:171-290`) + concrete cells: `PlainHistoryCell`, `CompositeHistoryCell`, `PrefixedWrappedHistoryCell` (`base.rs`), `UserHistoryCell` (styled elements, sanitises CSI/control chars from user text, `messages.rs:11-80`), `AgentMarkdownCell` (source-backed, re-renders on width change, single-entry `MarkdownRenderCache` keyed by width + syntax theme revision + terminal fg/bg + color level, `markdown_render_cache.rs:12-48`), `ExecCell` (grouped commands, `exec_cell/model.rs:1-7`), patch/diff cells, MCP, plan, session header, approvals decision cells, notices.
- **Markdown.** `pulldown-cmark` → styled ratatui lines in `markdown_render.rs` (2.7k lines: headings keep their `#`, lists with colored markers, blockquotes with line-level style, tables with a width-allocation pipeline that falls back to key/value records when columns cannot fit, `:1-40`). `markdown.rs:1-21` unwraps ` ```md ` fences that contain tables because LLMs wrap tables in code fences. Local file links are resolved relative to cwd; web links become OSC 8 hyperlinks carried out-of-band so they never affect wrapping (`terminal_hyperlinks.rs:1-5`).
- **Code.** `syntect` + `two-face` (~250 languages, 32 themes), five process globals, hard limits (512 KB, 10k lines, 4 KiB/line) beyond which it returns plain text (`render/highlight.rs:1-25`); `StreamingCodeHighlighter` keeps parser state per open fence so streamed code highlights append-only (`render/highlight_streaming.rs:1-20`). `/theme` live-previews themes and bumps a `THEME_REVISION` that invalidates caches.
- **Diffs.** `diff_render.rs:1-33`: unified diff → line numbers + gutter sign + content, per-hunk syntax highlighting (parser state preserved within a hunk, deliberately not across hunks), theme-aware backgrounds probed from OSC 11 (dark tints vs GitHub-style light pastels) with separate truecolor / 256 / 16-color palettes, hard wrap preserving span styles. `FileChange::{Add, Delete, Update{unified_diff, move_path}}` (`diff_model.rs`). `/diff` runs `git diff` + untracked files through the workspace command runner (which can be remote) with hooks and executable filters disabled (`get_git_diff.rs:1-6`, `20-25`) and shows the ANSI output in the alt-screen pager.
- **Exec output.** Head/tail preview capped at `TOOL_CALL_MAX_LINES = 5` (50 for user `!` shells), full output in the transcript overlay; the live buffer is bounded to 1 MB and keeps the first/last 50 lines with per-line head/tail truncation so a command that never prints a newline cannot grow the active cell (`exec_cell/render.rs:32-34`, `live_output.rs:5-20`). ANSI in command output is parsed into styled spans (`codex-ansi-escape`), never passed raw.
- **Streaming.** Two-region model (`streaming/controller.rs:1-36`): source accumulates; only newline-terminated source is re-rendered; rendered lines split into a _stable_ prefix that is enqueued to scrollback and a mutable _tail_ shown in the active cell. Tables are held back entirely until finalisation (column widths change with every row). `MarkdownStreamCollector` (`markdown_stream.rs:1-9`) defines the newline commit boundary; `markdown_render/streaming.rs:1-4` reports the byte offset of the last top-level block so only the final block is mutable. Commit ticks run at the frame interval (`app.rs:432-436`), one line per tick in `Smooth` mode, everything in `CatchUp` mode with hysteresis thresholds on queue depth/age (`streaming/chunking.rs:1-30`). On finalisation the run of streamed cells is consolidated into one source-backed `AgentMarkdownCell` so reflow re-renders from markdown, not from wrapped lines (`chatwidget/streaming.rs:24-70`, `AppEvent::ConsolidateAgentMessage`).
- **Wrapping.** `wrapping.rs:1-26`: `textwrap` with URL-aware adaptive wrapping (never split URLs; mixed prose wraps at words); `live_wrap.rs` `RowBuilder` for incremental plain-text rows with `drain_commit_ready(max_keep)`; `line_truncation.rs` grapheme-aware truncation with ellipsis; `width.rs` display width; `unicode-segmentation` everywhere.
- Reasoning: summary deltas stream into the status header (first bold phrase becomes "Thinking: ...", `chatwidget/streaming.rs:9-20`), raw reasoning only with `show_raw_agent_reasoning`.

### Steal / avoid

- Steal **source-backed cells**: keep the markdown/diff/command source and render at the current width with a one-entry cache keyed by width+theme; never store wrapped lines as truth.
- Steal newline-gated streaming with a stable/tail split and table holdback; it is the difference between "typewriter that reflows every token" and a calm stream. Steal the smooth/catch-up drain with hysteresis.
- Steal the 5-line exec preview + full transcript, bounded live output with head/tail, and ANSI-to-spans parsing of tool output.
- Steal the URL-preserving wrap and OSC 8 out-of-band hyperlinks.
- Steal fence unwrapping for tables and the key/value fallback for narrow tables.
- Avoid embedding a 250-grammar highlighter unless startup cost is acceptable (syntect load is measurable); in TS, a small `shiki`/`highlight.js` subset or a lazy loader is the equivalent. Avoid per-cell `Paragraph::line_count` in hot paths without caching (they cache aggressively for a reason).

---

## 6. Keymap and key hints

- `KeyBinding {key, modifiers}` (`key_hint.rs:38-48`) with `is_press` matching Press|Repeat only and normalisation (`:119-135`): raw C0 control chars map to `ctrl-<letter>` (for terminals that send `\x10` for Ctrl+P), uppercase letters become `shift-<lower>`, `Ctrl+5` aliases `Ctrl+]`. `is_plain_text_key_event` (`:160-172`) is the shared boundary between "text input" and "navigation" for searchable lists.
- Display labels: `ctrl + `, `shift + `, `⌥ + ` on macOS / `alt + ` elsewhere, arrows as glyphs, `key_hint_style()` = dim (`:200-260`). Hints are `Span`s built from bindings so the footer always reflects the live keymap.
- `RuntimeKeymap` (`keymap.rs:1-66`, `68-83`) resolves `tui.keymap.<context>` → `tui.keymap.global` → built-in defaults into per-context structs: `AppKeymap` (open transcript, external editor, copy, clear, toggle vim/raw), `ChatKeymap` (interrupt, reasoning up/down, permission mode prev/next, edit queued message), `ComposerKeymap` (submit, queue, toggle shortcuts, history search), `EditorKeymap` (Emacs-style movement/kill/yank), `VimNormal/Operator/TextObject/Search`, `PagerKeymap`, `ListKeymap` (`ListAction`), `AgentsKeymap`, `ApprovalKeymap`. Uniqueness/shadowing is validated at load with actionable error messages (`keymap.rs:2171-2300`); invalid config aborts startup with a pointer to the docs (`app/startup.rs:520-530`).
- Two-key chords: `KeyChordMatcher` with `KEY_CHORD_TIMEOUT` and a footer hint override "`ctrl + x …` waiting for next key / esc cancel" (`app/input.rs:57-105`, `keymap/chords.rs`).
- Keymap contexts are computed from what is focused (`app/input.rs:118-132` `active_keymap_contexts`: pager, or view/composer contexts plus Global+Chat when no modal).
- `/keymap` opens an interactive picker that captures a key press and writes config (`keymap_setup/{picker,capture,debug}.rs`).
- Legacy-terminal quirk: without keyboard enhancement, `Alt+x` and `Esc x` are indistinguishable; `should_recover_vim_insert_escape` (`app/input.rs:12-50`) re-splits them when Vim insert mode is waiting for Esc.

### Steal / avoid

- Steal the normalisation table (C0 → ctrl, uppercase → shift) and `is_plain_text_key_event`; these are the two things every TS TUI gets wrong first.
- Steal context-scoped keymaps resolved once into per-context objects, validated for shadowing, with hints generated from the resolved bindings. Your `keymap/` layer already owns command enablement; extend it, do not fork it for the TUI.
- Steal the chord footer hint.
- Avoid shipping a `/keymap` capture UI before the keymap is stable; config-file remapping is enough initially.

---

## 7. External editor handoff

- Trigger: `Ctrl+G` (default `open_external_editor`). The composer sets `ExternalEditorState::Requested`; the _next draw_ flips it to `Active` and emits `AppEvent::LaunchExternalEditor` (`app.rs:857-861`) so the hint "Save and close external editor to continue." is painted before the terminal is handed over.
- `external_editor.rs:37-56`: `VISUAL` then `EDITOR`, split with `shlex` (Unix) or `winsplit` (Windows), `.cmd` shims resolved with `which`. The temp file is a `.md` under a `CODEX_HOME/editor/` directory that is verified to be _outside_ the sandbox's writable roots and free of symlinks (`:58-165`) so an agent cannot tamper with the draft; content is seeded and read back after a successful exit (`:168-225`).
- Terminal handover: `Tui::with_restored` (`tui.rs:508-550`) pauses (drops) the crossterm event stream, leaves the alt screen if active, `restore_keep_raw()` (pops keyboard-enhancement flags, disables bracketed paste, keeps raw mode), un-suppresses stderr, runs the future, then re-applies modes, **flushes the kernel input buffer** (`tcflush`/`FlushConsoleInputBuffer`) so keys typed at the editor do not leak into the composer, re-enters the alt screen, resumes events, and schedules a size re-check.
- The edited text replaces the draft via `apply_external_edit` (`chat_composer.rs:1324`), preserving placeholders where possible.

### Steal / avoid

- Steal every step of `with_restored`, in that order; the input-buffer flush and the "drop the stdin reader, do not just stop polling" rule (`event_stream.rs:11-19`) are the parts people miss.
- Steal `.md` suffix (editors highlight it) and the draw-then-launch sequencing.
- The non-writable-directory check matters only if your agent sandbox could reach the temp dir; keep it if your server runs tools with write access to `$HOME`.

---

## 8. Terminal capability handling

- **Modes** (`tui.rs:214-235` `set_modes`): bracketed paste, raw mode, keyboard enhancement (kitty protocol), focus-change reporting (Unix only; disabled on Windows). `restore_after_exit` (`tui.rs:311-322`) uses a stronger reset (`ESC[<u` to pop _all_ enhancement levels, `keyboard_modes.rs:229-240`) because terminals sometimes miss the stack pop.
- **Kitty keyboard protocol** (`tui/keyboard_modes.rs`): flags `DISAMBIGUATE_ESCAPE_CODES | REPORT_ALTERNATE_KEYS`, plus `REPORT_EVENT_TYPES` except on Ghostty/iTerm2 (leak release events) and tmux without `extended-keys-format=csi-u` (loses Shift+Enter) (`:162-176`). In tmux they _shell out_ to `tmux display-message -p '#{extended-keys-format}'` and only enable xterm `modifyOtherKeys` (`ESC[>4;2m`) when csi-u is confirmed (`:178-215`). Disabled entirely via `CODEX_TUI_DISABLE_KEYBOARD_ENHANCEMENT` or automatically for VS Code terminal under WSL (`:19-40`, probing the Windows side with `cmd.exe /c set TERM_PROGRAM`). Support is probed at startup with a 100 ms deadline (`terminal_probe.rs:24`, `tui.rs:275-300`); `enhanced_keys_supported` drives whether Shift+Enter is advertised.
- **Startup probes** (`terminal_probe.rs:1-25`): cursor position (CPR), default fg/bg (OSC 10/11), keyboard enhancement, all on a duplicated fd or `/dev/tty` with a bounded timeout; consumed bytes that were user input are replayed into crossterm's parser. On Windows, OSC probes are deferred until after protected startup screens because late replies could be misread as key presses (`tui.rs:308-320`, `app/startup.rs:66-78`). Focus-gained does _not_ re-probe colors (`event_stream.rs:233-236`).
- **Colour**: `supports-color` → `TrueColor|Ansi256|Ansi16|Unknown` (`terminal_palette.rs:7-20`); Windows Terminal forced to truecolor when `WT_SESSION` is set unless `FORCE_COLOR` overrides (`:44-70`); `best_color()` quantises RGB to the nearest xterm colour; light/dark detection from OSC 11 chooses diff palettes; `styles.md` forbids custom colours in ordinary UI.
- **Windows/ConPTY**: `ensure_virtual_terminal_processing` on stdout/stderr before every draw (`tui.rs:1170-1215`); input record mode is forced off `ENABLE_VIRTUAL_TERMINAL_INPUT` and re-asserted every poll because another console client can flip it back (`tui/windows_console.rs`, `event_stream.rs:118-135`); `FullScreen` scrollback strategy for Windows Terminal; `winsplit`/`which` for editor commands; a Windows sandbox setup flow.
- **tmux/Zellij**: detection via `TMUX`/`TMUX_PANE`/`ZELLIJ_VERSION` (`terminal-detection/src/lib.rs:56-70`); Zellij insertion mode; tmux clipboard used before OSC 52 over SSH (`clipboard_copy.rs:8-10`).
- **Job control**: Ctrl+Z is handled in the event stream: leave alt screen, place the cursor on the viewport's last row, `SIGTSTP`, and on resume re-enable raw mode and realign the viewport with a fresh CPR probe (`tui/job_control.rs:26-80`, `TuiEvent::Resume`).
- **Notifications**: OSC 9 on Ghostty/iTerm2/Kitty/Warp/WezTerm, else BEL, only when unfocused by default (`notifications/mod.rs`, `tui.rs:553-580`).
- **Panics**: hook restores the terminal before printing (`tui.rs:336-342`, `lib.rs:1015-1024`); `TerminalInitializationGuard` restores if init fails halfway (`input_boundary.rs:12-22`).
- **Screen size**: never query the backend on ordinary draws; cache the last size and only re-sample after resize/resume/external program with a debounce (`tui/screen_size.rs`).

### Steal / avoid

- Steal: bounded startup probes with a fallback; kitty flags without `REPORT_EVENT_TYPES` on the known-bad terminals; the strong `ESC[<u` reset on exit; `sync_update`; job-control handling; OSC 9 notifications gated on focus; `WT_SESSION`/`FORCE_COLOR` colour rules.
- Steal the _policy_ of caching terminal size and avoiding CPR queries during normal operation (queries race the input reader).
- Avoid shelling out to `tmux` at startup unless you observe the Shift+Enter bug; in Bun a spawn at startup is a visible latency hit.
- Avoid the Windows-side probing via `cmd.exe` in WSL; document `CODEX_TUI_DISABLE_KEYBOARD_ENHANCEMENT`-style env instead.

---

## 9. Testing strategy

- **VT100 backend.** `tui/src/test_backend.rs:13-25` wraps `CrosstermBackend<vt100::Parser>`: every escape sequence the app emits is fed to a real VT100 emulator (with optional scrollback), and tests assert on `screen().contents()` or per-cell `fgcolor()`. Because the backend overrides `size`/`get_cursor_position`, no crossterm call touches the real stdout. This is what makes scrollback insertion testable: `tests/suite/vt100_history.rs` (wrapping, emoji/CJK, styled spans, blockquote colour on every wrapped row), `vt100_live_commit.rs` (RowBuilder commit), `insert_history.rs` unit tests (nested list markers keep colour), `custom_terminal/tests/`, `tui/scrollback_tests.rs`, `tui/history_tail_tests.rs`.
- **Snapshot tests.** 857 `insta` `.snap` files, mostly of `format!("{buf:?}")` of a rendered `Buffer` or of `lines_to_single_string(cell)`: composer states (`bottom_pane/snapshots`), chat widget frames (`chatwidget/snapshots`), history cells, markdown tables, status cards, onboarding. Paths are normalised for Windows (`chatwidget/tests/helpers.rs:40-95`).
- **Widget harness.** `make_chatwidget_manual` (`chatwidget/tests/helpers.rs:154-220`) builds a `ChatWidget` with a default config in a temp `CODEX_HOME`, an `AppEvent` receiver and an `Op` receiver (`CodexOpTarget::Direct`), then tests feed protocol notifications (`handle_exec_approval_request`, `replay_agent_message_delta`, `complete_user_message`), press keys, render into a `Buffer`, and assert on emitted `AppCommand`s (`next_submit_op`). `app/test_support.rs:13` `make_test_app` builds a full `App`; `tui/test_support.rs` `make_test_tui` builds a `Tui` with a fake 80x24 size. `FrameRequester::test_dummy()` and paused tokio time (`frame_requester.rs` tests) make animation deterministic. `FakeEventSource` swaps crossterm in the event broker (`event_stream.rs:330-380`).
- **Real server in tests.** `app_server_session.rs` tests start an _embedded_ app-server (`start_embedded_app_server_for_picker`, `lib.rs:557-573`) and exercise `thread/start|resume|fork` against it; `app/tests/` replays buffered thread events.
- **PTY end-to-end.** `tests/suite/focus_palette.rs` spawns the real binary in a pty (`PtyCodex`), writes `ESC[I` + text, asserts nothing is dropped; `tests/suite/reconnect.rs` binds a fake unix-socket WebSocket app-server that speaks just enough JSON-RPC to accept `initialize`/`thread/resume`, drops the connection, and asserts the TUI reconnects and preserves the draft. `resize_reflow.rs` is a tmux smoke test, `#[ignore]`d.
- **Unit-level purity.** Paste burst, chunking policy, footer collapse, key normalisation, keymap conflicts, wrapping and truncation are all pure and tested in isolation; the module docs list invariants that tests enforce.
- Debug tooling: `md-events` binary dumps pulldown-cmark events (`src/bin/md-events.rs`); `session_log.rs` writes an inbound-event JSONL for replay; `app-server-test-client` is a scriptable JSON-RPC client for the server.

### Steal / avoid

- Steal the VT100 test backend as the first thing you build. In Bun, feed your writer's bytes into an `@xterm/headless` (or a small VT parser) instance and assert on the screen; keep a `size()` override so nothing touches the real tty. Test the scrollback insertion, wrapping, and colour-per-wrapped-row cases exactly as `vt100_history.rs` does.
- Steal buffer snapshots for widgets and plain-text snapshots for cells; keep them small and normalised.
- Steal the "widget + injected command channel + protocol notifications in, commands out" harness; it fits your repo rule of driving real app code (a real in-process server via `createApp`/treaty is the analogue of their embedded app-server).
- Steal the fake-server reconnect test shape (a tiny scripted WS server) for your daemon/socket path.
- Avoid pty tests in CI except a couple of smoke tests; they are slow and flaky by their own admission (`STARTUP_TIMEOUT` 30 s under Rosetta).

---

## 10. Distribution

- **Single static binary per target.** Workspace release profile: `lto = "thin"`, `codegen-units = 4`, `debug = "line-tables-only"`, `strip = false` until symbols are archived (`codex-rs/Cargo.toml:589-598`). Targets: `x86_64/aarch64-unknown-linux-musl`, `x86_64/aarch64-apple-darwin`, `x86_64/aarch64-pc-windows-msvc` (`codex-cli/bin/codex.js:15-22`). One `codex` binary hosts every subcommand (`cli/src/main.rs:147-243`: `exec`, `resume`, `fork`, `login`, `mcp-server`, `app-server {daemon, proxy, generate-ts}`, `sandbox`, ...) and the TUI is the default command; `arg0` dispatch (`arg0/src/lib.rs`) lets the same executable act as `apply_patch`, the Linux sandbox helper, and an execve wrapper when invoked under those names.
- **npm wrapper.** `@openai/codex` (`codex-cli/package.json`) ships only `bin/codex.js`; platform binaries are optional dependencies `@openai/codex-{linux,darwin,win32}-{x64,arm64}` (published as the same package name under platform dist-tags, `scripts/build_npm_package.py:22-70`) containing `vendor/<triple>/bin/codex`. `codex.js` resolves the platform package (fallback to a local `vendor/`), errors with a package-manager-specific reinstall hint (npm/pnpm/bun/vite-plus detection by walking ownership metadata, `bin/codex.js:118-200`), spawns the binary with `stdio: 'inherit'` **asynchronously** so Node can forward SIGINT/SIGTERM/SIGHUP and exit with the child's code (`:200-260`), and sets `CODEX_MANAGED_BY_{NPM,BUN,PNPM,VITE_PLUS}=1` + `CODEX_MANAGED_PACKAGE_ROOT` so the binary's self-update prompt knows how it was installed (`tui/src/update_action.rs`).
- **Other channels.** Standalone installer (`curl https://chatgpt.com/codex/install.sh | sh`) into `~/.codex/packages/standalone/current/bin/codex`, which the daemon's hourly updater loop refreshes and restarts (`app-server-daemon/README.md`); GitHub releases include a DotSlash file for pinned per-repo versions (`docs/install.md:11-13`); the TUI checks for updates once at startup and shows an `UpdateAvailableHistoryCell` (`app/startup.rs:735-760`, non-debug builds only).
- Logging: TUI writes `codex-tui.log` only when `log_dir` is configured; app-server logs to stderr with `RUST_LOG` and `LOG_FORMAT=json` (README:51-55); diagnostics also go to a bounded SQLite `log_db` used for `feedback/upload`.

### Steal / avoid

- Steal the npm shape: a tiny JS launcher, platform packages as optional deps, async spawn with signal forwarding and exit-code propagation, and a `MANAGED_BY` env so the binary can print the right upgrade command. With Bun, `bun build --compile --target=bun-<os>-<arch>` gives you the per-target binaries; keep the launcher in plain Node-compatible JS so `npx` works without Bun.
- Steal one binary with subcommands (`tui` default, `serve`, `daemon`, `generate-schema`) and arg0 dispatch only if you actually need helper personas.
- Avoid the hourly self-updating daemon until there is a daemon; it is the most operationally fragile piece here (pidfiles, locks, reboot-non-persistent updater).

---

## Cross-cutting takeaways for a TypeScript/Bun TUI against the Elysia server

1. **Contract first.** Define thread/turn/item + server-request approvals in `packages/contracts` and generate the TUI's types from it, mirroring `generate-ts`. Include `clientUserMessageId`, `serverRequest/resolved`, `expectedTurnId` on steer, `willRetry` on errors, and a per-connection `initialize` with notification opt-out.
2. **Rendering.** Inline bottom viewport + scrollback insertion via DECSTBM, `CSI 2026` synchronized updates, VT100-backed tests, source-backed cells with width-keyed caches, reflow on resize from cells. Alt screen only for pagers.
3. **Loop.** One `select`-style loop over {app events, server events, terminal events, timers}; frame requests coalesced to ~120 fps; widgets never write to the terminal.
4. **Composer.** View stack over a retained draft, placeholder elements for big pastes/images/mentions, one fuzzy-search session, typing-idle approval delay, `Enter` submit / `Ctrl+J` newline / `Tab` queue, Esc interrupt.
5. **Streaming.** Newline-gated markdown with stable/tail split, table holdback, smooth vs catch-up commit ticks, consolidation into a source cell on completion.
6. **Terminal quirks worth handling from day one:** kitty flags (minus event types on Ghostty/iTerm2/tmux), C0/uppercase key normalisation, bracketed paste with CRLF normalisation, `ESC[<u` on exit, panic/init restore guards, Ctrl+Z, drop-the-stdin-reader around `$EDITOR`, OSC 8/9/52.
7. **What not to copy:** the size. Their protocol has 158 methods and the TUI has ~50 slash commands, plugins, pets, and an agents dashboard; the transferable core is maybe a tenth of the code.
