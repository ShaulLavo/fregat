# Plan 177: Prefetch every press

## Status and authorization

- Status: PROPOSED, research first. Requested 2026-09-26 (owner). Nothing here authorizes
  implementation.
- Planned at: Platform `d42184dc`, Editor `74e76be`, 2026-09-26. Origin: the investigation into
  markdown files and diffs painting without colours or decorations before their syntax lands.
- [Plan 175](175-large-folder-open.md) Phase 6 caps speculative directory prefetch at four in
  flight per surface. This plan inherits that cap as its default per-surface budget.

## Outcome

Every press that starts an async load has already started it on intent: hover, pointer trajectory,
keyboard focus or the active row of a list. Each prefetching surface can be turned off in Settings,
and each one logs hits and misses so its budget is tuned from data.

## Owner direction

- 2026-09-26: any press that causes an async call should prefetch. The app runs locally, so the
  gap between client and server is latency nobody needs to wait for.
- Speculative prefetching gets settings toggles, possibly one per surface. The shape is open.
- Prefetch is in-memory intent. The persistence cut (2026-09-22, "persist intent, not answers")
  stands, and the owner already considers the app's caching too large. This plan adds no persisted
  caches.

## What exists today

| Surface                              | Before the press                                                                                        | After the press                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| File tree row                        | Foresight intent → `fileOpenIntent.prepare`: content, buffer, LSP match, Shiki stage, tree-sitter stage | The claim is adopted in `attachSession`                                                                |
| Inactive editor tab (`kind: 'file'`) | The same (`features/workspace/hooks/use-tab-intent-prefetch.ts`)                                        | The same                                                                                               |
| LSP go-to-definition link            | The same (`features/editor/hooks/use-lsp-plugin.ts:91`)                                                 | The same                                                                                               |
| Quick open and palette results       | Nothing                                                                                                 | Fetch, then parse and tokenize                                                                         |
| Search results                       | Nothing (search keeps its own result editor pool)                                                       | Fetch, then parse and tokenize                                                                         |
| Keyboard tab switch, restored tabs   | Nothing (`claimLive` with no prepared document)                                                         | A new syntax session, then worker round trips                                                          |
| Git changes row → diff               | Nothing                                                                                                 | `fetchQuery(gitKeys.diff)` (`state/navigation.ts:667`), the blob diff query, then both sides tokenized |
| Chat session                         | Nothing                                                                                                 | `sessionDetailSnapshot` (`features/chat/transport/create-chat-transport.ts:45`)                        |
| File picker row                      | Directory listing, unbounded until Plan 175 Phase 6                                                     | —                                                                                                      |

**Limits of the file prefetch** (`lib/file-open-intent/state/service.ts`):

- 8 records, 32 MB, a 30 s idle TTL, 1 MiB per file.
- Paths are prepared one at a time, newest first, at background priority.
- The Shiki and tree-sitter stages run one after the other (`runPreparationStages`, line 1105).
- A claim goes stale once its content is older than `FILE_SNAPSHOT_STALE_MS` (5 s), so hovering,
  pausing and then clicking loses the preparation.
- A claim does not wait for running stages, so the click paints plain text and the stage's result
  follows.
- Production logs, 2026-09-23 to 26, markdown intents: 149 evicted (75 idle TTL, 74 memory
  budget), 11 stale, 8 promoted. Prepared markdown stages averaged 257 ms (Shiki) and 191 ms
  (tree-sitter), against 45 ms and 23 ms for TypeScript.

**Diffs.**

- Plan 061, which built prepared opens, listed diffs, compare views, search buffers, settings JSON
  and git-ref documents as out of scope.
- The diff view remounts on every visit and tokenizes both sides again. `DiffSyntaxController`
  keeps per-side tokens only while mounted.
- `diff.paint.v1` (added in `d1ca64722`, 2026-09-21) replayed a coloured paint on reload or on a
  return to the last diff. The persistence cut (`519957660`, 2026-09-22) deleted it. Its
  leftovers remain: `presentationReady` and `isSyntaxReady` in
  `features/editor/components/diff-pane.tsx` hold nothing now, and
  `docs/instant-reload-implementation.md` still describes the diff paint.
- The same cut kept `lib/editor-visible-snapshot-cache.ts`, the editor's equivalent. The notes from
  that day flag the mismatch as unsettled.

**Observability.** The gap is invisible in the logs today. `editor.syntax.*` events are debug
level. No event records when markdown decorations or a diff's first tokens land. `highlightPaintMs`
measures Shiki only. `editor.command.select_file` logs its target as `[circular]`, so the logs
cannot count opens that had no prefetch.

## Research questions

1. **Inventory.** Every press that starts an async load, across the sidebar panels, git (changes,
   history commits, compare views), chat (session rail and list), quick open, search, settings
   pages, logs and problems. For each: what loads, its p50 and p90 from the logs, and what predicts
   the press (hover, trajectory, keyboard focus, active row).
2. **One intent layer or several.** Generalize `fileOpenIntent` into per-surface preparers behind
   one scheduler (budgets, cancellation, priority, telemetry), or keep separate services on a shared
   scheduler.
3. **What "prepared" means per surface.** A diff: both blobs plus both sides tokenized into a
   prepared diff document the view can claim. A chat: the session detail in the query cache, and
   whether its first screen of rendered markdown too. Quick open and search: the highlighted row.
4. **Budgets.** Plan 175's four-in-flight cap as the default. A memory budget shared across
   surfaces. A remote machine over SSH pays more per prefetch: should its defaults differ?
5. **Staleness.** Replace the 5 s discard with revalidation at claim time, keeping the check that
   the claimed content matches a fresh read.
6. **Settings shape.** (a) One master switch. (b) One key per surface. (c) A master switch plus
   per-surface keys. Scope is `application`, since a toggle selects no binary and sets no flag.
   Each key is registered in the phase that wires its consumer, per AGENTS.md § Settings.
7. **The snapshot mismatch.** Decide whether the editor paint snapshot stays now that the diff one
   is gone, or whether prefetch makes both unnecessary.
8. **Measurement.** Hit rate per surface, time saved, and wasted work (bytes fetched and worker time
   spent on preparations nobody claimed).

## Proposed phases

Confirmed or reshaped once the research lands.

0. **Measure first paint.** Scenarios under `scripts/agent/scenarios/` that count frames until
   colours and markdown decorations appear, for a hovered markdown open, a quick-open markdown
   open, a quick-open TypeScript open, a diff open and a chat session open. Info-level fields on the
   existing open events: prepared or not, stage status at claim, cold or warm worker, milliseconds
   to first tokens and to decorations. Fix the `[circular]` target. Plans 170 and 176 use the same
   baseline.
1. **Diffs.** Intent on git changes rows, a prepared diff document claimed by `DiffPane`, and a
   decision on reuse across remounts. Delete the dead `presentationReady` path and fix the stale
   doc.
2. **Chats.** Intent on session rows loads the session detail into the query cache.
3. **Quick open, search and keyboard.** Prepare the active row.
4. **File prefetch fixes.** The staleness rule, stages in parallel, more than one path at a time,
   and eviction tuned from Phase 0's numbers.

Each phase registers its surface's toggle with its consumer.

## Verification

- Every phase re-runs its Phase 0 scenario before and after and reports the frame counts.
- Performance claims cite `agent:browser trace` with `--compare`; cache claims cite `caches`.
- The logs show hits and misses per surface.

## What this plan does not do

- No persisted caches.
- No grammar or worker warm-up ([Plan 170](170-language-census.md)) and no parser change
  ([Plan 176](176-markdown-parser.md)).
- The file picker's directory cap belongs to Plan 175 Phase 6.
