# Web front-end feature inventory (TUI parity checklist)

Scope: `/work/projects/platform/apps/web/src` — `App.tsx`, `main.tsx`, `components/`, `keymap/`, `lib/`, and every feature under `features/`. All paths below are relative to `apps/web/src` unless they start with `apps/server`, `packages/`, or `docs/`. Line numbers are from the working tree on 2026-09-05 (which contains uncommitted multi-environment work — see §1.6).

---

## 1. App shell and navigation model

### 1.1 Boot sequence (`main.tsx`)

1. `installEditorPerformanceTraceFromUrl()`, `initializeClientLogging()`, `applyBackdrop(resolveBackdrop())` (`main.tsx:29-31`).
2. `bootAppearance()` reads a localStorage mirror of appearance settings and `applyAppearance(boot, documentElement, systemPrefersDark())` before React mounts (`main.tsx:36-37`; mirror in `features/settings/utils/boot-mirror.ts`).
3. `loadNerdFont(boot['editor.fontFamily'])` (`main.tsx:59`) — fetches font from `/fonts/:name`.
4. `restoreAddressFromStorage()` puts the last address into the URL when the app was launched at `/` (`main.tsx:64`; `features/address/state/storage.ts`).
5. `createApplicationRuntime({ workspaceCache: addressedWorkspaceCache(readWorkspaceCache(), parseAddress(location.href)), preparation })` (`main.tsx:65-73`; `state/application-runtime.ts:15-69`) — one editor runtime + one TanStack `QueryClient` per server origin.
6. Provider stack (`main.tsx:86-98`): `LoggingErrorBoundary > ApplicationRuntimeProvider > FocusProvider > HotkeysProvider > CommandBusProvider > ActiveEnvironmentApplication`.
7. `ActiveEnvironmentApplication` (`components/active-environment-application.tsx:14-38`) re-keys on `active.origin`: `QueryClientProvider > LanguageServerMatchProvider > AppearanceProvider > EditorColorThemeProvider > TooltipProvider > EditorStateProvider > App` + `ThemeAwareToaster` (sonner).
8. `App` (`App.tsx:6-16`): `ChatProviderSignInProvider > AppContent`, plus two app-level dialogs `WorkspaceEditPreviewDialog`, `WorkspaceEditRecoveryDialog`.
9. `AppRuntimeContent` (`components/app-runtime-content.tsx:16-38`) mounts app-lifetime hooks: `useWorkspaceCachePersistence`, `useAddressRestore`, `useAddressProjection`, `useAutoSave`, `useRestoreRecentWorkspaceRoot`, `useUnsavedWorkGuard`; then `EditorTabActionsProvider > CommandProvider > AppShell`.
10. `AppShell` = `<AppTitlebar/>` + `<main><AppWorkspace/></main>` + dirty-tab dialog; registers focus target `{kind:'app-shell'}` (`app-runtime-content.tsx:40-65`).
11. `AppWorkspace` (`components/app-workspace.tsx:15-51`): if `rootFolder` → `WorkspaceView`, else `EmptyWorkspace` ("Open a folder" card, `components/empty-workspace.tsx`). Mounts the folder picker via `usePickEntry` (`components/use-pick-entry.tsx`: native `window.platformBridge.pickEntry` on desktop, else `FilePickerDialog`).

### 1.2 UI modes — `lib/ui-mode.ts`

- `WorkspaceUiMode = 'chat' | 'workbench'`, default `'workbench'` (`lib/ui-mode.ts:1-3`).
- **This is a toggle, not the navigation stack described in `docs/product-vision.md`.** The vision says "no toggle and no current-project setting; IDE mode is pushed per project row with a back button." Today: `UiModeToggle` in the titlebar (`components/ui-mode-toggle.tsx:21-51`) is a two-button segmented control; `workspace.toggleUiMode` (`Mod+Shift+M`), `workspace.showChatMode`, `workspace.showWorkbenchMode` commands (`keymap/workspace-commands.ts:1098-1141`); titlebar context menu radio (`features/workbench/utils/titlebar-menu.ts:47-50`); palette `view ` mode items (`features/command-palette/command-palette-data.ts:15-27`). Persisted in `EditorWorkspaceStore.uiMode` and localStorage key `uiMode` (`features/workspace/state/cache.ts:64-71`).
- `WorkspaceView` (`features/workspace/components/view.tsx:14-37`) wraps `GitStoreProvider` + `SearchRuntime`, forces `min-w-[1024px]`, and branches: `uiMode === 'chat'` → `ChatModeSurfaceView`, else `EditorSurfaceLayoutView`.
- Both layouts share the **same** `WorkbenchPanels.editorTabs` (tab set + active tab) — the chat layout's "editor" tool tab renders the same `CodePanel` (`features/chat-mode/components/tool-pane.tsx:50-60`).

### 1.3 Address (URL) grammar — `features/address`

`/~<workspace-slug>/<mode>/<document-token>?<view params>#<position>` (`features/address/utils/grammar.ts:4`). Fields (`grammar.ts:36-59`): `workspace`, `mode` ('chat'|'workbench'), `document`, `tabs[]`, `side` ('chat'|'files'|'git'|'logs'|'search'), `bottom` ('terminal'|'problems'), `tool` (chat tool tab), `rail` ('active'|'archived'), `diff` (thread diff scope), `settings` (category slug), `search` (`s.*` params), `logs` (`log.*` params), `focus` (`#L<line>[:col][-endLine]`), `passthrough` (4 dev params).

Document tokens (`features/address/utils/document-token.ts:74-85`): `s` search buffer, `f/<path>` file, `c/<path>` compare-with-saved, `r/<ref>/<path>` git ref read-only file, `d/<source>/<rev>/<path>` snapshot diff, `k/…` checkpoint diff. `settings:` overlays and conflict documents are unaddressable.

- Outbound projection: store → URL via `history.pushState/replaceState` debounced, also written to `writeAddressCache` (`features/address/hooks/use-projection.ts:44-80`).
- Inbound: `useAddressRestore` applies boot vs popstate with different semantics (boot never closes tabs; popstate is authoritative) (`features/address/hooks/use-restore.ts:45-80`).
- `workspace.copyAddress` copies a shareable link (`keymap/workspace-commands.ts:919`).
- Every link is by absolute filesystem path slug; there is no environment/machine segment yet.

### 1.4 Workspace root / project switching

- Root is a `PickedFsEntry` in `EditorWorkspaceStore.rootFolder`; switching parks the outgoing project's tabs/history/scroll into `parkedWorkspaces` and restores the incoming one (`features/editor/state/workspace-state.tsx:118-148`). Max 8 projects cached (`features/workspace/state/cache.ts:57-58`).
- `useOpenWorkspaceRoot` (`features/workspace/hooks/use-open-root.ts:39-91`): `POST /fs/workspace-root`, supersede protocol, records recent via `POST /fs/recents`, invalidates recent lists.
- Entry points: titlebar `WorkspaceProjectMenu` (recent + chat projects radio list + "Open folder…", `components/workspace-project-menu.tsx`), titlebar context menu "Switch Project" submenu (`features/workbench/utils/titlebar-menu.ts:105-124`), chat rail "Add project" button (`features/chat-mode/components/session-rail.tsx:133-143`), `workspace.openFilePicker` command, `useRestoreRecentWorkspaceRoot` on boot.
- `useValidateRootFolder` stats the root and clears it if gone (`components/app-workspace.tsx:25`).

### 1.5 Focus service — `lib/focus`

`FocusArea` = `chat | command-palette | dialog | editor | file-tree | git | global | logs | problems | search | settings | terminal` (`lib/focus/state/service.ts:14-26`). `FocusTargetId` kinds: `app-shell`, `chat-composer{key}`, `command-palette`, `editor{key,surface:'diff'|'document'|'search-result'|'settings',side,tabId}`, `file-tree{rootPath}`, `git{rootPath}`, `logs`, `problems`, `search{rootPath,surface:'editor'|'sidebar'}`, `settings-dialog`, `settings-page{tabId}`, `terminal{rootPath,sessionId}`, `unsaved-dialog` (`service.ts:30-57`). Intents: `focus | open-search | reveal-active`. Every pane registers via `useFocusTarget`; commands request focus through `runtime.focus.request(destination, intent)` and get an async `FocusTransitionTicket` (`service.ts:86-105`). Key bindings are resolved **per focused pane** (`keymap/utils/app-bindings.ts:6-11`). A TUI needs an equivalent focus registry because commands, menus and `when` clauses all key off it.

### 1.6 Environments (multi-server) — in-progress, uncommitted

`git status` shows untracked `keymap/environment-commands.ts`, `components/active-environment-application.tsx`, `features/environments/`, `keymap/state/runtime-binding.ts`, etc. Current shape:

- `lib/client.ts:11-43`: `selectedOrigin` (default `http://localhost:3001` / `VITE_SERVER_URL`), `environmentClientFor(origin)` caches one Eden treaty client per origin.
- `lib/environments/state/store.ts`: zustand store of `entries` (origin → `{environmentId,label,kind:'primary'|'dev'}`) and `connectionByOrigin` (`phase: disconnected|connected|identity-drift`, `protocolVersion`, `serverInstanceId`, `slowRequestCount`).
- `state/application-runtime.ts:42-55` `activateEnvironment(origin)`: suspends activity signal, resets LSP pool, suspends editor runtime, cancels queries, closes chat transports, swaps `current`.
- `environment.devSwitchOrigin` command (DEV only) opens `DevOriginDialog` (`features/environments/components/dev-origin-dialog.tsx:19-82`; "Plan 078 replaces this with the Machines page").
- `/health` returns `HealthDescriptor {ok, environmentId, label, protocolVersion, serverVersion, platform}` (`packages/contracts/src/health.ts`; `apps/server/src/app.ts:199-211`).

---

## 2. Command and keymap system — `keymap/`

- Single command table `platformCommands = [...workspaceCommands, ...editorCommands, ...environmentCommands]` (`keymap/table.ts:8`). Each entry: `id`, `title`, `category`, `description`, `keys[{chord,platforms,pane,preventDefault}]`, `when[]`, `execution`, `target`, `undoCategory`, `run`, `hiddenInPalette`, `keepsPaletteOpen` (`keymap/define-command.ts:140-150`).
- `when` conditions: `chatMode | editorTarget | editorWritable | fileBackedTab | saveableTab | tabOpen | workspaceOpen | workspaceEditRedoable | workspaceEditUndoable | workspaceMutable` with human disabled reasons (`keymap/utils/when.ts:23-34`).
- Bindings are `PlatformKeyBinding{keys,chord,command,pane,source:'default'|'user'}`; user overrides come from setting `keybindings.overrides` (`keymap/providers/command-provider.tsx:98`). Chords up to N strokes, pending-chord indicator (`keymap/components/pending-chord-indicator.tsx`), trie with prefix-conflict warning (`keymap/use-app-keymap.ts:29-64`).
- Reserved browser hotkeys swallowed with no command: `Control+Tab`, `Control+Q`, `Mod+Alt+Tab`(mac), `Mod+Shift+T`, `Mod+1/2/3`, `Mod+W`, `F12` (`keymap/default-bindings.ts:94-108`). A TUI is free to bind these.
- Menu surfaces recorded as command sources: `chat.composer, chat.message, chat.project, chat.session, editor.gutter, editor.tab, editor.text, files.empty, files.row, git.file, git.group, pane.header, sidebar.rail, terminal, titlebar` (`keymap/types.ts:34-49`).

### 2.1 Workspace commands (`keymap/workspace-commands.ts`)

| id                                                  | title                                           | keys                         | when                            |
| --------------------------------------------------- | ----------------------------------------------- | ---------------------------- | ------------------------------- |
| `workspace.jumpToSession1..9`                       | Go to session N                                 | (unbound, hidden)            | workspaceOpen, chatMode         |
| `workspace.undoWorkspaceEdit` / `redoWorkspaceEdit` | Undo/Redo workspace edit                        | —                            | workspaceEditUndoable/Redoable  |
| `workspace.showQuickAccess`                         | Quick Open                                      | `Mod+P`                      | workspaceOpen                   |
| `workspace.showCommandPalette`                      | Show command palette                            | `Mod+Shift+P`, `F1`          | —                               |
| `workspace.showSettings`                            | Settings                                        | `Mod+,`, chord `Mod+K Mod+S` | —                               |
| `workspace.openFilePicker`                          | Open file picker                                | —                            | —                               |
| `workspace.openSearchEditor`                        | Open Search Editor                              | —                            | workspaceOpen                   |
| `workspace.quickOpenPreviousEditor`                 | Quick open previous editor                      | —                            | tabOpen                         |
| `workspace.quickOpenView`                           | Open view                                       | —                            | workspaceOpen                   |
| `workspace.gotoSymbol`                              | Go to symbol in editor                          | `Mod+Shift+O`                | fileBackedTab                   |
| `workspace.showAllEditors`                          | Show all editors                                | —                            | workspaceOpen                   |
| `workspace.saveFile`                                | Save                                            | `Mod+S`                      | saveableTab, workspaceMutable   |
| `workspace.saveAllFiles`                            | Save all                                        | —                            | workspaceOpen, workspaceMutable |
| `workspace.compareWithSaved`                        | Compare with saved                              | —                            | fileBackedTab                   |
| `workspace.openFileAtHead`                          | Open file at HEAD                               | —                            | fileBackedTab                   |
| `workspace.revertFile`                              | Revert file                                     | —                            | fileBackedTab                   |
| `workspace.reopenClosedEditor`                      | Reopen closed editor                            | —                            | workspaceOpen                   |
| `workspace.toggleSidebarVisibility`                 | Toggle Files pane                               | `Mod+B`                      | workspaceOpen                   |
| `workspace.togglePanel`                             | Toggle panel (bottom)                           | `Mod+J`                      | workspaceOpen                   |
| `workspace.focusFirst/Second/ThirdEditorGroup`      | Focus editor group                              | —                            | tabOpen (single group only)     |
| `workspace.focusEditor`                             | Focus editor                                    | —                            | tabOpen                         |
| `workspace.focusFileTree`                           | Focus file tree                                 | `Mod+Shift+E`                | workspaceOpen                   |
| `workspace.findInFileTree`                          | Filter files in tree                            | `Mod+F` (pane: file-tree)    | workspaceOpen                   |
| `workspace.revealActiveFileInTree`                  | Reveal active file in tree                      | —                            | fileBackedTab                   |
| `workspace.focusGit`                                | Focus Git                                       | —                            | workspaceOpen                   |
| `workspace.copyAddress`                             | Copy address                                    | —                            | workspaceOpen                   |
| `workspace.navigateBack` / `navigateForward`        | Back / Forward                                  | `Mod+[` / `Mod+]`            | workspaceOpen                   |
| `workspace.revealChat`                              | Show chat                                       | —                            | workspaceOpen                   |
| `workspace.revealTerminal`                          | Show terminal                                   | —                            | workspaceOpen                   |
| `workspace.newIsolatedSession`                      | New session in its own worktree                 | —                            | workspaceOpen                   |
| `workspace.closeCurrentTab`                         | Close current tab                               | —                            | tabOpen                         |
| `workspace.toggleDiffViewMode`                      | Toggle diff view mode                           | `Mod+Shift+D`                | workspaceOpen                   |
| `workspace.toggleUiMode`                            | Toggle Chat mode                                | `Mod+Shift+M`                | workspaceOpen                   |
| `workspace.showChatMode` / `showWorkbenchMode`      | Chat/Workbench mode                             | —                            | workspaceOpen                   |
| `workspace.selectColorMode` / `selectColorTheme`    | Choose color mode / theme (palette sub-pickers) | —                            | —                               |
| `workspace.setDark/Light/SystemTheme`               | color mode                                      | —                            | —                               |
| `workspace.toggleWallpaper`                         | Toggle wallpaper                                | —                            | —                               |
| `workspace.newSession`                              | New session                                     | `Mod+Alt+N`                  | workspaceOpen, chatMode         |
| `workspace.nextSession` / `previousSession`         | Next/Previous session                           | `Mod+Alt+]` / `Mod+Alt+[`    | workspaceOpen, chatMode         |
| `workspace.toggleSessionRail`                       | Toggle session rail                             | `Mod+Alt+B`                  | workspaceOpen, chatMode         |
| `environment.devSwitchOrigin`                       | Switch local server (DEV)                       | —                            | —                               |

### 2.2 Editor commands (`keymap/editor-commands.ts`, dispatched into `@singapore-editor/core` editor)

undo `Mod+Z`; redo `Mod+Shift+Z`/`Ctrl+Y`; find `Mod+F`; findReplace `Mod+H`/`Mod+Alt+F`(mac); findNext `F3`/`Mod+G`; findPrevious `Shift+F3`/`Mod+Shift+G`; goToDefinition; goToImplementation; goToTypeDefinition; peekDefinition; revealDefinitionAside; showHover; goToReferences `Shift+F12`; closeFind `Escape`; toggleFindCaseSensitive `Alt+C`/`Mod+Alt+C`; toggleFindWholeWord `Alt+W`; toggleFindRegex `Alt+R`; toggleFindInSelection `Alt+L`; togglePreserveCase `Alt+P`; replaceOne `Mod+Shift+1`; replaceAll `Mod+Alt+Enter`; selectAllMatches `Alt+Enter`; selectAll `Mod+A`; addNextOccurrence `Mod+D`; clearSecondarySelections; deleteWordLeft/Right; deleteLines `Mod+Shift+K`; copyLinesUp/Down `Alt+Shift+↑/↓`; moveLinesUp/Down `Alt+↑/↓`; insertLineBefore `Mod+Shift+Enter`; insertLineAfter `Mod+Enter`; commentLine `Mod+/`; blockComment `Alt+Shift+A`; indent/outdentLines `Mod+]`/`Mod+[`; insertCursorAbove/Below `Mod+Alt+↑/↓`; selectHighlights `Mod+Shift+L`; changeAll `Mod+F2`; jumpToBracket `Mod+\`; cursorWordPartLeft/Right; trimTrailingWhitespace; sortLinesAsc/Desc; joinLines `Ctrl+J`(mac); duplicateSelection; transformToUpper/Lower/Titlecase; rename `F2`; formatDocument `Alt+Shift+F`; toggleWordWrap `Alt+Z`; moveSelectionToNextFindMatch; plus the full cursor/selection/page/document movement set with emacs-style mac bindings (`editor-commands.ts:601-884`).

Note: `Mod+[`/`Mod+]` are bound to BOTH `workspace.navigateBack/Forward` and editor indent/outdent; the editor binding wins when the editor pane is focused (pane-scoped resolution).

---

## 3. Feature-by-feature inventory

### 3.1 `features/address` — see §1.3

Owns: `state/projection.ts` (debounced URL writer), `state/storage.ts` (address localStorage cache + `shareableAddress`), `state/root-claim.ts`. No server routes. No settings.

### 3.2 `features/chat` — agent conversation (T3Code-style)

**Surfaces**

- `ChatView` (`components/chat-view.tsx`) = `MessagesTimeline` + `ChatRuntimeStatus` + `PendingApprovalPanel` + `PendingUserInputPanel` + `PlanFollowUpBanner` + `ChatInput`. Hosted in two places: chat-mode stage (`features/chat-mode/components/chat-stage.tsx:115-122`) and the workbench "Chat" sidebar tab via `ChatSidePanel > ChatSidePanelContent` (`components/side-panel-content.tsx`) which adds `ChatPanelHeader` (title, "New chat", "Conversation history" dropdown) and `ChatPanelStatus` (error line / "Waiting on the server (N requests)").
- `ChatDraftView` — composer for a not-yet-created thread (`components/chat-draft-view.tsx`); seeds runtime/interaction mode from settings `chat.defaultRuntimeMode`, `chat.defaultInteractionMode`; consumes one-shot worktree isolation intent (`features/chat-mode/state/session-isolation-store.ts`).
- `ChatWelcomeView` — empty state with `@ mention files` and `/ commands` hints.

**Timeline** (`components/messages-timeline.tsx`, virtualized with @tanstack/react-virtual): items are `message | activity-group | turn-fold | working | proposed-plan` (`utils/timeline-items.ts:26-66`). Message bubbles render user text (with extracted `<terminal_context>` chips) and assistant markdown via Streamdown (GFM, math, mermaid, CJK, code blocks themed from the editor theme, file-link chips that open the editor at line/col) (`components/assistant-markdown.tsx`). Per-message: copy button, completion divider with elapsed time, `AssistantChangedFilesSection` (tree of changed files with +/- stats, "open checkpoint diff" per file / whole turn / whole thread), "revert to checkpoint" on user messages. Activity rows: work log with icons `approval|context|error|info|task|thinking|tool|user-input`, expandable command/output, plan steps (`utils/activity-presentation.ts`). `TimelineLoadEarlier` pages older history (`threadDetailPage` RPC). `TimelineMinimap` — thin rail of turn marks with keyboard roving (`components/timeline-minimap.tsx`). "Jump to latest" button.

**Composer** (`components/chat-input.tsx`, Lexical editor):

- Enter sends, Shift+Enter newline, IME-safe (`components/chat-input-submit-plugin.tsx:66-95`).
- Triggers: `@` mention (workspace file search → mention chip node), `/` slash commands (built-in `/default`, `/plan` + provider catalog), `$` skills (`utils/input-logic.ts:20-23,155,403-426`). Popover menu navigated with ↑/↓, Tab/Enter to commit.
- Attachments: image paste/drop/picker, classified + compressed client-side (`utils/input-attachments.ts`, `utils/image-compression.ts`), thumbnails + lightbox with ←/→ paging.
- Drop of a tree row (absolute path text) becomes a mention (`utils/composer-drop.ts`).
- Terminal context chips (captured terminal selections) (`components/chat-input-terminal-context-list.tsx`).
- Action row (`components/chat-input-actions.tsx`): `ModelPicker` (cmdk popover, provider rail on the left, ranked search, hidden/ordered models from settings, "sign in" rows), `ComposerControlsMenu` (Access: Ask first / Auto-accept edits / Full access; Mode: Build / Plan), `ModelOptionsMenu` (reasoning effort and any provider-advertised option descriptors), attach button, `ContextUsageRing` (context-window occupancy), `PromptStashBadge` (⌘S stashes the prompt; empty composer ⌘S opens the stash list, `hooks/use-prompt-stash.ts`), submit/stop button.
- Draft persistence per `(rootPath, threadId|'draft')` in localStorage, including images, modes, model override, terminal contexts (`state/chat-input-draft-store.ts`).
- Composer inbox: captures from elsewhere (terminal "Ask the Agent", diff line comment) queue until a composer mounts; `workspace.revealChat` brings it on screen (`hooks/use-attach-to-composer.ts`, `state/composer-inbox-store.ts`).

**Pending requests**

- Approvals: kinds `command | file-change | file-read`; decisions `cancel | decline | acceptForSession | accept` (`components/pending-approval-actions.tsx:7-16`).
- User input questions: `text | single-select | multi-select`, multi-step wizard, "other" free text (`components/pending-user-input-panel.tsx`).
- Runtime alert stack: provider sign-in required, command failures, interrupt pending, etc. (`components/chat-runtime-status.tsx`, `utils/runtime-state.ts`).

**Plans**: `ProposedPlanCard` (collapsible markdown, copy, download `.md`), `PlanFollowUpBanner` (Implement / Refine / "New thread") (`components/plan-follow-up-banner.tsx`).

**Provider auth**: `ProviderSignInDialog` (method picker, spinner, copyable CLI command, sign out) (`components/provider-sign-in-dialog.tsx`); `ChatProviderSignInProvider` at App root.

**Menus**: message context menu (Copy, Copy as Markdown, View Changed Files, Revert to Checkpoint Before This) (`utils/message-menu.ts`); link menu (Open Link, Copy Link).

**Transport / server**

- WebSocket RPC `/orchestration/ws` — client `transport/orchestration-rpc-client.ts`; methods `dispatchCommand`, `subscribeShell`, `subscribeThread`, `threadDetailPage`, `replayEvents`; heartbeat 30s, request timeout 60s, slow-request flag at 4s (`orchestration-rpc-client.ts:30-35`); handshake carries `serverConfig {serverInstanceId, protocolVersion, environmentId}`.
- HTTP fallbacks: `GET /orchestration/shell-snapshot`, `GET /orchestration/thread-detail`, `POST /orchestration/thread-search`, `GET /orchestration/turn-diff`, `GET /orchestration/full-thread-diff`, SSE `GET /orchestration/shell-stream`, `GET /orchestration/thread-detail-stream`, `POST /orchestration/commands`, `POST /orchestration/replay` (`apps/server/src/orchestration/routes.ts:60-230`).
- `GET /providers`, `GET /providers/:id/commands` (slash/skill catalog), `GET|POST /providers/:id/auth[/login|/login/:attempt|/login/:attempt/cancel|/logout]` (`apps/server/src/provider/routes.ts`).
- `GET /chat-attachments/:fileName` (`apps/server/src/attachments/routes.ts`).
- Commands sent (`utils/command-builders.ts:90-540`): `project.create`, `thread.create`(draft submission), `thread.turn.start`, `thread.turn.interrupt`, `thread.session.stop`, `thread.meta.update`(rename), `thread.archive/unarchive/delete`, `thread.approval.respond`, user-input respond, runtime-mode set, interaction-mode set, `thread.checkpoint.revert`, project default model, `project.meta.update`, project scripts, `project.delete`, `project.reorder`, session reorder/place (`thread.pin`, `thread.pin.reorder`). Full contract list: `packages/contracts/src/orchestration-commands.ts`.

**State owned**: `chat-projection-store` (threads/projects projection, cached to localStorage), `chat-optimistic-store`, `thread-detail-subscriptions` (LRU of thread streams), `thread-detail-sync-store`, `server-connection-store`, `chat-input-draft-store`, `composer-inbox-store`, `prompt-stash-store`, `thread-diff-scope-store` (working-tree vs turn scope per thread, persisted), `chat-changed-files-expansion-store`, `chat-work-log-expansion-store`, `coarse-clock-store`, `active-transports`.

**Settings read**: `chat.defaultRuntimeMode`, `chat.defaultInteractionMode`, `models.hidden`, `models.order`.

### 3.3 `features/chat-mode` — the agent-first layout

- `ChatModeLayout` (`components/layout.tsx:29-111`): `PersistedResizablePanelGroup` id `chat-mode` with `SessionRail` (220–460px, default 300) | `ChatStage` (min 360) | `ToolPane` (280–720, default 420) + vertical `ToolRail` on the far right. Panel state `ChatModePanels{activeToolTab, sessionRailOpen, toolPaneOpen}` (`utils/panels.ts:10-14`), tool tabs `git, files, editor, search, terminal, problems, logs` (`utils/panels.ts:16-24`); clicking the active tab collapses the pane.
- `SessionRail` (`components/session-rail.tsx`): "New session" button, "Add project" button, `SessionScopeMenu` (All projects / one project with counts), archived toggle with count, scoped count, search input (title + server-side message search via `POST /orchestration/thread-search`), projects as collapsible groups (drag-reorder groups via dnd-kit), session rows (drag-reorder within/between? — `rail-order-commands.ts`), bulk-select bar (Archive / Delete / Clear) when ≥2 marked. Escape clears marks. Empty labels: Searching…, No sessions match, No archived sessions, Connecting…, No sessions yet.
- Session row (`components/session-row.tsx`): status dot (`waiting|working|failed|idle`, `features/chat/utils/thread-status.ts:12`), title, unread dot, relative time, subline = plan step "3/7 running tests" while running else branch name; click intents: plain=open, Cmd/Ctrl=toggle mark, Shift=range (`utils/session-multi-select.ts:19-24`). Inline rename in rail or header.
- Session context menu (`utils/session-menu.ts`): Open, New Session in This Project, Rename, Archive/Unarchive, Delete, Show Only This Project, Stop Agent Session. Project menu (`utils/project-menu.ts`): New Session, Rename Project, Archive All Sessions, Delete Project, Show Only This Project, Expand/Collapse, Copy Path. Dialogs: `SessionDeleteDialog`, `ProjectDeleteDialog`, `ProjectRenameDialog`.
- `ChatStage` (`components/chat-stage.tsx`): `StageHeader` (project › branch › title, inline rename, `BranchActions` Publish/Push N/PR link/Create PR, status badge, context ring, `StageSessionMenu`), body = `StageEmptyState` | "Opening session" | `SessionMissingState` | `ChatDraftView` | `ChatView`; error footer.
- `ToolPane` (`components/tool-pane.tsx:24-100`): tools act on the **session's worktree** (`useSessionToolRoot`) — Files, Git (with Working tree / Turn scope buttons; Turn shows checkpoint file list), Search, Terminal (per-session terminal id `useSessionTerminalId`), Problems, Logs, Editor (`CodePanel`).
- Keyboard: `Mod+Alt+N` new session, `Mod+Alt+[`/`]` prev/next, `Mod+Alt+B` toggle rail, `jumpToSessionN` slots.
- State: `session-selection-store` (selection/draft per project, restored from localStorage `chatModeSelection`), `session-rail-store` (query, scope, view, collapsed projects, renaming), `session-search-store`, `session-multi-select-store`, `session-read-store` (seen stamps for unread), `rail-order-store` (drag order keys), `session-isolation-store`, `project-delete/rename-request-store`, `session-delete-request-store`.
- Provider `ChatModeSessionController` (`providers/session-controller.tsx`): resolves `rootPath = activeWorkspaceRoot ?? editorRootPath`, project via `useWorkspaceChatProject` (creates `project.create` on demand), retry.
- Scripts: `useSaveProjectScript` writes `project.scripts`; palette `run ` mode lists saved + `package.json` scripts (runner chosen by lockfile) and queues into the terminal command inbox (`utils/project-scripts.ts`, `features/terminal/state/command-inbox-store.ts`).

### 3.4 `features/command-palette`

- Opened by `Mod+Shift+P`/`F1` (commands) or `Mod+P` (files). Modes (`command-palette-types.ts:60-70`): `commands` (`>`), `files` (no prefix), `symbols` (`@`, document symbols via LSP), `gotoLine` (`:`), `views` (`view `), `colorMode` (`color `), `colorTheme` (`theme `, live preview on ↑/↓), `editors` (`edt `), `scripts` (`run `), `sessions` (`sess `) (`command-palette-utils.ts:279-289`). Command-opened sub-pickers hold the mode as a "scope chip" so the input is a bare query.
- Rows show category icon, title, description or disabled reason, shortcut; recent commands first (`state/recent-commands-store.ts`).
- File mode: `GET /fs/quick-open` style query via `fetchQuickOpenFiles` (limit from `search.quickOpenLimit`), plus already-loaded tree.
- Sessions mode: existing sessions + "New session in… <project>".
- Views list: Chat mode, Workbench mode, Explorer, Source Control, Search, Editor, Open Folder, Settings (`command-palette-data.ts:15-64`).
- Uses `FocusService` origin capture/restore.

### 3.5 `features/editor` — code editing (`@singapore-editor/*` editor packages)

- `Editor` (`components/editor.tsx`) hosts `@singapore-editor/react` `EditorHost` with critical plugins: tree-sitter syntax (or shiki/VSCode theme), line gutter, fold gutter, find widget, merge-conflict, bracket match, occurrence highlight, document links, markdown preview (markdown files), logging (`utils/plugins.ts:57-83`); lazy non-critical: scope/indentation guides (`editor.guides.indentation`), minimap (`editor.minimap.enabled`), decode (`editor.decode.mode`) (`utils/plugins.ts:140-175`). Diagnostic peek overlay (`components/diagnostic-peek.tsx`), references side pane (`components/language-server-references-pane.tsx`), hover, go-to-definition/implementation/type, rename, format, workspace edits.
- LSP: `GET /lsp/match?path&root` picks server(s); `WS /lsp?path&root&server` per (origin, root, server) via `LspConnectionPool` (`state/language-server-connection-pool.ts`); `GET /lsp/semantic-tokens` with `lsp.semanticTokens.*` settings. Settings: `lsp.servers`, `lsp.languageServers`, `lsp.experimental.tyForPython` (`providers/language-server-match-provider.tsx:19-21`).
- Document kinds rendered by `EditorSurfaceTabBody` (`features/workbench/components/editor-surface-tab-body.tsx:209-245`) → `SettingsPage` (settings: tab), `SearchPane` (search buffer), `FileEditorBody` → `DiffView` (git-diff:), `CompareSavedView` (compare:), editor (file or git-ref: read-only or conflict:). Image/media blob preview through `useMediaBlobUrl`.
- Diff: `DiffEditor`/`DiffPane` split or stacked (`editor.diff.viewMode`, `Mod+Shift+D`), read-only editors with region expansion, syntax highlighted, LSP-aware on worktree side, line-range drag → "Ask" (attach to composer) (`features/git/components/diff-line-comment-action.tsx`).
- Save pipeline: `workspace.saveFile/saveAllFiles`, auto-save (`files.autoSave` off|afterDelay…, `files.autoSaveDelay`) (`hooks/use-auto-save.ts`), dirty-tab close dialog (Save/Discard/Cancel) (`components/unsaved-changes-dialog.tsx`), `useUnsavedWorkGuard` beforeunload.
- Filesystem conflicts (file changed/deleted/renamed on disk while dirty): toast with Override with local / Override with remote / Open conflict editor (`components/filesystem-conflict-toast.tsx`); conflict documents are 3-way merge editors.
- Workspace edits (atomic multi-file LSP edits): `WorkspaceEditPreviewDialog` (rows dirty/open/unopened, confirm), `WorkspaceEditRecoveryDialog` (recover/discard after crash), undo/redo up to 20 groups (`state/workspace-edit-service.ts:70-92`); server `/fs/workspace-edit/{prepare,commit,finalize,status,abort,rollback,undo,redo,recover,release,recovery}`.
- Color themes: bundled VSCode themes via shiki + two built-in tree-sitter palettes; selection persisted in localStorage `platform.editor-color-theme.v1`, preview scrubbing debounced 60ms (`state/color-theme-store.ts`).
- Editor commands API (`state/commands.ts:57-80`): `closeTab, discardAndCloseTab, openDefinition, openFileSurface, openSearchEditor, openSettingsEditor, reopenClosedEditor, renameLiveEditorDocument, reorderTab, selectFile, selectPreviousEditor, selectTab, switchRootFolder`. **`splitTab`, `moveTabToPane`, `moveTabToSplit`, `setActivePane` are stubs returning false** (`state/commands.ts:126-144`) — there is exactly one editor group.
- Settings read: `editor.syntaxHighlighting.enabled`, `editor.diff.viewMode`, `files.autoSave`, `files.autoSaveDelay`, `editor.fontFamily/fontSize/lineHeight/tabSize` (via appearance CSS vars), `editor.minimap.enabled`, `editor.guides.indentation`, `editor.decode.mode`, `lsp.*`.

### 3.6 `features/file-picker` — in-app folder/file picker

`FilePickerDialog` (`components/file-picker-dialog.tsx`): Back/Forward/Up, editable location bar (`⌘⇧G` go to folder), search box (typing in list forwards to search), refresh, new folder popover, show-hidden toggle (`⌘⇧.` writes setting `files.showHidden`, policy-aware), places sidebar (home, recents), sortable list header, virtualized list with keyboard nav (↑↓ Home End PgUp PgDn, → enter dir, ←/Backspace up, Enter pick), preview pane, mobile layout. Modes `folder | file` with `accept`. Routes: `GET /fs/stat`, `GET /fs/tree`, `GET /fs/recents`, `POST /fs/recents`, `POST /fs/create-folder`, `/health` for `homePath`. Replaced by the native dialog on desktop (`components/use-pick-entry.tsx:56-67`).

### 3.7 `features/git`

- `Panel` (`components/panel.tsx`): header "Changes" collapsible with ahead/behind label + Commit / Fetch / Pull / Push icon buttons; `CommitControls`: message input (`⌘↵` commits), AI "Generate commit message" (SSE `POST /git/commit-message` with cancel), Commit button or "Sync Changes" button when nothing local; `CommitProgress` stream; groups "Staged Changes" and "Changes" (collapsible, hover actions stage/unstage/discard, group actions stage all/unstage all/discard all/open all diffs), file rows (icon, status symbol, path, click opens `git-diff:` tab), empty "Working tree clean", "No Git repository", "Git is unavailable".
- `BranchActions` in chat stage header: Publish / Push N / PR #n link / Create Pull Request (`gh`).
- Context menus: file (Open Changes, Open File, Stage/Unstage, Discard, Copy Path, Copy Relative Path), group (Open All Diffs, Stage/Unstage All, Discard All) (`utils/file-menu.ts`, `utils/group-menu.ts`).
- Routes (`apps/server/src/git/routes.ts`): `GET /git/repo,/status,/diff,/diff/blob,/file,/branches,/base-refs,/branch-diff,/worktrees,/branch-remote-state,/pull-request`; `POST /git/stage,/unstage,/discard,/apply-patch,/commit,/commit-message(SSE),/checkout,/create-branch,/fetch,/pull,/push,/pull-request,/worktrees/create,/worktrees/remove`. Client wrappers `utils/api.ts:33-338`. (No UI for checkout/create-branch/apply-patch/worktrees list yet — server-only.)
- State: `state/store.tsx` (panelOpen, sectionOpen per group), `commit-progress-store`. Status query invalidated by fs watch events.
- Settings: `editor.diff.viewMode`.

### 3.8 `features/logs` — evlog dashboard

`LogsPanel`: toolbar (time range 15m/1h/6h/24h/All, level, search, source, area, refresh), timeline (Events/Errors/Warn/Slow metrics + bar histogram), event list (virtualized rows with level dot, time, primary/secondary text, duration; expand for inline detail), live SSE tail. Routes: `GET /_log/dashboard/summary`, `/events` (limit 300), `/event`, SSE `/live` (`utils/api.ts`); client also posts its own logs to `POST /_log/ingest`. State: module-level `filter-store.ts` (addressable via `log.*` params), `live-cache`, `live-batcher`. Settings: `logs.defaultTimeRange`, `logs.slowThresholdMs`.

### 3.9 `features/menus` — context-menu framework

Model (`utils/model.ts`): sections → items of kind `command` (registry-backed: title/shortcut/enablement from the command table) | `action` | `checkbox` | `radio-group` | `submenu`; `unavailable` renders disabled with a hint. `MenuSurface` renders a positioned menu at a pointer/rect/keyboard anchor; `useContextMenu` gives `openAtEvent`, `openOnMenuKey` (Shift+F10/ContextMenu). Every right-click surface in the app goes through this; a TUI needs one equivalent popup-menu widget.

### 3.10 `features/search` — workspace search/replace

- Controls (`features/workspace/components/search-controls.tsx`): query input with history (↑/↓), toggles Match case / Whole word / Regex / Include-exclude filters, replace toggle with Replace Next / All, include/exclude globs, "Open search editor" (opens as a tab), summary line with expand/collapse all + prev/next match.
- Results (`components/results-view.tsx`): file groups (collapsible) with match rows; in the editor-tab variant, results render inside pooled read-only editors with line action rows (open, replace line) (`components/result-file-editor.tsx`, `components/result-file-line-actions.tsx`).
- Streaming via SSE `GET /fs/search/events` (`lib/workspace-search-client.ts`); replace runs through the workspace-edit pipeline / `POST /fs/write`.
- State: `state/buffer-state.tsx` (one buffer per root; persisted to localStorage `search:<root>`, cached shape in `features/workspace/state/cache.ts:87-108`), `result-editor-pool`, `result-virtual-window-store`. Address `s.*` params.
- Settings: `search.defaultMatchMode`, `search.caseSensitive`, `search.wholeWord`, `search.maxResults`, `search.maxResultFiles`, `search.quickOpenLimit`.

### 3.11 `features/settings`

- `SettingsPage` (`components/page.tsx`): scope tabs User / Workspace, search, category pin (from address), per-row widgets `boolean | enum | number | string | font (nerd-font preview) | complex | providers | models | keybindings (chord recorder with conflict count)`, modified marker, "also modified in"/"overridden by" notes, restart-required badge, row menu (Reset, Copy setting ID, Copy as JSON, Edit in settings.json), page menu (Open settings.json, Reset all), form/JSON view toggle (JSON view is a real editor tab bound to the settings file with diagnostics), malformed-file banner, raw-conflict banner + reload dialog.
- Hosted as an editor tab `settings:` when a folder is open, else `SettingsDialog` (`components/dialog.tsx`).
- Routes: `GET /settings`, `POST /settings/write`, SSE `GET /settings/events`, `GET|POST /settings/raw` (`apps/server/src/settings/routes.ts`).
- Registry: `packages/contracts/src/settings/keys.ts` (46 keys, see §5). Scopes: window / application / machine.
- State: `intent-store` (optimistic submissions), `sync-service`, `snapshot-admission`, `live-projection`, `scope-store`, `view-store`, `category-store`, `active-buffer`, `diagnostics-*`; appearance applied to CSS vars by `utils/apply-appearance.ts`.

### 3.12 `features/terminal`

- `TerminalPanel` (`components/panel.tsx`): **ghostty-webgpu** emulator in a canvas; connects `WS /terminal?root&session` with messages `input | resize | dispose` ← → `ready{shell,cwd} | output | exit | error` (`packages/contracts/src/terminal.ts:9-17`). One fixed session `terminal-1` in the workbench bottom panel (`features/workbench/components/bottom-panel.tsx:45`), one per chat session in chat mode. Cursor shape by focus, blink/font/scrollback from settings `terminal.integrated.cursorBlinking|fontSize|scrollback`.
- Context menu (`utils/menu.ts`): Ask the Agent (captures selection with line numbers into the composer), Copy, Paste (`mod+v`), Select All, Clear (`ctrl+l` sent to shell), Reset, Scroll to Top/Bottom.
- Ctrl/Cmd-click file paths (`path:line:col`) opens the editor (`hooks/use-links.ts`).
- App keybindings are claimed at the host before ghostty encodes keys (`hooks/use-keybindings.ts`).
- Command inbox: palette scripts are typed into the terminal (`state/command-inbox-store.ts`).

### 3.13 `features/workbench` — IDE layout

- `WorkbenchLayout` (`components/layout.tsx:27-125`): `ResizablePanelGroup` id `workbench-outer` = `SidebarPanel` (220–520px) | `main`; `main` is a vertical group `workbench-main` = `CodePanel` (editor min 160) / `BottomPanel` (140–480). Sizes as percentages in `WorkbenchLayout{outerLayout{sidebar,main}, mainLayout{editor,bottom}}`, defaults 24/76 and 70/30, **global not per-project** (`utils/layout.ts:1-35`).
- `WorkbenchPanels{activeSidebarTab: chat|files|git|logs|search, activeBottomTab: terminal|problems, sidebarOpen, bottomPanelOpen, editorTabs[], activeEditorTabId}` (`utils/panels.ts:3-13`); per project, persisted.
- Sidebar: vertical icon rail (Files, Git, Search, Logs, Chat) + content (`components/sidebar-panel.tsx`); pane header menu (radio of views + Hide) (`utils/pane-header-menu.ts`). Bottom: Terminal / Problems tabs.
- `CodePanel` = `EditorTabBar` (dnd-kit sortable tabs, dirty dot, loading shimmer, close button, tab menu: Close, Close Others, Close to the Right, Close Saved, Close All, Open File (for diff tabs), Copy Path, Copy Relative Path) + `EditorSurfaceTabBody`; empty state "No file selected ⌘P".
- `DiagnosticsPanel` (Problems): diagnostics for the active editor with severity, click to open / preview.
- `Wallpaper` / `WebWallpaper`: still image + optional video from `GET /wallpaper/info|still|/wallpaper`, gated by `workbench.wallpaper.enabled`, only when backdrop is `app`.
- Titlebar (`components/app-titlebar.tsx`): project menu, document title, `UiModeToggle`; whole bar is a context-menu trigger (`titlebar-menu.ts`: Open Folder…, Switch Project ▸, Command Palette…, Workbench/Chat mode radio, Color Mode ▸, Settings…, Copy Workspace Path). Native drag region on desktop.
- Editor visible-snapshot (paint-a-cached-bitmap-first) machinery (`hooks/use-editor-visible-snapshot.ts`) is a GUI perf trick, not a feature.

### 3.14 `features/workspace` — file tree and root lifecycle

- `TreePane` (`components/tree-pane.tsx`): `@workspace/tree` `FileTree` with compact density, lazy directory loads (`GET /fs/tree?path&depth`), git status decorations, file icons, inline rename (F2), inline create file/folder, drag-and-drop move (`POST /fs/rename`), duplicate (`POST /fs/copy`), delete with confirm dialog (`POST /fs/delete`), tree filter/search (`Mod+F` in pane; toolbar with match count prev/next/clear), reveal active file, keyboard: arrows, Home/End, PgUp/PgDn, Enter, Space, `*`, Escape. Row context menu (`utils/row-menu.ts`): Open, New File, New Folder, Stage/Unstage/Discard (when changed), Copy Path, Copy Relative Path, Rename (F2), Duplicate, Delete.
- File watching: SSE `GET /fs/events?path|paths` (`created|changed|deleted|renamed`) updates tree, file snapshots, git status; conflicts with dirty documents raise the conflict toast (`hooks/use-events.ts`, `state/event-conflict-adapter.ts`).
- Files pane header shows loaded/visible item count.
- Cache (`state/cache.ts`): localStorage keys `rootFolder`, `uiMode`, `workbenchLayout`, `chatModePanels`, `chatModeSelection`, `workspaces` (order), `workspace:<root>` (tabs, history, recently closed, scroll positions, panels), `search:<root>`.
- Prefetch on intent (hover/foresight) for tree directories and tabs (`hooks/use-file-tree-intent-prefetch.ts`, `use-tab-intent-prefetch.ts`) — GUI-only optimisation.

### 3.15 `components/` (app-level)

`active-environment-application.tsx`, `app-content.tsx`, `app-runtime-content.tsx`, `app-titlebar.tsx`, `app-workspace.tsx`, `command-palette.tsx` (gate on `paletteOpen`), `empty-workspace.tsx`, `file-picker-dialog.tsx`, `logging-error-boundary.tsx`, `theme-aware-toaster.tsx` (sonner toasts — used for errors everywhere via `toast.error`), `ui-mode-toggle.tsx`, `use-pick-entry.tsx`, `workspace-project-menu.tsx`.

---

## 4. Server surface used by the client (routes and sockets)

| Area          | Routes                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health        | `GET /health`                                                                                                                                                                                                                                                                                                                   |
| Filesystem    | `GET /fs/stat,/tree,/read,/blob,/recents`; SSE `GET /fs/search/events`, `GET /fs/events`; `POST /fs/recents,/workspace-root,/write,/create-file,/create-folder,/rename,/copy,/delete`; `POST /fs/workspace-edit/{prepare,commit,finalize,abort,rollback,undo,redo,recover,release}`, `GET /fs/workspace-edit/{status,recovery}` |
| Git           | see §3.7                                                                                                                                                                                                                                                                                                                        |
| LSP           | `GET /lsp/match`, `GET /lsp/semantic-tokens`, `WS /lsp`                                                                                                                                                                                                                                                                         |
| Terminal      | `WS /terminal?root&session`                                                                                                                                                                                                                                                                                                     |
| Orchestration | `WS /orchestration/ws` (dispatchCommand, subscribeShell, subscribeThread, threadDetailPage, replayEvents); HTTP `/orchestration/{commands,shell-snapshot,thread-detail,thread-search,turn-diff,full-thread-diff,shell-stream,thread-detail-stream,replay}`                                                                      |
| Providers     | `GET /providers`, `GET /providers/:id/commands`, `GET                                                                                                                                                                                                                                                                           | POST /providers/:id/auth[...]` |
| Attachments   | `GET /chat-attachments/:fileName`                                                                                                                                                                                                                                                                                               |
| Fonts         | `GET /fonts`, `GET /fonts/:name`, `GET /fonts/:name/preview`, `POST /fonts/batch`                                                                                                                                                                                                                                               |
| Wallpaper     | `GET /wallpaper`, `/wallpaper/info`, `/wallpaper/still`                                                                                                                                                                                                                                                                         |
| Settings      | `GET /settings`, `POST /settings/write`, SSE `GET /settings/events`, `GET                                                                                                                                                                                                                                                       | POST /settings/raw`            |
| Observability | `POST /_log/ingest`; `GET /_log/dashboard/{summary,events,event}`, SSE `/_log/dashboard/live`                                                                                                                                                                                                                                   |

All HTTP calls go through the Eden `treaty<App>` client (`lib/client.ts`) with an `x-client-instance` header; SSE responses are parsed by `lib/eden-events.ts`. A TUI can reuse `server/client-contract` types and the same treaty client under Bun.

---

## 5. Settings keys read by the client (`packages/contracts/src/settings/keys.ts`)

Appearance (window): `workbench.colorTheme`, `workbench.palette`, `workbench.density`, `workbench.surface.opacity|contentOpacity|blur|saturation`, `workbench.wallpaper.enabled`, `workbench.tree.indentGuides`. Editor (window): `editor.fontFamily|fontSize|lineHeight|tabSize|diff.viewMode|minimap.enabled|guides.indentation|syntaxHighlighting.enabled|decode.mode`. Terminal (window): `terminal.integrated.fontSize|scrollback|cursorBlinking`. Search (window): `search.defaultMatchMode|caseSensitive|wholeWord|maxResults|maxResultFiles|quickOpenLimit`. Chat (application): `chat.defaultRuntimeMode|defaultInteractionMode`. Logs (window): `logs.defaultTimeRange|slowThresholdMs`. Window (machine): `window.transparency`. Files (window): `files.autoSave|autoSaveDelay|showHidden`. Language servers (machine): `lsp.experimental.tyForPython|idleTimeoutMs|downloadRuntimes|servers|languageServers|semanticTokens.enabled|delta|servers`. Providers/Models/Keys (application): `providers.instances`, `models.hidden`, `models.order`, `keybindings.overrides`.

Read sites: grep results in `features/settings/utils/apply-appearance.ts:46-80`, `features/terminal/components/panel.tsx:100-102`, `keymap/providers/command-provider.tsx:96-98`, `features/chat/components/chat-draft-view.tsx:51-52`, `features/chat/components/model-picker.tsx:88-89`, `features/editor/hooks/use-auto-save.ts:25-26`, `features/logs/utils/filter-params.ts:21`, `features/search/utils/buffer-query.ts:25-29`, `features/file-picker/picker-search.ts:92`, `components/file-picker-dialog.tsx:104`.

---

## 6. State ownership summary

| Store / provider                                                                                                                  | Lives                                                                 | Persists                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `EditorWorkspaceStore` (rootFolder, uiMode, workbenchPanels, workbenchLayout, chatModePanels, parked workspaces, history, scroll) | `features/editor/state/workspace-state.tsx` via `EditorStateProvider` | localStorage (`features/workspace/state/cache.ts`)          |
| Editor document store (live buffers, views per tab, dirty set)                                                                    | `features/editor/state/document-state.tsx`                            | no (recovery via workspace-edit)                            |
| Editor UI store (definitionTarget, references, status bar source)                                                                 | `features/editor/state/ui-state.tsx`                                  | no                                                          |
| Workspace edit service                                                                                                            | `features/editor/state/workspace-edit-service.ts`                     | server-side recovery                                        |
| Chat projection / optimistic / drafts / stash / inbox / diff scope                                                                | `features/chat/state/*` (zustand, module-level)                       | projection cache, drafts, diff scope, stash in localStorage |
| Chat-mode selection, rail, order, read, multi-select                                                                              | `features/chat-mode/state/*`                                          | selection, collapse, read stamps in localStorage            |
| Git panel open state                                                                                                              | `features/git/state/store.tsx` via `GitStoreProvider`                 | no                                                          |
| Search buffer per root                                                                                                            | `features/search/state/buffer-state.tsx`                              | localStorage `search:<root>`                                |
| Logs filters                                                                                                                      | `features/logs/state/filter-store.ts`                                 | no (address only)                                           |
| Settings intent/sync/scope/view/category                                                                                          | `features/settings/state/*`                                           | server settings file; appearance mirror in localStorage     |
| Command bus, bindings, palette state, settings dialog, env dialog                                                                 | `keymap/providers/command-provider.tsx`                               | keybinding overrides in settings                            |
| Focus service                                                                                                                     | `lib/focus/state/service.ts`                                          | no                                                          |
| Environments store, query clients per origin, activity abort signals                                                              | `lib/environments/state/*`                                            | no                                                          |
| Application runtime (editor runtime per origin)                                                                                   | `state/application-runtime.ts`                                        | —                                                           |
| Editor color theme                                                                                                                | `features/editor/state/color-theme-store.ts`                          | localStorage                                                |
| Recent commands                                                                                                                   | `features/command-palette/state/recent-commands-store.ts`             | localStorage                                                |

---

## 7. Layout / tiling model (what a TUI must reproduce)

- Two fixed layouts, not a free tiling manager. Workbench: `[sidebar | (editor / bottom)]` with two draggable splitters, both panes toggleable (`Mod+B`, `Mod+J`) and each hosting a tab strip of fixed views. Chat: `[session rail | stage | tool pane] + tool rail`, two splitters, rail and tool pane toggleable, tool pane is a single view chosen from 7.
- Sizes are percentages, persisted globally (`features/workbench/utils/layout.ts:1-5`); chat-mode sizes persisted by `PersistedResizablePanelGroup` under storage key `chat-mode`.
- Exactly one editor group; tabs reorder by drag or `reorderTab`; no split editors (stubs at `features/editor/state/commands.ts:126-144`). `workspace.focusSecond/ThirdEditorGroup` exist for VS Code keymap compatibility but focus the same group.
- Min widths: whole workspace forces `min-w-[1024px]` (`features/workspace/components/view.tsx:22`), sidebar 220px, tool pane 280px, stage/main 360px. A TUI at 80×24 cannot honour these; expect to collapse to one pane at a time with the same toggle commands.
- Every pane is a focus target; the focused pane decides which key bindings are live.

---

## 8. Inherently GUI features (and why)

| Feature                                                                                    | Why it does not translate                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal emulator (`ghostty-webgpu`, `features/terminal/components/panel.tsx`)             | WebGPU canvas renderer. A TUI would embed a PTY differently (pass-through to the host terminal or a text-cell emulator like OpenTUI/crush use). The WS protocol (`input/resize/output`) is reusable.                                                                                                |
| Editor (`@singapore-editor/*` via `EditorHost`)                                                    | DOM/canvas editor with minimap, scope lines, shiki worker, font metrics, pixel scroll positions (`EditorScrollPosition{left,top}` persisted), diagnostic peek positioned by client rects, visible-snapshot bitmap overlay. A TUI needs its own text-cell editor; commands/keymap ids can be shared. |
| Diff viewer split panes with region expansion and drag-selected line comments              | Pixel mouse drags over two synced editors (`diff-line-comment-action.tsx`). Keyboard-first line-range selection is the TUI equivalent.                                                                                                                                                              |
| Wallpaper video/still, surface blur/saturation/opacity, vibrancy, palette, density         | Compositor visuals (`apply-appearance.ts`, `web-wallpaper.tsx`). Only `workbench.colorTheme` (dark/light/system) and the editor color theme have TUI meaning.                                                                                                                                       |
| Nerd-font loading, font preview widget (`/fonts/*`)                                        | Fonts belong to the host terminal.                                                                                                                                                                                                                                                                  |
| Image attachments: paste/drop/picker, compression, thumbnails, lightbox                    | Clipboard images and drag-drop are browser APIs; a TUI can take file paths only.                                                                                                                                                                                                                    |
| Drag-and-drop everywhere (tabs, tree move, session/project reorder, tree→composer mention) | dnd-kit pointer sensors. All have command or keyboard equivalents except tree DnD move (use rename) and tree→composer (use `@` mention).                                                                                                                                                            |
| Timeline minimap, context-usage ring, animated status dots, shimmer/orbit loaders          | Cosmetic; TUI uses text badges.                                                                                                                                                                                                                                                                     |
| Mermaid/math rendering in assistant markdown (Streamdown)                                  | Render as fenced text.                                                                                                                                                                                                                                                                              |
| Native desktop bridge (`window.platformBridge.pickEntry`, window drag region, backdrop)    | Electrobun only.                                                                                                                                                                                                                                                                                    |
| Hover intent prefetch (foresight), visible-snapshot cache                                  | Perf tricks tied to mouse hover/paint.                                                                                                                                                                                                                                                              |
| Popover/portal-based menus, dialogs, tooltips (`@workspace/ui`)                            | Need TUI-native modal/popup widgets; the menu _model_ (`features/menus/utils/model.ts`) is reusable.                                                                                                                                                                                                |
| Streaming SSE via browser `fetch` / Eden treaty in browser                                 | Reusable under Bun (treaty works in Bun), but WebSocket/SSE lifecycles need the `AbortSignal` activity plumbing.                                                                                                                                                                                    |

---

## 9. Gaps and observations relevant to parity

- The vision doc's navigation stack (agent root → pushed IDE per project, back button) is **not implemented**; the app is a two-mode toggle with a global current project. A TUI cloning "everything the web app supports" should clone the toggle today and be ready for the stack (`docs/product-vision.md` "There is no toggle and no current project setting").
- Terminal sessions in the agent view (vision: "biggest genuinely new UI surface") do not exist as sidebar rows; only a per-chat-session tool-pane terminal.
- Git server has branch/checkout/worktree/apply-patch routes without UI (`apps/server/src/git/routes.ts:47-104`).
- `workspace.newIsolatedSession` sets a one-shot flag; the worktree is created server-side at first send.
- Search replace and workspace edits run through a transactional multi-file pipeline that a TUI must reuse (server routes) rather than reimplement.
- Multi-environment work is mid-flight and uncommitted; `docs/environments-and-remote-plan.md` (rewritten 2026-09-05) says chat federates every connected machine while files/terminal/LSP follow one. The TUI plan should key everything by `(environmentId, id)` from day one.
