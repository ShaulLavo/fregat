# TUI front end: the hard problems

Scope: what is genuinely hard about cloning `apps/web` into a terminal, what each reference (opencode, crush, t1code) does about it, and which of our modules survive as pure models. Every claim below was read from code; paths are absolute, line numbers are from the checkout at `/work/projects/platform` on 2026-09-05.

## 0. Ground truth that shapes every answer

### 0.1 The server contract the TUI would speak (unchanged)

| Surface              | Transport                                                                                                               | Where                                                                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal             | WS `/terminal?root=&session=`; JSON frames `{type:'input'                                                               | 'resize'                                                                                                                                                                                                                                                        | 'dispose'}`/`{type:'ready' | 'output' | 'exit' | 'error'}` | `/work/projects/platform/packages/contracts/src/terminal.ts:8-17`, `/work/projects/platform/apps/server/src/app.ts:221`, client side `/work/projects/platform/apps/web/src/lib/server-sockets.ts:31-42` |
| Chat / orchestration | WS RPC with subscriptions, replay, resume                                                                               | `/work/projects/platform/apps/server/src/orchestration/ws-rpc.ts:1-80`, client `/work/projects/platform/apps/web/src/features/chat/transport/orchestration-rpc-client.ts` (only DOM-ish call is `new WebSocket(url)` at line 794; Bun has a global `WebSocket`) |
| LSP                  | WS `/lsp?path=&root=&server=` proxy to server-side language servers                                                     | `/work/projects/platform/apps/server/src/app.ts:220`, `/work/projects/platform/apps/server/src/lsp/routes.ts`                                                                                                                                                   |
| Files                | REST `/fs/tree?path&depth`, `/fs/read`, `/fs/write`, workspace-edit prepare/commit/undo/redo, `/fs/search/events` (SSE) | `/work/projects/platform/apps/server/src/fs/routes.ts:32-131`                                                                                                                                                                                                   |
| Git / diffs          | REST `/git/diff`, `/git/diff/blob`, `/git/branch-diff`, stage/commit/worktrees                                          | `/work/projects/platform/apps/server/src/git/routes.ts:29-122`; `GitFileDiff` carries `oldText/newText/patch/hunks` (`/work/projects/platform/packages/contracts/src/git.ts:47-59`)                                                                             |
| Logs                 | REST `/_log/dashboard/summary`, `/events`, SSE `/live`                                                                  | `/work/projects/platform/apps/server/src/observability/routes.ts:48-81`, contracts `/work/projects/platform/packages/contracts/src/log-dashboard.ts`                                                                                                            |
| Settings             | `GET /settings`, `POST /settings`, SSE `/settings/events`, `/settings/raw`                                              | `/work/projects/platform/apps/server/src/settings/routes.ts:37-58`                                                                                                                                                                                              |
| Attachments          | `GET /attachments/:fileName` bytes                                                                                      | `/work/projects/platform/apps/server/src/attachments/routes.ts:22-45`                                                                                                                                                                                           |

Auth today is origin-allowlist only (`/work/projects/platform/apps/server/src/auth.ts:22-40`); a TUI has no `Origin` header, so the guard needs a non-browser principal before anything else works. This is not one of the eight problems but it gates all of them.

### 0.2 What OpenTUI actually ships (verified against the Bun cache, 0.5.10)

Nothing in `references/` has `node_modules`, so this comes from `/work/cache/bun/cache/@opentui/core@0.5.10@@@1`:

- Renderables (`renderables/index.d.ts`): `Box`, `Text`, `ScrollBox` (with `viewportCulling`, `stickyScroll`, `stickyStart`), `Input`, `Textarea`, `Select`, `TabSelect`, `Slider`, `Code` (tree-sitter highlighted, `streaming`), `Diff` (parses a unified patch, `view: "unified"|"split"`), `Markdown` (marked-based, streaming), `Image` (kitty/sixel/blocks via `resolveImageRenderProtocol`), `TextTable`, `LineNumberRenderable`, `EditBufferRenderable`, **`EmbeddedTerminal`**, `FrameBuffer`, `ASCIIFont`.
- `EmbeddedTerminalRenderable` (`renderables/EmbeddedTerminal.d.ts`): `write(string|Uint8Array)`, `onData(bytes, source: "input"|"response")`, `onTerminalResize`, `onScreenChange`, `screen()`, `encodeKey/encodePaste`, mouse forwarding, selection, `maxScrollback`. Native side (`zig.d.ts:736-761`): `createEmbeddedTerminal`, `embeddedTerminalWrite/Resize/Scroll/Compose/Cursor/EncodeKey/EncodeMouse/EncodeFocus/DrainResponses`. The native library is libghostty: `strings libopentui.so` yields `libghostty` and `OTUI_GHOSTTY_LOG_LEVEL`, and the package ships `LICENSE-GHOSTTY` (`/work/cache/bun/cache/@opentui/core-linux-x64@0.5.10@@@1/`). So OpenTUI's terminal-in-terminal is the same VT engine as our web pane.
- A native rope editor: `edit-buffer.d.ts` (`EditBuffer`: insert/delete, cursor, undo/redo, highlights, `setSyntaxStyle`), `editor-view.d.ts` (`EditorView`: viewport, wrap, selection, visual cursor, extmarks), `renderables/Textarea.d.ts` (multi-line editor with action keymap incl. `undo`/`redo`/word motions).
- Renderer: `suspend()/resume()/pause()` (`renderer.d.ts:585-587`), `capabilities` (kitty graphics, sixel, kitty keyboard, pixel resolution via `lib/terminal-capability-detection.d.ts`), `kittyImageTransport`, `screenMode: "alternate-screen"|"main-screen"|"split-footer"` (`renderer.d.ts:40-58`), `useKittyKeyboard`.
- Reconcilers: `@opentui/solid` (opencode) and `@opentui/react` 0.5.10 (t1code uses 0.2.7 with React 19).

Version caveat: opencode pins `@opentui/*` 0.4.5 (`/work/projects/platform/references/opencode/package.json:43-45`), t1code 0.2.7 (`/work/projects/platform/references/t1code/apps/tui/package.json:36`). Neither of them uses `EmbeddedTerminal`; I could not verify which version introduced it. Pin >= 0.5.10 or verify.

### 0.3 Our own VT engine runs headless

`/work/projects/ghostty-webgpu` is ours and is layered: `src/core` (`GhosttyRuntime`, `GhosttyTerminal`, `GhosttyRenderState`), `src/term` (`TerminalSession`), `src/dom`, `src/render`. `src/core` and `src/term` contain no `document`/`window`/`HTMLElement` references (grep is empty), the wasm loader falls back to `node:fs` for `file:` URLs (`src/core/runtime.ts:13-50`), and `src/core/tests/terminal.test.ts` runs under `environment: 'node'` (`vitest.config.ts`). The cell read API is exactly what a cell renderer wants: `GhosttyRenderState.update()`, `readRows({ dirtyOnly })`, `readCursor()`, `acknowledge()` (`src/core/render-state.ts:393-432`) producing `RenderRow { y, dirty, cells: RenderCell[] }` with `RenderCell { x, text, continuation, foreground?, background?, style?: CellStyle, selected }` (`src/core/types.ts:163-200`). The WebGPU renderer already consumes it damage-first (`src/render/renderer.ts:462-480, 619-626`).

## 1. Terminal-in-terminal

### 1.1 What we have

- Web pane: `GhosttyWebGpuTerminal` mounted in a div, bytes decoded to strings and sent as `{type:'input', data}`; output written with `terminal.write(message.data)`; resize forwarded as `{type:'resize', cols, rows}` (`/work/projects/platform/apps/web/src/features/terminal/components/panel.tsx:305-333, 396-418, 496-507`).
- Server `TerminalService`: one `TerminalSession` per `(root, sessionId)` (`/work/projects/platform/apps/server/src/terminal/service.ts:133-157`), replay buffer of the last 256 KB of raw output (`:64`, `appendOutput` `:339-351`), detached sessions kept 10 minutes (`:65`, `startDetachTimer` `:318-325`), PTY spawned via a Node child running node-pty (`NodePtyBridge` `:597-607`; plan 074 replaces it with `Bun.Terminal`).
- **Exclusive attach**: `setConnection` closes the previous socket when a second client attaches (`service.ts:310-316`). Web and TUI cannot watch the same shell at once today.

### 1.2 What the references do

- **opencode**: no terminal pane. `!` switches the prompt to "shell" mode and submits `sdk.client.session.shell({...command})` to the server (`/work/projects/platform/references/opencode/packages/tui/src/component/prompt/index.tsx:831-836, 1059-1068`); the server's shell tool spawns a piped process, no PTY (`/work/projects/platform/references/opencode/packages/opencode/src/tool/shell.ts:484`). Output lands in the transcript as a tool part. For a real shell, opencode gives the host terminal away: `terminal.suspend` command does `renderer.suspend(); process.kill(0,'SIGTSTP')` and resumes on `SIGCONT` (`/work/projects/platform/references/opencode/packages/tui/src/app.tsx:869-877`). The opencode **server** does have a full PTY API (`/pty` create/connect over WS with tickets: `/work/projects/platform/references/opencode/packages/opencode/src/server/routes/instance/httpapi/groups/pty.ts:17-40`, core in `packages/core/src/pty/pty.bun.ts`), but its consumer is the desktop app using `ghostty-web` (`/work/projects/platform/references/opencode/packages/app/src/components/terminal.tsx:7,35-44`), never the TUI.
- **crush**: no terminal pane either. The bash tool runs through an in-process POSIX interpreter (`mvdan.cc/sh`, `/work/projects/platform/references/crush/internal/shell/shell.go:7-25`); output is text rendered as a chat item (`internal/ui/chat/bash.go`). External programs get the terminal through `tea.ExecProcess` (used for `$EDITOR`, `/work/projects/platform/references/crush/internal/ui/model/ui.go:3817-3830`).
- **t1code**: a "terminal drawer" over a real server PTY (node-pty or `Bun.spawn` with `terminal:` in `/work/projects/platform/references/t1code/apps/server/src/terminal/Layers/BunPTY.ts:102-105`), but the TUI does **not** emulate: it strips ANSI with a regex, keeps the last 60k chars, splits on newlines and shows the tail lines in a scrollbox (`/work/projects/platform/references/t1code/apps/tui/src/terminalDrawer.ts:19-31, 70-76`; rows at `ui.tsx:5222-5230`). Input is `api.terminal.write({data: cmd + '\r'})` (`ui.tsx:8597`). Full-screen programs (vim, htop) are unusable in it. This is the cautionary example: it is the cheapest option and it is not a terminal.

### 1.3 The two real options

**A. Embedded emulator, rendered into cells.**

- A1: OpenTUI `EmbeddedTerminalRenderable`. Wire `onData -> {type:'input'}` (bytes need UTF-8 decoding to fit today's string protocol), `terminal.write(output)`, `onTerminalResize -> {type:'resize'}`. Keyboard: OpenTUI encodes host key events into the inner terminal's negotiated protocol (`encodeKey`, kitty flags on the native side), answers inner queries itself (`embeddedTerminalDrainResponses`, `onData(..., "response")`), forwards mouse when the inner app enables tracking, composites straight into the frame buffer (`embeddedTerminalCompose`). Scrollback is emulator-side (`maxScrollback`), so `terminal.integrated.scrollback` (`/work/projects/platform/packages/contracts/src/settings/keys.ts:194`) maps directly. Cost: essentially zero new code beyond the socket adapter.
- A2: our `ghostty-webgpu` core in-process plus a cell painter: `GhosttyTerminal.write(bytes)`, then per frame `renderState.update()` / `readRows({dirtyOnly:true})` into OpenTUI `Text`/`FrameBuffer` cells. Gives byte-for-byte parity with the web pane and full control (selection formatting, links via `src/term/links.ts`, the same appearance model plan 067 resolves), at the cost of writing the painter, key encoding (`src/core/input.ts` exists), and mouse. Both A1 and A2 are the same libghostty underneath.

Nested-emulator hazards (apply to A1 and A2):

- Two parsers per byte (ours, then the host's after repaint). Fine with damage-only redraw; the whole point of `readRows({dirtyOnly})`.
- Unicode width disagreements between the inner emulator and the host terminal produce misaligned columns. libghostty's width tables vs the host's; OpenTUI exposes a `WidthMethod` for its own text. Emoji/CJK-heavy inner output is the test case.
- Inner images (kitty/sixel emitted by a program inside the pane) cannot be composited; `EmbeddedTerminal` is cells only. Same for inner OSC 8 hyperlinks (not clickable through two layers unless we re-emit them).
- Kitty keyboard protocol: the inner app's request must be answered by the inner emulator and the host's mode left alone; OpenTUI does this in native code. A2 would need to replicate it.
- Colors: only what the host supports; 256/truecolor pass through as cell attributes.

**B. Raw passthrough (tmux-attach style).** Suspend the TUI (`renderer.suspend()`), put host stdin in raw mode, pipe host stdin bytes to `{type:'input'}`, WS output to host stdout, send host size as `{type:'resize'}`, watch `SIGWINCH`. The host terminal answers every inner query natively; images, kitty keyboard, hyperlinks and mouse all work; zero emulation. Costs: the terminal is the whole screen (no sidebar), you need a detach prefix (tmux's `C-b d`) and therefore an input scanner, and on detach you must reset whatever modes the inner app left on before `renderer.resume()` (DECRST 1000-1006/2004, `CSI ? 1049 l`, kitty keyboard pop `CSI < u`), otherwise the TUI comes back with mouse tracking or an alt screen stuck. Scrollback lives only in the host while attached. This is exactly what opencode does for `$EDITOR` and SIGTSTP and what crush does with `ExecProcess`, extended to a remote PTY.

### 1.4 Recommendation

Do A1 as the pane (sidebar + terminal split, matching the product vision's "terminal session opens as a full-bleed pane" but keeping the rail), and B as a "zoom/attach" command for fidelity. Plan A2 only if A1's key/mouse/width behaviour proves wrong; the same wasm is already ours.

Server work either option needs:

1. Non-browser auth principal (0.1).
2. Multi-attach or an explicit "steal" semantic in `TerminalSession.setConnection` (`service.ts:310-316`). The product vision's "one id, two doors" is about agent sessions, but users will open the same shell in web and TUI.
3. Replay is a truncated raw stream cut at chunk boundaries (`service.ts:346-350`); a fresh emulator replaying from the middle of an alt-screen session repaints wrong. tmux avoids this by keeping the emulator on the server. **Structural alternative worth stating**: move the VT emulator server-side (ghostty-vt.wasm runs in Bun, 0.3) and ship screen snapshots plus row deltas to every client; web and TUI both become thin painters, multi-attach is free, replay becomes "send the current screen", and the web pane stops needing WebGPU-side state for reconnection. This is a bigger change than the TUI needs on day one but it is the design that removes problems 2 and 3 instead of patching them.
4. Bytes, not JSON strings, for output frames. Plan 074 already notes the encoding boundary moves once node-pty's JSON framing goes; `EmbeddedTerminal.write` takes `Uint8Array`.

## 2. Editor-in-terminal

### 2.1 What is separable in `@singapore-editor/*` (read from `/work/projects/Editor`, symlinked as `packages/editor-*`)

DOM-bound, not reusable:

- `Editor` requires an `HTMLElement` and builds `VirtualizedTextView(container, ...)`, `EditorAnnouncer(container)`, `observeBrowserTextMetricsInvalidation` in its constructor (`/work/projects/Editor/packages/editor/src/editor/Editor.ts:424-464`). The architecture is explicit that browser layout is the text layout engine and the CSS Highlight API is the painter (`/work/projects/Editor/ARCHITECTURE.md` section 5.4, 5.11).
- `EditorViewSnapshot` / `EditorVisibleSnapshotJSON` paint runs (`/work/projects/Editor/packages/editor/src/plugins.ts:320-380`) look like a cell-renderer feed but are _emitted by_ the DOM view; "secondary views" are the same `VirtualizedTextView` re-exported (`/work/projects/Editor/packages/editor/src/public/secondaryViews.ts:14-15`). No headless view exists.
- `@singapore-editor/react` / `@singapore-editor/solid` are thin mount wrappers (`packages/react/src/index.ts:213-225` mounts into a div). `@singapore-editor/gutters`, `find`, `minimap`, `scope-lines`, `panes`, `markdown` (preview plugin), `lsp-plugin` (completion/hover/diagnostic widgets: `packages/lsp-plugin/src/anchoredSurface.ts`, `renameWidget.ts`) are Editor plugins over DOM.

DOM-free, reusable as models (grep for `document.`/`window.`/`HTMLElement` is empty for these):

- `@singapore-editor/core/document`: piece table, anchors, `createDocumentSession`, `createEditorTextBuffer`, `createEditorViewSession`, transaction prepare/commit/reverse, mutation leases (`/work/projects/Editor/packages/editor/src/index.ts:55-100`).
- `@singapore-editor/core/syntax`: `createEditorSyntaxSession`, `EditorToken`, `FoldRange`, `BracketInfo`, `treeSitterCapturesToEditorTokens` (`index.ts:148-172`; types in `src/syntax/session.ts:1-60`).
- `foldMap.ts` (anchor-backed folds), `displayTransforms.ts`, `history.ts`, `selections.ts`, `inlineMap.ts`, `editor/keymap` tables (`defaultEditorKeyBindings`, `editorKeymapLayers`, `index.ts:173-186`).
- Shiki incremental tokenizer (`src/shiki/tokenizer.ts`, pure over `shiki/core`) and the shiki worker client (`src/shiki/workerClient.ts`, piece-table aware).
- `@singapore-editor/tree-sitter`: `web-tree-sitter` wasm; the only environment probe is `typeof Worker !== 'undefined'` (`/work/projects/Editor/packages/tree-sitter/src/treeSitter/workerClient.ts:127-130`) and it spawns `new Worker(new URL('./treeSitter.worker.ts', import.meta.url))` (`:346`). Bun has `Worker` and runs TS workers, so highlighting, folds and structural selection can run in the TUI process. Untested there.
- `@singapore-editor/lsp`: `LspClient`, `LspWorkspace`, `createWebSocketLspTransport` (`/work/projects/Editor/packages/lsp/src/index.ts:17-52`), `sideEffects: false`, only dependency `vscode-languageserver-protocol`. Pairs with our `/lsp` WS proxy.

Gotcha: package roots import CSS as a side effect (`packages/editor/src/editor.ts:1`, `packages/diff/src/index.ts:1`); a Bun TUI must import subpath entries (`@singapore-editor/core/document`, `/syntax`) or the build needs a CSS no-op loader.

### 2.2 What the references do

- **opencode**: never renders an editable buffer in the TUI. `openEditor` writes a temp `.md`, `renderer.suspend()`, spawns `$VISUAL || $EDITOR`, reads the file back, `renderer.resume()` (`/work/projects/platform/references/opencode/packages/tui/src/editor.ts:26-54`) - and only for the prompt. Zed integration reads Zed's sqlite for the active selection (`editor-zed.ts:41-87, 187-195`) and discovers an IDE MCP lock file for "connected editor" (`editor.ts:56-96`). Read-only code appears via `<code>` (`routes/session/index.tsx:1635, 2117`).
- **crush**: same shape, `editor.Command("crush", tmpPath, editor.AtPosition(line, col))` + `tea.ExecProcess` (`/work/projects/platform/references/crush/internal/ui/model/ui.go:3806-3842`) for the prompt only; file contents render read-only with chroma.
- **t1code**: no editor; diffs via OpenTUI `<diff>` (`ui.tsx:2399-2462`).

### 2.3 Options and recommendation

1. **`$EDITOR` handoff** (suspend/resume, 1.3 B mechanics). For remote environments the file must round-trip through `/fs/read` and workspace-edit prepare/commit (`/work/projects/platform/apps/server/src/fs/routes.ts:38, 101-104`) with the `snapshot` precondition (`/work/projects/platform/packages/contracts/src/workspace-edit.ts:1-11`) so a concurrent agent write is detected. Cheap and what both references chose.
2. **Read-only viewer in cells**: OpenTUI `CodeRenderable` + `LineNumberRenderable` (tree-sitter highlight through OpenTUI's own parser worker, `renderables/Code.d.ts`), or our shiki tokenizer feeding styled spans. Jump-to-line from diagnostics, search results, chat file links. Diagnostics as a list/overlay via `@singapore-editor/lsp` over `/lsp` - transport-agnostic, so "LSP client reuse" is yes for read-only features (diagnostics, hover on demand, go-to-definition as navigation).
3. **Real editor in cells**: use our document/syntax/fold/keymap models and write a cell `VirtualizedTextView` equivalent (input, selection, scroll, wrap, gutters, decorations). OpenTUI's `EditBuffer`/`EditorView` is tempting as the view, but it is a second source of truth (a Zig rope) - driving it by `setText` per change is O(n) per keystroke and loses anchors/undo parity. This is the honest "editor port" and is large; only do it if IDE mode inside the TUI is a stated goal.

Recommend 1 + 2 for the first TUI. The product vision puts IDE mode behind the agent view; in the terminal the agent view plus viewer/diff plus `$EDITOR` handoff covers the ladder without a fourth editor implementation.

## 3. Diff view

### 3.1 Ours

`@singapore-editor/diff` splits cleanly:

- Pure model: `createTextDiff` / `parseGitPatch` (`/work/projects/Editor/packages/diff/src/model.ts:1-9, 49-80`, over npm `diff`), `annotateInlineChanges` (`inline.ts`, `diffWordsWithSpace`), `createSplitProjection` / `createStackedProjection` (`projection.ts:29-95`) yielding `DiffRenderRow { type: context|addition|deletion|placeholder|hunk|empty, text, oldLineNumber, newLineNumber, inlineRanges, expandKey, skippedLines }` (`types.ts:75-87`); split rows are already aligned into equal-length `leftRows`/`rightRows`; `createDiffRegionStore` (expansion state, `regions.ts`). Imports are only `diff` and types (`grep ^import` over `src/*.ts`).
- DOM-bound: `createDiffPlugin` (an Editor plugin, `editorDiffPlugin.ts`), `diffGutter.ts`, `liveProjection.ts` (injected editor rows). `diffSyntax.ts` builds piece-table snapshots for a highlighter provider and is usable headless with the shiki worker.
- Web glue that is pure: `editorDiffFiles()` maps `GitFileDiff` to `DiffFile`, preferring whole-file text over the patch (`/work/projects/platform/apps/web/src/features/git/utils/editor-diff-files.ts:15-50`); `renderableDiffFile`. `DiffPane` is two read-only Editors (`/work/projects/platform/apps/web/src/features/editor/components/diff-pane.tsx:1-80`).

### 3.2 References

- **crush** `diffview`: `go-udiff` edits, unified or split; split pairs each delete with the next insert in the hunk (`/work/projects/platform/references/crush/internal/ui/diffview/split.go:20-66`), per-line chroma highlighting cached by hash, x/y offsets for scrolling, width-aware layout (`diffview.go:36-70`). A hand-written cell diff renderer, roughly 600 lines.
- **opencode**: OpenTUI `<diff>` fed the raw patch string with `view`, `filetype`, `syntaxStyle`, `wrapMode`, colors (`/work/projects/platform/references/opencode/packages/tui/src/routes/session/index.tsx:2411-2430`); full diff route with a file tree and split-when-wide (`feature-plugins/system/diff-viewer.tsx:843-866`; `ctx.width > 120 ? "split" : "unified"` near `index.tsx:2445`).
- **t1code**: web uses `@pierre/diffs` (`apps/web/src/components/DiffPanel.tsx`), the TUI normalises patches for OpenTUI `<diff>` (`apps/tui/src/ui.tsx:2399-2462`).

### 3.3 Recommendation

Keep the invariant "one diff component" at the **model** level: TUI = `GitFileDiff -> editorDiffFiles -> createSplit/StackedProjection + regions` and a cell painter (one `DiffRenderRow` per row, inline ranges as styled runs, hunk rows expandable through `DiffRegionStore`, split only at >= ~120 columns, syntax via shiki tokenizer or OpenTUI `Code` per side). That is the fourth container of the same model, which is what the vision's invariant is protecting against (drift between three parsers). OpenTUI `<diff>` is the zero-effort fallback and what both TS references use, but it re-parses the patch with its own parser, has no expandable context, and cannot show the whole-file text our server already sends.

## 4. File tree and fuzzy pickers

### 4.1 Ours

`packages/tree` has a headless core: `PathStore` (`add/remove/move/batch`, `getVisibleCount`, `getVisibleSlice(start,end)`, `getVisibleIndex`, `expand/collapse`, `getPathInfo`; `/work/projects/platform/packages/tree/src/utils/path-store/store.ts:266-380`) and `FileTreeController` (focus/selection/range selection, search session, rename, drag, `getVisibleRows(start,end)`, `subscribe`; `/work/projects/platform/packages/tree/src/utils/model/FileTreeController.ts:280-1224`). `FileTreeVisibleRow` gives `depth/level/name/kind/isExpanded/isSelected/isFocused/posInSet/setSize` (`utils/model/publicTypes.ts:101-117`), i.e. everything a row painter needs. Git status is a pure model too (`utils/model/gitStatus.ts`). DOM lives in `utils/render/FileTree.ts` (web component, shadow root, SVG sprite), `components/*`, `state/renderer.ts`. The package `index.ts` exports both; a TUI should import the model files directly or the package should add a `./model` entry (allowed as a package entry point). Data comes from `/fs/tree?depth=1` (`/work/projects/platform/apps/web/src/lib/file-server.ts:29`) exactly as the web does.

Fuzzy: `fuzzyRank`/`fuzzyRankScore`/`compareFuzzyRankedTargets` in contracts (`/work/projects/platform/packages/contracts/src/fuzzy-rank.ts`) drive the command palette; quick-open files come from the server (`fetchQuickOpenFiles`, `/work/projects/platform/apps/web/src/features/command-palette/use-command-palette-files.ts:36-45`); settings search `matchingSettingIds` (`/work/projects/platform/apps/web/src/features/settings/utils/search.ts`) is pure. The command specs (`/work/projects/platform/apps/web/src/keymap/command-registry.ts`) are data.

### 4.2 References

- opencode `DialogSelect`: fuzzysort over options with categories, `InputRenderable` filter, `ScrollBoxRenderable`, keyboard and mouse, actions/footers (`/work/projects/platform/references/opencode/packages/tui/src/ui/dialog-select.tsx:22-120`); file autocomplete asks the server `fs.find` and only fuzzysorts non-file items (`component/prompt/autocomplete.tsx:316-324, 489-502`). Its diff-viewer file tree is a 100-line flatten (`feature-plugins/system/diff-viewer-file-tree.tsx`).
- crush: `bubbles/filepicker` with kitty image preview (`internal/ui/dialog/filepicker.go:1-60`), `sahilm/fuzzy` for completions, `bubbles/list` for dialogs.

### 4.3 Recommendation

One `DialogSelect`-shaped picker over our `fuzzyRank` (commands, files via server quick-open, sessions, models, settings). File tree = `FileTreeController` + manual windowing (`getVisibleRows(top, top+rows)`); the controller already virtualises, so do not put thousands of `<text>` children in a `ScrollBox` and rely on `viewportCulling`. Icons: Nerd Font glyphs instead of the SVG sprite (`getBuiltInFileIconColor` is reusable for colour).

## 5. Images and attachments

### 5.1 Ours

Composer stages images as data URLs after canvas-based compression (`/work/projects/platform/apps/web/src/features/chat/utils/input-attachments.ts`, `image-compression.ts` - DOM), uploads them in the turn command, the server stores blobs and serves `GET /attachments/:fileName` (`/work/projects/platform/apps/server/src/attachments/routes.ts:22-45`); the transcript resolves URLs with `chatAttachmentUrlPath` (`/work/projects/platform/apps/web/src/features/chat/utils/attachment-image.ts:26-32`).

### 5.2 References

- **crush** `internal/ui/image`: kitty graphics with `TransmitAndPut`, virtual placement and unicode placeholders, chunked, tmux passthrough via `ansi.TmuxPassthrough`, and a block-character fallback (`go-ansi-paintbrush`) (`/work/projects/platform/references/crush/internal/ui/image/image.go:127-260`); used by the file picker preview.
- **t1code**: hand-rolled kitty APC (`ESC _ G a=T,f=100,...` chunked base64) placed by cursor moves, kitty only, sixel explicitly unsupported (`/work/projects/platform/references/t1code/apps/tui/src/terminalImages.ts:82-112, 124-276`); remote attachments cached to disk from `/attachments/:id` (`:278-302`); clipboard images via platform tools (`clipboardImage.ts`).
- **opencode**: attaches local files/images to prompts (`component/prompt/local-attachment.ts`) but renders none in the TUI (no kitty/sixel code; `clipboard.ts` shells out to pbpaste/wl-paste/powershell).

### 5.3 Recommendation

OpenTUI `ImageRenderable` with `protocol: "auto"` (`renderables/Image.d.ts`; capability detection in `lib/terminal-capability-detection.d.ts`; native decode/resize in `image.d.ts` replaces the canvas compressor). When unsupported, render a chip `[image name WxH] o: open` and open the cached file with the OS opener (t1code pattern). Paste-from-clipboard: platform tools as opencode/t1code. Known hazards: tmux needs passthrough (crush handles it; check OpenTUI's `kittyImageTransport` status field `renderer.d.ts:456`), and images cannot appear inside the embedded terminal pane (1.3).

## 6. Resize, reflow, scrollback, long-chat virtualization

### 6.1 Ours

Chat: `@tanstack/react-virtual` with measured rows, overscan 6, insets on the virtualizer (`/work/projects/platform/apps/web/src/features/chat/components/messages-timeline.tsx:87-97`); all scroll policy is a **pure reducer over geometry** (`/work/projects/platform/apps/web/src/features/chat/utils/timeline-scroll-anchoring.ts`: follow modes `following-end | anchoring-new-turn | free-scrolling`, prepend absorption, remeasure compensation); the timeline item model is pure (`utils/timeline-items.ts`); earlier pages load through the WS thread-detail page RPC. Logs list is virtualized the same way (`features/logs/components/event-list.tsx:23`). Markdown is streamdown/react (`assistant-markdown.tsx`), not portable.

### 6.2 References

- **opencode**: all messages of a session live in one `<scrollbox stickyScroll stickyStart="bottom">` (`/work/projects/platform/references/opencode/packages/tui/src/routes/session/index.tsx:1180-1199`), session load is capped at 100 messages (`context/sync.tsx:603`), and it leans on OpenTUI `ScrollBox.viewportCulling` (`ScrollBox.d.ts`, `ContentRenderable._getVisibleChildren`). Layout is still computed by yoga for every child; culling saves paint, not layout.
- **crush**: `list.List` renders only the viewport: `offsetIdx/offsetLine`, a per-item render cache keyed by width and version, "frozen" finished items that are never re-rendered, full invalidation on width change (`/work/projects/platform/references/crush/internal/ui/list/list.go:1-108, 557-620`). Explicit resize benchmarks (`internal/ui/chat/resize_bench_test.go`).

### 6.3 Recommendation

Cells make measurement deterministic: height(item, width) = wrapped line count, cacheable per (item id, version, width) exactly like crush. Reuse our `timelineScrollReducer` with rows as the unit (it is pure over `TimelineViewportMetrics`), mount only the visible window plus overscan (crush model, not opencode's), invalidate the height cache on `SIGWINCH` and re-anchor on the reducer's anchor item. Markdown: OpenTUI `<markdown streaming>` for the _visible_ assistant messages only. Terminal pane: scrollback is the emulator's (`maxScrollback`), scroll via `embeddedTerminalScroll`; the inner PTY reflows through the existing `resize` message (`/work/projects/platform/packages/contracts/src/terminal.ts:10`, handled at `service.ts:526`) and libghostty reflows its own scrollback. The server's 256 KB replay is the only history a fresh attach gets (1.4).

## 7. Logs dashboard in cells

Everything below the React layer is reusable: filters and query params (`/work/projects/platform/apps/web/src/features/logs/utils/filter-params.ts`), live SSE subscription (`utils/api.ts:46-63`, `parseEdenSseStream` has no DOM references), batching and cache merge (`state/live-batcher.ts`, `state/live-cache.ts`), formatters, toolbar option derivation (`utils/toolbar-options.ts`). The summary contract already has what a text chart needs: `timeline[]` buckets with `total/error/warn/slow` and the four headline counts (`/work/projects/platform/packages/contracts/src/log-dashboard.ts:51-74`). OpenTUI has no chart renderable (none in `renderables/index.d.ts`), so the histogram is a row of block glyphs (`▁▂▃▄▅▆▇█`) coloured by error/warn share; the event list is a windowed table (time, level, area, operation, durationMs, message) in `tabular-nums` spirit (fixed-width columns), Enter expands `rawJson` in a `<code filetype="json">`, `/` edits the search filter, level/area/source toggles are a `TabSelect`. None of the three references ship a logs surface; crush has a `crush_logs` tool that prints text.

## 8. Settings UI in cells

The registry is the UI: `SETTINGS_REGISTRY` entries carry `widget`, `category`, `description`, `keywords`, `visibility`, `scope` (`/work/projects/platform/packages/contracts/src/settings/keys.ts:31-120`), the widget vocabulary is `boolean|font|number|string|multiline|enum|list|record|keybindings|providers|models|complex` (`settings/registry.ts:37-49`; today 15 number, 12 boolean, 12 enum, 3 complex, 2 models, 1 each font/keybindings/providers), and `settingControl()` narrows value plus widget to a renderable control (`settings/control.ts:32-60`). Resolution, layer/scope security and diagnostics are pure (`settings/resolve.ts`), the wire snapshot carries raw layer text and key ranges (`settings/wire.ts`), and the server exposes snapshot, mutation, SSE and raw text (`/work/projects/platform/apps/server/src/settings/routes.ts:37-58`). Web-side pure helpers: `projectSettings` optimistic projection (`features/settings/utils/projection.ts:29-45`), `search.ts`, `humanize.ts`, `patch.ts`, `operations.ts`, `mutation-policy.ts`, `availability.ts` (takes an environment object; the TUI is a new environment kind). React-coupled: `state/sync-service.ts` (QueryClient), stores, widgets, the chord recorder (DOM `KeyboardEvent`).

References do not have a settings page: opencode uses config files plus per-concern dialogs (`dialog-theme-list`, `dialog-model`, `dialog-provider`), crush has model/API-key/reasoning dialogs, t1code has `providerSettings.ts` and prefs. The TUI-native shape is therefore a search-first palette over the registry (`matchingSettingIds`) opening one dialog per key: boolean toggle, enum `Select`, number/string `Input`, `multiline` `Textarea`, font from `/fonts`, keybinding recorder from OpenTUI `KeyEvent` (chords need `useKittyKeyboard`), providers/models as sub-dialogs, `complex` and the JSON view via `$EDITOR` on `/settings/raw` with the revision check. Scope tabs and the cross-scope indicator come straight from `SettingsLayerId` and `SCOPES_BY_LAYER`. No TUI-only keys unless registered with a consumer in the same pass, and anything the TUI turns into a binary or key binding stays `application`/`machine`.

## Summary table

| Problem                 | Feasibility                                                            | Recommended                                                                                                           | Reusable from us                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Terminal-in-terminal    | High with OpenTUI `EmbeddedTerminal` (libghostty); passthrough trivial | Embedded pane + attach/zoom passthrough; fix exclusive attach and replay on the server; consider server-side emulator | `contracts/terminal.ts`, `TerminalService`, `ghostty-webgpu/src/core` if we paint ourselves                          |
| Editor                  | Real editor is a large port; viewer + `$EDITOR` is cheap               | Viewer in cells + `$EDITOR` handoff via workspace-edit; LSP read-only overlay                                         | `@singapore-editor/core/document`, `/syntax`, `foldMap`, keymap tables, tree-sitter worker, shiki tokenizer, `@singapore-editor/lsp` |
| Diff                    | High                                                                   | Our model + cell painter (split >= 120 cols); OpenTUI `<diff>` as fallback                                            | `@singapore-editor/diff` model/projection/regions, `editorDiffFiles`                                                         |
| File tree / pickers     | High                                                                   | `FileTreeController` + manual window; one fuzzy dialog                                                                | `packages/tree` model, `fuzzyRank`, command specs, settings search                                                   |
| Images                  | Medium (terminal-dependent)                                            | OpenTUI `Image` auto protocol + chip fallback + OS open                                                               | attachment contracts/routes                                                                                          |
| Resize / virtualization | High                                                                   | crush-style windowed list with width-keyed height cache; our scroll reducer in rows                                   | `timeline-scroll-anchoring`, `timeline-items`, logs live cache                                                       |
| Logs                    | High                                                                   | block histogram + windowed table + SSE                                                                                | all `features/logs/utils` and `state`                                                                                |
| Settings                | High                                                                   | registry-driven search-first palette + per-key dialogs                                                                | contracts `settings/*`, `settings/utils/*` pure helpers                                                              |
