# Plan 099 unit 0: baseline and consumer inventory

Research record for [Plan 099](../../plans/099-document-contributions.md) unit 0, taken 2026-09-25.
It covers the inventory, the baseline identity, and the measurements that run without changing
product code. The harness extension the plan puts first in unit 0 is Editor code, so it is listed
under [Not done](#not-done).

Probe scripts and raw output live in `/work/tmp/research/099/`: `scan.ts` (inventory scan) and
`inventory.tsv` (its 296 rows), `publication.ts` and `publication.json`, `head-read.ts`, and
`probe/` (browser probe) with `consumers-baseline.json`.

## Baseline identity

| Item               | Value                                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform           | `origin/main` `9f343825858b10a3b70b86250946e562956fbf13`, clean worktree                                                                                                                                                                                   |
| Editor             | `origin/main` `e2fd299`. The shared checkout `/work/projects/Editor` is at `c23cd306`, clean, 5 commits behind; `git diff c23cd30 origin/main -- packages examples` is empty, so every probe that imports the checkout measures `e2fd299` code             |
| Link resolution    | `packages/editor-*` in Platform are relative symlinks to `../../Editor/packages/*`, which resolves to `/work/projects/Editor`. `apps/web/node_modules/@singapore-editor/*` → `/work/cache/bun/global/node_modules/@singapore-editor/*` → the same checkout |
| What Platform runs | Dev: Editor `src/` through `platform-dev-sources` (`apps/web/vite.config.ts:103`). Build: each package's `dist/`. `packages/editor/dist` was built 18:51, before the 20:19 source commit, so a Platform build today would not match source                 |
| Package versions   | `@singapore-editor/core` 0.1.2, `diff` 0.2.0, `find`/`gutters`/`lsp`/`lsp-plugin`/`minimap`/`react`/`scope-lines`/`tree-sitter`/`tree-sitter-languages` 0.1.1, `decode`/`markdown`/`plugin-ui`/`textbuffer` 0.1.0 (`apps/web/package.json:49`)             |
| Tools              | Bun 1.4.0, Node 26.7.0, Vite 8.0.16, Playwright 1.63.0 (Chromium headless)                                                                                                                                                                                 |
| Hardware           | Intel Core i7-14700K, 31 GB RAM, shared with other agents (runs went through the 3-slot memory wrapper)                                                                                                                                                    |
| Capability flags   | The browser probe records `crossOriginIsolated` and `SharedArrayBuffer` per run. Platform passes no `useSharedBuffers`; E057 (delete the SAB text arm) is proposed and not landed                                                                          |

Platform's enabled contributions for an ordinary file (`features/editor/utils/plugins.ts:35`):
Tree-sitter syntax always, plus Shiki when the selected theme is not a built-in
(`state/syntax-highlighting.ts:47`); line and fold gutters; minimap (default on,
`editor.minimap.enabled`); find; merge conflicts; bracket match; occurrence highlight; document
links; scope lines when guides are on; Markdown preview for Markdown; logging; the language-server
set; unicode highlights; diagnostic peek; decode when requested.

## Measurements

### Publication cost per mutation path

`publication.ts` imports the buffer source headless under Bun, one no-op subscriber, 300 operations
per row after 50 warm-up edits, median and p95 of the call. Document is a repeated 62-character
line.

| Path                               | 64 KiB median / p95 µs | 4 MiB       | 32 MiB        |
| ---------------------------------- | ---------------------- | ----------- | ------------- |
| `applyEdits`, one insert           | 9.4 / 19.5             | 5.4 / 8.4   | 4.7 / 6.5     |
| `applyEdits`, two sparse inserts   | 13.7 / 88.3            | 7.4 / 30.4  | 6.7 / 15.2    |
| `undo`                             | 3.5 / 6.3              | 1.5 / 4.3   | 3.2 / 4.4     |
| `redo`                             | 2.8 / 5.2              | 1.9 / 5.3   | 3.9 / 5.3     |
| `checkoutHistoryState`, root ↔ tip | 211 / 1150             | 2167 / 3597 | 17047 / 20786 |
| `commitPrepared`, text             | 4.8 / 11.0             | 3.1 / 5.9   | 4.5 / 6.1     |
| `commitPrepared`, logical-only     | 1.4 / 3.2              | 0.7 / 1.8   | 0.6 / 1.5     |
| `reverseReceipt`                   | 1.3 / 3.6              | 0.9 / 2.6   | 0.8 / 2.3     |
| `rotateSyncSegment` (no event)     | 0.7 / 1.9              | 0.2 / 2.5   | 0.2 / 2.5     |
| `clearHistory` (one sample)        | 42                     | 13          | 7             |

Every path except history checkout is flat in document size, so publication today does no
size-dependent work. Checkout grows with the size because `checkoutHistoryState`
(`documentSession.ts:911`) turns the move into one replacement with `diffPieceTableSnapshots`, and
the root ↔ tip span covers nearly the whole document. That cost is mutation work, and unit 1 keeps
it visible as a separate timing.

Undo and redo changed text on 200 of their 300 calls; the other 100 were no-ops and are in the
samples, which pulls those two medians down.

### Nested publication and head reads

A listener that commits during dispatch (`publication.ts`, reentrancy block) shows the queue in
`emitChange` (`documentSession.ts:1717`) already delivers revision R to every observer before R+1:

```
A frame=5 head=5 rev=1
B frame=5 head=7 edits=[{"from":4,"to":4,"text":"x"}]
A frame=7 head=7 rev=2
B frame=7 head=7 edits=[{"from":0,"to":0,"text":"NN"}]
```

Observer B receives R's edits while `buffer.getTextSnapshot()` already returns R+1. The published
`DocumentSessionChange` (`documentSession.ts:80`) carries a text snapshot but no revision and no
sync point, so a listener that needs either reads the mutable head. Platform's
`acceptBufferChange` (`features/editor/state/workspace-document-service.ts:1417`) does:
`head-read.ts` replays its logic against a logical-only commit whose listener commits a text edit,
and the text revision is never accepted (`synchronize: localRevision=2, text NOT accepted`, then
`edit: skipped`). No production listener was found that commits during a `synchronize` dispatch,
so this is latent, but it is the failure class unit 1 must close.

### Skipped-edit composition

`changesSinceDocumentSyncPoint` over 1, 10 and 100 skipped edits on a 4 MiB buffer took
0.19, 0.04 and 0.28 ms and returned 1, 10 and 100 edits. At 1,000 it returned `null`: the chain keeps
128 entries (`editor/editChain.ts:47`), and a gap falls back to each consumer's own recovery.

### Source delivery per consumer and view count

`probe/` builds a page against Editor source with Vite and drives it in headless Chromium 153
(Playwright 1.63). One buffer, one or two visible views (640×600 each), each view an `Editor`
with the named consumers registered the way Platform registers them: one shared Tree-sitter
backend and provider with the bundled grammars, one shared Shiki worker owner (a one-rule grammar,
enough to tokenize), minimap per view. It wraps `Worker.prototype.postMessage` and counts
main-to-worker messages and the UTF-16 code units of every string in them. Each phase ends when
the syntax workers pass their idle fences, every view has left `loading`, and no message was
posted for 500 ms. Phases: open; 20 characters typed 30 ms apart; one undo; ten 400 px scrolls.
Fixtures are a four-line TypeScript function repeated 700 and 8,000 times. All 16 rows painted
(`plain` for minimap alone) with no page errors; `crossOriginIsolated` and `SharedArrayBuffer`
were both false, so every text payload was a string. Raw rows: `/work/tmp/research/099/consumers-baseline.json`.

Cells are messages / string code units sent to that consumer's worker. The last column is the
main thread's `TextSnapshot` reads during open, as reads / code units, from the `textSnapshot.read`
diagnostic. A control read of 1,000 units before each run registered as exactly 1 read of 1,000
units. The table is the fourth run; the third, without the read column, matched it within four
messages per cell.

| Fixture (chars)  | Consumer     | Views | Open           | Type 20 chars | Undo       | Scroll     | Open reads         |
| ---------------- | ------------ | ----- | -------------- | ------------- | ---------- | ---------- | ------------------ |
| small (54,600)   | Tree-sitter  | 1     | 6 / 60,034     | 5 / 309       | 3 / 118    | 3 / 91     | 43 / 799           |
| small            | Tree-sitter  | 2     | 10 / 120,055   | 13 / 884      | 5 / 227    | 6 / 214    | 86 / 1,598         |
| small            | Shiki        | 1     | 5 / 54,961     | 3 / 317       | 2 / 153    | 1 / 9      | 44 / 55,399        |
| small            | Shiki        | 2     | 7 / 109,812    | 5 / 625       | 3 / 297    | 1 / 9      | 88 / 110,798       |
| small            | minimap      | 1     | 13 / 52,069    | 10 / 180      | 5 / 64     | 20 / 200   | 2,845 / 52,599     |
| small            | minimap      | 2     | 26 / 104,138   | 20 / 360      | 10 / 128   | 40 / 400   | 5,690 / 105,198    |
| small            | Platform set | 1     | 22 / 167,125   | 18 / 804      | 11 / 347   | 26 / 312   | 2,846 / 107,199    |
| small            | Platform set | 2     | 40 / 334,136   | 39 / 1,820    | 20 / 676   | 50 / 606   | 5,692 / 214,398    |
| medium (624,000) | Tree-sitter  | 1     | 11 / 630,371   | 5 / 863       | 8 / 600    | 11 / 419   | 43 / 799           |
| medium           | Tree-sitter  | 2     | 18 / 1,260,711 | 15 / 4,432    | 15 / 1,191 | 21 / 829   | 86 / 1,598         |
| medium           | Shiki        | 1     | 5 / 624,361    | 3 / 317       | 2 / 153    | 1 / 9      | 44 / 624,799       |
| medium           | Shiki        | 2     | 7 / 1,248,612  | 5 / 625       | 3 / 297    | 1 / 9      | 88 / 1,249,598     |
| medium           | minimap      | 1     | 13 / 592,269   | 13 / 242      | 5 / 64     | 20 / 200   | 32,045 / 592,799   |
| medium           | minimap      | 2     | 26 / 1,184,538 | 23 / 422      | 10 / 128   | 40 / 400   | 64,090 / 1,185,598 |
| medium           | Platform set | 1     | 27 / 1,847,059 | 22 / 1,431    | 11 / 624   | 41 / 892   | 32,046 / 1,216,799 |
| medium           | Platform set | 2     | 58 / 3,694,072 | 43 / 5,506    | 20 / 1,230 | 82 / 1,778 | 64,092 / 2,433,598 |

"Platform set" is Tree-sitter, Shiki and minimap together, Platform's configuration under a
non-built-in theme.

- **Each consumer takes the whole document once per view.** Opening a second view on the same
  buffer doubles every consumer's open payload: Tree-sitter 630,371 → 1,260,711 units, Shiki
  624,361 → 1,248,612, minimap 592,269 → 1,184,538. Tree-sitter and Shiki run one worker for both
  views and still hold two mirrors, one per `runtimeSessionId`; minimap starts a second worker. The
  Platform set sends about three times the document for one view and six times for two.
- **A peer view does not coalesce typing.** For 20 keystrokes Tree-sitter got 5 messages from one
  view and 15 from two. `shouldDeferSecondarySessionWork` (`Editor.ts:4399`) defers syntax only for
  the input timing names of the view that took the input; the peer receives
  `editor.bufferChange` and refreshes on every keystroke. Typing payloads stay small (hundreds to
  a few thousand units), so the added cost is in message and parse count.
- **Scrolling sends no document text.** Scroll phases carry Tree-sitter `queryRange` requests and
  minimap viewport updates, under 2,000 units in every row.
- **Main-thread reads at open differ per consumer.** Shiki materializes the whole text once per
  view (`materializeFullText`, 624,000 units). Minimap reads the whole document line by line:
  32,045 reads and 592,799 units for one view on the medium file without materializing it, the
  pattern [E031](../../../Editor/docs/performance/e031-projection.md) warns a full-read counter
  hides. Tree-sitter shows 43 reads because it builds chunks from the piece table's buffers
  (`treeSitter/source.ts:172`), below the `TextSnapshot` counter; its cost appears only in the
  message column. Typing costs the view about 900 reads and 16,000 units per 20 keystrokes in
  every configuration, doubled with two views.
- A first attempt with a 1.7 MB fixture was killed at the 7 GB memory cap during the two-view
  Tree-sitter row; the one-view row completed. It was not investigated and the fixture was
  reduced to 624,000 characters.

## Inventory

`scan.ts` runs seven patterns over non-test sources in all Editor packages and examples and in
Platform `apps/*` and the non-linked `packages/*`: buffer publishers, raw buffer subscriptions,
provider session creation, worker document messages, source materialization and range reads, sync
cursors, and private cross-package imports. Every hit is classified below. Range reads in
synchronous view code (`readRange` over a line, a word, a selection) are listed by package, not
line by line; `inventory.tsv` has every line.

### Core mutation: the ten publishers

All in `PieceTableEditorTextBuffer` (`packages/editor/src/documentSession.ts:567`).

| Method (line)                   | Revision | Edit chain                     | Event kind    | Origin   | Platform caller                                           |
| ------------------------------- | -------- | ------------------------------ | ------------- | -------- | --------------------------------------------------------- |
| `commitEdit` (1579)             | +1       | edits                          | `edit`        | view     | typing, paste, IME, delete, indent, `applyEdits`          |
| `undo` (778) / `redo` (811)     | +1       | inverse / forward edits        | `undo`/`redo` | view     | editor commands                                           |
| `checkoutHistoryState` (911)    | +1       | one diffed replacement         | `checkout`    | view     | `history-mutations.ts:11`                                 |
| `clearHistory` (962)            | none     | none                           | `checkout`    | view     | `history-mutations.ts:20`                                 |
| `restoreHistory` (982)          | none     | none                           | `checkout`    | external | `history-persistence.ts:133`                              |
| `commitPrepared` (1111), text   | +1       | prepared edits, scope, count   | `edit`        | external | WorkspaceEdit segments (`workspace-edit-service.ts:2881`) |
| `commitLogicalOnly` (1372)      | +1       | no edits, `textChanged: false` | `synchronize` | external | same, when a segment has no text change                   |
| `reverseReceipt` (1171)         | +1       | inverse edits                  | `edit`        | external | compensation (`workspace-edit-service.ts:3066`, `:3411`)  |
| `reverseSequenceSegment` (1240) | +1       | inverse edits                  | `edit`        | external | multi-segment compensation                                |
| `rotateSyncSegment` (1350)      | none     | new segment                    | no event      | —        | `workspace-edit-service.ts:2991`                          |

Eight of them repeat the same block: replace `textSnapshot`, bump `revision`, `editChain.record`,
`createChange`, `acceptBufferSelections`, `emitChange`. `completeReverseSequence`, `sealReceipt`,
`releaseReceipt` and lease changes publish nothing through this channel (leases use their own
`leaseChanges` source). `StaticDocumentSession` (`:2003`) never publishes.

Platform replaces a document by creating a new buffer, not by publishing a replacement:
`resetDocumentText` (`workspace-document-service.ts:983`) and four other `createHistoryBuffer`
sites build a fresh buffer and rebind views. Editor's `setText` path is `applyEdits` with
`history: 'skip'` (`editor/Editor.ts:1482`), which publishes an ordinary `edit`. No "reset
boundary" publication exists today.

### Per-view dispatch: where secondary consumers are fed

Each `Editor` subscribes to the buffer (`Editor.ts:3284`) and runs the fan-out for its own view:
`handleBufferChange` (3292) → `flushViewOperation` (3984) → per change
`scheduleSecondarySessionChangeWork` (4344: `refreshSyntax` and feature/decoration
`handleEditorChange`, deferred under rapid input), then `onChange`, view contributions
(`notify`, 3634) and `notifyChangeWithTiming`. The syntax controller is per view
(`Editor.ts:562`) and owns two dispatch cursors, `structuralDispatchPoint` and
`highlightDispatchPoint` (`editor/syntaxController.ts:201`), composed by `composeSkippedChanges`
(2245). So N views on one buffer run N syntax pipelines.

### Classification

| Class                   | Occurrences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core mutation           | The ten publishers above; `emitChange` (1717); `DocumentEditChain` (`editChain.ts:57`); `changesSinceDocumentSyncPoint`/`getDocumentSyncPoint` (860–868); `diffPieceTableSnapshots` in checkout (930) and prepared reversal (2599); `historySerialization.ts:124`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Document contribution   | Tree-sitter session (`tree-sitter/src/session.ts:56`, own `runtimeSessionId` per session at :80, piece-table diff fallback :569); Shiki client (`shiki/workerClient.ts`: own `snapshot` baseline, full-text `open` :397, diff fallback :534); syntax controller cursors (above); LSP document (`lsp-plugin/src/document.ts:92`, buffer subscription :98, per-lane `syncPoint` in `documentSync.ts:54`, compose :380); live diff overlay (`diff/src/editorDiffPlugin.ts:422`, full text + whole-document diff per rebuild :480); merge conflicts (`mergeConflictPlugin.ts:159`, own `parsedPoint`); find's `elsewhereSyncPoint` (`find/src/plugin.ts:413`)                                                                                                                                                                                                                                                                                                                 |
| View presentation       | Minimap (`minimap/src/plugin.ts:99`: a `MinimapWorkerClient` and worker per view, `workerClient.ts:250`; own `workerDocumentState` baseline :235; clipped `readRange` :1072); history viewer (`historyViewer.ts:137`); view snapshot serialization (`viewSnapshot.ts:125`, allowlisted full read); React `createFullTextSelector` (`react/src/index.tsx:1095`) and Solid `readWholeRevision` (`solid/src/index.ts:204`), both allowlisted; `fixedRowVirtualizer` and `inputSelectionController` `emitChange`/`notifyChangeWithTiming` (view events, not buffer publishers); synchronous range reads in `editor/src/editor/*` (occurrences, folds, ghost text, line map, row window, token projection, text cursor, selection ranges, navigation targets, edit actions), `find/`, `scope-lines/`, `markdown/`, `plugin-ui/`, bracket match, document links; Platform `unicode-hover-plugin.ts:48`, `utils/text-snapshot.ts:26`, `search/utils/result-syntax-plugin.ts:192` |
| Domain adapter          | Tree-sitter worker client (`treeSitter/workerClient.ts`: `parse`/`edit`/`queryRange`/`disposeDocument`), source descriptors and chunk retention (`source.ts`, `sourceChunkRetention.ts`); Shiki worker protocol (`workerTypes.ts:35`); minimap worker protocol (`types.ts:177`); LSP client (`lsp/src/client.ts:203`–`240`, full read for `didOpen`/full sync :572, `positions.ts:306`); semantic token layer (`semanticTokenLayer.ts:194`, own 128-entry point map); `lsp-plugin` range reads (formatting, code actions, completion, rename, source text); `workspaceTextEdits.ts` (prepared transactions from LSP edits); browser TypeScript LSP (`typescript-lsp/`, used only by `examples/app`); Platform server LSP (`apps/server/src/lsp/proxy-session.ts:955`, `lsp/typescript/session.ts:148`); Platform `semantic-token-controller.ts:760`                                                                                                                       |
| Headless or prepared    | `editor/preparedDocument.ts:375`, `:420` (prepared highlighter and structural sessions); `diff/src/diffSyntax.ts:173`, `:327`, `:347`; `editor/snippetTokensFeature.ts:83`, `:101` (hover and snippet code); Platform `utils/prepared-document.ts:57` (file-open preparer); Platform `search/state/result-syntax-cache.ts:77` (Tree-sitter session per search excerpt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Host transaction policy | Platform `workspace-document-service.ts:1392` (dirty and content revision tracking), `workspace-edit-service.ts:2990` (segment rotation), `use-editor-visible-snapshot.ts:133` (snapshot cache invalidation), `file-sync-service.ts:217` (save), settings `sync-service.ts:117` and `raw-conflict-banner.tsx:27`, `conflict-editor-resolution.ts:103`, `event-conflict-adapter.ts:319`, `use-events.ts:743`, `search/state/dirty-documents.ts:19` (dirty text for server search), `editor-surface-tab-body.tsx:166` (conflict resolution through the view `onChange`)                                                                                                                                                                                                                                                                                                                                                                                                     |

Resolved at first sight unclassified:

- **Platform document symbols** (`lib/document-symbols.ts:181`, callers `command-palette/hooks/use-symbols.ts:58`
  and `workbench/hooks/use-document-symbol-tree.ts:35`): a dirty document is materialized and sent
  as `didOpen` version 1 over a separate socket, outside the retained language-server lane. It is
  an external-LSP source path the plan does not list; it belongs to unit 4.
- **Platform saved-state diffs** (`compare-saved-view.tsx:48`, `use-diff-language-context.ts:27`,
  `utils/history-compare.ts:26`, which reads the piece table through
  `materializePieceTableFullText` from `@singapore-editor/textbuffer`): whole-text diff consumers.
  They sit with the diff/headless callers in units 2 and 5.
- **Platform demo `orchestration.ts:85`** and **`demo-entry.ts:60`**: agent sessions and iframe
  messages, not document consumers.
- **`apps/tui/src/viewer/state/lsp.ts:103`**: the terminal viewer's own LSP client over its own
  text. It has no Editor buffer and is outside this plan.

Private imports: no package outside `packages/editor` imports `@singapore-editor/textbuffer/internal/*`
(36 files inside core do). Piece-tree types are used outside core by `tree-sitter/src` (session,
source descriptors, chunk retention, structural selection, worker client),
`lsp-plugin/src/workspaceTextEdits.ts` and `diff/src/diffSyntax.ts`. `examples/stress` imports
`dist/` files directly in its reclamation scripts; those are benchmarks.

### Deletion list for later units

Generic source bookkeeping each consumer owns today, which the runtime replaces:

| Unit | Delete or move                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | Syntax controller dispatch cursors and `composeSkippedChanges`; per-view syntax session creation for a shared buffer                                                                         |
| 2    | Tree-sitter per-session `runtimeSessionId` source mirror, piece descriptors from piece-table internals, `diffPieceTableSnapshots` fallback in `session.ts`; chunk retention keyed by session |
| 2    | Shiki client `snapshot` baseline, `pieceTableSnapshotsHaveSameText` check and `diffPieceTableSnapshots` fallback                                                                             |
| 2    | SAB text arm, if E057 has not landed first                                                                                                                                                   |
| 2    | Direct `createSession` callers: prepared document, diff syntax, snippet tokens, Platform file-open preparer and search excerpt cache                                                         |
| 3    | Minimap `workerDocumentState` baseline and per-view worker ownership for one document                                                                                                        |
| 4    | LSP document buffer subscription and per-lane sync points; Platform document-symbols `didOpen` path                                                                                          |
| 5    | Find, merge conflict and semantic-token private sync points, if they still need generic progress after unit 4; live diff full rebuild                                                        |

### Anchor drift since the plan's inspected baseline

| Plan anchor                         | Now                                                  |
| ----------------------------------- | ---------------------------------------------------- |
| `documentSession.ts` ~488, ~1320    | class at 567, `emitChange` at 1717                   |
| `documentTextSnapshot.ts:20`        | `TextSnapshot` at 46                                 |
| `editChain.ts:103`                  | `DocumentEditChain` at 57                            |
| `plugins.ts:618`, `:950`            | view contribution at 669, plugin context at 995      |
| `secondaryViews.ts:70`              | unchanged, `EditorSecondaryViewTextProjection` at 70 |
| Shiki `workerClient.ts:394`, `:465` | `refresh` 380, `applyChange` 414, fallback 534       |
| minimap `workerClient.ts:210`       | `MinimapWorkerClient` 211                            |
| `documentSync.ts:45`, `:388`        | `syncPoint` 54, `changesSinceLastSync` 380           |

## Not done

- **Harness extension.** The plan puts consumer configurations, readiness assertions and frozen
  fixture files into `examples/stress` before any baseline. That is Editor code, which this research
  pass may not change.
- **Calibrated controls.** Three unchanged `bench:input` controls, a holdout and the 20 ms negative
  control need the extended harness to cover consumer configurations, and at about three slots
  shared across agents the existing matrix alone would hold one slot for a long time. No new
  control was recorded.
- **Worker and WASM memory.** The browser probe counts messages and payload units, not heaps.
- **Time to visible syntax.** The probe settles on idle fences; it does not time paint.
