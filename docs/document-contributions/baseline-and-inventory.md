# Plan 099 unit 0: baseline and consumer inventory

Research record for [Plan 099](../../plans/099-document-contributions.md) unit 0, taken 2026-09-25.
Current canonical sources, publication proof and remaining acceptance limits are recorded in
[the 2026-09-30 foundations closeout](foundations-publication-proof.md).
This historical record covers the inventory, baseline identity and measurements from the research
pass. Its [Not done](#not-done) section describes that checkpoint, not the current harness.

Closeout, 2026-10-01: unit 0 is partial, **5/10 configurations calibrated** at instrument `56c8e77fb`.
The harness is delivered; `native`, `disabled`, `tree-sitter`, `shiki` and `minimap` are accepted.
`tree-sitter-shiki` failed its holdout; four other configurations never ran. The remaining
absolute-threshold matrix is superseded by **Plan 282's paired A/B instrument**. The owner approved
units 2–7 on 2026-10-04. Production start still needs accepted performance and exact host proof.
See [the historical reference](paired-input-latency.md#historical-reference) for results and evidence.

Probe scripts and raw output live in `/work/tmp/research/099/`: `scan.ts` (inventory scan) and
`inventory.tsv` (its 296 rows), `publication.ts` and `publication.json`, `head-read.ts`, and
`probe/` (browser probe) with `consumers-baseline.json`.

## Runtime preparation, 2026-10-04

Source identity: canonical Fregat `0f6a1edcff995260dad0e49a69b63a29c4540bc8`, clean production
source in the preparation worktree. All Editor packages are local root workspaces. Frozen dependency
installation and all 25 `build:workspaces` tasks pass. This refresh adds inventory/proof tooling and
records owner approval; it creates no production contribution runtime. Earlier source/payload
measurements below retain their original identity and date.

### Rerunnable source inventory

From the repository root, run:

```sh
bun run documents:inventory --check
bun run documents:inventory --write
```

The script resolves the checkout from its own location, lists Git-tracked sources and reads each
file once with Node. It covers all Editor packages, Editor examples, Platform apps and shared
packages. It excludes dependencies, built artifacts,
tests, browser-test files and benchmark directories. Example benchmark source remains included.
It writes [consumer-inventory.tsv](consumer-inventory.tsv), including source text, line, owner,
migration family and an explanatory note. Standard output without a flag supports comparison
without writing. `--check` detects drift in the complete generated file.

The current scan has 597 classified matches: 26 publication points, 26 subscriptions/view
notifications, 106 factories/borrows/declarations, 65 worker/protocol messages, 252 source reads,
33 cursor reads, 56 source-state declarations/recovery paths and 33 private/debug/built imports.
These are source matches, including declarations and calibrated examples. They are separate from
live session counts. The scan classifies every match by its owning family. The `unit` column records
the family's migration, and the deletion table below distinguishes generic source state from
domain and presentation state. Agent-session factories, demo messages, file-watcher messages,
spelling word messages and the TUI's independent text are explicitly outside Editor document delivery.

This is a reviewable source scan, not the unit 7 import/AST enforcement check. Source matches do
not prove runtime byte cost, session cardinality or performance. File ownership and the traces
below supply the semantic interpretation. The widened scan includes JS benchmark imports, optional
`buffer?.subscribe`, borrowing APIs, the highlighting service's Tree-sitter snippet session,
the exported syntax fallback factory, storage/debug reads and source-history fields that the
historical scanner omitted. Counts from the two scans cannot establish growth or deletion.

### Current publication and raw subscriptions

`PieceTableEditorTextBuffer.publish` at `documentSession.ts:1726` is the sole accepted mutation
publication operation. Its ten calls cover edit, Undo, Redo, checkout, clear/restore history,
prepared commit, receipt reversal, sequence reversal and logical-only commit. Its fan-out at
`:1772` dispatches captured frames. `DocumentEditChain` remains the sole edit history and keeps
128 entries. `changesSince(point, scope, current)` already supports a captured endpoint. Unit 2
can expose a checked base/target reader over that implementation without adding another journal.

There are twelve production raw buffer subscriptions and one stress example. Preserve essential
view/input and host policy notifications. Move document contribution demand into the same
document owner as each family migrates.

| Caller                                                   | Current source contract                            | Migration                                                               |
| -------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Core `editor/Editor.ts:3615`                             | Captured publication for synchronous view update   | Preserve view notification; unit 2 removes its provider source fallback |
| Core `editor/documentAnalysis.ts:297`                    | One captured-frame subscription per analysis owner | Extend this owner for unit 2; preserve Plan 198 leases/results          |
| Core `historyViewer.ts:137`                              | Latest undo graph, independent of edit frame       | Preserve synchronous presentation                                       |
| LSP `document.ts:104`, `bufferSync.ts:36`                | Captured source/protocol snapshot                  | Unit 4 retained synchronization                                         |
| Platform `workspace-document-service.ts:1440`            | Captured revision/dirty metadata                   | Preserve host transaction policy                                        |
| Platform `language-server-documents.ts:59`               | Captured source length for analysis admission      | Preserve host admission; unit 4 migrates lane delivery                  |
| Platform `use-editor-visible-snapshot.ts:133`            | Captured dirtiness invalidates saved paint         | Preserve saved-paint policy                                             |
| Platform `markdown-preview-pane.tsx:59`                  | Latest immutable external-store read               | Preserve synchronous source projection                                  |
| Platform `use-document-feature-tier.ts:11`               | Latest source length and settings                  | Preserve feature-size admission                                         |
| Platform `csv-table.tsx:33`, `csv-history-action.tsx:21` | Latest text or undo availability                   | Preserve CSV presentation/history; audit secondary parse work in unit 5 |
| Stress `consumers.ts:77`                                 | Example-only protocol copy probe                   | Update its runtime attachment with the affected examples                |

### Unit 2 start conditions

The owner approved units 2–7, benchmark repairs and acceptance proofs in this session on October 4.
That clears the authorization restriction in the September decisions. It supplies no latency,
memory or first-frame acceptance by itself.

| Required contract                                               | State at this source identity                                                                                                         | Production-start implication                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Exact paired instrument and frozen baseline/candidate products  | Plan 282 repair/acceptance is in the sibling lane; accepted identity has not been relayed                                             | Wait for the coordinator's accepted receipts and selected workload scope. Historical controls earn no new-identity credit |
| Canonical captured publication                                  | Landed in #203; 154 focused tests pass in this refresh                                                                                | Reuse `EditorTextBufferChange`, snapshots and edit chain                                                                  |
| Scoped document/tab identity and captured operation ownership   | Plans 098/097 delivered; `documentKey`, targets and operation-issued sources are authoritative                                        | Bind runtime identity to retained buffer incarnation and environment, preserving captured WorkspaceEdit ordering          |
| Retained analysis and prepared borrowing                        | Landed; `WorkspaceDocumentService` creates analysis beside the buffer, preparer receives it, `preparedDocument.borrow` creates leases | Extend `EditorDocumentAnalysis`; no second handle or preparation registry                                                 |
| Retained structural range readiness and final runtime disposal  | #659 and #661 landed before this baseline                                                                                             | Preserve their ready/pending distinction and final-release order                                                          |
| Complete first-frame observation and dirty two-view Shiki paint | #662 is open/draft; #666 is open and repairs its 7/70 versus 70/70 split failure                                                      | Integrate the owned repair/probe and verify the host attachment contract before public cutover. Reuse their work          |
| Disposed Tree-sitter source metadata                            | #660 is open, with 40-cycle surviving-runtime proof                                                                                   | Reconcile the source-retirement fix before replacing its owner; carry its regression into the common delivery path        |
| Inactive analysis reclamation                                   | #664 is open; inspection/reclaim covers zero-lease sessions and preserves active entries                                              | Reuse the existing handle API if landed. Active-range pruning, host budget and parser/WASM bytes remain unproven          |
| Standalone highlighting and prepared-diff service ownership     | Plan 197 delivered; service owns engine selection, workers and `DiffSyntaxStore`                                                      | Migrate through this service, preserving borrowed service lifetime and its bounded prepared-side store                    |
| Historical complete blobs and partial-source admission          | Platform checkpoint `withCheckpointSources` and `DiffPane` guard landed; Editor `diffSyntax` still accepts patch lines                | Editor's typed complete/partial boundary and common source registration are unit 2 work                                   |
| Shared content acquisition for every comparison/preview         | Plan 200 remains approved and unimplemented                                                                                           | Preserve its source semantics; its whole migration is outside this start gate                                             |

The open docwave PRs have focused evidence, not broad Plan 198 acceptance. Chat/workbench crossing,
reload/font loading, physical hardware, memory pressure, independent host inactive-analysis budget,
active-range pruning and total parser/WASM memory remain Plan 198 work. Their absence cannot be
reported as a completed guarantee or silently made a prerequisite for every unrelated unit 2 edit.
The coordinator owns acceptance and integration of prerequisite work.

### Unit 2 caller cutover and deletions

All source positions below refer to the recorded source identity. The generated TSV supplies every
matching line in each family. A family marked unit 2 moves with the public providers in that unit.
Snippet and excerpt callers cannot be deferred to unit 5 after their provider factories disappear.

| Family and entry points                                                                                            | Same-unit replacement/deletion                                                                                                                                                       | Keep                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Core `documentAnalysis.ts:311,:343`; syntax controller `:835,:1020`                                                | Existing analysis owner admits typed document operations and shared source delivery; remove view-owned fallback session creation                                                     | Configuration partitioning, borrowed leases, ready result/snapshot pairs and per-view range demand                                   |
| Syntax controller `structuralDispatchPoint`, `highlightDispatchPoint`, `composeSkippedChanges` (`:216,:217,:2322`) | Delete feature source cursors/composition after runtime dispatch supplies exact deltas                                                                                               | Syntax/range scheduling, structural readiness, paint/configuration admission and retry policy                                        |
| `plugins.ts:1393,:1423`, `syntax/session.ts:176`, `syntax/highlighter.ts:32`                                       | Replace public raw session factories with registered typed operations; migrate every consumer before deletion                                                                        | Provider precedence and distinct structural/highlight capabilities                                                                   |
| `editor/runtime.ts:45,:51`, export in `editor.ts:49`                                                               | Remove global session-factory fallback and its export after callers use document registration                                                                                        | Ordinary `new Editor(element)` and plugin options, with internal owner creation                                                      |
| Tree-sitter `session.ts:72,:177`; `source.ts`, `sourceChunkRetention.ts`, `workerClient.ts:229,:265,:560`          | Move source attachment, epochs, sent chunks and exact base/target progress into common worker delivery. Delete piece-descriptor/debug imports and main-thread snapshot-diff recovery | Grammar/query state, tree edit coordinates, injections, bounded parser strings, atomic cancellation and packed results               |
| Shiki `workerClient.ts:394,:573,:584`                                                                              | Delete feature snapshot baseline, equality check and snapshot-diff fallback; common delivery establishes exact source before tokenization                                            | Tokenizer analysis revision/state, language/theme acquisition, recolor and packed token transport                                    |
| Prepared `preparedDocument.ts:383,:424,:550,:591`; Platform `prepared-document.ts:126,:134`                        | Bind preparation/pinned work and adoption to existing runtime leases; remove replaced source initialization                                                                          | Current `borrow` ownership, configuration matching and once-only release. Transfer-only `take` is already gone                       |
| Diff `diffSyntax.ts:499,:520,:595`; highlighting `diffs.ts`                                                        | Register complete immutable sides and obtain typed operations; delete direct backend factories and generated-row-as-source parsing                                                   | `DiffSyntaxStore`, theme subscriptions, per-side identity and row projection. Partial sources yield explicit unsupported syntax      |
| Snippet `snippetTokensFeature.ts:92–98`; highlighting `service.ts:407`                                             | Use a transient runtime scope for provider-backed snippets; delete their raw factories                                                                                               | Exact submitted-text offset mapping, bounded transient ownership; Shiki stateless snippet highlighting may retain its domain request |
| Platform `result-syntax-cache.ts:77`; `result-syntax-plugin.ts:37`                                                 | Replace direct excerpt parser session and its provider wrapper with a runtime-owned immutable source/demand                                                                          | Excerpt range mapping and bounded completed-result reuse                                                                             |
| React/Solid wrappers, ordinary examples and stress `firstPaint`, `boundary`, `geometry`, `copies`                  | Migrate provider registrations and ownership inputs, including calibrated probe providers                                                                                            | No required document setup for simple Editor; independent view/selection/scroll state                                                |

Units 3–5 retain their own full caller sets: minimap `workerDocumentState` and clipped projections
in unit 3; LSP `DocumentSyncLane.syncPoint`, browser TypeScript VFS and external URI/version/barrier
state in unit 4; Find `elsewhereSyncPoint`, merge conflicts `parsedPoint`, semantic
`syncPointsByTextVersion` and live diff-overlay rebuilds in unit 5. Protocol versions and derived
projection indexes remain domain state. Storage-owned internal imports, inspector debug imports,
and reclamation benchmark `dist` imports stay with their existing owners. E057's SAB text deletion
is complete; the current Tree-sitter descriptor contains strings. Atomic cancellation is separate.

### Executable first-unit outline

The caller shape is `analysis.contributions.request(operation, input, demand)`, with current
structural/highlighter conveniences delegated to it. Use the plan's `DocumentRevision`,
`DocumentRead`, `DocumentOperation<Input, Result>`, `ContributionDemand<Result>` and
`ContributionTask<Result>` contracts. `changesBetween(base, target, scope)` validates issued
revision ownership, then delegates to `DocumentEditChain.changesSince(base.point, scope,
target.point)`. A source advance is either an exact snapshot reset or a delta with exact
base/target points. Applied-source acknowledgement never implies completed analysis.

| Module                                                 | Shape to implement                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/documentSession.ts`                               | Captured revision acquisition and bounded exact interval access over the existing buffer                                          |
| `src/editor/editChain.ts`                              | Existing 128-entry history, exact base/target composition and unavailable result                                                  |
| `src/editor/documentAnalysis.ts`                       | Existing analysis handle owns contributions, provider/configuration bindings, interest and result admission                       |
| `src/editor/documentContributions.ts` (new)            | Typed operation factories, issued revisions/audiences and settled outcome contract, exported through existing public entry points |
| `src/editor/documentDelivery.ts` (new, private)        | Endpoint generations, acknowledged source point, pins, reset admission and disposal, owned by analysis                            |
| `src/document/workerReader.ts` (new, DOM-free/private) | Ordinary reset/advance/release protocol and worker-local immutable reader, reused by both workers                                 |
| Existing Tree-sitter/Shiki modules                     | Private domain bindings and analysis state; preserve independent workers                                                          |

These paths are the implementation outline, not unused files added by this preparation. Stable
provider/configuration keys retain compatible bindings; runtime environment and buffer incarnation
prevent cross-owner sharing. The delivery module has no independent public resource or journal.

1. Extend `editor/documentAnalysis.ts` as the document-owned coordinator. Place typed operation,
   revision, audience and outcome contracts under core's existing public document/syntax exports.
   Use runtime-issued identity bound to buffer incarnation and the existing `DocumentSyncPoint`.
   Keep current structural/highlighter convenience calls over those operations.
2. Extend `editor/editChain.ts` and `documentSession.ts` with checked exact base/target access,
   reusing the existing bounded endpoint implementation. A revision owner pins an immutable read;
   unavailable history returns an explicit reset/unavailable outcome. Capture source and operation
   input at admission. A newer head never retargets pinned work.
3. Put endpoint source progress and private ordinary worker reader protocol below that owner.
   Model detached/attached/disposed endpoint generations and reset/advance/release/acknowledgement
   as distinct messages. Acknowledged source progress and parser/tokenizer analysis progress have
   separate states. Keep independent executors and `EditorWorkScheduler` task policy.
4. Implement the reader with Tree-sitter and Shiki together. Preserve incremental domain state,
   parser read batching and packed result transfer. Bring every caller in the table onto registration,
   including transient snippet, prepared, diff and search scopes. Preserve the highlighting service's
   ownership and make complete versus partial syntax input explicit in Editor.
5. Create the internal owner automatically on simple Editor construction/owned-buffer replacement.
   Borrow an explicit host's existing analysis owner when attached. Dispose only internally owned
   resources; detaching one view releases that view's demand. Preserve synchronous text/input.
6. Delete each replaced cursor, reset policy and public source factory in the same cutover. Add real
   worker proof for exact pinned reads after the head advances, wrong base/reset, UTF-16 chunks,
   sparse edits, worker replacement, stale completions, two views, prepared adoption and partial
   diff refusal. Reuse the docwave regressions rather than copying their implementations.
7. Build all workspace exports, run affected core/provider/framework/Platform checks, verify real
   first-frame/source output, and compare the affected frozen products using accepted Plan 282
   identity. Measure source reads/payloads and bounded retention independently of latency. No
   improvement claim follows from the source inventory or a successful build.

The selected extension follows the existing owner. A separate public document wrapper was already
rejected in Plan 198, and a worker-message wrapper leaves generic cursor/reset decisions with each
feature. Neither supplies this migration's one-owner contract.

### Current focused verification

After `bun install --frozen-lockfile` and `bun run build:workspaces`, core's configured Vitest command
passes 154 tests in six files:

```sh
bun run --cwd editor/packages/editor test -- test/documentPublication.node.test.ts test/documentAnalysis.node.test.ts test/documentSession.test.ts test/editChain.test.ts test/publicationContributions.test.ts test/preparedDocument.test.ts
```

These checks cover exact nested publication, mutation/transaction paths, eventless segment rotation,
mounted frame readers, bounded edit history, prepared borrowing, configuration/range isolation,
stale replies and owner disposal. They validate delivered publication/analysis contracts. They do
not implement or accept the unit 2 worker reader, a complete first-frame matrix or new performance.

Twenty LSP document/buffer synchronization tests pass through the configured package script:

```sh
bun run --cwd editor/packages/lsp-plugin test -- test/documentSync.test.ts test/bufferSync.test.ts
```

From `apps/web`, the configured Node project passes 36 runtime, preparation, retention and
WorkspaceEdit checks:

```sh
bun --bun vitest run --project node src/features/editor/tests/runtime.test.ts src/features/editor/tests/prepared-document.test.ts src/features/editor/tests/document-retention.test.ts src/features/editor/tests/workspace-text-change.test.ts
```

The local raw logs are `/work/reports/plan099-unblock-20261004/runtime-evidence/`.
All heavy checks use the local runner. This preparation changes source inventory and documentation,
so new browser rendering, latency measurements and package release changes are outside its proof.

## Baseline identity

| Item               | Value                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform           | `origin/main` `9f343825858b10a3b70b86250946e562956fbf13`, clean worktree                                                                                                                                                                                |
| Editor             | `origin/main` `e2fd299`. The shared checkout `/work/projects/Editor` is at `c23cd306`, clean, 5 commits behind; `git diff c23cd30 origin/main -- packages examples` is empty, so every probe that imports the checkout measures `e2fd299` code          |
| Link resolution    | `packages/editor-*` in Platform are relative symlinks to `../editor/packages/*`, which resolves to `/work/projects/Editor`. `apps/web/node_modules/@singapore-editor/*` → `/work/cache/bun/global/node_modules/@singapore-editor/*` → the same checkout |
| What Platform runs | Dev: Editor `src/` through `platform-dev-sources` (`apps/web/vite.config.ts:103`). Build: each package's `dist/`. `packages/editor/dist` was built 18:51, before the 20:19 source commit, so a Platform build today would not match source              |
| Package versions   | `@singapore-editor/core` 0.1.2, `diff` 0.2.0, `find`/`gutters`/`lsp`/`lsp-plugin`/`minimap`/`react`/`scope-lines`/`tree-sitter`/`tree-sitter-languages` 0.1.1, `decode`/`markdown`/`plugin-ui`/`textbuffer` 0.1.0 (`apps/web/package.json:49`)          |
| Tools              | Bun 1.4.0, Node 26.7.0, Vite 8.0.16, Playwright 1.63.0 (Chromium headless)                                                                                                                                                                              |
| Hardware           | Intel Core i7-14700K, 31 GB RAM, shared with other agents (runs went through the 3-slot memory wrapper)                                                                                                                                                 |
| Capability flags   | The browser probe records `crossOriginIsolated` and `SharedArrayBuffer` per run. Platform passes no `useSharedBuffers`; E057 (delete the SAB text arm) is proposed and not landed                                                                       |

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
  pattern [E031](../../editor/docs/performance/e031-projection.md) warns a full-read counter
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

Historical limits of the 2026-09-25 research pass. The harness and partial calibration were delivered
later; their current status is [recorded separately](paired-input-latency.md).

- **Harness extension.** The plan puts consumer configurations, readiness assertions and frozen
  fixture files into `examples/stress` before any baseline. That is Editor code, which this research
  pass may not change.
- **Calibrated controls.** Three unchanged `bench:input` controls, a holdout and the 20 ms negative
  control need the extended harness to cover consumer configurations, and at about three slots
  shared across agents the existing matrix alone would hold one slot for a long time. No new
  control was recorded.
- **Worker and WASM memory.** The browser probe counts messages and payload units, not heaps.
- **Time to visible syntax.** The probe settles on idle fences; it does not time paint.
