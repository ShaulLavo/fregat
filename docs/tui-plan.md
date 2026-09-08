# TUI — Strategy

> **STATUS: 🟢 REVIEWED STRATEGY, PREPARED 2026-09-05.** Product and architecture direction for a
> terminal front end to `apps/server`. Like every `docs/` strategy, it authorizes nothing; the
> executable slices in §10 become `plans/0NN-tui-*.md` one at a time and root
> [`PLAN.md`](../PLAN.md) owns cross-project order. Research behind every claim is preserved under
> [`docs/tui-research/`](tui-research/) (§13); those notes cite file and line for each fact.

Plan 079 completed on 2026-09-05. Its [foundation record](tui-foundation.md) and
[command audit](tui-bindings.md) preserve the implementation and verification. The TUI now has
editable settings, commands, file browsing, address navigation, themes, and shared client services.
Plan 081 completed on 2026-09-07. Its [workbench record](tui-workbench.md) covers the file tree,
viewer and external editing, Git, search, problems, logs, terminal, and native feasibility checks.
Plan 082 completed on 2026-09-07. Its [Agent view record](tui-agent.md) covers the prompt, streamed
timeline, session rail, provider controls, blocking requests, plans, and terminal history return.
The executable plans were deleted after their checks passed. Worktree parity (083) is next.

## 0. What the TUI is

**The TUI is a second front end to the same server.** It speaks the same `packages/contracts`
schemas, the same treaty client contract, the same orchestration WebSocket RPC, the same terminal,
LSP, filesystem, git, settings and log routes that `apps/web` speaks. It holds no domain logic of
its own. Everything the web app supports is in scope; what changes is the input model (keyboard
first, mouse second) and the rendering (cells, not DOM).

Four coding-agent TUIs were read for this document, all cloned under `references/` (gitignored):

| Reference                              | Stack                | Why it matters to us                                                                 |
| -------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `references/opencode` (`packages/tui`) | OpenTUI + Solid, Bun | The largest production OpenTUI app; keymap, dialog, prompt, theme and sync patterns  |
| `references/crush`                     | Go, Bubble Tea v2    | The best client/server split and the best cell-list virtualization design            |
| `references/t1code`                    | OpenTUI + React, Bun | A T3Code fork with a TUI: the closest precedent, and a catalogue of seams not to cut |
| `references/codex` (`codex-rs/tui`)    | Rust, ratatui        | App-server JSON-RPC contract, streaming pipeline, VT100-backed tests                 |
| `references/t3code`                    | React web app        | Already the model for `features/chat`; kept for parity checks                        |

## 1. Decisions

Each decision names the evidence in `docs/tui-research/`. "Refused" rows are behaviours a reference
ships that we will not copy.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Runtime: `@opentui/core` 0.5.x with `@opentui/react`**, exact-pinned through the workspace catalog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The only TypeScript terminal layer with native cell buffer, Yoga layout, grapheme widths, kitty keyboard, SGR mouse, kitty/sixel images, synchronized output, OSC 8/52/99, scrollbox, markdown, code, diff, textarea and an embedded VT (libghostty). React keeps `apps/web` hooks, Zustand stores, contexts and query definitions reusable; Solid would share none of them and fails silently without its Babel preload. Verified under Bun 1.4 and `bun --bun vitest`; single binary verified at ~100 MB. (`framework-options.md` §3–§9) |
| D2  | **A new `packages/client-core`** (`@workspace/client-core`) holds transport, environment identity, projection writers and selectors, command builders and dispatch, derivations, keymap pure pieces and errors; hosts inject ports (origin, socket factory, headers, storage, notify, wake, flush, logging). No React, no DOM, `zustand/vanilla`, `@tanstack/query-core`.                                                                                                                                                                                                                                            | 58% of `apps/web/src/lib` and ~80% of `features/chat/utils` are already pure; t1code and opencode both converged on "transport + derivations + ids, host capabilities injected". The `lib/` two-consumer rule makes this a package, not a cross-app import. (`client-core.md` §7)                                                                                                                                                                                                                                                          |
| D3  | **Navigation follows the product vision, not today's toggle.** Root screen = cross-project rail + stage. A workbench screen (tree, viewer, diff, git, search, terminal, problems, logs) is _pushed_ from a project or worktree row and popped with Back. No `uiMode` toggle, no global current project.                                                                                                                                                                                                                                                                                                              | `docs/product-vision.md:26-35,119-124` forbids a toggle for new construction. The web's toggle is legacy the vision already inverted. Commands `workspace.toggleUiMode/showChatMode/showWorkbenchMode` have no TUI binding; `workspace.revealChat` pops to root; a new `workspace.openWorkbench` pushes. Addresses round-trip: `mode=workbench` in an address is the pushed state. Confirmed by the operator on 2026-09-05 (§12 Q1).                                                                                                       |
| D4  | **Screen mode: alternate screen** for the application. Inline scrollback insertion (Codex) is refused for the main UI. A plain transcript export and a copy-friendly pager cover the accessibility case.                                                                                                                                                                                                                                                                                                                                                                                                             | Our product is a multi-pane app (rail, stage, tool pane, embedded terminal, pushed workbench); scrollback insertion only fits a linear chat and costs reflow heuristics, terminal special-casing and stderr redirection (`codex-tui.md` §1).                                                                                                                                                                                                                                                                                               |
| D5  | **Auth: the TUI presents a dedicated allow-listed origin string**, registered by the launcher through `SERVER_ALLOWED_ORIGINS`, on every `fetch` and WebSocket upgrade. No token mode is added.                                                                                                                                                                                                                                                                                                                                                                                                                      | The guard is an exact origin allowlist and nothing else (`apps/server/src/auth.ts`); the desktop shell already sends a synthetic origin. Token/pairing stays deferred per `docs/environments-and-remote-plan.md` §4. Spoofing `http://localhost:5173` is refused. The origin string is `platform-tui://local` (§12 Q6). (`server-surface.md` §2)                                                                                                                                                                                           |
| D6  | **Terminal pane: OpenTUI `EmbeddedTerminal`** (libghostty) fed by the `/terminal` socket, plus a raw **attach** command that suspends the renderer and hands the host terminal to the PTY (tmux-attach style) for full fidelity.                                                                                                                                                                                                                                                                                                                                                                                     | Same VT engine as the web's `ghostty-webgpu`, so parsing parity is free. t1code's ANSI-stripped text log is the cautionary example. Gate: the D6 spike in §10 must pass before Slice 081 starts. Fallback A2: our `ghostty-webgpu/src/core` runs headless and exposes `readRows({dirtyOnly})`. Multi-viewer is server fan-out (§7.3); the server-side emulator is a recorded reserve (§5.1). Decided 2026-09-05. (`hard-problems.md` §1)                                                                                                   |
| D7  | **Editor: read-only viewer in cells plus `$EDITOR` handoff** through workspace-edit prepare/commit with the snapshot precondition. LSP read-only features (diagnostics, hover, go-to-definition as navigation) through `@singapor/lsp` over `/lsp`. A full editor in cells is a **reserve**, not v1.                                                                                                                                                                                                                                                                                                                 | `@singapor/*` document, syntax, fold, keymap and LSP models are DOM-free; the view is not. Every reference chose handoff. (`hard-problems.md` §2) Confirmed by the operator on 2026-09-05 (§12 Q2).                                                                                                                                                                                                                                                                                                                                        |
| D8  | **Diff: one model, fourth container.** `GitFileDiff → editorDiffFiles → @singapor/diff createSplit/StackedProjection + DiffRegionStore`, painted into cells (split at ≥ 120 columns, expandable hunks). OpenTUI `<diff>` is a bootstrap fallback only.                                                                                                                                                                                                                                                                                                                                                               | Keeps the vision's "one diff component" invariant at the model layer; `<diff>` re-parses patches, has no expandable context and cannot use the whole-file text the server already sends. (`hard-problems.md` §3)                                                                                                                                                                                                                                                                                                                           |
| D9  | **Keymap: the web command table is the TUI command table.** Reuse `keymap/{table,define-command,active-bindings,utils/chord,utils/keymap-trie,utils/chord-machine,utils/when,utils/format-keys}` through `client-core`; reimplement only the DOM chord session and `eventTargetsTextEntry` over OpenTUI `KeyEvent`. `Mod` means Control in the TUI on every platform. Bindings: add `'tui'` to `platforms` and author TUI defaults per command row; user overrides stay in the single `keybindings.overrides` key.                                                                                                   | 142 rows, 125/108/106 default bindings and the chord machine already run under Bun with no DOM (`keymap-commands.md` §8). Ten web defaults collide with C0/tty controls and 51 need the kitty protocol (`completeness-critic.md` G4), so a TUI default table is unavoidable; a second binding store is refused.                                                                                                                                                                                                                            |
| D10 | **Focus: port the protocol, not the plumbing.** `FocusArea`, `FocusTargetId`, capabilities, `request → acknowledged/rejected/superseded`, `resolveTarget` precedence and per-pane binding arbitration are kept; registration binds to OpenTUI renderables instead of `HTMLElement`.                                                                                                                                                                                                                                                                                                                                  | Commands, menus, `when` clauses and palette enablement all key off the focus service (`keymap-commands.md` §5).                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D11 | **State: server is truth, projections in `client-core`.** Chat renders from the Zustand projection store fed by shell and thread subscriptions; one-shot reads use `@tanstack/query-core` observers. No snapshot-per-event refetch, no client-derived status.                                                                                                                                                                                                                                                                                                                                                        | t1code's refetch-the-world model can never stream; crush's blocking getters forced a TTL cache layer. Our transport already streams deltas and resumes by cursor. (`client-core.md` §8, `crush-tui.md` §1.6)                                                                                                                                                                                                                                                                                                                               |
| D12 | **Theme: one TUI theme JSON with `{dark, light}` variants and a `system` theme derived from the terminal's 16-colour palette; tokens mirror the web semantic tokens** (`background, card, popover, muted, accent, primary, foreground, muted-foreground, border, destructive, info, success, warning, diff-added, diff-removed`). Syntax colours come from the same shiki theme the web uses via `SyntaxStyle.fromTheme`. Degradation truecolor → 256 → 16 uses OpenTUI capabilities; `NO_COLOR` is honoured. `workbench.colorTheme` (dark/light/system) is read; `system` resolves through OSC 10/11 and mode 2031. | Web palette is 511 oklch custom properties and cannot be consumed directly (`completeness-critic.md` G6). opencode's `generateSystem` and luminance-based selected-foreground are the patterns (`opencode-tui.md` §9).                                                                                                                                                                                                                                                                                                                     |
| D13 | **Persistence: a file-backed `KeyValueStorage` under the platform home, namespaced by `environmentId` from day one**, holding only per-viewer conveniences (drafts, stash, rail collapse, read stamps, recent commands). No migration code, ever.                                                                                                                                                                                                                                                                                                                                                                    | Mirrors `docs/environments-and-remote-plan.md` §2.4 scoped storage and the greenfield rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D14 | **Logging: `@workspace/observability` `initializeObservabilityRuntime({ source: 'tui' })` writing JSONL into `logs/`**, wide events, `createStructuredError`. Not the HTTP ingest drain.                                                                                                                                                                                                                                                                                                                                                                                                                             | Matches the repo's log conventions and needs no round-trip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D15 | **Distribution: `bun build --compile` per target; the binary attaches to a running server or launches one** using the same launcher logic as the desktop shell (port release, allowed origins, `/health` probe). Remote = SSH port-forward attach through a launcher module shared with the desktop shell (§12 Q5).                                                                                                                                                                                                                                                                                                  | Codex's npm launcher shape (tiny JS, platform packages, signal forwarding) is the model. Whether `apps/server` itself compiles is a spike (§10).                                                                                                                                                                                                                                                                                                                                                                                           |
| D16 | **Testing: `bun --bun vitest` node project, `@opentui/core/testing` headless renderer with frame snapshots, real in-process `createApp`, in-process socket factories for all three WebSocket routes, PTY and LSP children injected.** A `--headless-frame` flag captures one frame to a file for agents and humans.                                                                                                                                                                                                                                                                                                  | Repo rules (real app code, no sockets to our own server) plus t1code's headless capture and codex's VT100 backend (`completeness-critic.md` G7).                                                                                                                                                                                                                                                                                                                                                                                           |
| D17 | **Windows: WSL only in v1.** Native Windows is deferred until the server has Windows CI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Server support is a shell list only; CI is Linux-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 2. Architecture

```
apps/tui                      apps/web                    apps/desktop
  screens/ (react + opentui)    features/ (react + dom)     bun main process
  host adapters (tty, fs kv,    host adapters (localStorage,
    OSC 52, $EDITOR, signals)     sonner, window, focusin)
        │                             │
        └──────────┬──────────────────┘
                   ▼
        packages/client-core          ← transport, environments, chat projections,
                   │                     command builders/dispatch, derivations,
                   │                     keymap pure pieces, errors, logging seams
                   ▼
        packages/contracts            ← valibot schemas, settings registry, ids
                   │
                   ▼
        apps/server (Elysia)          ← truth: orchestration, fs, git, lsp, terminal,
                                         settings, logs
```

### 2.1 Process model

One TUI process per terminal. It owns one renderer, one keymap session, one focus service, and one
`ChatTransport` per connected environment (one in v1, shaped for many). It never embeds the server
in-process: it attaches to a loopback origin, or launches `apps/server` as a supervised child with
injectable spawn/port/readiness (t1code's supervisor shape), then attaches. A running dev server is
always reused in development.

### 2.2 `packages/client-core`

Entry rule: one barrel at `src/index.ts`; consumers import exact files through subpath exports
(`./transport`, `./environments`, `./chat/state`, `./chat/commands`, `./chat/derive`, `./keymap`,
`./errors`, `./logging`). Dependencies: `@workspace/contracts`, `@workspace/observability` (`./env`),
`@elysia/eden`, `evlog`, `valibot`, `zustand` (vanilla only), `@tanstack/query-core`,
`@tanstack/pacer`, types-only `server/client-contract`. Forbidden: `react`, `sonner`,
`@workspace/ui`, `@workspace/tree`, `@singapor/*`, `lexical`, `@streamdown/*`, `import.meta.env`,
`window`, `document`, `localStorage`.

Host ports the package declares:

```ts
type ClientCoreHost = {
  readonly origin: string
  readonly instanceId?: string
  readonly fetch?: typeof fetch
  readonly createSocket?: (url: string) => WebSocket
  readonly headers?: () => Record<string, string>
  readonly storage: KeyValueStorage | null
  readonly notify?: (level: 'error' | 'warn' | 'info', title: string, description?: string) => void
  readonly wake?: WakeSource
  readonly isOnline?: () => boolean
  readonly onFlush?: (flush: () => void) => () => void
  readonly logging: { runtime: 'browser' | 'tui' | 'desktop'; mode: string; dev: boolean }
}
```

What moves, by target folder, is enumerated in `docs/tui-research/client-core.md` §7.2; what stays
web-only in §7.3. Two rules of the move: `import { create } from 'zustand'` becomes `createStore`
from `zustand/vanilla` with thin `useStore` hooks in web; `@tanstack/react-pacer/debouncer` becomes
`@tanstack/pacer/debouncer`.

### 2.3 Wire facts the TUI must honour

- Orchestration RPC at `/orchestration/rpc`, protocol version 5 (session-domain contract). Handshake
  frame carries `environmentId`, `serverInstanceId`, `protocolVersion`; refuse identity drift; bump
  the generation and invalidate on a new instance id; treat close `1008` as blocked.
- Snapshots over HTTP (`/orchestration/shell-snapshot`, `/orchestration/thread-detail`), streams
  over the socket; `afterSequence` resume, `synchronized` marker flips a "catching up" indicator.
- Commands carry client-minted `commandId`; `deduped` results are success; retry after a drop is
  idempotent.
- Assistant text never rides the shell stream; hold a thread subscription for every thread rendered
  live, ref-counted exactly as `thread-detail-subscriptions` does.
- Hand-roll the three WebSocket URLs with `URLSearchParams` and `new WebSocket(url, { headers })`;
  Eden's socket helper sets no headers and does not URL-encode query values.
- `x-client-instance` on every request so server logs attribute the TUI.
- Terminal input and output use binary frames; controls use JSON text. Feed the raw bytes to
  `EmbeddedTerminal.write`; see the [terminal reference](terminal.md).

## 3. Product shape in the terminal

### 3.1 Screens

| Screen                | Content                                                                                                                                                                                                                    | Enter                                                                                        | Leave                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Root: agent view**  | Rail (projects, sessions with `needs-input / working / settled` sections, terminal-face sessions, machine chips later) + stage (chat, draft, terminal-face session as a full-bleed embedded terminal) + optional tool pane | launch, `workspace.revealChat`, Back from workbench                                          | `workspace.openWorkbench` on a project or worktree row        |
| **Pushed: workbench** | Sidebar tabs (files, git, search, logs, chat) + editor group (viewer, diff, search buffer, settings) + bottom panel (terminal, problems)                                                                                   | `workspace.openWorkbench`, any address with `mode=workbench`, escalation from an inline diff | `workspace.navigateBack` to the exact rail state it came from |
| **Overlays**          | Command palette (all ten modes), settings palette, pickers, confirm/prompt/alert, permission and question prompts (inline, replacing the composer, never modal)                                                            | commands                                                                                     | `Escape`                                                      |

The diff escalation ladder maps directly: inline in the transcript → tool pane → workbench diff tab
with the file focused. Each rung is an address, not a mode switch.

### 3.2 Layout

Yoga flexbox in cells. Breakpoints in columns, not pixels: rail 34 columns, collapses to an overlay
below 100 columns; tool pane hidden below 120 columns; split diff only at ≥ 120 columns; help row
reserved when the shortcut overlay is open. Below 80×24 the app shows one pane at a time and every
toggle command still works. Layout is persisted per project in the file store (D13), never global.

### 3.3 Keyboard policy

- Kitty keyboard protocol on when the terminal supports it (probed); legacy terminals get a reduced
  default table that avoids Ctrl+Shift and Ctrl+punctuation.
- `Mod` = Control everywhere. Ten web defaults that collide with tty controls (`Mod+S`, `Mod+J`,
  `Mod+[`, `Mod+H`, `Mod+D`, `Mod+Z`, `Mod+K Mod+S`, `Mod+Enter`, `Mod+Backspace`) get TUI defaults
  on their command rows; `Ctrl+Z` stays job control.
- Chords keep the web semantics (two strokes, five-second timeout, first stroke must carry Control,
  arming stroke swallowed, pending indicator in the footer).
- Every action is a named command from the shared table; palette rows, footer hints, menus and the
  which-key style overlay are all derived from the same registry. Free letters (`j/k`, `g/G`,
  `space`, `?`) are pane-scoped bindings on the rail, timeline and lists, exactly like the web's
  file-tree bindings.
- Text entry (composer, inputs, viewer search) is the "targets text entry" gate; `firesWhileTyping`
  keeps its web meaning.
- Focus areas are the web's twelve; `Tab` cycles the visible panes; `Escape` walks up (overlay →
  pane → root).

### 3.4 Mouse

Second-class but present: click to focus and select rows, wheel with acceleration, drag-select with
copy-on-release (OSC 52 always, native tool as well), click guards that ignore clicks after a
drag-select. No drag-and-drop; every reorder has a command.

## 4. Surface parity map

Reuse column names modules that move to or already live in `client-core`, `contracts`,
`@singapor/*` or `packages/tree`. Slice numbers are from §10.

| Web surface                                                                                                                                       | TUI shape                                                                                                                                                                   | Reuse                                                                                                                                                                                                                          | Slice    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Session rail, scope menu, archived toggle, search, groups, bulk select, context menus, inline rename                                              | Rail pane; `j/k`, `Enter`, `m` mark, `/` filter, popup menu                                                                                                                 | `session-rail-model`, `session-order`, `session-unread`, `rail-order-commands`, `session-commands`, menu models (icon-free core)                                                                                               | 082      |
| Stage header (project › branch › title, branch actions, status badge, context ring)                                                               | Stage header row; ring becomes `42%` tabular                                                                                                                                | `runtime-state`, `context-usage`, git `branch-remote-state`                                                                                                                                                                    | 082      |
| Timeline (virtualized, markdown, activity groups, folds, changed files, checkpoints, minimap, jump-to-latest)                                     | Windowed list with width-keyed height cache, source-backed cells, `<markdown streaming>` for visible assistant cells, `<code>` for fences                                   | `timeline-items`, `timeline-scroll-anchoring` (rows as unit), `activity-presentation`, `work-log`, `changed-files-presentation`, `turn-diff-tree`                                                                              | 082      |
| Composer (Lexical: `@` mentions, `/` commands, `$` skills, images, terminal-context chips, model picker, access/mode menus, effort, stash, inbox) | OpenTUI `<textarea>` with extmark placeholders for mentions, images, large pastes; autocomplete popup above the anchor; pickers as `DialogSelect`                           | `input-logic`, `composer-tokens`, `composer-command-search`, `model-picker-search`, `provider-model-options`, `resolve-model-selection`, `prompt-stash-store`, `composer-inbox-store`, `chat-input-draft-store` (file storage) | 082      |
| Pending approvals, user-input questions, plan follow-up, runtime alerts, provider sign-in                                                         | Inline prompts replacing the composer; digit shortcuts; typing-idle delay before a new prompt takes keys                                                                    | `pending-approvals`, `pending-user-input`, `proposed-plan`, `provider-auth`, `runtime-state`                                                                                                                                   | 082      |
| Terminal-face sessions (vision)                                                                                                                   | Rail rows; stage renders an embedded terminal running `claude --resume <id>`; attach command for fidelity                                                                   | Plan 068 discovery, `/terminal` contract                                                                                                                                                                                       | 082      |
| Terminal panel (ghostty-webgpu)                                                                                                                   | Embedded terminal pane + attach; per-session terminal id; context menu (Ask the Agent, copy, paste, clear); path links                                                      | `contracts/terminal.ts`, `terminal-context`, `command-inbox-store`                                                                                                                                                             | 081      |
| File tree (packages/tree web component)                                                                                                           | `FileTreeController` + manual window into rows, Nerd Font glyphs, git decorations, inline rename/create, filter                                                             | `packages/tree` model (`PathStore`, `FileTreeController`, `gitStatus`), `getBuiltInFileIconColor`                                                                                                                              | 081      |
| Editor (`@singapor/*` DOM)                                                                                                                        | Read-only viewer (`<code>` + line numbers or shiki tokens), jump-to-line, find, diagnostics list, hover on demand, go-to-definition; `e` opens `$EDITOR` via workspace-edit | `@singapor/core/{document,syntax}`, `@singapor/lsp`, `@singapor/tree-sitter` worker (untested under Bun: spike)                                                                                                                | 081      |
| Diff (split/stacked, region expansion, line comments)                                                                                             | Cell painter over the diff model; `v` toggles view; line-range selection → Ask                                                                                              | `@singapor/diff` model/projection/regions, `editor-diff-files`                                                                                                                                                                 | 081      |
| Git panel (status groups, stage/unstage/discard, commit with AI message stream, push/pull/fetch, PR)                                              | Same groups as a list pane; commit message in a prompt dialog; progress stream in the footer                                                                                | `features/git/utils/api.ts` wrappers, contracts                                                                                                                                                                                | 081      |
| Search (streaming, replace, include/exclude, search editor tab)                                                                                   | Search pane with results grouped by file; replace through the workspace-edit pipeline                                                                                       | `workspace-search-client`, `buffer-query`, `workspace-search-match`                                                                                                                                                            | 081      |
| Problems                                                                                                                                          | Diagnostics list for the active viewer with `Enter` to jump                                                                                                                 | `@singapor/lsp`                                                                                                                                                                                                                | 081      |
| Logs dashboard                                                                                                                                    | Block-glyph histogram, windowed table, `Enter` expands JSON in `<code filetype="json">`, live SSE tail                                                                      | `features/logs/utils/*`, `state/live-*`                                                                                                                                                                                        | 081      |
| Settings page (scopes, search, widgets, keybinding recorder, JSON view)                                                                           | Search-first palette over the registry; one dialog per widget kind; chord recorder over `KeyEvent`; raw JSON in `$EDITOR` with revision check                               | `contracts/settings/*`, `settings/utils/{search,projection,patch,operations,mutation-policy,availability}`                                                                                                                     | 079      |
| Command palette (ten modes)                                                                                                                       | Same prefix grammar, same item builders                                                                                                                                     | `command-palette-utils`, `fuzzy-rank`, recent-commands store (file)                                                                                                                                                            | 079      |
| Address bar / links                                                                                                                               | Accept and emit the same address strings; `workspace.copyAddress` writes OSC 52                                                                                             | `features/address/utils/grammar`                                                                                                                                                                                               | 079      |
| File picker dialog                                                                                                                                | Places, path input with completion, list with preview                                                                                                                       | `/fs/tree`, `/fs/recents`, `/health.homePath`                                                                                                                                                                                  | 079      |
| Workspace root / project switching                                                                                                                | Rail rows and "Add project" prompt                                                                                                                                          | `use-open-root` logic                                                                                                                                                                                                          | 082      |
| Environments (077/078)                                                                                                                            | One transport per origin; machine chips and filter after 078                                                                                                                | `lib/environments` (moved)                                                                                                                                                                                                     | 079, 084 |
| Fonts, wallpaper, vibrancy, minimap, hover prefetch, visible-snapshot cache                                                                       | Not applicable                                                                                                                                                              | —                                                                                                                                                                                                                              | —        |

## 5. Hard problems and their resolutions

### 5.1 Terminal in a terminal

Two options were analysed: an embedded emulator painted into cells, or raw passthrough. The plan
does both. The pane is `EmbeddedTerminal` (libghostty in OpenTUI): host keys are encoded into the
inner terminal's negotiated protocol, inner queries are answered natively, mouse is forwarded when
the inner program asks for it, scrollback is the emulator's and maps to
`terminal.integrated.scrollback`. The attach command suspends the renderer, puts stdin in raw mode,
pipes bytes both ways, forwards `SIGWINCH`, and on the detach prefix resets every mode the inner
program left on (`DECRST 1000-1006/2004`, `CSI ?1049 l`, `CSI < u`) before resuming.

Known hazards: two parsers per byte (fine with damage-only redraw); width disagreements between the
inner emulator and the host on emoji and CJK (the test case); inner images and inner OSC 8 links
cannot be composited in the embedded pane (the attach command is the answer).

Server work this needs is listed in §7. The structural alternative — a server-side emulator that
ships screen snapshots and row deltas so web and TUI are both thin painters — was weighed on
2026-09-05 and recorded as a **reserve**, not scheduled work. What it buys is late-join and
reconnect correctness, one scrollback in one place, and one libghostty build for every front end;
it does not reduce bandwidth or latency. What it costs is a new wire contract (rows, cursor, modes,
image placements, links, per-viewer viewports), a core API to read history rows without moving the
shared viewport (the core has one viewport today), server-side input encoding, selection as a client
overlay, and a rewrite of both painters behind Plan 075's renderer interface. Triggers that reopen
it: remote sessions over Plan 078 whose reconnects garble full-screen programs often enough to hurt;
a need for server-side scrollback search; screen reading for terminal-face sessions. If it is
built, two sub-decisions are already taken: viewers scroll independently through a server history
API, and the most recent resize from any viewer wins.

### 5.2 Editor

`@singapor/core/document`, `/syntax`, folds, history, selections, the shiki tokenizer and the LSP
client are DOM-free; the view (`VirtualizedTextView`, CSS Highlight painter, gutters, widgets) is
not, and no headless view exists. A real cell editor over the shared document model is the honest
"editor port" and is large. v1 ships the viewer plus `$EDITOR` handoff: read through `/fs/read`,
edit in a temp `.md`/native-extension file outside any tool-writable root, commit through
workspace-edit prepare/commit with the `snapshot` precondition so a concurrent agent write is
detected. Package roots import CSS as a side effect; the TUI imports subpath entries only.

### 5.3 Diff

`createTextDiff` / `parseGitPatch`, `annotateInlineChanges`, `createSplitProjection` /
`createStackedProjection` and `createDiffRegionStore` are pure and already produce aligned
`DiffRenderRow`s with inline ranges, hunk rows and expand keys. The TUI paints one row per
`DiffRenderRow`: line numbers, sign, content with inline ranges as styled runs, syntax from the
shiki tokenizer per side, split only at ≥ 120 columns, `…` on horizontal cut. Golden tests across
widths and heights, as crush does.

### 5.4 Long transcripts, resize and reflow

Cells make measurement deterministic: `height(item, width)` is the wrapped line count, cached per
`(item id, version, width)`, frozen for finished items, dropped on width change with a 120 ms
settle and incremental prewarm (crush's list). The web's `timelineScrollReducer` is pure geometry
and keeps `following-end / anchoring-new-turn / free-scrolling` with rows as the unit. Only the
visible window plus overscan is mounted; OpenTUI's viewport culling saves paint, not layout, so a
long thread is never thousands of children in one scrollbox.

Streaming follows Codex's newline-gated stable/tail split with table holdback and a smooth versus
catch-up drain, then consolidates into a source-backed cell so reflow re-renders from markdown.

### 5.5 Images and attachments

`ImageRenderable` with `protocol: "auto"` (kitty, sixel, then a chip `[image name W×H]` with an
open-externally action). Composer attachments come from file paths and clipboard tools
(`wl-paste`, `xclip`, `pbpaste`, PowerShell), never from a canvas compressor; the server's attachment
limits from `contracts/chat-model.ts` still apply. Images cannot appear inside the embedded terminal
pane.

### 5.6 Logs and settings

Both are already data-driven. The logs summary contract carries timeline buckets with
`total/error/warn/slow`; the histogram is a row of `▁▂▃▄▅▆▇█` coloured by error share and the event
list is a windowed fixed-column table. Settings are the registry: search-first, one dialog per
widget kind, scope tabs from `SettingsLayerId`, cross-scope indicator, and no TUI-only key without a
consumer in the same pass. Anything the TUI turns into a binary or a key binding stays
`application` or `machine` scope.

### 5.7 Accessibility and plain mode

Alt-screen apps are opaque to screen readers. The plan ships: `chat.exportTranscript` (markdown to
file or OSC 52), a copy-friendly transcript pager, an animations-off mode registered as a settings
key that the spinner primitives consume (loaders slow down, never freeze), `NO_COLOR` and
`TERM=dumb` handled at boot with a real message, and OSC 9 notifications only while unfocused.

## 6. Reference behaviours copied and refused

Copied, with the report that documents each:

- Transport injection (`fetch`, socket, event source) and a 16 ms event batch flush (opencode).
- Phased bootstrap (`loading → partial → complete`) and a hydration tracker so events received
  during a snapshot fetch win over the stale snapshot (opencode).
- Mode stack for keymap layers, single-slot dialog with promise helpers, one `DialogSelect` for every
  picker, inline permission and question prompts replacing the composer (opencode, crush, codex).
- Extmark-backed rich prompt with placeholder elements for mentions, images and large pastes; paste
  heuristics (path → attachment, big paste → placeholder); submit re-entrancy guard and IME
  double-defer; `$EDITOR` handoff with input-buffer flush on return (opencode, codex).
- Typing-idle delay before an approval prompt takes keys, and discard of queued typeahead (codex).
- Virtualized list with per-item version, frozen finished items, width-keyed cache, resize settle
  and prewarm; tool renderer registry with a uniform header, body and early-state grammar (crush).
- Reconnect ladder with degraded / recovered / stuck status line messages and resync on recover
  (crush); never retry a user operation (codex).
- Theme JSON with `defs` and `{dark, light}` refs, system theme from the terminal palette,
  luminance-based selected foreground, OSC theme-change hook (opencode).
- OSC 52 always plus native clipboard, capability probing gated by terminal identity, notifications
  only while unfocused, strong `CSI < u` reset on exit, synchronized output around every write
  (opencode, crush, codex).
- Exit banner with the resume command (crush, opencode).
- Managed-server supervisor with injectable spawn, port and readiness; headless frame capture as a
  fixture (t1code).
- Golden tests for the diff view across widths and heights; VT-backed tests of terminal output
  (crush, codex).

Refused:

- A single-file application (t1code's 17,407-line `ui.tsx`, opencode's 2,706-line session route,
  crush's 5,205-line model). One component per file, one hook per file, tool renderers one per file.
- Snapshot refetch per domain event and client-side status derivation (t1code; Plan 068 makes status
  server-projected).
- ANSI-stripped text log as a "terminal" (t1code).
- Runtime-downloaded tree-sitter grammars from unpinned branches (t1code). Grammars are bundled with
  `update-assets` or highlighting falls back to shiki tokens.
- Blocking getters on the client contract that force a TTL cache layer (crush).
- SSE without a resume cursor (crush); our streams resume by sequence.
- Inline scrollback insertion with terminal-specific special cases for the main UI (codex).
- A 158-method protocol; the thread → turn → item core plus approvals, list, resume and config is
  the surface (codex).
- `setTimeout(0)` focus and position polling workarounds (opencode, t1code); OpenTUI lifecycle hooks
  and explicit readiness instead.
- Untyped key-value toggles scattered across call sites (opencode); every knob is a registry entry.
- Hard-coded keybindings with no user override and colour literals inside theme layers (crush).
- Legacy shims kept in-tree (opencode's command shim); this project has no back-compat.
- Parsing error message text to recover state (codex); structured error `data` instead.
- A token in `argv` (t1code); the origin allowlist and, later, the SSH forward.

## 7. Server changes the TUI needs

These changes build on the completed [session domain](session-domain.md) and its protocol v5 contracts.

1. **Allowed origin for the TUI.** The launcher (`scripts/runtime-network.ts`, desktop's
   `allowedOriginsForWebPort`) includes the TUI origin string; documented in `docs/settings-reference.md`
   only if it becomes a setting (it should not: it is launcher configuration).
2. **Explicit close codes on `/terminal` and `/lsp`.** Both close with no code on auth failure or an
   invalid root; the TUI cannot tell "unauthorized" from "bad root". Send `1008 'unauthorized'` and
   `1008 'invalid-root'` exactly as the orchestration socket does.
3. **Terminal fan-out to N viewers** (decided 2026-09-05). `TerminalSession` keeps a set of
   connections instead of closing the previous socket; output goes to every viewer, input is accepted
   from any, and the most recent resize wins. This is what lets the same shell be open in web and TUI.
4. **Replay boundary.** The 256 KiB replay is cut at the byte limit and can start mid-escape or
   mid-alt-screen. Cut at a UTF-8 boundary, and after replay send a resize nudge (cols−1, then cols)
   so full-screen programs repaint, as tmux does on attach. Line-mode shells replay correctly as is.
5. **Native PTY transport is available.** The [terminal service](terminal.md) uses `@workspace/pty`,
   and `/terminal` carries binary input and output. Build items 3 and 4 on that socket and feed
   `EmbeddedTerminal.write` bytes directly.
6. **In-process socket factories for tests** for `/terminal` and `/lsp`, mirroring
   `apps/web/test/factories/in-process-orchestration-socket.ts`, with the PTY factory injected.

## 8. Testing and development loop

- Project: `apps/tui` runs a `node` Vitest project under `bun --bun vitest`; happy-dom is never
  needed. Frames are rendered with `createTestRenderer({ width, height, kittyKeyboard })`, driven by
  `mockInput` / `mockMouse`, asserted with `captureCharFrame` snapshots kept small and normalised.
  Markdown cells use `streaming: true` or await `highlightingDone` before asserting.
- Server: the real in-process Elysia app from `server/testing`, one temp workspace per test, two
  servers where environments matter. Sockets: in-process factories for all three routes; no test
  opens a socket to our own server.
- Widgets: "protocol frames in, commands out" harness, injecting a command channel exactly like
  Codex's `CodexOpTarget::Direct`.
- Shared factories that both apps need live next to the code they fake, under
  `packages/client-core/test/`, exported for both apps; `apps/tui` never imports from `apps/web`.
- Dev loop: `bun run dev:tui` attaches to the running dev server (the repo rule) and restarts the
  TUI process under `bun --watch`; alt-screen state is reset on restart by the exit path.
  `--headless-frame <path>` renders one frame at a given size and exits, so agents can look at the
  UI without a tty.
- Golden tests for the diff painter, the rail, the timeline window and the footer collapse rules
  across widths.

## 9. Distribution and remote

- `bun build --compile --target=bun-<os>-<arch>` per target, with every `@opentui/core-*` platform
  package installed before the build; the tree-sitter worker and grammars are embedded through
  `type: "file"` imports. A plain-Node launcher package with platform packages as optional
  dependencies, async spawn, signal forwarding and a `MANAGED_BY` environment marker (Codex's shape).
- v1 targets: linux x64/arm64, darwin x64/arm64. Windows through WSL.
- Attach or launch: `--origin <url>` attaches; otherwise the binary runs the same reserve-port,
  compute-allowed-origins, spawn, probe-`/health` sequence the desktop shell runs, from the compiled
  server build if it exists, else from source under `bun`.
- Remote (decided 2026-09-05): Plan 078's probe, reuse-or-launch and loopback-to-loopback forward
  logic becomes one Bun module that both the desktop shell and the TUI binary call; slice 084 wires
  it into the TUI. Nothing in the TUI binds a server off loopback.

## 10. Sequencing and executable slices

### 10.1 Constraints from the current lane

- **Plan 077** is complete and deleted (commit `c8e05123`); the transport and environment seams
  are stable and can be extracted into `client-core`.
- **Plans 056 and 057** (chord keymap, VS Code keymap) own `keymap/**` until 057 closes; the TUI
  consumes their pure modules and does not edit them while 057 is in delivery.
- The [native PTY and binary transport](terminal.md) are available for slice 081 (§7.5).
- **Plan 068** is complete. New consumers use the [session domain](session-domain.md): raw
  session UUIDs, protocol v5, worktree ownership, and projected attention. Its plan-file deletion
  remains a dependency check; it does not schedule this TUI work.
- **Plan 078** (federation) and **069** (worktrees) are not prerequisites; their TUI surfaces are
  later slices.

### 10.2 Spikes that can start now (scratch only, no repo changes)

Each produces a short feasibility record under `docs/tui-research/` with PASS/FAIL rows, the way the
Ghostty config-resolver proof did.

| Spike                 | Question                                                                                                                                                                                                                                                                                | Pass criterion                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| S1 EmbeddedTerminal   | Does OpenTUI 0.5.x `EmbeddedTerminal` render the `/terminal` stream correctly: chunk-unaligned UTF-8, resize from relayout, kitty negotiation for the inner program, mouse forwarding, alt-screen program (vim, htop), mid-alt-screen replay, headless render under `bun --bun vitest`? | All rows PASS against the running dev server with the synthetic origin |
| S2 Server compile     | Does `apps/server` survive `bun build --compile` (`@parcel/watcher`, native PTY, `bun:sqlite`, `~/.platform`)?                                                                                                                                                                          | A compiled server serves `/health` and one terminal session            |
| S3 Grammar and worker | Do `@singapor/tree-sitter`'s Worker path and the shiki tokenizer run under Bun outside Vitest, and inside the compiled binary?                                                                                                                                                          | Tokens for a TypeScript file from both paths                           |
| S4 Binding audit      | Which of the 142 commands need a TUI default, under kitty and legacy terminals?                                                                                                                                                                                                         | A per-command table checked into the slice 079 plan                    |
| S5 Attach fidelity    | Raw passthrough to a server PTY with detach prefix, mode reset and `SIGWINCH` forwarding                                                                                                                                                                                                | vim and htop usable; renderer resumes clean                            |

S1 and S5 have [native terminal evidence](tui-research/terminal-feasibility.md), including real
Neovim, host resize, detach, and renderer restoration. The older running preview origin and htop
remain unverified. S3 uses the [bundled Shiki implementation](tui-research/viewer-feasibility.md);
the published tree-sitter worker fails under both Bun and standalone compilation.

### 10.3 Executable slices

| Slice                                          | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Prerequisites                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **079 — TUI foundation and client-core**       | `packages/client-core` extraction (transport, environments, errors, logging seams, keymap pure pieces, command palette utils, settings utils); `apps/tui` workspace with OpenTUI + React, renderer bootstrap and shutdown paths, connection (origin, `/health`, handshake, drift), origin registration in the launcher, logging, theme (D12), settings read and search palette, keymap adapter and focus registry, dialog / toast / select / prompt primitives, command palette, address parsing, file store (D13), headless frame flag, test harness, `dev:tui`; server items 7.1, 7.2, 7.6 | 056/057 keymap work closed or its pure modules frozen; S4                                                                            |
| **081 — Workbench surfaces**                   | Embedded terminal pane and attach; file tree; viewer with find, diagnostics, hover, go-to-definition; `$EDITOR` handoff through workspace-edit; diff painter; git panel; search; problems; logs; workbench screen layout and persistence; server items 7.3, 7.4                                                                                                                                                                                                                                                                                                                              | 079, native PTY, S1, S3, S5                                                                                                          |
| **082 — Agent view**                           | Rail, stage, composer, timeline, approvals and questions, plans, model picker, provider sign-in, terminal-face sessions, project add and switch, root ↔ workbench navigation stack, transcript export                                                                                                                                                                                                                                                                                                                                                                                        | 079; the session domain is landed (protocol v5), so chat state and derivations move into `client-core` in 079 or at the start of 082 |
| **083 — Worktree and session creation parity** | "Send to current branch / New worktree" picker, worktree chips, cleanup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 082, 069                                                                                                                             |
| **084 — Distribution and machines**            | Compiled binaries, launcher package, attach-or-launch, machine chips and filter, one transport per machine, SSH forward through the launcher module shared with desktop                                                                                                                                                                                                                                                                                                                                                                                                                      | 082, S2, 078 (shared launcher module)                                                                                                |

Plans 079, 081, and 082 are complete. Plan 080 belongs to platform keybinding modes; TUI follow-ups
start at 083. Numbers are never reused. Each slice follows the executable-plan skeleton
in `plans/077` (status block, drift-check preamble, locks, verified source, outcome, locked design,
scope, git and state policy, phases with narrow verification, done-when, STOP conditions,
maintenance) and registers a row in `plans/README.md`. Root `PLAN.md` schedules them.

## 11. What "everything the web supports" means, honestly

Two surfaces do not translate one-to-one and are decided above rather than hidden:

- **Editing text** happens in `$EDITOR` in v1 (D7). The viewer, diagnostics, navigation, diff and
  save pipeline are all there; the buffer editing is delegated. A cell editor over the shared
  document model is a reserve slice.
- **Layout** is two fixed layouts with breakpoints, not resizable splitters; every pane toggle
  command works, and pane selection and sidebar visibility persist per project.

Everything else — chat, rail, composer with mentions and commands, approvals, plans, model and
provider management, terminal, tree, diff, git, search, problems, logs, settings, palette, address
links, environments — is in scope with a named slice.

## 12. Decisions taken with the operator (2026-09-05)

1. **Q1 Navigation.** The vision's stack: root agent view, workbench pushed per project or worktree
   row, no toggle, no global current project (D3).
2. **Q2 Editor.** Viewer plus `$EDITOR` handoff in v1; a cell editor over `@singapor/core` is a
   reserve slice (D7).
3. **Q3 Sequencing of chat.** Moot: Plans 077 and 068 landed in commit `c8e05123`. Slice 082
   consumes protocol v5 and the session domain directly.
4. **Q4 Terminal.** Fan-out to N viewers now, with a UTF-8-aligned replay and a resize nudge on
   attach, painted with OpenTUI's embedded terminal (D6, §7.3–7.5). The server-side emulator is a
   reserve with named triggers (§5.1); if built, viewers scroll independently through a server
   history API and the most recent resize wins. The native PTY transport is already available.
5. **Q5 Remote.** The TUI may own an `ssh -L` attach; the launcher logic is one module shared with
   the desktop shell (§9).
6. **Q6 Origin.** `platform-tui://local`, registered by the launcher through
   `SERVER_ALLOWED_ORIGINS` (D5, §7.1).
7. **ghostty-webgpu source.** Platform consumes the sibling checkout through a root `link:`
   override, like the editor packages; CI clones, builds and links it with a pinned `GHOSTTY_REF`.
   The published 0.1.0 is behind the checkout.

## 13. Research notes

The deep reads behind this document, each with file and line citations, are kept under
[`docs/tui-research/`](tui-research/). They were taken against the working tree before commit
`c8e05123` (Plans 077 and 068 landing, 454 files), so anchors under `apps/server`, the chat
features and `packages/contracts` have drifted; re-verify a line before citing it in a plan. The
`completeness-critic.md` gaps G1 and G2 are closed by that commit and by §12.

- `server-surface.md` — every route, socket and stream a client must speak; auth; browser assumptions.
- `web-features.md` — the parity checklist: every feature, surface, store, setting and command.
- `keymap-commands.md` — the command table, bindings, chord machine, focus protocol, pure versus DOM.
- `client-core.md` — module-by-module portability of the web client and the proposed package boundary.
- `plans-constraints.md` — invariants from the vision and Plans 077/068/078/069, plan format, mid-flight tree.
- `framework-options.md` — OpenTUI React versus Solid versus Ink versus hand-rolled, with measurements.
- `hard-problems.md` — terminal-in-terminal, editor, diff, tree, images, reflow, logs, settings.
- `opencode-tui.md`, `crush-tui.md`, `t1code-tui.md`, `codex-tui.md` — reference deep reads.
- `completeness-critic.md` — contradictions settled and the eight gaps this document closes.
