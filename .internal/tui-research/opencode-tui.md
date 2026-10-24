# opencode TUI (`packages/tui`) — architecture deep-read

Root: `/work/projects/platform/references/opencode/packages/tui` (v1.18.29, ~27k lines, Bun + `@opentui/core|solid|keymap` 0.4.5/0.5.10 + `solid-js` + `effect`). All paths below are relative to that root unless absolute.

The TUI is a **thin front end over the opencode HTTP server + SSE**: it holds no domain logic, only a Solid store mirror of server state, a keymap, a dialog stack, and renderers for the message stream. Nearly everything the web app can do goes through the same `@opencode-ai/sdk/v2` client the web uses.

---

## 1. Boot and renderer setup

### Entry: `src/index.tsx:1` → `src/app.tsx:186` `run(input: TuiInput)`

`TuiInput` (`src/app.tsx:142-152`): `{ url, args, config: TuiConfig.Resolved, onSnapshot?, directory?, fetch?, headers?, events?: EventSource, pluginHost }`. **Transport is injectable** (`fetch`, `events`) — this is what makes the same app run against an in-process worker, a remote server, and tests.

`run` is an `Effect.fn` with a scoped resource tree (`src/app.tsx:186-363`):

1. `createCliRenderer` (`src/app.tsx:191-213`) with these options:
   - `externalOutputMode: "passthrough"`, `targetFps: 60`, `gatherStats: false`
   - `exitOnCtrlC: false` (Ctrl+C handled by keymap `app_exit` binding, `src/config/keybind.ts:48`)
   - `useKittyKeyboard: {}` (kitty protocol on)
   - `autoFocus: false`, `openConsoleOnError: false`
   - `useMouse: !Flag.OPENCODE_DISABLE_MOUSE && config.mouse`
   - `consoleOptions.keyBindings: [{ ctrl+y → "copy-selection" }]`
   - released via `destroyRenderer` (`src/util/renderer.ts:1-7`: clears terminal title before destroy).
2. `win32DisableProcessedInput()` (`src/app.tsx:214`).
3. `createDefaultOpenTuiKeymap(renderer)` + `registerOpencodeKeymap` (`src/app.tsx:215-219`; see §5).
4. Finalizers: `pluginHost.dispose()`, `TuiAudio.dispose`, `SIGHUP → destroyRenderer` (`src/app.tsx:220-235`).
5. Shutdown is a `Deferred` resolved on `renderer.once("destroy")` (`src/app.tsx:230-236`).
6. Palette prewarm + `renderer.waitForThemeMode(1000) ?? "dark"` **before** `render` so the system theme doesn't flash (`src/app.tsx:239-243`).
7. `render(() => <providers…><App/></providers>, renderer)` (`src/app.tsx:245-351`). Provider order (outer → inner): Exit → Epilogue → ErrorBoundary(ErrorComponent) → TuiPaths → TuiTerminalEnvironment → TuiStartup → Clipboard → OpencodeKeymap → Args → KV → Toast → Route → TuiConfig → PluginRuntime → SDK → Permission → Project → Sync → Data → Theme → Local → PromptStash → Dialog → Frecency → PromptHistory → PromptRef → EditorContext → Location → App.
8. After shutdown: `win32FlushInputBuffer()`, print error to stderr, print epilogue to stdout (`src/app.tsx:357-362`). The epilogue is the "Session … / Continue opencode -s <id>" wordmark (`src/util/presentation.ts:30-38`) set by the session route (`src/routes/session/index.tsx:201-205`).

`createSimpleContext` (`src/context/helper.tsx:3-26`) is the context factory used everywhere: `init(props)` returns a plain object; if it has `ready`, children are gated on `<Show when={init.ready…}>` (`:15`). KV, Theme, Sync use this gate to block the tree until loaded.

### CLI wiring (how the server is reached)

`/work/projects/platform/references/opencode/packages/opencode/src/cli/cmd/tui.ts`:

- Spawns the server in a **Bun `Worker`** (`:210-215`), talks to it over an RPC channel.
- Local transport: `url: "http://opencode.internal"`, `fetch: createWorkerFetch(client)` (`:24-40`, serializes Request → RPC → `Server.Default().app.fetch` in the worker, `cli/tui/worker.ts:31-49`), `events: createEventSource(client)` (`:42-50`, subscribes to the worker's `Rpc.emit("global.event")`, `worker.ts:23-26`).
- External (`--port/--hostname/--mdns`): `url` of the listening server, `fetch: undefined` (real fetch + SSE), `headers: ServerAuth.headers()` (`:233-249`).
- `SIGUSR2` → `client.call("reload")` (config invalidate + dispose instances) (`:217-219`); the TUI itself also listens to SIGUSR2 to re-discover themes (`src/context/theme.tsx:46-49`).
- `run` is provided the Effect layer in `cli/tui/layer.ts:6-8`.

### Server side of the event stream

- SDK: `sdk.global.event()` → SSE GET `/global/event` (`packages/sdk/js/src/v2/gen/sdk.gen.ts:1336-1341`) using the generated `createSseClient` (`gen/core/serverSentEvents.gen.ts:78+`, has `Last-Event-ID`, retry/backoff options; the TUI sets `sseMaxRetryAttempts: 0` and does its own reconnect loop).
- Server: `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:25-58` — stream = `server.connected` first, then `GlobalBus` events merged with a **10 s heartbeat** (`server.heartbeat`), encoded as `text/event-stream` with `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`.
- Envelope `GlobalEvent = { directory, project?, workspace?, payload: { id, type, properties } }` (`packages/sdk/js/src/v2/gen/types.gen.ts:730+`). Directory/workspace scoping is on the envelope, which the TUI uses to filter (`src/app.tsx:985-1006`).
- The SDK client injects `x-opencode-directory` / `x-opencode-workspace` headers and rewrites them into query params for GET (`packages/sdk/js/src/v2/client.ts:18-93`).

---

## 2. Routing

`src/context/route.tsx`:

- Route union `HomeRoute | SessionRoute | PluginRoute` (`:6-23`), each optionally carrying a `prompt?: PromptInfo` so navigation can seed the composer (used by fork: `src/routes/session/dialog-message.tsx:145-149`).
- Store-backed; `navigate(route)` is `setStore(reconcile(route))` (`:37-39`). Initial route from `--continue` or `OPENCODE_ROUTE` env JSON (`src/app.tsx:277,286-295`, `route.tsx:44-53`).
- `useRouteData("session")` narrows the type (`:57-60`).

`App` renders `<Switch>` home / session, keyed on `sessionID` so `<Session/>` remounts per session (`src/app.tsx:1112-1121`), plus plugin routes resolved from `pluginRuntime.routes.get(id)` (`src/app.tsx:1079-1085`, `src/plugin/api.ts:11-38`). Two host slots wrap the route: `app_bottom` (dock) and `app` (overlay) (`src/app.tsx:1124-1127`).

Home (`src/routes/home.tsx:22-95`): logo slot, prompt slot (`home_prompt`, mode replace), `home_bottom`, `home_footer` (single_winner); auto-submits `--prompt` once sync + model store are ready (`:59-68`).

---

## 3. State sync from the server

### `src/context/sdk.tsx` — transport + event bus

- `EventSource` interface `{ subscribe(handler): Promise<() => void> }` (`:7-9`) — injectable replacement for SSE.
- Event emitter with **batching**: events are queued and flushed in a Solid `batch()`; if a flush happened <16 ms ago, the next flush is deferred 16 ms (`:48-80`). One render per burst of streaming deltas.
- SSE loop with exponential backoff 1 s → 30 s (`:82-117`), `sseMaxRetryAttempts: 0` so the loop owns retry. Workspace sync is kicked off **after** subscribing (`:96-100,124-128`).
- Exposes `{ client, directory, event, fetch, url }`.

### `src/context/event.ts` — typed subscription

`useEvent().on("session.status", (evt, { directory, workspace }) => …)` (`:22-30`); `sync` payloads are filtered out (`:14-16`).

### `src/context/sync.tsx` — the v1 mirror store

Store shape (`:70-144`): `status: loading|partial|complete`, `provider[]`, `provider_default`, `provider_next`, `agent[]`, `command[]`, `config`, `session[]` (sorted by id), `session_status{}`, `session_diff{}`, `todo{}`, `message{sessionID: Message[]}`, `part{messageID: Part[]}`, `permission{}`, `question{}`, `lsp[]`, `mcp{}`, `mcp_resource{}`, `formatter[]`, `vcs`, `console_state`, `capabilities`.

Key mechanics:

- Every list is kept **sorted** and updated with **binary search + `produce(splice)`** (`search` `:41-52`; sessions `:273-298`, messages `:321-360`, parts `:376-396`, permissions `:181-225`, questions `:227-263`). `reconcile()` for in-place replacement so Solid keeps identity.
- `message.part.delta` appends to a string field in place (`:398-415`) — streaming text never re-allocates the array.
- **100-message cap per session**: when a new message pushes over 100 the oldest is shifted and its parts deleted (`:340-358`); `session.sync` also slices to the last 100 (`:625-626`).
- `bootstrap()` (`:451-552`) has three phases: **blocking** (providers, provider list, capabilities, agents, config, project, and session list only when `--continue`) → `status = "partial"` → **non-blocking** (sessions, commands, lsp, mcp, resources, formatter, session status, provider auth, vcs, workspaces) → `status = "complete"`. Fatal by default (calls `exit(e)`); `sync.bootstrap({ fatal: false })` is re-run on workspace switch (`src/routes/session/index.tsx:301-311`) and on `server.instance.disposed` (`:178-180`).
- `session.sync(sessionID)` (`:594-667`) fetches session/messages(limit 100)/todo/diff, de-dups concurrent calls (`syncingSessions`), and uses a **hydration tracker** so events that arrived during the fetch are not clobbered by the stale snapshot (`hydratingSessions`, `touchMessage/touchPart` `:150-158`, merge logic `:613-656`; keeps live text over an empty snapshot text `:637-645`). `fullSyncedSessions` makes it once-per-session.
- `sessionListQuery()` scopes the list by worktree-relative path or `scope: "project"` (KV toggle) (`:160-168`).
- Auto-permission mode (`--auto`) replies `once` to every `permission.asked` inside the sync handler (`:196-205`).

### `src/context/data.tsx` — the v2 store (newer message model)

Separate `Data` store keyed by `location` (`{directory, workspaceID}` → JSON key, `:50-56`) holding v2 catalogs (agent/command/integration/model/provider/reference/skill) and a v2 `session.message` list built purely from `session.next.*` events (`:124-403`: step.started/ended, text/reasoning/tool deltas, shell, compaction). Both stores coexist during migration; the prompt uses `data.location.reference.list()` and `sdk.client.v2.fs.find` for autocomplete.

### Other context stores

- `src/context/project.tsx` — current path/project/workspaces; `workspace.status` updated from `workspace.status` events (`:70-74`).
- `src/context/local.tsx` — pure client-side selection state: agent (`:77-133`, deterministic color per agent from theme palette `:119-131`), model with recents/favorites/variants persisted to `state/model.json` (`:137-407`; `fallbackModel` precedence `--model` > config.model > recent > provider default `:197-234`), pinned sessions + quick slots 1-9 (`:411-501`), MCP toggle (`:505-520`).
- `src/context/kv.tsx` — `state/kv.json` general-purpose KV: `Flock` lock + serialized write queue + `structuredClone(unwrap(store))` snapshot (`:20-62`), `kv.signal(name, default)` returns a signal-like tuple (`:40-49`). Used for ~25 toggles (sidebar, timestamps, thinking, animations, theme, etc.).
- `src/context/permission.tsx` (`auto|normal`), `src/context/location.tsx` (current LocationRef for path formatting), `src/context/path-format.tsx` (relative-to-session-dir formatter with `~` abbreviation), `src/context/thinking.ts` (`show|hide` + OpenAI reasoning-summary title parsing `:12-17`).

---

## 4. Keymap and keybind config

### Config format (`src/config/keybind.ts`)

- A binding value is `false | "none" | "ctrl+x" | {name, ctrl?, shift?, meta?, super?, hyper?} | {key, event?, preventDefault?, fallthrough?} | array` (`:8-34`). Comma-separated alternatives (`"escape,q"`) and leader token (`"<leader>e"`) are parsed by keymap addons.
- `Definitions` is the single registry of ~180 named keybinds with defaults + description (`:45-240`). `CommandMap` maps snake_case config names → dotted command ids (`:256-420`) (e.g. `session_new → "session.new"`, `messages_page_up → "session.page.up"`).
- `KeybindOverrides` schema is generated from `Definitions` (`:245-252`); `parse()` rejects unknown keys (`:449-458`); `bindingDefaults()` injects descriptions as the binding `desc` when absent (`:466-471`).
- `src/config/index.tsx:101-136` `resolve()` builds `keybinds: createBindingLookup(...)` (a view with `get/has/gather/pick/omit`) and applies platform rules: no terminal suspend → `terminal_suspend: "none"` and `ctrl+z` becomes undo (`:103-111`). Also resolves attention, cursor, mouse, leader timeout (default 2000 ms `:21`).

### Keymap engine (`src/keymap.tsx`, on `@opentui/keymap`)

- **Mode stack** (`:53-100`): a layer field `mode` requires `opencode.mode === value`; `push("modal"|"autocomplete"|"question")` returns a pop fn. Layers registered with `mode: OPENCODE_BASE_MODE` are silenced while a dialog/autocomplete/question is up; layers with no `mode` stay active (verified by `test/keymap.test.tsx:66-120`).
- `registerOpencodeKeymap` (`:214-244`): comma bindings, key aliases (`enter→return`, `esc→escape`, `pgup/pgdown`, `:112-134`), base-layout fallback (layout-independent matching), timed leader (`ctrl+x` default, `:41` in keybind.ts), escape clears / backspace pops pending sequence, and a **managed textarea layer** wiring the `input.*` commands to the focused `TextareaRenderable` (`:136-178`).
- `useBindings(() => ({ mode?, enabled?, priority?, target?, commands?, bindings }))` from `@opentui/keymap/solid` — this is how every component declares its commands. Pattern: commands carry metadata (`title, category, namespace: "palette", slashName, slashAliases, hidden, suggested, enabled`) and bindings come from `tuiConfig.keybinds.gather("<layer name>", [...commandIds])` (`src/app.tsx:962-983`, `src/routes/session/index.tsx:1098-1121`).
- `useCommandShortcut(cmd)` → formatted key label for footers (`:250-258`). `useCommandSlashes()` derives the `/` autocomplete list from palette commands with `slashName` (`:260-290`). `useLeaderActive()` dims the prompt while a leader sequence is pending (`:246-248`, used at `src/component/prompt/index.tsx:1288-1289`).
- Command palette (`src/component/command-palette.tsx`) is just `DialogSelect` over `keymap.getCommandEntries({ namespace: "palette", visibility: "reachable" })` with a "Suggested" category (`:29-78`).
- which-key is a builtin plugin (disabled by default) that reads `keymap.getActiveKeys({includeMetadata:true})` and `getPendingSequence()` to render a cheat sheet as dock/overlay (`src/feature-plugins/system/which-key.tsx:184-330,532-600`).
- Priority layering examples: `DialogPrompt` submit at `priority: 1` to beat the managed textarea (`src/ui/dialog-prompt.tsx:57`), selection-copy intercept at `priority: 1` (`src/app.tsx:423-430`), which-key layer priority 900.

---

## 5. Dialog, toast, spinner system

### Dialog (`src/ui/dialog.tsx`)

- **Single-slot stack**: `replace(element, onClose)` clears the stack and shows one dialog (`:150-165`); `clear()` runs all `onClose`s (`:140-149`). Sizes medium/large/xlarge = 60/88/116 cols (`:22-26`), centred at `height/4` over a `RGBA(0,0,0,150)` scrim (`:40-48`).
- Opening pushes mode `"modal"` (`:81-85`) so base-mode bindings go quiet; escape/ctrl+c close (`:105-137`). Focus is saved/blurred on open and restored via a `setTimeout(1)` tree search on close (`:87-103,151-153`).
- Backdrop click closes unless the user was selecting text (`:21-39,51-57`). Copy-on-select handler lives on the dialog layer too (`:188-197,205-213`).
- Promise helpers: `DialogAlert.show(dialog, title, msg)` (`src/ui/dialog-alert.tsx:59-66`), `DialogConfirm.show(...) → true|false|undefined` (`src/ui/dialog-confirm.tsx:93-108`), `DialogPrompt.show(...) → string|null` (`src/ui/dialog-prompt.tsx:118-127`). Used for update-available flow (`src/app.tsx:1038-1076`).
- `DialogSelect` (`src/ui/dialog-select.tsx`) is the workhorse list: fuzzysort with title weighted 2× category (`:154-173`), category grouping with headers (`:186-195`), `flat` mode when filtering, `actions` (footer buttons bound to commands via `keybinds.get(cmd)`, tab/shift+tab cycles them `:369-483`), `footerHints`, `preserveSelection` across async option updates (`:217-269`), `current` marker `●`, `gutter`/`margin` slots, mouse hover only after a real mouse move (`input: "keyboard"|"mouse"` guard `:178-182,650-666`), height capped to half terminal (`:212-213`), scroll-to-selection by walking scrollbox children (`:311-342`). Concrete consumers: sessions (`src/component/dialog-session-list.tsx`: debounced server search, pinned/today categories, spinner gutter for busy sessions, two-press delete confirm `:290-346`), models, agents, themes (live preview on move, revert on cancel `src/component/dialog-theme-list.tsx:19-47`), plugins.

### Toast (`src/ui/toast.tsx`)

Single toast at a time (`:53-85`), `duration` default 5000 ms with `.unref()` timer, rendered absolutely top-right with a left/right `┃` split border coloured by variant (`:15-51`). `toast.error(err)` helper. Toast component is mounted inside each route (`src/routes/home.tsx:88`, `src/routes/session/index.tsx:1337`).

### Spinners

- `<spinner>` element registered from `opentui-spinner/solid` (`src/component/register-spinner.ts`). `Spinner` component: braille frames at 80 ms, `⋯` fallback when `animations_enabled` is false (`src/component/spinner.tsx:17-24`).
- Knight-Rider bar for the "working" status, colour derived from the agent colour with alpha trail (`src/ui/spinner.ts:199-368`, used at `src/component/prompt/index.tsx:1322-1344`).
- `StartupLoading` overlay only after 500 ms, min 3 s hold once shown (`src/component/startup-loading.tsx:5-63`).

---

## 6. Prompt editor (`src/component/prompt/index.tsx`, 1716 lines)

Built on OpenTUI's `<textarea>` (`:1369-1443`) with **extmarks** as the model for rich tokens.

- **Model**: `PromptInfo = { input, mode?: normal|shell, parts: (FilePart|AgentPart|TextPart-with-source)[] }` (`src/prompt/history.tsx:9-25`). Each non-text part has `source.text.{start,end,value}`; a virtual extmark (`styleId` from theme scopes `extmark.file|agent|paste`, `typeId = "prompt-part"`) tracks the range as text is edited. `syncExtmarksWithPromptParts` rebuilds parts from live extmark ranges on every content change (`:702-734`); `restoreExtmarksFromParts` re-creates them when loading history/stash (`:658-700`). Cursor math uses grapheme/display widths (`src/prompt/display.ts`).
- **Submit** (`:930-1147`): re-entrancy guard (`submitting`, regression test `test/cli/tui/prompt-submit-race.test.ts`), IME double-defer on Enter (`:1391-1395`) plus a plainText resync (`:950-956`), `exit|quit|:q` words exit the app, creates a session first if none (`:993-1024`), expands pasted placeholders back into text (`:1026-1034`), routes to `session.shell` (shell mode), `session.command` (server slash command, multi-line args `:1071-1091`), or `session.prompt` with editor-context synthetic part (`:1042-1057,1092-1121`). Navigates to the new session after 50 ms (`:1134-1143`).
- **Shell mode**: `!` at column 0 toggles (`:816-841`), escape/backspace at col 0 exits (`:843-860`), border turns primary and status shows "Shell".
- **Paste** (`:1396-1420`, `:1183-1222`): bracketed paste bytes decoded + CR/CRLF normalised; empty paste on old Windows Terminal falls back to a clipboard read command; pasted text that is a local file path (with `file://` and escaped-space handling `:78-87`) becomes an image/PDF attachment via `readLocalAttachment` (`src/component/prompt/local-attachment.ts`), SVG becomes text; ≥3 lines or >150 chars becomes a `[Pasted ~N lines]` placeholder part (KV toggle); `getClipboardText` expands placeholders when copying out of the textarea (`:1423-1425`). Clipboard image paste via `prompt.paste` command reads OS clipboard for `image/*` (`:371-391`, `src/clipboard.ts:30-75`).
- **Attachments**: `pasteAttachment` inserts `[Image N]`/`[PDF N]` virtual text and a `data:` URL FilePart (`:1224-1270`).
- **Autocomplete** (`src/component/prompt/autocomplete.tsx`): triggers `@` (files/dirs via `sdk.client.v2.fs.find` limit 20, ranked server-side; agents; MCP resources; reference aliases with `alias/sub/path`) and `/` (palette slash commands + server commands), `#12-20` line ranges on files (`:32-57,242-278`), frecency boost from a local JSONL (`src/prompt/frecency.tsx:33-36`), directory expansion with tab (`:559-579`), absolute positioning above the prompt anchor with a 50 ms position poll (`:115-144`), pushes mode `"autocomplete"` (`:109-113`), keeps previous options while files are loading (`:497-499`). Editor `at_mentioned` events also insert mentions (`:662-666`).
- **History/stash**: JSONL files in state dir, capped at 50, duplicate-suppressed, self-healing rewrite on load (`src/prompt/history.tsx:27-108`, `src/prompt/stash.tsx`). Up/Down move history only when the cursor is at buffer start/end (`:862-928`). Draft ≥20 chars is saved to history on clear (`:1272-1286`). Module-level `stashed` preserves the draft across route remounts (`:141,615-633`).
- **External editor**: `prompt.editor` command writes a temp `.md`, `renderer.suspend()`, spawns `$VISUAL||$EDITOR`, resumes and re-anchors non-text parts by searching their virtual text in the result (`:423-514`, `src/editor.ts:26-54`).
- **Editor context** (`src/context/editor.ts`): connects to a Claude-Code-style IDE WebSocket (JSON-RPC, `initialize`, `selection_changed`, `at_mentioned`; discovered from `~/.claude/ide/*.lock` scored by workspace folder containment `src/editor.ts:56-96`, or `CLAUDE_CODE_SSE_PORT`/`OPENCODE_EDITOR_SSE_PORT`) with backoff reconnect; in a Zed terminal it polls Zed's sqlite DB for the active selection (`src/editor-zed.ts:41-87`). The selection is shown as a dismissible label and sent once as a `<system-reminder>` synthetic text part (`:128-139,1042-1057`).
- **Status row** (`:1513-1690`): working spinner + double-escape interrupt counter (`:393-422`), retry countdown with click-to-expand error, workspace/move progress, context tokens (% of model limit) and cost, agent/model/variant labels with fade-in (`src/util/signal.ts:19-51`).
- **Traits**: `input.traits` describes capture (`tab`, `escape/navigate/submit` when autocomplete is open) and status badge (`src/prompt/traits.ts`).

---

## 7. Message rendering (`src/routes/session/index.tsx`, 2706 lines)

- Container: `<scrollbox stickyScroll stickyStart="bottom" scrollAcceleration=…>` (`:1181-1198`) with optional scrollbar (KV). `<For each={messages()}>` renders `UserMessage`/`AssistantMessage`; reverted messages after the revert point are hidden and replaced by a "N messages reverted / redo" card (`:1200-1295`).
- **No virtualization.** Bounded by the 100-message store cap (§3) and OpenTUI's own dirty-tracking. Message-level navigation (`session.message.next/previous`, `messages_last_user`) scans `scroll.getChildren()` by `y` (`:378-421,830-876`).
- **Parts**: `PART_MAPPING = { text, tool, reasoning }` rendered via `<Dynamic>` (`:1578-1582,1493-1507`).
  - Text → `<markdown syntaxStyle streaming internalBlockMode="top-level" conceal tableOptions={{style:"grid"}}>` (`:1686-1705`). Markdown + code highlighting are native OpenTUI renderables backed by tree-sitter; extra languages are declared in `src/parsers-config.ts` (wasm + highlight/locals query URLs) and registered with `addDefaultParsers` (`:85`). Filetype mapping in `src/util/filetype.ts` (JS/JSX/TSX collapse to `typescript`).
  - Reasoning → collapsible header ("Thought: title · 1.2s") + `<code filetype="markdown">` with a **subtle** syntax style (alpha = `thinkingOpacity`) (`:1586-1684`, `src/theme/index.ts:560-584`).
  - Tool → `ToolPart` switches on tool name (`:1709-1789`): `Shell`, `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Write` (code + `<line_number>` + diagnostics), `Edit`/`ApplyPatch` (`<diff view=split|unified showLineNumbers wrapMode …>` with all diff colours from the theme `:2389-2516`), `Task` (subagent progress from the child session's parts; click navigates `:2214-2310`), `Execute`, `TodoWrite`, `Question`, `Skill`, `GenericTool`. Two shapes: `InlineTool` (one-line `icon label`, spinner while pending, strikethrough when denied, click to expand error `:1835-1991`) and `BlockTool` (left-border panel with title, hover bg, error footer `:1993-2043`).
  - Long outputs collapse to N lines/chars with click-to-expand (`src/util/collapse-tool-output.ts`).
- **Spacing trick**: consecutive inline tools have no blank line between them, but any block gets a margin; implemented with a pre-layout lifecycle hook that looks at the previous sibling (`src/util/layout.ts:8-25`, `alwaysSeparate` WeakSet `:94`, used in `InlineToolRow :1938-1946`). Snapshot-tested in `test/cli/tui/inline-tool-wrap-snapshot.test.tsx`.
- Assistant footer line `▣ Build · model · 12.3s` after the final message (`:1548-1573`); errors as a red-bordered card (`:1533-1547`).
- **Permission/question prompts are inline, not dialogs**: `PermissionPrompt` (`src/routes/session/permission.tsx`) renders below the scrollbox in place of the composer (`:1297-1312`), shows tool-specific bodies (edit diff in a scrollbox, bash command, task, external_directory patterns…), option buttons with left/right/h/l/enter, `ctrl+f` fullscreen via `<Portal>` (`permission.tsx:524-719`), "always" confirmation stage and a reject-with-message stage for subagents. `QuestionPrompt` pushes keymap mode `"question"` (`question.tsx:12,128-131`) and supports tabs, multi-select and custom answers.
- Session commands (`:465-1084`): share/unshare, rename, timeline (jump to message via child id), fork from message, compact, undo/redo (revert API + reseeding the prompt with the reverted text), toggles (sidebar/conceal/timestamps/thinking/tool details/scrollbar/generic output), scroll commands, copy last assistant message, copy/export transcript (`src/util/transcript.ts`), background subagents, parent/child navigation.
- Terminal title follows the session title (`src/app.tsx:452-476`).

---

## 8. Sidebar

`src/routes/session/sidebar.tsx`: 42-col panel, `backgroundPanel`, own scrollbox; content is **entirely slot-driven**: `sidebar_title` (single_winner, default = title + workspace + share url), `sidebar_content` (append), `sidebar_footer` (single_winner). Builtin plugins fill it in `order`: context tokens/cost (100), MCP status (200), LSP (300), Todo (400), Modified files with +/- (500), footer with getting-started card + path/branch + version (`src/feature-plugins/sidebar/*`). Visible automatically when width > 120 (`session/index.tsx:270-276`); narrower terminals get an **overlay** sidebar with a dim scrim when toggled (`:1339-1357`). `Footer` (`src/routes/session/footer.tsx`) shows dir:branch, permission count, LSP/MCP counts and a periodic "/connect" nudge.

---

## 9. Theme system

### Definition (`src/theme/index.ts`, `src/theme/assets/*.json`, 33 bundled)

- `ThemeJson = { defs?: Record<name, hex|ref>, theme: Record<ThemeColor, hex | ref | {dark, light} | ansiNumber> }` (`:113-128`). Example `assets/opencode.json`: `defs.darkStep1…lightStep12` then `"primary": { "dark": "darkStep9", "light": "lightStep9" }`.
- `Theme` has ~50 tokens (`:36-91`): ui (`primary/secondary/accent/error/warning/success/info/text/textMuted/selectedListItemText/background/backgroundPanel/backgroundElement/backgroundMenu/border/borderActive/borderSubtle`), diff (11 tokens incl. line-number backgrounds), markdown (14), syntax (9), `thinkingOpacity`.
- `resolveTheme(json, mode)` (`:241-299`) resolves refs recursively with cycle detection, `"transparent"|"none"` → alpha 0, 256-colour ints via `ansiToRgba` (`:301-344`), fallbacks for `selectedListItemText` (→ background) and `backgroundMenu` (→ backgroundElement).
- `selectedForeground(theme, bg?)` picks black/white by luminance when the background is transparent (`:95-111`) — the trick that keeps selection readable on the terminal's own background.
- **System theme** `generateSystem(colors, mode)` (`:360-469`) derives a full theme from the terminal's 16-colour palette (`renderer.getPalette({size:16})`), with grey scale and muted text computed from the actual background luminance (`:471-554`), diff backgrounds as `tint(bg, green/red, 0.22|0.14)`. `terminalMode()` picks dark/light by background luminance (`:353-358`).
- Registry with priority defaults < plugin < custom files < system (`:166-239`), subscribable.
- Syntax: `generateSyntax(theme)` → `SyntaxStyle.fromTheme(rules)` mapping tree-sitter scopes (incl. `markup.*`, `diff.*`, `extmark.file|agent|paste`) to theme tokens (`:586-1089`).

### Runtime (`src/context/theme.tsx`)

- Custom themes discovered from `Global.Path.config/themes/*.json` and every `.opencode/themes` walking up from cwd (`:37-61`); refreshed on `SIGUSR2` after 250 ms/1000 ms (`:82,235-246`).
- Mode: KV lock > `renderer.themeMode` (OpenTUI queries the terminal) > initial; listens to `CliRenderEvents.THEME_MODE` and to the raw OSC `\x1b[?997;1n|2n` theme-change notification via `renderer.prependInputHandler` (`:222-233`); lock/unlock persisted in KV (`:202-220`).
- `theme` is a **Proxy** over a memo so consumers write `theme.primary` and stay reactive (`:275-280`); `renderer.setBackgroundColor(theme.background)` effect (`:269`).
- `createSyntaxStyleMemo` destroys the previous native `SyntaxStyle` only after `renderer.idle()` (`:306-332`) — avoids freeing a style mid-frame.

---

## 10. Scrolling, mouse, clipboard

- Scroll speed: `scroll_speed` (constant cells/tick) or macOS-style acceleration (`src/util/scroll.ts`), passed as `scrollAcceleration` to every `<scrollbox>`.
- Mouse: `useMouse` from config; hover states (`onMouseOver/Out`) on messages/tools/buttons; click handlers guarded with `if (renderer.getSelection()?.getSelectedText()) return` so drag-select doesn't trigger clicks (`session/index.tsx:1226`, `:1894`, `:2013`). Copy-on-select: root `onMouseUp` → `Selection.copy` (`src/app.tsx:1101-1105`, `src/util/selection.ts:26-44`), or right-click / ctrl+c / escape when `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT` (`:423-430,1093-1100`). `Link` opens URLs on click (`src/ui/link.tsx`). Console (`renderer.console`) copy hooked to clipboard (`src/app.tsx:437-446`).
- Clipboard (`src/clipboard.ts`): write = **OSC 52 always** (tmux/screen passthrough wrapping `:23-28`) + native tool (`osascript`, `wl-copy`, `xclip`, `xsel`, PowerShell `Set-Clipboard`) + `clipboardy` fallback (`:77-125`); read prefers image (`osascript` PNG, PowerShell, `wl-paste`/`xclip` `image/png`) then text (`:30-75`). Wrapped in an injectable `ClipboardService` context (`src/context/clipboard.tsx`).

---

## 11. Attention / notifications

`src/attention.ts`: `notify({title, message, notification?: {when}, sound?: {name, volume, when}})` → `renderer.triggerNotification` (OSC 9/777 desktop notification) gated on focus state tracked from renderer `focus`/`blur` events (`:126-134`), plus sounds via OpenTUI `Audio` (`src/audio.ts`) with sound packs (builtin mp3s bundled with `with { type: "file" }` `:17-22`) and per-sound overrides from config (`src/config/index.tsx:42-51`). Text is ANSI-stripped and length-capped (`:69-76`). The builtin `notifications` plugin fires on question/permission asked, session done (subagent vs root sound), and session error (`src/feature-plugins/system/notifications.ts:29-87`).

---

## 12. Persistence (`src/util/persistence.ts`)

`readJson/readText`, `writeText`, `appendText`, `writeJsonAtomic` (temp file `.<pid>.<uuid>.tmp` + `rename`, cleanup on failure `:22-33`). Files under `paths.state`: `kv.json` (locked, queued), `model.json`, `session.json`, `prompt-history.jsonl`, `prompt-stash.jsonl`, `frecency.jsonl` (append-only, compacted on load/overflow).

---

## 13. Plugin slots and plugin API

- Host slots (`/work/projects/platform/references/opencode/packages/plugin/src/tui.ts:455-486`): `app`, `app_bottom`, `home_logo`, `home_prompt`, `home_prompt_right`, `session_prompt`, `session_prompt_right`, `home_bottom`, `home_footer`, `sidebar_title`, `sidebar_content`, `sidebar_footer`. Modes: `replace`, `single_winner`, default append, ordered by `order`.
- Implementation: `createSolidSlotRegistry` from `@opentui/solid` (`src/plugin/slots.tsx:24-53`); `pluginRuntime.Slot` is a signal-swapped view so plugins loading late re-render slots (`:17-21`).
- Plugin API surface (`src/plugin/adapters.tsx:173-355`): `keymap` (register layers/commands), `mode`, `route.register/navigate/current`, `ui.{Dialog*, DialogSelect, Prompt, Slot, toast, dialog}`, `kv`, `state` (read-only view of sync store), `client`, `event.on`, `theme`, `attention`, `renderer`. Builtins are ordinary plugins (`src/feature-plugins/builtins.ts`): home footer/tips, sidebar sections, notifications, plugin manager, which-key, diff viewer (a plugin **route** `diff` with file tree, split/unified, hunk navigation, git/branch/last-turn sources — `src/feature-plugins/system/diff-viewer.tsx:38-130`).
- Legacy `api.command` shim maps old command objects to `keymap.registerLayer` with deprecation warnings (`src/plugin/command-shim.ts`).

---

## 14. Windows (`src/terminal-win32.ts`)

`bun:ffi` to `kernel32.dll`: clear `ENABLE_PROCESSED_INPUT` so Ctrl+C is a key not a signal (`:29-42`), flush queued input on exit (`:47-54`), and a guard that re-clears after `setRawMode` plus a 100 ms poll because the flag is console-global (`:69-130`). Installed by the CLI before `run` (`cli/cmd/tui.ts:189`).

---

## 15. Testing (`test/`)

- `bun test` (`package.json:9`). Solid trees are mounted with `testRender` from `@opentui/solid`; whole-app lifecycle tests mock `createCliRenderer` with `createTestRenderer` from `@opentui/core/testing` and drive `run()` end-to-end (`test/app-lifecycle.test.tsx:10-61`, `renderOnce()`, `api.keymap.dispatchCommand("app.exit")`).
- Fixtures: fake `fetch` answering the bootstrap routes (`test/fixture/tui-sdk.ts:64-109`) and an in-memory `EventSource` that also produces a real SSE `Response` (`:18-60`); `TestTuiContexts` provider stack (`test/fixture/tui-environment.tsx`); `createTuiResolvedConfig` (`test/fixture/tui-runtime.ts`).
- Sync tests mount the real provider stack and `emit()` events (`test/cli/cmd/tui/sync-fixture.tsx:25-70`, `sync.test.tsx`, `sync-live-hydration.test.tsx`).
- Pure-logic tests for keybind parsing, display widths, history/stash JSONL, transcript, error formatting, tool-output collapse; a layout snapshot test for the inline-tool spacing rule.

---

## 16. Patterns worth stealing (with references)

1. **Transport injection**: `TuiInput.fetch` + `EventSource.subscribe` (`src/app.tsx:142-152`, `src/context/sdk.tsx:7-9,119-132`). Lets one app run in-process (worker RPC), remote (HTTP+SSE), and in tests (fake fetch + emitter). For our Elysia server: inject the treaty client factory and a WS/SSE subscriber the same way.
2. **Event batching into one reactive flush** with a 16 ms coalescing window (`src/context/sdk.tsx:48-80`). Cheap and effective for token streaming.
3. **Sorted arrays + binary search + `produce(splice)`/`reconcile`** for every server list (`src/context/sync.tsx:41-52,285-298`). Keeps identity stable for Solid and avoids O(n) `findIndex` per event.
4. **Hydration tracker** in `session.sync` so events received during a fetch win over the stale snapshot (`src/context/sync.tsx:150-158,594-667`). Any front end that fetches-then-subscribes has this race.
5. **Phased bootstrap** (`loading → partial → complete`) with only truly blocking data awaited (`src/context/sync.tsx:451-552`); UI can render on `partial`.
6. **Keybind registry = single `Definitions` table** with defaults + descriptions and a `CommandMap` to command ids, schema generated from it, unknown keys rejected (`src/config/keybind.ts:45-240,449-458`). Directly analogous to our `packages/contracts/src/settings/keys.ts` discipline.
7. **Command-first keymap**: every action is a named command with metadata; keys are looked up by `keybinds.gather(layer, ids)`; palette, slash commands, footers and which-key are all derived from the same registry (`src/keymap.tsx:250-290`, `src/component/command-palette.tsx`).
8. **Mode stack as a layer field** (`src/keymap.tsx:53-100`) — modal/autocomplete/question silence base bindings without unregistering them.
9. **Single-slot dialog with promise helpers** (`src/ui/dialog.tsx:150-165`, `DialogConfirm.show`) and a reusable `DialogSelect` with actions/footer hints (`src/ui/dialog-select.tsx`).
10. **Inline permission/question prompts replacing the composer** rather than modal dialogs (`src/routes/session/index.tsx:1297-1312`, `permission.tsx:524-719`), with `<Portal>` fullscreen.
11. **Extmark-backed rich prompt** (mentions/attachments/paste placeholders as virtual ranges synced to a parts array) (`src/component/prompt/index.tsx:658-734,1149-1270`).
12. **Paste heuristics**: file-path paste → attachment, big paste → placeholder part, empty bracketed paste → clipboard image read (`:1183-1222,1396-1420`).
13. **Submit re-entrancy guard + IME double-defer** (`:930-956,1391-1395`).
14. **External editor handoff** via `renderer.suspend()/resume()` and temp file (`src/editor.ts:26-54`); suspend also used for `ctrl+z` (`src/app.tsx:868-878`).
15. **Theme JSON with `defs` + `{dark,light}` variants + ref resolution**, `system` theme derived from the terminal palette, luminance-based selected-foreground (`src/theme/index.ts:95-111,241-299,360-469`). Terminal-only OSC theme-change notification hook (`src/context/theme.tsx:228-233`).
16. **Deferred native resource destruction** after `renderer.idle()` (`src/context/theme.tsx:306-332`).
17. **Copy-on-select with click guards** (`src/util/selection.ts`, `renderer.getSelection()?.getSelectedText()` checks before handling clicks).
18. **OSC 52 clipboard write always + native fallback** (`src/clipboard.ts:23-28,121-125`) — works over SSH/tmux.
19. **Sibling-aware margins via a pre-layout hook** (`src/util/layout.ts`) to get "tight tool list, spaced blocks" without per-item state.
20. **KV file with lock + write queue + `kv.signal()`** for dozens of small toggles (`src/context/kv.tsx`).
21. **Attention service** with focus tracking + sound packs + per-event `when: blurred|always` (`src/attention.ts`).
22. **Crash screen** with safe hard-coded palette, prefilled GitHub issue URL with encoded-length budgeting (`src/component/error-component.tsx`).
23. **Slots for sidebar/footers/prompt** so builtin features are plugins with `order` (`src/plugin/slots.tsx`, `src/feature-plugins/*`).
24. **Test fixtures**: fake fetch + emitter `EventSource` that can also serve a real SSE `Response` (`test/fixture/tui-sdk.ts`), `mock.module` of `createCliRenderer` with a headless test renderer (`test/app-lifecycle.test.tsx:11-13`).

---

## 17. Anti-patterns / things to avoid

1. **God components**: `routes/session/index.tsx` (2706 lines: route, commands, all tool renderers, parsers) and `component/prompt/index.tsx` (1716 lines). Tool renderers should be one file each; command lists should live with their state owners.
2. **`setTimeout(…, 0|1|50)` workarounds** for focus/scroll/layout (`src/ui/dialog.tsx:89`, `src/ui/dialog-select.tsx:277,587`, `src/component/prompt/index.tsx:241-247,1134-1143,1421-1426`, `src/routes/session/index.tsx:423-428`). They paper over missing "layout settled" signals; prefer `requestAnimationFrame`/lifecycle hooks or explicit readiness.
3. **Position polling** for the autocomplete anchor every 50 ms (`autocomplete.tsx:115-128`) instead of a layout event.
4. **Two parallel state stores** (`sync.tsx` v1 message/part model and `data.tsx` v2 `session.next.*` model) during migration — double event handling and two mental models. Start with one.
5. **Untyped `kv.get(key, default)` string keys** scattered across ~25 call sites (`app.tsx`, `session/index.tsx`, plugins). Our settings registry rule ("every knob is a registered key") is the fix.
6. **Reactive-ness by side effect**: `props.value // <- track` and `cursorVersion()` counters to force memo re-evaluation of non-reactive renderable state (`autocomplete.tsx:149`, `prompt/index.tsx:1049-1055,1382`). Wrap renderable state in signals at the boundary instead.
7. **`Proxy`-wrapped theme** (`context/theme.tsx:275-280`) is clever but hides reactivity; a plain accessor object is easier to type and test.
8. **Feature flags read from env at module scope** (`Flag.OPENCODE_*` in `app.tsx`, `prompt`, `sdk.tsx`) rather than config.
9. **Magic constants** duplicated: sidebar width 42 in two files, wide threshold `> 120` in four places, dialog widths, `MIN_SPLIT_WIDTH` 100 vs 120 elsewhere.
10. **Legacy shim retained in-tree** (`plugin/command-shim.ts`) — contrary to our greenfield/no-back-compat rule.
11. **Message cap at 100 with silent truncation** and no virtualization: long sessions lose scrollback and the DOM-like tree grows with every part. If we expect long sessions, plan windowed rendering from day one.
12. **`catch {}` swallowing** in many places (`session/index.tsx:308-310`, `editor.ts:87-89`, `persistence` callers) — our evlog/structured-error rules forbid this.
13. **`sessionID: "dummy"` placeholder route** for `--continue` (`app.tsx:286-294`) — a sentinel in typed state.
14. **Copy-on-select on every `onMouseUp` at three layers** (root, dialog provider, dialog) with flag-dependent branches — hard to reason about; centralise once.

---

## 18. Mapping onto our platform (what a TUI front end here needs)

- Equivalent of `sdk.tsx`: a treaty/eden client factory + subscriber over our server's WS RPC/SSE (`apps/server/src/orchestration/ws-rpc.ts`) with the same injectable `fetch`/`events` seam, and the same 16 ms batch flush.
- Equivalent of `sync.tsx`: one sorted-list mirror store per DTO family from `packages/contracts`, with hydration tracking on session open.
- Keybinds: a `Definitions` table registered through `packages/contracts/src/settings/keys.ts` (application/machine scope, since keys reach execution) and a `CommandMap` to command ids; palette/slash/footers derived from it.
- Rendering primitives available from OpenTUI 0.4.5: `<markdown>`, `<code>`, `<diff>`, `<line_number>`, `<scrollbox stickyScroll>`, `<textarea>` with extmarks, `<spinner>` (opentui-spinner), `Portal`, `Dynamic`, `TimeToFirstDraw`, `renderer.getPalette/themeMode/triggerNotification/suspend/resume/setTerminalTitle/console`.
- Plugin/slot system is optional for us; the useful part is slots for sidebar sections and footers so "agent view" chrome stays composable.
