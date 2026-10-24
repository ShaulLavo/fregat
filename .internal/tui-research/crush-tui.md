# Crush (Charm) — TUI and client/server deep read

Repo: `/work/projects/platform/references/crush`. Go 1.27, `charm.land/bubbletea/v2 v2.0.9`, `charm.land/lipgloss/v2 v2.0.6`, `charm.land/bubbles/v2 v2.2.1`, `github.com/charmbracelet/ultraviolet` (cell buffer + layout), `alecthomas/chroma/v2` (syntax), `aymanbagabas/go-udiff` (diff), `charm.land/glamour/v2` (markdown), `sahilm/fuzzy` (`go.mod:6-60`).

All line numbers below are from the checked-out tree. The two AGENTS.md files are the authoritative maps and are worth reading first: `/work/projects/platform/references/crush/AGENTS.md` (package map, lines 13-60) and `/work/projects/platform/references/crush/internal/ui/AGENTS.md` (UI architecture, rendering rules, dialog rules, hot-path invariants).

---

## 1. Process model and the client/server split (most relevant to us)

Crush runs in two modes selected by an env var, `CRUSH_CLIENT_SERVER=1` (`internal/cmd/root.go:233-236`):

- **Local**: `setupLocalWorkspace` builds an in-process `app.App` and wraps it in `workspace.NewAppWorkspace` (`internal/cmd/root.go:270-338`).
- **Client/server**: `setupClientServerWorkspace` → `connectToServer` → `workspace.NewClientWorkspace(c, *protoWs)` (`internal/cmd/root.go:366-448`).

The TUI never sees the difference. Both implement one interface.

### 1.1 The `workspace.Workspace` interface — the single front-end contract

`internal/workspace/workspace.go:119-238`. Package doc (lines 1-4): "defines the Workspace interface used by all frontends (TUI, CLI)… Two implementations exist: one wrapping a local app.App instance and one wrapping the HTTP client SDK." Groups:

- Sessions: `CreateSession/GetSession/ListSessions/SaveSession/DeleteSession`, `CreateAgentToolSessionID/ParseAgentToolSessionID` (sub-agent sessions are encoded into the session-id string), `SetCurrentSession` (presence hint, lines 126-134).
- Messages: `ListMessages`, `ListUserMessages`, `ListAllUserMessages` (prompt history source).
- Agent: `AgentRun` (fire-and-forget), `AgentRunShellCommand` (bang mode, streams via `onProgress`), `AgentCancel`, `AgentIsBusy`, `AgentIsSessionBusy`, `AgentModel`, `AgentIsReady`, `AgentReadyErr` (distinguishes "not initialized" from "server unreachable", lines 152-158), `AgentQueuedPrompts/List/ClearQueue`, `AgentSummarize`, `UpdateAgentModel`, `InitCoderAgent`.
- Permissions: `PermissionGrant/GrantPersistent/Deny` return `bool` = "this call resolved it" so multi-client races are safe (lines 170-183). `PermissionSkipRequests/SetSkipRequests` (yolo).
- Questions: `QuestionAnswer`, `QuestionCancel`.
- FileTracker (read-file tracking), History (file versions), LSP (`LSPStart/StopAll/GetStates/GetDiagnosticCounts`), Config read + mutation proxies (`UpdatePreferredModel`, `SetCompactMode`, `SetProviderAPIKey`, `SetConfigField`, `RemoveConfigField`, OAuth), project lifecycle, skills, MCP, and finally `Subscribe(program *tea.Program)` + `Shutdown()` (lines 233-235).

Connection health is modelled explicitly: `ConnectionState {Degraded, Recovered}` and `ConnectionEvent{State, Err, Stuck}` (`workspace.go:50-73`) plus sentinel errors `ErrAgentNotInitialized`, `ErrServerUnreachable`, `ErrWorkspaceGone`, `ErrStreamClosed` (lines 29-46).

### 1.2 Server side

`internal/cmd/server.go:26-99` (`crush server --host`), `internal/server/server.go`:

- Address: Unix socket `$XDG_RUNTIME_DIR/crush-<uid>.sock` (fallback `os.TempDir()`, then `/tmp` if > 104 bytes), Windows `npipe:////./pipe/crush-<uid>.sock` (`server.go:23-77`). Stale socket self-heal: stat → 200ms dial probe → remove if ECONNREFUSED/ENOENT (`net_other.go:32-61`, `socket_classify.go`).
- HTTP/1 + unencrypted HTTP/2, `net/http` mux. Full route table `server.go:139-214`: `/v1/health`, `/v1/version`, `/v1/config`, `/v1/control`, `DELETE /v1/clients/{client_id}`, `/v1/workspaces` CRUD, `POST …/current-session`, `GET …/events` (SSE), sessions CRUD + `/history` + `/messages` + `/messages/user`, filetracker, `lsps`, `lsps/{lsp}/diagnostics`, `lsps/start|stop`, `permissions/skip|grant`, `questions/answer|cancel`, `agent` (GET info / POST message), `agent/init`, `agent/update`, `agent/sessions/{sid}` (+ `cancel`, `prompts/queued|list|clear`, `summarize`, `shell`), `config/set|remove|model|compact|provider-key|import-copilot|refresh-oauth`, `project/needs-init|init|init-prompt`, `skills`, `mcp/*`, and swagger at `/v1/docs/`.
- **Agent POST is detached from the request**: `handlePostWorkspaceAgent` returns `202 Accepted` after `backend.SendMessage` validates and spawns the run on the workspace context (`server/proto.go:777-799`; `backend/agent.go:28-63`). A client dropping its TCP connection cannot kill a turn other clients are watching; only the explicit cancel endpoint can.
- **SSE**: `handleGetWorkspaceEvents` subscribes to the broker _before_ attaching the client so no event is lost between "attached" and "subscribed", writes headers and flushes immediately, then loops `data: <json>\n\n` (`server/proto.go:281-330`). Every domain event is wrapped in a `pubsub.Payload{Type, Payload json.RawMessage}` envelope by `wrapEvent` (`server/events.go:24-181`), with `PayloadType` strings enumerated in `pubsub/events.go:17-32` (`lsp_event`, `mcp_event`, `permission_request`, `permission_notification`, `message`, `session`, `file`, `agent_event`, `config_changed`, `skills_event`, `run_complete`, `update_available`, `question_batch_request`, `question_batch_notification`).
- **No resume cursor.** SSE has no `Last-Event-ID`; a dropped stream loses events (client compensates, see 1.4).

### 1.3 Backend lifecycle (workspaces, clients, grace timers)

`internal/backend/backend.go`:

- A `Workspace` embeds `*app.App` and owns a run context (`backend.go:170-215`). Workspaces are deduped by resolved absolute path (`pathIndex`, lines 89-96) so two clients in the same directory share one workspace.
- Each client mints a UUID `clientID` (`client/client.go:46-51`); the server tracks a `clientState{streams, holdTimer, currentSessionID, released}` per client per workspace (`backend.go:161-166`). **The SSE stream is the refcount claim**: `DefaultCreateGrace = 30s` for a creator to open its stream (line 47), `DefaultDetachGrace = 10s` after the last stream drops before teardown (line 68), `DefaultIdleShutdownDelay = 60s` after the last workspace is released before the server exits (line 58; env overrides `CRUSH_SERVER_IDLE_TIMEOUT`, `CRUSH_SERVER_DETACH_GRACE`).
- `RetireClient` is the client's authoritative goodbye; retired IDs are never pruned so a create that was on the wire cannot orphan a workspace (`backend.go:114-132`; `client/client.go:174-187`).
- Presence: `SetCurrentSession` per client feeds `AttachedClients` per session, surfaced in `proto.Session.AttachedClients` and `IsBusy` computed on read (`proto/session.go:1-34`).
- Server control: `shutdown_if_idle` command exists so a newer client can probe whether the server understands idleness before asking it to stand down (`proto/server.go:3-16`; `client/client.go:118-142`); `ErrServerBusy`, `ErrServerShuttingDown`, `ErrUnsupported`, `ErrNotFound` sentinels (`client/errors.go:12-33`).

### 1.4 Client side: transport and the reconnect/recovery loop

- `client.NewClient` clones the default transport, dials unix/npipe, disables compression on sockets, uses `DummyHost` `api.crush.localhost` for socket URLs (`client/client.go:46-67, 199-266`).
- `SubscribeEvents` reads SSE lines, decodes the envelope, and fan-outs typed `pubsub.Event[proto.X]` values on a buffered `chan any` (100) (`client/proto.go:117-250+`).
- `ClientWorkspace.runSubscription` (`workspace/client_workspace.go:829-914`): exponential backoff; on `ErrNotFound` (server no longer knows the workspace) it **re-registers** the workspace from its cached snapshot (`recoverWorkspace`, 916-949) and adopts the new ID; after 20 failures (`maxRecoveryEscalate`, line 808) it sends `Stuck: true`; on every re-established stream `afterReconnect` re-asserts current session and sends `ConnectionRecovered` (970-983). The UI turns Recovered into `loadSession` to resync everything missed (`model/ui.go:1509-1537`).
- `translateEvent` maps `proto.*` back to domain types the TUI's `Update` already handles (`client_workspace.go:1074-1212`), so the TUI has one `Update` for both modes.
- `Shutdown` cancels the loop, waits up to 5s, then `RetireClient`, falling back to `DeleteWorkspace` on old servers (`client_workspace.go:1022-1055`).

### 1.5 Event semantics: lossy vs must-deliver, and RunComplete

`internal/pubsub/broker.go:1-25` documents two publish modes: `Publish` (non-blocking, drops on full 4096-buffer with a counter, for per-token updates) and `PublishMustDeliver` (bounded-blocking 50ms per subscriber, for finish/tool result/error/cancel). `app.setupEvents` chooses per source: sessions/messages/history/agent-notifications/mcp/lsp lossy; permissions, questions, run-completions must-deliver (`app/app.go:588-604`).

`RunComplete{SessionID, RunID, MessageID, Text, Error, Cancelled}` is the authoritative end-of-turn (`proto/proto.go:74-81`). `RunID` is minted by the caller and echoed so `crush run` can wait for _its_ turn even when queued behind another (`cmd/run.go:253-262, 384-399`); `backend.runAgent` emits a fallback errored `RunComplete` if the coordinator did not (`backend/agent.go:88-125`).

Message streaming is debounced server-side at 33ms per message with terminal updates flushing synchronously (`message/message.go:18-45`).

### 1.6 The consequence: the UI memoization layer

Because `Workspace` exposes synchronous getters that are HTTP round-trips in client mode, the UI needed a whole caching subsystem so `Update`/`View` never block: `model/workspace_cache.go:1-27` (design doc), `ttlCache` (48-68), `busyCacheTTL = 500ms`, `promptQueueTTL = 2s`, generation counters to discard stale in-flight probes (`busyStateMsg.gen`, 71-88; `applyBusyState` 171-211), a TTL backstop at the tail of every `Update` (`staleWorkspaceRefreshCmds`, 262-286), optimistic busy=true on send (`ui.go:4235-4241`), and the same for LSP (`model/lsp.go:27-94`, `lspStatesTTL = 5s`). This is the strongest argument for making our TUI client contract push-first and never exposing blocking getters to the render loop.

---

## 2. Elm architecture: how the model/update/view is decomposed

### 2.1 One Bubble Tea model, imperative sub-components

`internal/ui/AGENTS.md` ("Centralized Message Handling"): the `UI` struct in `model/ui.go:182-390` is the **sole** `tea.Model`. `Chat`, `list.List`, `Completions`, `Attachments`, `Status`, `header`, sidebar are stateful structs with imperative methods; none implement the standard `Update(tea.Msg) (Model, Cmd)`:

- `Chat` has no `Update`; the UI calls `HandleMouseDown`, `ScrollBy`, `SetMessages`, `Animate`, `BeginResize`, `WarmStep` (`model/chat.go:166-1263`).
- `Completions.Update(tea.KeyPressMsg) (tea.Msg, bool)` returns a message plus "consumed" (`completions/completions.go:288-318`); `Attachments.Update(tea.Msg) bool` (`attachments/attachments.go:40-73`).
- Dialogs implement `Dialog{ID(); HandleMsg(tea.Msg) Action; Draw(scr, area) *tea.Cursor}` and return typed **Actions** the owner dispatches (`dialog/dialog.go:32-43`; `dialog/actions.go` for the full action catalogue; dispatch in `model/ui.go:1871-2147`).
- Inline editors implement `InlineEditor{HandleKey; ShortHelp; Height(width); Draw; HeightChanged; SetFocused}` plus optional `MouseClickableEditor`/`PasteableEditor` (`dialog/inline_editor.go:12-64`).

Rules enforced in `internal/ui/AGENTS.md`: never do IO in `Update`, never mutate the model inside a `tea.Cmd`, use `x/ansi` for any ANSI-aware string ops, prefer methods on the model for cmds.

### 2.2 `Update` routing order

`model/ui.go:706-1443`. The big type switch handles ~60 message kinds. Notable orderings:

- `m.caps.Update(msg)` first for capability messages (line 709).
- `tea.WindowSizeMsg` → `chat.BeginResize()` + `updateLayoutAndSize()` + keep following (1017-1030).
- `tea.KeyboardEnhancementsMsg` rewrites help labels when the terminal disambiguates keys (`ctrl+m` → models, `shift+enter` → newline) (1031-1037).
- Mouse: dialogs first, then inline editor, then click-focus, attachment remove button hit-test, textarea selection, then chat (1042-1178). Wheel arrives pre-coalesced as `common.CoalescedWheelMsg` (1180-1235).
- `default:` forwards unknown messages to the front dialog (1400-1405).
- Tail: placeholder text logic and TTL backstop run on every message (1417-1441).

Key handling (`handleKeyPressMsg`, 2412-2935) is strictly ordered: quit key always first (2488-2495) → if any dialog is open, everything goes to it (2498-2500) → Tab toggles focus even with an inline editor (2505-2519) → inline editor gets keys when editor-focused (2522-2535) → `esc` cancels when the agent is busy (2538-2545) → per `state` and `focus` switch → `handleGlobalKeys` as the fallback (2415-2486).

### 2.3 Draw/View pipeline (hybrid string + cell buffer)

`View()` (`ui.go:3119-3154`) builds a `uv.NewScreenBuffer(width,height)`, calls `Draw`, then flattens with `canvas.Render()`, trims trailing spaces per line, and sets `AltScreen`, `BackgroundColor` (unless transparent), `MouseMode` (all-motion only when an inline editor is active), `ReportFocus`, `WindowTitle`, and an indeterminate `ProgressBar` while busy (Ghostty/iTerm2/Rio/WT only; randomized percentage to defeat Ghostty's auto-hide, 3149-3152).

`Draw` (`ui.go:2951-3117`): recompute layout from the area; `screen.Clear`; per `uiState` (`uiOnboarding | uiInitialize | uiLanding | uiChat`, 106-114) draw header/sidebar/chat/pills/editor-or-inline; status + help; completions popup anchored above the `@` position (3062-3082); `CRUSH_UI_DEBUG=true` paints a random-colour 4x2 block to visualise repaints (3096-3104); dialogs draw last over the full bounds and own the cursor (3108-3111). Cursor math for the editor adds the app margin and the attachments row (3113-3135).

`Chat.Draw` (`model/chat.go:195-282`) caches the decoded cell buffer of the last rendered list string so byte-identical frames skip ANSI re-parse (`chatDrawCache`, 154-164; `newChatDrawCache` 284-306; `drawCachedBuffer` 321-335).

### 2.4 Layout and responsive sizing

`generateLayout(w,h)` (`ui.go:3577-3776`) uses `ultraviolet/layout` splits (`layout.Vertical(layout.Len(n), layout.Fill(1)).Split(rect).Assign(&a,&b)`) to produce a `uiLayout{area, header, main, pills, editor, sidebar, status, sessionDetails}` of rectangles (3778-3805):

- Help line is 1 row, or `max(len(row))` rows when full help is showing (3583-3605).
- App margin: 1 col left/right, 1 row top/bottom; landing/onboarding get 2 cols (3608-3623).
- Chat non-compact: `sidebarWidth = 32` on the right, main | sidebar horizontal split, then editor at the bottom of main, then pills carved from main (3690-3773).
- Chat compact: 1-row header + gap, session-details overlay of max 20 rows (`sessionDetailsMaxHeight`, line 83), no sidebar (3651-3690).
- Compact mode auto-engages under **120 cols or 30 rows** (`compactModeWidthBreakpoint/HeightBreakpoint`, 71-75) or by user toggle (persisted via `SetCompactMode`, 3433-3445; `updateLayoutAndSize` 3447-3474).
- Editor height = textarea height (dynamic, min 3 / max 15, `TextareaMinHeight/MaxHeight` lines 86-93) + 2 rows margin (attachments row above, spacing below), or the inline editor's `Height(width)`; a collapsed question form is 1 line + 1 when unfocused and it would eat > 40% of the terminal (`shouldCollapseQuestion`, 4648-4651).
- `updateLayoutAndSize` runs a second reconciliation pass because `textarea.SetWidth` can change its height through soft-wrap (3462-3473). Textarea growth in follow mode re-pins the chat to the bottom (`handleTextareaHeightChange`, 3476-3487).
- `editorContentWidth` duplicates the arithmetic (`m.width - 2`, minus 30 for the sidebar) so an inline editor's height is a pure function of width (4637-4646).

Sidebar (`model/sidebar.go:64-211`) renders its whole content to a string once, computes total lines vs. available height, and virtual-scrolls by slicing lines, with an auto-hiding scrollbar that stays visible while the sidebar is focused. Pills (todos / queued prompts) reserve `3 + N` rows when expanded and auto-expand on terminals ≥ 40 rows (`model/pills.go:248-361`, `pillsHeightReasonableTerminalHeight` line 137).

### 2.5 Focus model

`uiFocusState = None | Editor | Main | Sidebar` (`ui.go:96-104`). Tab cycles editor ↔ chat; `l`/`→` from chat focuses the sidebar when it is scrollable; `h`/`←` returns. Clicking focuses (`handleClickFocus`, 1678). Help text changes with focus (`ShortHelp` 3156-3245).

---

## 3. Chat list: virtualization and caching

`internal/ui/list/list.go` is a generic lazily-rendered vertical list:

- Viewport state is `(offsetIdx, offsetLine)` — first visible item and how many of its lines are scrolled off (`list.go:26-31`).
- `Item{Render(width); Version() uint64; Finished() bool}` (`list/item.go:22-40`). Items embed `*Versioned` and must `Bump()` on every observable mutation. `Finished()==true` lets the list **freeze** the entry: subsequent draws return stored output without calling `Render` until the version bumps or the width changes.
- Cache keyed by item pointer → `listCacheEntry{width, version, frozen, content, lines[], height}` (`list.go:61-68`; `renderItemEntry` 296-372). Width change drops everything (`SetSize`, 105-111); `SetItems` retains entries for surviving pointers (`retainCacheFor`, 395-409).
- `Render` is O(viewport): it slices only the lines that fit the remaining budget (559-627). `AtBottom`, `VisibleItemIndices`, `findItemAtY` all walk from `offsetIdx` and stop at the viewport height.
- `TotalHeight` renders **every** item (needed for exact scrollbar geometry, 178-196); `Overflows(height)` is the bounded alternative that walks from the bottom and stops once the threshold is crossed (220-232); `Prewarm(from, batch)` populates the cache incrementally (203-213).
- Selection-drag escape hatch: `BeginSelectionDrag/EndSelectionDrag` un-freeze the items in range so highlight overlays land on live output (411-450).
- Render callbacks run before every render (focus, highlight) and may bump versions (`RegisterRenderCallback`, 95-99; `FocusedRenderCallback` in `list/focus.go`).
- `FilterableList` wraps it with `sahilm/fuzzy` and `MatchSettable` items (`list/filterable.go:24-125`).

Resize storm handling (`model/chat.go`): `BeginResize` sets `resizing`, bumps a settle sequence, and schedules a warm step after 120ms of quiet (`resizeSettleDuration`, line 51); while resizing, `Draw` skips the scrollbar (which needs `TotalHeight`); `WarmStep` prewarms 25 items per frame (`warmBatchSize`, 55) and only then re-enables the scrollbar (337-359; consumed in `ui.go:1252-1266`). `SetSize` captures `wasFollowing` before the width change because line offsets become stale (362-384).

Animations only tick for visible items; off-screen spinners are paused and restarted when they scroll into view (`Chat.Animate` 469-495; `RestartPausedVisibleAnimations` 498-530). Each spinner tick chain carries a generation so two chains cannot drive one spinner (`anim/anim.go:96-99, 503-509`); the spinner is 20 fps (line 21) with deterministic staggered "birth" of scrambled glyphs and an ellipsis phase (`Render` 444-500).

---

## 4. Message items and tool renderers

`internal/ui/chat/messages.go`:

- Layered interfaces: `MessageItem = list.Item + list.RawRenderable + Identifiable`; opt-in `Animatable`, `Expandable`, `KeyEventHandler`, `HighlightableMessageItem`, `FocusableMessageItem` (27-72). Nested sub-agent tools are `NestedToolContainer` (`chat/agent.go:20-24`) and map their IDs to the parent's list index (`model/chat.go:404-466`).
- Text is capped at `maxTextWidth = 120` cells for readability; a 2-cell left gutter carries the focus/role prefix (`MessageLeftPaddingTotal`, 21-24).
- Two caches per item: raw render by width, and the prefixed render keyed by `(width, stateKey)` (`cachedMessageItem`, 165-233). Highlight is applied above the cache so drags do not invalidate it (`user.go:132-160`).
- `ExtractMessageItems` turns a `message.Message` into items: user → `UserMessageItem` (or `ShellItem` for persisted bang commands); assistant → `AssistantMessageItem` only if it has text/thinking/error, plus one `ToolMessageItem` per tool call, results linked via `BuildToolResultMap` (394-468).
- Live updates: `appendSessionMessage` (`ui.go:1598-1676`) and `updateSessionMessage` (1709-1778) mutate existing items (`SetMessage`, `SetToolCall` only when finished/input changed, `SetResult`) instead of rebuilding, and manage the per-turn `AssistantInfoItem` footer ("◇ model via provider in 12s").

`AssistantMessageItem` (`chat/assistant.go`):

- Per-section caches for thinking/content/error keyed by `(width, srcHash, extra)` so streaming one section does not re-render the others (70-104, 192-214).
- Streaming markdown renders a **stable prefix** once and only re-renders the trailing partial; the boundary is a blank line after which no fence/list/table/quote is open, and any doubt falls back to a full render (`chat/streaming_markdown.go:10-36, 90-`).
- Thinking is a three-state view: collapsed (last 10 lines, `maxCollapsedThinkingHeight` 33) → tail window (last 200, `maxExpandedThinkingTailLines` 46) → full, cycled by click/space (`thinkingViewMode` 52-60; `renderThinking` 557-627 adds a "Thought for Ns" footer).
- Provider refusals render as a `REFUSED` banner with TUI-owned copy (37-44).

Tool items (`chat/tools.go`):

- `ToolStatus = AwaitingPermission | Running | Success | Error | Canceled` (35-43); `NewToolMessageItem` routes by tool name to ~30 renderers with `mcp_` prefix and generic fallbacks (200-274; table in `internal/ui/AGENTS.md`).
- Renderer contract `RenderTool(sty, width, *ToolRenderOpts{ToolCall, Result, Anim, ExpandedContent, Compact, IsSpinning, Status})` (91-124).
- Consistent header `● Name main (k=v, …)` truncated to width, wrapping only when expanded (`toolHeader` 633-655; `toolParamList` 592-630 drops k=v pairs if fewer than 30 cells remain for the main param).
- Early states: `Requesting permission...`, `Waiting for tool response...`, `Canceled.`; errors render `ERROR msg`, user denials `WARN msg` (541-576).
- Bodies cap at `responseContextHeight = 10` lines with `… (N lines hidden) [click or space to expand]` (28, `assistantMessageTruncateFormat` in assistant.go:22); plain output is space-normalised, cursor-control-stripped and ANSI-16 remapped to the theme (`toolOutputPlainContent` 658-690); code gets line numbers + syntax highlight (`toolOutputCodeContent` 693-742); diffs use the diff view, auto-split above 120 cols (`toolOutputDiffContent` 956-984; unified-diff parsing for git-style output in `chat/unified_diff.go:24-171`).
- Hook results render as aligned `Hook name matcher → OK|Denied reason` lines above the tool (`toolOutputHookIndicator` 769-840).
- `c`/`y` on a focused item copies its content (`HandleKeyEvent` 511-518; user messages `user.go:177-183`); `space` toggles expand (`ToggleExpanded` 481-486).
- Bang-mode shell output is a `ShellItem` with live `AppendOutput` streaming from `shellStreamMsg` (`ui.go:1329-1381`; `chat/shell.go`).

---

## 5. Diff viewer (`internal/ui/diffview`)

- Builder API: `New().Unified()|Split().Before(path, content).After(path, content).FileName().ContextLines().Style().LineNumbers().Height().Width().XOffset().YOffset().InfiniteYScroll().TabWidth().ChromaStyle()` then `String()` (`diffview.go:75-223`).
- Pipeline in `String()`: normalise CRLF → expand tabs to spaces (default 8, chat uses 4 via `common.DiffFormatter`, `common/diff.go:10-14`) → `udiff.Lines` + `udiff.ToUnifiedDiff` with context lines (240-254) → convert hunks to split pairs (`split.go:21-73`: a Delete claims the next Insert in the hunk as its right-hand partner, Equal lines pair with themselves, unmatched sides render as "missing" rows) → digit widths → total lines → clamp yOffset → code width.
- Width budget: `codeWidth = width - (beforeDigits + afterDigits + 4 padding) - 2 symbols` for unified; split halves the remainder and gives the odd column to the right pane (`resizeCodeWidth` 379-395). Without a width it measures the longest line (`detectCodeWidth`).
- Rendering is line-by-line into a `strings.Builder` with `printedLines` starting at `-yOffset` so vertical scroll is free (`renderUnified` 398-541; `renderSplit` 544-717). Each row = `[lineno][lineno][sym][code]` styled per `LineStyle{LineNumber, Symbol, Code}` for `Divider|Missing|Equal|Insert|Delete|Filename` (`style.go:8-24`). Horizontal scroll uses `ansi.GraphemeWidth.Cut(content, xOffset, …)` and shows a leading `…` when cut (`getContent` closures 407-413). Hitting the height cap prints a final `…` row (420-437). Optional file-name header row and `@@ -a,b +c,d @@` divider per hunk.
- Syntax highlighting is per line, with the background forced to the row colour, cached by `xxh3(content + bg)` (`hightlightCode` 751-783; `createSyntaxCacheKey` 787-797); lexer chosen once per file via the memoised `xchroma.MatchLexer` then `lexers.Analyse` fallback (799-816).
- Default light/dark styles are hard-coded Charmtone colours + hex literals (`style.go:27-141`); the theme overrides them through `Styles.Diff` (`quickstyle.go:544-595`).
- Golden tests cover every width 1..110 and height 1..20 for both layouts, X/Y offsets, tabs, and a line-break bug (`testdata/TestDiffView*`; `diffview_test.go:1-80`).

Where diffs appear: chat edit/write/multi-edit tool bodies (`chat/file.go:205-249`), the permission dialog (`dialog/permissions.go:615-641`, split default when dialog width ≥ 140, `splitModeMinWidth` line 48; `t` toggles, `f` fullscreen, `shift+←/→` scroll 5 cols), and the sidebar "Modified Files" +N/-N stats computed from first vs latest file version (`model/session.go:120-165`).

---

## 6. Syntax highlighting and markdown

- `common.SyntaxHighlight(styles, source, fileName, bg)` and `SyntaxHighlightLexerName(…, "bash", …)` (`common/highlight.go:15-40`) use chroma's `terminal16m` formatter with a **memoised style**: `common.ChromaStyle(st, bg)` builds `chroma.MustNewStyle("crush", st.ChromaTheme())` once per theme and once per background override (`common/chromastyle.go:23-64`); `Styles.ChromaTheme()` derives the chroma style entries from the markdown code-block style config so markdown and standalone code agree (`styles/styles.go:619-656`).
- `xchroma.MatchLexer` memoises `lexers.Match` (hundreds of glob matches per call) and coalesces tokens (`xchroma/chroma.go:27-45`). `xchroma.Formatter(bg, processValue)` is a lipgloss-based chroma formatter that forces a background colour and renders **each line separately** to avoid lipgloss padding multi-line tokens (49-102).
- Markdown via glamour: renderers memoised per width for assistant (`MarkdownRenderer`), user input (`UserMarkdownRenderer` with preserved newlines because users type in a plain textarea — `common/markdown.go:63-92`), and a colourless "quiet" variant for thinking/tool output (94-108). Renderers are not goroutine-safe; a per-renderer mutex is exposed (`LockMarkdownRenderer` 167-176) and the whole cache is invalidated on theme change (129-140). Glamour is told to use the registered `"crush"` chroma formatter (15-21).
- Inline code padding uses a sentinel grapheme `" ︎"` so selection copy can turn it back into backticks; the doc explains why U+FE0F would cause width mismatch flicker (`styles/styles.go:28-44`; used by `list/highlight.go:88-96`).

---

## 7. Dialog stack

`dialog.Overlay` (`dialog/dialog.go:63-297`): a slice of `Dialog`s; `OpenDialog`, `OpenDialogWithGrace`, `CloseDialog(id)`, `CloseFrontDialog`, `ContainsDialog`, `BringToFront`, `Dialog(id)` lookup, `Update` routes to the front dialog only, `Draw` paints all in order (last wins the cursor). `LoadingDialog` is an optional `StartLoading/StopLoading` interface.

Grace period (53-60, 112-125, 213-231): a dialog opened asynchronously (permission prompts) **absorbs keystrokes** until input has been quiet for 425ms or 1.5s has elapsed, so a key typed at the textarea cannot accidentally answer the prompt; reopening the same dialog ID within 500ms skips the grace so rapid successive prompts do not eat keystrokes.

Dialog rendering rules (from `internal/ui/AGENTS.md` "Dialog rendering rules"): lipgloss v2 `Width(n)` is total width including border/padding; size content to `innerWidth = width - View.GetHorizontalFrameSize()`; inset with `Padding` never `Margin`; render styled segments individually and concatenate; use the shared helpers `renderDialogHelp` (greedy pack with ellipsis, `dialog/common.go:130-176`), `dialogInputTextWidth` (23-31), `common.DialogTitle` (truncates, gradient rule fill, `common/elements.go:240-252`), `joinScrollbar` (78-83), `applyInfoColumnVisibility` (hides a secondary column when it would exceed 25-35% of row width, 89-113), `sizeDialogList` (38-73); clamp to the drawable area. `RenderContext{Title, TitleInfo, Parts, Help, Gap, IsOnboarding}` assembles title + parts + help (232-336); onboarding dialogs draw bottom-left without a frame (`DrawOnboardingCursor` 279-289).

Concrete dialogs: `commands.go` (command palette: System/User/MCP tabs, fuzzy filter, single-key shortcuts matched against visible items `169-241`, custom commands from `~/.config/crush/commands/*.md`, `$ARG` placeholders → `arguments.go` dialog), `sessions.go` (fuzzy list, `ctrl+x` delete with y/n confirm, `ctrl+r` inline rename, double-click select), `models.go` + `models_list.go` (grouped by provider with `SpacerItem`s and non-selectable group headers, `tab` toggles large/small slot), `filepicker.go` (image attachments, live image preview), `quit.go` (Yep/Nope buttons, `ctrl+c` twice quits), `reasoning.go`, `notifications.go`, `permissions.go`, `api_key_input.go`, `oauth*.go`, `mcp_auth.go`, `aws_sso.go`.

Buttons are a shared primitive with underlined accelerator letter and a hit-test compositor for mouse (`common/button.go:25-118`).

---

## 8. Inline editors: question forms

Agent "question" tool requests arrive as `question.Request{Questions[]{Type: yes_no|single_choice|multi_choice|free_text, Label, Text, Choices}, ConfirmTitle}` (`question/question.go:24-72`; wire `proto/proto.go:224-262`). The UI does **not** open a modal: it installs a `QuestionForm` as `activeInline`, which replaces the textarea in the editor area (`ui.go:4599-4621`; `dialog/question_form.go:27-150`). Multi-question batches get tabs (`[`/`]` or `ctrl+←/→`) and an auto-appended Confirm tab that lists answers and jumps to the first unanswered on reject. Choices accept number keys 1-9 (`question_choice_base.go:63-74`), have a fill-in row and per-choice notes. Tab still toggles focus to the chat; when unfocused and tall the form collapses to one line (`DrawCollapsed`). Any client answering dismisses the form everywhere via `question.Notification` (`ui.go:4623-4633`).

---

## 9. Permission prompts

Server: `permission.Service` publishes `PermissionRequest{ID, SessionID, ToolCallID, ToolName, Description, Action, Params any, Path}` on a must-deliver broker and blocks the tool until `Grant/GrantPersistent/Deny` resolves it; resolution is first-writer-wins and publishes `PermissionNotification{ToolCallID, Granted, Denied}` (`permission/permission.go:37-85, 118-`). Session-scoped "allow for session" grants are keyed by `(session, tool, action, path)`. Hook pre-approval short-circuits via context (`WithHookApproval`, 17-35). Params are decoded per tool name on the wire (`proto/permission.go:86-146`), aliasing the tool packages' types (`proto/tools.go:1-8`).

UI (`dialog/permissions.go`): opened with grace (`ui.go:4582-4595`), closing any previous one. Header shows Tool (MCP tools pretty-printed as `Server → Tool`), Path/File/Directory/URL/Desc; body is a syntax-highlighted bash panel, a diff (edit/write/multi-edit/replace-symbol), or pretty-printed JSON params. Sizing: diff dialogs 80% of the terminal capped at 180 cols, simple ones 60% capped at 100 and shrink to content; **forced fullscreen under 77x20** (`dialogSize` 340-353; constants 34-56). Keys: `←/→/tab` choose, `enter` confirm, `a`/`s`/`d` direct, `esc` denies, `t` toggle diff mode, `f` fullscreen, `shift+arrows` scroll (87-155). Buttons `Allow | Allow for Session | Deny` right-aligned, centred when fullscreen, stacked vertically when too wide (738-765). The chat tool item flips to `AwaitingPermission`/`Running` on notifications and the dialog auto-closes if another client resolved it (`ui.go:4653-4677`). A desktop notification "Crush is waiting…" fires when the window is unfocused (`ui.go:906-916`).

---

## 10. Completions (`@` file/resource picker)

- Trigger: typing `@` at the start or after whitespace opens the popup and records `completionsStartIndex` and the cursor's screen position (`ui.go:2727-2739`; `completionsPosition` 4035). Items load asynchronously and concurrently: filesystem walk with configurable depth/limit (`options.tui.completions.max_depth|max_items`, `schema.json:32-50`) plus MCP resources (`completions.go:149-162, 396-421`).
- Filtering on each keystroke uses the current `@word` (`ui.go:2784-2803`); closes on space, on cursor moving before the start, or `esc`. Ranking: fuzzy match, then stable-sorted by tier exact basename/stem > basename prefix > path segment match > fallback (`applyNamePriorityFilter` 220-244; `namePriorityRules` 66-90).
- Popup: reverse-ordered list (best at the bottom, nearest the cursor), height clamped 1-10, width = widest visible item + 2 clamped 10-100 (`updateSize` 265-280), anchored above the `@` and clamped to the screen (`ui.go:3062-3082`). Keys: `↑/↓` move, `enter/tab/ctrl+y` select, `ctrl+n/ctrl+p` **insert and keep open** to cycle candidates in place, `esc` cancel (`completions/keys.go:17-44`). Match ranges are highlighted via `lipgloss.StyleRanges` after converting byte offsets to grapheme columns (`item.go:118-186`). Selecting a file inserts the path and attaches it (`insertFileCompletion` `ui.go:3939`).

---

## 11. LSP diagnostics surfacing

- Server: `lsp.Manager` starts servers lazily per file path within the working dir (`lsp/manager.go:105-121`), `TrackConfigured` announces configured-but-unstarted servers so the UI can list them (91-103). Each client caches severity counts keyed by a diagnostics-map version (`lsp/client.go:499-528`). State/diagnostic changes publish `app.LSPEvent{Type: state_changed|diagnostics_changed, Name, State, Error, DiagnosticCount}` from package-level maps (`app/lsp_events.go:20-99`) → SSE `lsp_event` → `workspace.LSPEvent`.
- Client: events only _request_ a refresh; a single in-flight fetch pulls `LSPGetStates()` + per-server `LSPGetDiagnosticCounts` off-thread, with a 5s TTL backstop (`model/lsp.go:27-94`).
- Rendering: sidebar/landing section "LSPs" lists each server with a state icon (unstarted/stopped/starting/ready/error/disabled) and `E3 W2 I1 H4` coloured counts (`lspInfo` 108-136, `lspDiagnostics` 139-154, `lspList` 158-205; icons `styles/styles.go:72-75`); the compact header shows the total error count next to context-window percentage (`model/header.go:110-162`); the `diagnostics` tool result renders as a plain body (`chat/diagnostics.go:37-67`). There is no per-file gutter or jump-to-diagnostic in the TUI; the raw diagnostics endpoint exists (`GET …/lsps/{lsp}/diagnostics`, `backend/events.go:36-51`).

---

## 12. Theme system

- Three layers (`AGENTS.md` "Styling System"): `styles/quickstyle.go` builds the entire `Styles` struct from a token palette `quickStyleOpts{primary, secondary, accent, keyword, fgBase/Subtle/MoreSubtle/MostSubtle, onPrimary, bgBase/LeastVisible/LessVisible/MostVisible, separator, destructive, error, warning(+Subtle), attention, busy, info(+MoreSubtle,+MostSubtle), success(+…), ansi 16 colours}` (`quickstyle.go:20-79`); `styles/themes.go` defines concrete themes (`CharmtonePantera` 36-115 with a handful of overrides; `HypercrushObsidiana` is currently identical, 118-120); `styles/styles.go` is the giant `Styles` struct grouped by surface (Header, CompactDetails, Markdown/QuietMarkdown, TextInput, Help, Diff, FilePicker, Button, Editor prompts per mode, Radio, Tab, Logo, Working gradient, Section, Initialize, LSP, Sidebar, ModelInfo, Dialog._, Tool._, Messages._, Pills._, Files._, Status._, Completions, Attachments, Resource).
- Theme is chosen by **provider** (`ThemeForProvider`, `ThemeKeyForProvider` 13-32) and swapped at runtime with a key check to skip rebuilds (`ui.go:4135-4180`; `applyTheme` clears item caches, markdown renderers, header logo). There is **no user theme setting** in `schema.json` and no light theme in use; `options.tui.transparent` drops the painted background (`config.go:279-288`).
- Icons are constants (`styles.go:20-76`: `✓ ⋯ ⟳ ◇ ◆ → ● × ◉ ○ │ ▌ ─ • ■ ≡ ▲ ✕ ┃`).
- Gradients: `ForegroundGrad/ApplyForegroundGrad` blend per grapheme with `lipgloss.Blend1D` for titles, logo, queue pill triangles (`styles/grad.go:15-70`).
- Raw terminal output (bang mode) is remapped from ANSI-16 SGR to the theme palette so program colours stay legible (`common/ansi16.go:18-46`; `Styles.ANSI [16]color.Color`).

---

## 13. Keybindings and help overlay

- All keys are compile-time `key.Binding`s in `model/keys.go:5-320` (Editor, Chat, Initialize groups + globals). **Not user-configurable**: `schema.json` has no keybindings section; `docs/config/README.md` `option ui` exposes only compact/diff/transparent/scrollbar/exit-banner/completions limits.
- Defaults: `ctrl+c` quit (confirm dialog; twice quits), `ctrl+g` more/less help, `ctrl+p` or `/` on empty prompt commands, `ctrl+l` (`ctrl+m` when disambiguated) models, `ctrl+s` sessions, `ctrl+n` new session, `ctrl+y` yolo, `ctrl+z` suspend, `tab` focus, `enter` send (`\` at end → newline), `shift+enter`/`ctrl+j` newline, `ctrl+o` external `$EDITOR`, `ctrl+f` add image, `ctrl+v` paste image, `ctrl+shift+v` paste text, `ctrl+r`+digit delete attachment, `@` mention, `up/down` history at edges, `esc` cancel (twice) / clear queue / clear selection, `ctrl+d` details (compact), `ctrl+t` tasks/pills, chat nav `j/k`, `J/K` one item, `d/u` half page, `f/b`/`space` page, `g/G` home/end, `ctrl+end` follow, `c/y` copy, `space` expand, `H/L` horizontal scroll, `l/h` sidebar focus.
- Help is contextual: `ShortHelp()`/`FullHelp()` on the UI choose bindings by state, focus, busy (esc reads "press again to cancel" or "clear queue"), attachments, image support, and delegate entirely to an active inline editor (`ui.go:3156-3417`). `ctrl+g` toggles `help.ShowAll` and the layout reserves rows for the grid (`model/status.go:53-65`; `ui.go:3600-3605`). Help labels are rewritten when key disambiguation is available (`ui.go:1031-1037`). Dialogs render their own hint line packed to the inner width with an ellipsis (`dialog/common.go:138-176`).

---

## 14. Status bar, header, sidebar, pills

- Status bar (`model/status.go:71-113`): one row that shows help, overlaid by an `InfoMsg{Type: info|success|warn|error|update, Msg, TTL}` with an indicator glyph, truncated and padded to width; auto-cleared after TTL (default 5s). Errors/warnings are reported by returning `util.ReportError/Warn/Info` cmds (`ui/util/util.go`). Connection degraded/recovered/stuck messages live here (`ui.go:1509-1537`).
- Header: full logo in landing; in compact chat a 1-row `Charm™ CRUSH ╱╱╱╱ cwd • E3 • 42% • ctrl+d open` row with diagonal filler and truncation (`model/header.go:55-162`).
- Sidebar (32 cols): logo (small variant under 30 rows), session title (2 lines max), cwd, model info (name, `via provider`, reasoning/thinking state, `42% (12K) $0.12`, warning icon > 80%), Modified Files with +/-, LSPs, MCPs, Skills; virtual-scrolled (`model/sidebar.go`, `common/elements.go:42-140`).
- Pills row above the editor: `To-Do 3/7 → current task` with a spinner while the agent works, `▶▶▶ 3 Queued` gradient pill; `ctrl+t` expands to the list; `←/→` switch section when chat-focused (`model/pills.go`).
- Landing state: cwd, model info, and three columns LSP/MCP/Skills (`model/landing.go:26-60`). Onboarding = models dialog drawn bottom-left; Initialize = "Would you like to initialize this project?" Yep/Nope (`model/onboarding.go`).

---

## 15. Mouse: input filter, selection, copy

- `model/filter.go` is installed with `tea.WithFilter` (`cmd/root.go:132-137`) and coalesces wheel and motion samples to one per 16ms, summing wheel deltas (and resetting on direction change) into `common.CoalescedWheelMsg{DeltaX, DeltaY}` so key presses never queue behind a mouse flood.
- Chat selection (`model/chat.go:859-1126`): mouse down records `(itemIdx, x, itemY)`; drag updates the end; single/double/triple click select nothing/word/line with a 400ms threshold and 2-cell tolerance; the single-click action (expand) is **delayed** by the double-click threshold and cancelled if a drag produced a highlight (`HandleDelayedClick` 930-965). Highlight ranges are pushed into items through a render callback (`applyHighlightRange` 1052-1091), applied cell-by-cell on a `uv.ScreenBuffer` (`list/highlight.go:195-262`), and edge-drag auto-scrolls (`ui.go:1121-1141`). Copy on mouse-up (after the double-click window) reconstructs text from cells, restoring backticks and deciding newline vs word-wrap per row with a 60%-width heuristic and markdown block detection (`list/highlight.go:27-165`; `ui.go:1170-1178`). Clipboard writes go through OSC 52 **and** the native clipboard, with a warning only when a native clipboard exists and refused (`common/common.go:115-130`).
- Textarea gets its own click/drag selection in local coordinates (`forwardMouseToTextarea` `ui.go:3496-3548`).

---

## 16. Images in the terminal

`internal/ui/image/image.go`: two encodings, `EncodingBlocks` (half-block/box-drawing art via `go-ansi-paintbrush` with tuned glyph weights, 194-231) and `EncodingKitty` (Kitty graphics protocol with `VirtualPlacement` + Unicode placeholders and diacritic row/column encoding, colour-encoded image ID, chunked, tmux passthrough, 232-282). `Transmit` sends once per `(id, cols, rows)` and caches the fitted image (122-181, Lanczos fit to `cols*cellW × rows*cellH`); `Render` emits the placeholder grid. Capability detection: `common/capabilities.go:44-77` collects `ColorProfile`, pixel size (`XTWINOPS 14`), Kitty reply, DA1 Sixel bit, XTVERSION, focus-mode report, OSC 99 support; `QueryCmd` (81-102) only sends the "smart" queries to terminals known to answer (Alacritty/Ghostty/Kitty/Rio/WezTerm, not Apple Terminal, not SSH — 132-143). The file picker shows a grey block placeholder until the image is transmitted (`dialog/filepicker.go:264-296`). Pasted/attached images are limited to 5 MB and jpg/png (`common/common.go:19-22`); models without image support hide the keys (`ui.go:2583-2590`).

---

## 17. Notifications, exit banner, other terminal integration

- Notifications: backend chosen from config `auto|native|osc|bell|disabled` and capabilities — SSH → OSC (99 if the terminal answered the capability query, else 777 urxvt), local → native (`beeep`), else bell, else noop; only sent when the window is unfocused as reported by focus events (`notification/notification.go:1-19`; `osc.go`; `ui.go:578-662`). Triggers: permission needed, questions pending, agent finished/errored.
- Exit banner after the alt-screen closes: logo + random parting line + `Session  <title>` / `Continue crush -s <7-char xxh3 hash>`; `default|compact|none` (`exitbanner/exitbanner.go:26-88`; printed in `cmd/root.go:171-178` to stderr through a colorprofile writer). Session hash prefixes resolve on resume (`session.HashID`, `session.go:26-30`).
- Window title `crush <short cwd>`, indeterminate progress bar (OSC 9;4) while busy, `ctrl+z` suspend refused while busy, external editor via `tea.ExecProcess` on a temp `msg_*.md` (`ui.go:3807`), bracketed paste with heuristics: > 10 lines or > 1000 cols becomes a text attachment (`pasteLinesThreshold/ColsThreshold` 77-80; `handlePasteMsg` 4835), pasted absolute file paths become attachments (`handleFilePathPaste` 4923).

---

## 18. Prompt history, bang mode, attachments

- History: `up` at (0,0) / `down` at end walk previous user messages (loaded from the session or all sessions), keeping the draft; `esc` returns to the draft; bang commands are stored with a `!` prefix (`model/history.go`).
- Bang mode: typing `!` first flips the prompt into shell mode (icon + prompt colour), `enter` runs the command server-side with streaming output into a `ShellItem`, `esc` cancels, backspace on empty exits the mode (`ui.go:2758-2777`; `runShellCommandInternal` 4271; persisted as a `ShellCommand` message part, `message/content.go:140`).
- Attachments row above the textarea with chips (image/text/skill icons), `ctrl+r` then a digit deletes one, `ctrl+r r` all; click on the ✕ removes (`attachments/attachments.go`).
- Custom commands: markdown files under `~/.config/crush/commands`, `~/.crush/commands`, `<data-dir>/commands` with `$ARG` placeholders prompting an arguments dialog; MCP prompts likewise (`commands/commands.go:40-212`).

---

## 19. Config surface relevant to a TUI

`config.TUIOptions{CompactMode, DiffMode unified|split, Completions{MaxDepth, MaxItems}, Transparent, Scrollbar default|always|never, ExitBanner}` (`config/config.go:272-313`; `schema.json:796-841`), `options.notifications` (`schema.json:558-569`), `options.progress`. Config is a Bash DSL (`crushrc`) with JSON deprecated (`docs/config/README.md`). Mutations from the TUI go through the workspace so they land on the server (`SetConfigField("options.tui.transparent", …)` `ui.go:2017-2035`), and the server broadcasts `config_changed` so every client refetches its workspace snapshot (`proto/proto.go:43-45`; `client_workspace.go:1000-1020`).

---

## 20. Testing approach worth noting

Golden tests via `charmbracelet/x/exp/golden` for the diff view across exhaustive size/offset matrices (`diffview/testdata/**`), plus focused unit tests for list caching/versions (`list/list_test.go`, `chat/version_bump_test.go`, `chat/prefix_cache_test.go`), highlight/copy fidelity (`list/highlight_test.go`, `common/inlinecode_copy_test.go`), streaming markdown (`chat/incremental_glamour_test.go`), overlay grace (`dialog/overlay_test.go`), layout (`model/layout_test.go`), busy memoisation (`model/session_busy_test.go`), input filter (`model/filter_test.go`), and render benchmarks (`model/renderbench_test.go`, `chat/resize_bench_test.go`). The UI is testable because components are plain structs with `Render(width)`.

---

## 21. Patterns worth stealing (language-agnostic), mapped to our platform

1. **One front-end contract for every client.** `workspace.Workspace` is what our TUI, web, and CLI should share (t1code's `packages/client-core` is the same idea). Design it push-first: every state the UI renders per frame (busy, queue, model, LSP, permission mode) arrives as an event or snapshot, never as a blocking getter (`workspace_cache.go:1-27` is the cost of getting this wrong).
2. **Detached runs.** `POST agent → 202`, run bound to the workspace context, cancel only through an explicit endpoint (`server/proto.go:777-799`). Our WS-RPC turns should behave the same so a TUI disconnect never kills a turn the web app is watching.
3. **Typed terminal events with correlation ids.** `RunComplete{RunID}` minted by the caller (`proto/proto.go:74-81`; `cmd/run.go:253-262`) and must-deliver vs lossy classes (`pubsub/broker.go`). We already have an event log; we should still classify events by delivery guarantee and give headless callers a run id.
4. **Client presence as refcount with grace timers** (`backend.go:47-68, 161-166`): create grace, detach grace, idle shutdown, explicit retire. Directly applicable to plan 077/078 SSH-launched servers.
5. **Reconnect ladder with re-registration and resync** (`client_workspace.go:829-983`): backoff, re-register on 404, `Recovered` → reload the current session, escalate to a persistent error after N failures. The TUI status bar messages for degraded/recovered/stuck (`ui.go:1509-1537`) are a good baseline.
6. **Sole model + imperative components + typed dialog actions** (`AGENTS.md`; `dialog/actions.go`). Keep the "one owner routes everything" and "components return consumed/action" ideas; do not copy the 5k-line file.
7. **Rectangle layout with breakpoints** (`ui.go:3577-3805`): compact under 120x30, sidebar 32 cols, help rows reserved when expanded, two-pass reconciliation when the input's height changes, follow-mode re-pin after any layout change.
8. **Strict key routing order**: quit → dialog → focus toggle → inline editor → cancel-when-busy → state/focus → global fallback (`ui.go:2488-2545`). Two-press `esc` with a 2s timer and "clear queue" as the first-press semantics when prompts are queued (`cancelAgent` 4365-4415).
9. **Dialog overlay with input grace** (`dialog/dialog.go:53-125`): async prompts absorb in-flight keystrokes; reopen-within-500ms skips it.
10. **Inline editors instead of modals for agent questions** (`dialog/inline_editor.go`; `question_form.go`): the form lives where the prompt is, tabs for batches, confirm tab, collapse when unfocused, Tab still reaches the chat.
11. **Virtualized list with per-item version + frozen entries + width-keyed cache**, O(viewport) render, bounded `Overflows` instead of total height, resize suppression + settle + incremental prewarm (`list/list.go`; `model/chat.go:337-384`). This is the core of a fast chat surface and is framework-independent.
12. **Item capability interfaces** (Focusable/Highlightable/Expandable/Animatable/Compactable/KeyEventHandler/MouseClickable/NestedToolContainer) rather than one fat item type (`list/item.go`, `chat/messages.go`, `chat/tools.go`, `chat/agent.go`).
13. **Tool renderer registry + uniform header/body/early-state grammar** (`chat/tools.go:200-274, 522-742`): `● Name main (k=v)`, 10-line bodies with an explicit "N lines hidden [click or space]" affordance, `Requesting permission…`/`Waiting…`/`Canceled.`, ERROR vs WARN for denials, nested sub-agent tools rendered compact inside the parent.
14. **Streaming markdown stable-prefix cache and per-section caches** (`chat/streaming_markdown.go`; `assistant.go:70-104`), plus the three-state thinking view (collapsed tail 10 → tail 200 → full).
15. **Diff view as a pure string builder with a width budget**, split pairing algorithm, per-line highlight cache keyed by `(content, bg)`, leading `…` on horizontal scroll, auto-split above 120 cols, golden tests for every width/height (`diffview/*`). Our product vision wants "one diff component in three containers"; crush shows the terminal container's constraints.
16. **Memoise everything expensive by identity**: chroma style per (theme, bg), lexer per filename, glamour renderer per width, image per (id, cols, rows), animation frames per settings hash (`common/chromastyle.go`, `xchroma/chroma.go`, `common/markdown.go`, `image/image.go`, `anim/anim.go:73-90`).
17. **Completions UX**: `@` trigger only at word start, async load, tiered ranking, popup above the cursor, `ctrl+n/p` insert-and-keep-open, close on space (`completions/*`; `ui.go:2727-2803`).
18. **Permission dialog sizing and keys** (`dialog/permissions.go`): content-driven size with a floor that forces fullscreen on tiny terminals, `a/s/d` accelerators with underlined letters, `t` unified/split, `f` fullscreen, remote resolution auto-closes.
19. **Capability-aware help labels** and a status line that overlays help with TTL'd info messages (`ui.go:1031-1037`; `model/status.go`).
20. **Terminal capability probing gated by terminal identity** (`common/capabilities.go:81-143`) and graceful degradation for images (Kitty → blocks), notifications (native → OSC99 → OSC777 → bell → noop), progress bar (allowlist).
21. **Mouse input coalescing at the program boundary** (`model/filter.go`) and the delayed single click to disambiguate click vs drag-select vs double click (`model/chat.go:859-965`).
22. **Copy fidelity in a cell UI**: sentinel grapheme for inline code, word-wrap heuristic on copy, dual OSC52 + native clipboard with honest error reporting (`list/highlight.go`, `styles.go:28-44`, `common/common.go:115-130`).
23. **Exit banner with a resume command** and hashed short session ids (`exitbanner/*`, `session.HashID`). Cheap, high-value for a terminal front end.
24. **Paste heuristics** (large paste → attachment; absolute path → attachment) and **bang mode** for running shell commands without the agent (`ui.go:77-80, 2758-2777, 4835-4953`).

---

## 22. Anti-patterns to avoid

1. **The 5,205-line god model** (`model/ui.go`) with a ~700-line `Update` and a ~520-line `handleKeyPressMsg`. Keep the single-owner routing but split by feature (editor, chat, dialogs, workspace state) into separate stateful modules with narrow method APIs; crush's own AGENTS.md already pushes "create files if needed; do not nest models".
2. **Blocking getters on the client contract** (`AgentIsBusy`, `AgentIsReady`, `AgentModel`, `PermissionSkipRequests`, `LSPGetStates` — each an HTTP round-trip in client mode) that forced the TTL/generation memoisation layer (`workspace_cache.go`, `model/lsp.go`). Expose snapshots + events.
3. **Process-global state in a multi-workspace server**: LSP state and MCP state are package-level (`app/lsp_events.go:38-41`; `backend/events.go:26-33` and `95-98` ignore `workspaceID`), the turn timer is global (`common/timer.go`), image and markdown caches are global. For our federated multi-environment model, everything must be keyed by environment/workspace.
4. **SSE without a resume cursor** (`server/proto.go:281-330`): every reconnect loses events and the client has to reload the session. Our event log with sequence numbers should let the TUI resume from `lastSeq`.
5. **Lossy default delivery that needed a fallback**: `RunComplete` had to be re-emitted from `backend.runAgent` because the agent-error notification is lossy (`backend/agent.go:88-125`). Decide delivery classes up front.
6. **Encoding structure in id strings**: sub-agent sessions are identified by parsing `CreateAgentToolSessionID(messageID, toolCallID)` (`workspace.go:127-128`; `ui.go:1780-1800`). Model parent/child relationships as fields.
7. **`Params any` with a per-tool `UnmarshalJSON` switch** (`proto/permission.go:86-146`) and `Result.Metadata` as a JSON string every renderer re-parses (`chat/file.go:229-232`, `chat/bash.go:57-59`). Use discriminated unions in the contract.
8. **Two code paths behind one 80-method interface** (`AppWorkspace` vs `ClientWorkspace`, toggled by env var `cmd/root.go:233-236`). Parity bugs are inevitable; we should have exactly one path (always a client of the server).
9. **Hard-coded keybindings and provider-driven theme with no user setting** (`model/keys.go`; `styles/themes.go:13-32`; no schema entries). Our settings registry rule (every knob registered, execution-scoped keys at application scope) should cover keymap and theme from day one.
10. **Colour literals inside the theme layers** (`diffview/style.go:27-141` Charmtone + hex; `quickstyle.go` chroma section) and duplicated layout constants (`sidebarWidth = 32` at `ui.go:3596` vs `- 30` at `4643`). Token-only, single source.
11. **Cursor positioning by summing paddings/borders by hand** (`dialog/common.go:179-207`). A cell-buffer draw that returns the cursor from the widget that owns it is less fragile.
12. **Regex/heuristic reconstruction of text from cells for copy** is unavoidable in a pure-cell UI, but it is a large maintenance surface (`list/highlight.go:104-190`). Keep the source text reachable from the rendered item (crush does via `RawRender`) so copy can prefer the source when the selection covers whole items.
13. **Dialog-grace as a fix for focus stealing** is clever but is a symptom: an async prompt should not become the key target without an explicit user action, or should only accept its accelerators after a first non-accelerator key. Consider non-modal, focus-on-demand prompts (their own inline question form is the better model).
14. **Everything in one process-wide `tea.Program` with `program.Send` from goroutines** works for one connection; with several environments streaming at once (plan 078) the fan-in and per-environment ordering must be designed, not inherited.

---

## 23. How this maps to our platform (and open questions)

- Our server already has the event-log/projection spine and a WS-RPC transport (`apps/server/src/orchestration/ws-rpc.ts`), so the crush pieces that transfer are the _client-side_ ones: the workspace contract shape, the reconnect/resync ladder, permission/question request-response with first-writer-wins, `RunComplete` correlation for headless callers, and the whole render-side architecture (virtualized list, caches, tool grammar, diff view, dialogs, inline editors).
- Plan 078's "several connected environments, one workbench" has no analogue in crush (one server, many workspaces, but one workspace per TUI). The TUI will need one `ClientWorkspace`-like object per environment and a rail that merges them; crush's per-workspace `ConnectionEvent` needs an environment id.
- Crush's LSP/diagnostics surfacing is count-level only. The product vision's IDE-mode diagnostics are richer; the TUI can start at crush's level (sidebar counts, header error total) and grow.
- Diff: crush proves that a TUI diff needs a width-budgeted, horizontally scrollable, per-line-highlighted renderer with unified/split and golden tests. Our `@singapore-editor/*` diff package is a web editor; the TUI needs its own renderer over the same diff model.

Open questions to settle before building: which TUI runtime (OpenTUI/Solid or React as in opencode/t1code vs. Go), whether the server exposes permission requests, question batches, file-version history (+/- stats), and LSP counts as events today, how the TUI authenticates to SSH-launched servers (plan 077), and whether keymap/theme land in `packages/contracts/src/settings/keys.ts` before the TUI ships.
