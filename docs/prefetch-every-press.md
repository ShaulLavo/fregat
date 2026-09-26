# Prefetch every press: findings

Research for [Plan 177](../plans/177-prefetch-every-press.md), 2026-09-26, read from Platform
`c130dd35a` and Editor `74e76be`. Paths are under `apps/web/src/` unless they start with
`packages/`, `apps/server/` or `Editor/`.

## How it was measured

- **Browser.** A probe scenario (not committed; kept at
  `/work/tmp/research2/177/prefetch-first-paint.ts` and `prefetch-chat-switch.ts`) on a throwaway
  server and a fixture repository holding copies of real plans and source files. A capture-phase
  `pointerdown`/`keydown` listener stamps the press. A `requestAnimationFrame` sampler then records,
  per frame, whether the target's own view is on screen (found by a marker line in the file), how
  many `editor-shared-token-*` highlights have a range inside that view, and whether a row carries
  an `editor-inline-*` class (markdown live preview). Chrome headless, dev build, Vite from the
  research worktree on 5222 because the shared dev server was down. Four runs; the first run after
  a Vite start pays module compilation and is dropped. Evidence:
  `/work/tmp/fregat-evidence/20260926T095158Z`, `…T095302Z` and `…T095427Z-scenario-prefetch-first-paint/`,
  `20260926T095536Z-scenario-prefetch-chat-switch/`, `20260926T095637Z-trace-prefetch-chat-switch/`.
- **Production logs.** `/work/platform-production/logs/2026-09-20 … 26`, client events only, with
  `durationMs` percentiles and an `editor.file_open_intent` breakdown (scripts:
  `/work/tmp/research2/177/logstats.ts`, `intents.ts`).

## First paint per press (browser, ms from press, runs 2–4)

"Text" is the first frame the target's rows are on screen; "colour" is the first frame with a
syntax token inside them; "preview" is the first markdown live-preview row.

| Press                                         | Text    | Colour  | Preview | Uncoloured gap |
| --------------------------------------------- | ------- | ------- | ------- | -------------- |
| Quick open, TypeScript, first of its language | 105–117 | 270–281 | —       | ~165           |
| Quick open, TypeScript, warm                  | 75–102  | 138–145 | —       | ~50            |
| Quick open, markdown, first of its language   | 85–101  | 163–204 | 146–174 | ~90            |
| Quick open, markdown, warm                    | 76–90   | 90–127  | 76–127  | ~25            |
| Keyboard next tab, no pointer anywhere        | 41–53   | 97–120  | 97      | ~55            |
| File tree, click with no dwell                | 71–74   | 101–102 | 71–101  | ~30            |
| File tree, 1.5 s hover, markdown              | 40–44   | same    | same    | 0              |
| File tree, 1.5 s hover, TypeScript            | 60–67   | same    | —       | 0              |
| File tree, 7 s hover, markdown                | 56–130  | same    | same    | 0 (see below)  |
| Git diff, markdown, first open                | 94–99   | 157–187 | —       | ~75            |
| Git diff, TypeScript (2,000 lines), first     | 82–87   | 310–333 | —       | ~230           |
| Git diff, markdown, second visit              | 59–63   | 128–134 | —       | ~70            |
| Git diff, TypeScript, second visit            | 60–61   | 302–316 | —       | ~245           |
| Chat session, first visit after reload        | 77–116  | —       | —       | —              |
| Chat session, revisit                         | 68–135  | —       | —       | —              |
| Chat session, first visit after 1.5 s hover   | 82–89   | —       | —       | —              |

What the table says:

- **A prepared open is the only press that paints coloured on its first frame.** Every other file
  press paints plain text first. The gap is widest on the first file of a language (worker and
  grammar cold, [Plan 170](../plans/170-language-census.md)'s territory) and on large diffs.
- **Diffs pay the whole parse again on every visit.** The second visit of the same diff is as late
  to colour as the first (302–316 ms for the TypeScript diff). Tokens die with the view.
- **Diffs cost two round trips before text.** `fetchQuery(gitKeys.diff)` in `state/navigation.ts:673`
  then `useQuery(gitKeys.blobDiff)` after mount (`features/git/hooks/use-diff-document-diffs.ts:27`).
  The first answer is never seeded into the second key. Production p50 is 39 ms + 45 ms.
- **The 7 s hover survived by accident.** Its first preparation went `stale` at claim time after
  10 s; Foresight's `reactivateAfter` (5 s) fired again while the pointer rested and a second
  preparation won (`editor.file_open_intent` in the run log: `stale` lead 10 051 ms, then
  `promoted` lead 2 392 ms). A pointer that moves away and comes back after 5 s gets no second
  chance.
- **Chat switching is render-bound, not fetch-bound.** First visit and revisit take the same time,
  and the Chrome trace shows 66–150 ms of main-thread script in the 200 ms after each press
  (`/work/tmp/research2/177/trace-press.ts`). A small session's detail arrives in one socket
  message; hovering 1.5 s first changed nothing. Large sessions (production has 143-activity
  sessions) may differ, and no log field records it (see Observability).

## Production logs (2026-09-20 to 26, client round trips)

| Event                               | n     | p50 ms | p90 ms |
| ----------------------------------- | ----- | ------ | ------ |
| `fs.read`                           | 1 828 | 15.5   | 96.3   |
| `git.diff` (first diff request)     | 75    | 38.9   | 80.7   |
| `git.diff_blob` (second request)    | 463   | 45.0   | 116.2  |
| `git.history_commit`                | 22    | 36.0   | 106.1  |
| `chat.session_detail_snapshot.http` | 24    | 70.9   | 148.8  |
| `chat.checkpoint_diff.http`         | 48    | 53.2   | 139.7  |
| `fs.quick_open_files`               | 138   | 64.6   | 169.2  |
| `search.query`                      | 159   | 190.1  | 368.4  |
| `fs.tree`                           | 498   | 31.9   | 105.0  |

All of it is the local machine; the logs hold no remote-machine reads.

### The file prefetch, as it performs

1 239 `editor.file_open_intent` events:

| Outcome                                 | Count | Share |
| --------------------------------------- | ----- | ----- |
| `promoted` (a click claimed it)         | 142   | 11 %  |
| `evicted: memory-budget` (8-record cap) | 504   | 41 %  |
| `evicted: idle-ttl` (30 s)              | 355   | 29 %  |
| `stale: source-state-changed`           | 95    | 8 %   |
| `already-active` / `-mounted`           | 83    | 7 %   |
| other (aborted, rejected, invalidated)  | 60    | 5 %   |

- **Stale claims lose as many opens as the prefetch wins.** The 95 `stale` records were hovered
  and then clicked, with a lead of p10 5.3 s and p50 7.9 s: the 5 s freshness rule
  (`cleanFileMatchesFreshQuery`, `lib/file-open-intent/state/service.ts:1426`) threw them away.
  Fixing it raises the hit count by up to two thirds.
- **The memory budget is a count, not bytes.** Evictions by budget happen at 8 records; the mean
  prepared record is ~160 KB, far from 32 MB. A pointer sweeping the tree fills eight slots in a
  second.
- **Waste.** The 1 097 preparations nobody claimed read 26.9 MB of files and spent 76.7 s of
  worker stage time (Shiki plus tree-sitter) over seven days. The 142 hits cost 9.8 s.
- **When a claim lands, its stages have run.** 122 of 142 claims found both stages settled; 8 found
  a stage still running and painted plain, then coloured.
- Promoted lead time is p50 762 ms, p90 4.5 s. Paint after a promoted claim: text p50 39 ms,
  highlight p50 42 ms.
- Stage cost by language, p50/p90 ms: markdown Shiki 47/101, tree-sitter 23/64; TypeScript Shiki
  37/82, tree-sitter 4/16. (The plan's earlier 257 ms / 191 ms markdown means came from n=8.)

## Inventory: every press that starts an async load

"Predictor" is what already knows the target before the press.

### Files

| Surface                            | Press path                                                                                                      | Prefetched today                                 | Predictor                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| File tree row                      | `features/workspace/components/tree-pane.tsx:416` → `selectFile`                                                | Yes: Foresight → `prepare({source:'file-tree'})` | Pointer trajectory. Arrow-key focus (`packages/tree/src/hooks/useFileTreeKeyboard.ts:273`) prepares nothing |
| Inactive editor tab, mouse         | `features/workbench/components/editor-tab-button.tsx:70`                                                        | Yes: `use-tab-intent-prefetch.ts`                | Pointer trajectory                                                                                          |
| Editor tab, keyboard               | `keymap/workspace-commands.ts:601` (next/prev), `:583` (Nth), `:902` (previous editor), `:1016` (reopen closed) | No                                               | The adjacent, Nth and previous targets are known before the key                                             |
| Restored active tab at boot        | `features/editor/state/apply-actions.ts:274`                                                                    | No                                               | The address names it; not a press (the paint snapshot covers it, see below)                                 |
| LSP go-to-definition               | `features/editor/hooks/use-lsp-plugin.ts:91`                                                                    | Yes: on Ctrl-hover link                          | Ctrl-hover                                                                                                  |
| Quick open file row                | `features/command-palette/components/content.tsx:294`                                                           | No                                               | cmdk active value, already tracked (`content.tsx:238`, `hooks/use-files.ts:35`)                             |
| Palette `edt ` open editors        | `content.tsx:288`                                                                                               | No                                               | cmdk active value                                                                                           |
| Sidebar search result              | `features/search/components/results-view.tsx:80` → `features/search/utils/open-match.ts:5`                      | No                                               | `activeResultId` (`useListbox`)                                                                             |
| Search editor tab result           | `features/search/utils/result-editor-keyboard.ts:63`, `components/result-file-editor.tsx:195`                   | Excerpts only (result pool); the target file no  | `activeResultId`; per-line hover already tracked (`result-editor-surface.tsx:177`)                          |
| Problems row                       | `features/workbench/components/diagnostics-panel.tsx:73`                                                        | No                                               | Keyboard active row (`moveTo`, `:66`); hover                                                                |
| References row                     | `features/editor/components/reference-row.tsx:30`                                                               | No (hover previews in the current editor only)   | Hover and keyboard row already wired                                                                        |
| Breadcrumb folder row              | `features/workbench/components/breadcrumb-folder-picker.tsx:58`                                                 | No                                               | `useListbox` active row                                                                                     |
| Chat file links, stack-frame links | `features/chat/hooks/use-open-file-reference.ts:22`                                                             | No                                               | Hover                                                                                                       |

All of them end in `createEditorActivation.activate` (`features/editor/state/apply-actions.ts:589`),
which tries `claimLive`, then `claimReadyClean`. One preparer serves them all.

### Diffs

| Surface                               | Press path                                                                                     | What loads                                                                                                                                                                                  | Prefetched | Predictor                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------ |
| Git changes row (click, Enter, Space) | `features/git/components/git-file-row.tsx:76` → `features/git/hooks/use-open-diff-document.ts` | `gitKeys.diff` (stale 1 s), then `gitKeys.blobDiff(ids)` (stale ∞), then both sides parsed                                                                                                  | No         | Hover; `useListbox` active row (`changes-list.tsx:82`) |
| "Open all diffs"                      | `features/git/components/group-actions.tsx:100`                                                | The same, per row, one after another                                                                                                                                                        | No         | —                                                      |
| History commit row                    | `features/git/components/history-list.tsx:36` (arrow keys open too)                            | `historyKeys.commit(path, sha)` (stale ∞), a request per cursor move with no debounce                                                                                                       | No         | The cursor's neighbours                                |
| Commit file row                       | `features/git/components/commit-details.tsx:183` → `use-open-historical-diff.ts:10`            | `gitKeys.blobDiff` from ids the row already holds, then parse                                                                                                                               | No         | Local active row; hover                                |
| Checkpoint turn file (chat git pane)  | `features/chat-mode/components/turn-files.tsx:85` → `use-open-checkpoint-diff-document.ts:33`  | `gitKeys.checkpointDiff({ignoreWhitespace:true})`: a guaranteed miss, because the pane holds the same turn under `ignoreWhitespace:false` (`checkpoint-hunks.ts:26`); then blob, then parse | No         | Local active row                                       |
| Changed-files card in the timeline    | `features/chat/components/assistant-changed-files-section.tsx:119,134,158,185`                 | Turn diff or `/full-session-diff`, then diff tab                                                                                                                                            | No         | Hover                                                  |
| Open file at HEAD                     | `keymap/workspace-commands.ts:985`                                                             | `gitKeys.file` → `/git/file`                                                                                                                                                                | No         | — (command)                                            |

Remount per visit: only the selected tab renders (`features/workbench/components/editor-group.tsx:82`);
`DiffSyntaxController.setFile` drops its per-side token streams
(`Editor/packages/diff/src/diffSyntax.ts:93`), and disposing the tree-sitter session drops the
worker's document cache. `TabPresentation` keeps rows, scroll and the `DiffFile`, no tokens.

### Chats

| Surface                            | Press path                                                                        | What loads                                                                                                                                            | Prefetched | Predictor                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Rail session row (click, Mod+1..9) | `features/chat-mode/state/session-commands.ts:40` → `state/navigation-chat.ts:38` | Always `POST /fs/workspace-address` (uncached); a shell snapshot if the session is unknown; then `retainSessionDetail` → socket snapshot; then render | No         | Hover. Arrow keys open at once, so the cursor is the press |
| Palette session row                | `features/command-palette/components/session-palette-row.tsx:28`                  | The same                                                                                                                                              | No         | cmdk active value                                          |
| Sidebar chat history item          | `features/chat/components/chat-panel-header.tsx:103`                              | Address change, then retain → subscribe                                                                                                               | No         | Menu highlight                                             |
| Toast "Open session"               | `features/chat-mode/state/notification-host.ts:117`                               | The full `openChat`                                                                                                                                   | No         | The toast names the session when it shows                  |
| New session                        | `features/chat-mode/state/session-commands.ts:65`                                 | `POST /fs/workspace-address`, provider list (usually warm)                                                                                            | No         | Hover                                                      |

Retention already exists: a retained detail subscription lives 15 min idle, 32 entries LRU
(`packages/client-core/src/chat/cache-constants.ts:6-7`). `SIDEBAR_SESSION_DETAIL_PREWARM_LIMIT = 10`
(`:8`) has no reader.

### Everything else

- **Settings page, terminal panel chunk**: already prefetched at idle (`main.tsx:130-137`).
- **Theme, wallpaper, palette, bundle, font, code-theme pickers**: the highlighted row already
  previews (`HighlightReporter`, `onItemHighlighted`).
- **File picker folders**: Foresight plus the active row, capped at four (Plan 175 Phase 6).
- **Workspace switcher menu**: armed on trigger hover or focus; the chosen root's
  `POST /fs/workspace-address` runs again uncached on select (`state/navigation.ts:295`).
- **Composer popovers** (tasks, MCP, hooks, usage), **branch picker**, **logs panel** (stale 1 s),
  **new terminal** (Ghostty wasm, checkout registration): load on open; hover on the trigger
  predicts them. Each is one small request; none was measured above 200 ms p90 in the logs.
- **Palette `@` symbols**: each fetch opens a fresh LSP socket and an initialize handshake
  (`lib/document-symbols.ts:88-100`).

### Found along the way

- **Symbol query key collision (read, not reproduced).** Palette `@` mode and the breadcrumbs cache
  different shapes under one key, `documentSymbolKeys.document(root, path, "server:rev")`: a flat
  `FlatDocumentSymbol[]` (`features/command-palette/hooks/use-symbols.ts:64`) and a nested
  `DocumentSymbol[]` (`features/workbench/hooks/use-document-symbol-tree.ts:40`).
- **`editor.command.select_file` logs `requestedContent` as `[circular]`**, so no log can count
  file opens that had no prefetch.
- **No log records a chat switch's time to first snapshot.**
  `chat.session_detail_subscription.summary` has counts and errors, no latency; the server's
  `chat.pipeline.session_stream.start` has no timing either.

## Foresight as configured

`js.foresight` 4.2.1. Global: `enableScrollPrediction: false` (Plan 175); everything else is the
library default: trajectory 120 ms, 8-point history, Tab-key prediction with `tabOffset` 2, touch
strategy `onTouchStart`. Hit slop 8 px on the three registrations. `reactivateAfter` is 5 s for
tabs and tree rows (`FILE_SNAPSHOT_STALE_MS`), 10 s for picker rows.
