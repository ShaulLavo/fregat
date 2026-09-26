# Plan 177: Prefetch every press

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — every async press inventoried and measured; one shared intent
  scheduler with per-surface preparers; five phases; one owner question (settings shape). Nothing
  here authorizes implementation.
- Planned at: Platform `d42184dc`, Editor `74e76be`, 2026-09-26. Researched at Platform
  `c130dd35a`. Origin: the investigation into markdown files and diffs painting without colours or
  decorations before their syntax lands.
- [Plan 175](175-large-folder-open.md) Phase 6 caps speculative directory prefetch at four in
  flight per surface, skipping a guess when full (a click shares the prefetch's query key). This
  plan inherits the cap and the skip rule as its default per-surface budget.
- Findings, with the full inventory and every measurement: [docs/prefetch-every-press.md](../docs/prefetch-every-press.md).

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

## Findings

Browser numbers are from a probe scenario on a throwaway server (dev build, headless Chrome,
runs 2–4); log numbers are production client events, 2026-09-20 to 26. Method in the findings doc.

- **Only a prepared open paints coloured on its first frame.** A hovered tree row opens with text
  and colour together at 40–67 ms. Quick open paints text at 75–117 ms and colour 25–165 ms later;
  a keyboard tab switch paints text at 41–53 ms and colour ~55 ms later.
- **Diffs are the widest gap, and it repeats.** A 2,000-line TypeScript diff paints text at
  ~85 ms and colour at 310–333 ms, and the second visit is no faster (302–316 ms): tokens die with
  the view. Markdown diffs: ~75 ms uncoloured.
- **A diff open is two round trips in series.** `gitKeys.diff` (p50 39 ms) then, after mount,
  `gitKeys.blobDiff` (p50 45 ms); the first answer is never seeded into the second key.
- **The file prefetch hits 11 % of the time.** 1,239 intents: 142 promoted, 504 evicted by the
  eight-record cap, 355 by the 30 s TTL, 95 `stale`. The stale ones were hovered and then clicked
  after 5 s (lead p50 7.9 s) and discarded by the freshness rule; fixing it raises hits by up to
  two thirds. Unclaimed work over the week: 26.9 MB read, 76.7 s of worker stage time.
- **Chat switching is render-bound.** 68–135 ms from press to the first message, the same on a
  first visit, a revisit and after a 1.5 s hover; the trace shows 66–150 ms of main-thread script
  after each press. Fetching the detail early cannot remove that. Large production sessions are
  unmeasured: no log field records time to first snapshot.
- **Holes nothing predicts yet:** quick open, sidebar and editor search, Problems, References,
  keyboard tab commands, tree arrow-key focus, commit rows, checkpoint rows, chat file links. Each
  already tracks the row it would open (cmdk active value, `useListbox` active id, the adjacent
  tab), and nothing reads it.
- **Bugs found on the way:**
  - The checkpoint diff open always misses: the pane caches the turn under
    `ignoreWhitespace:false` and the open asks for `true`.
  - Every chat open sends an uncached `POST /fs/workspace-address`.
  - Palette `@` symbols and the breadcrumbs store different shapes under one query key (found by
    reading the code, not reproduced).
  - `editor.command.select_file` logs its target as `[circular]`.
  - `SIDEBAR_SESSION_DETAIL_PREWARM_LIMIT` has no reader.
  - `presentationReady` in `diff-pane.tsx` gates a snapshot the diff never has.

## Answers to the research questions

1. **Inventory.** Done: see the findings doc, grouped by what a press loads (files, diffs, chats,
   everything else). Every file press ends in `createEditorActivation.activate`, so one file
   preparer serves the tree, tabs, definitions, quick open, search, Problems, References and chat
   links. Pickers that preview their highlighted row, the settings and terminal chunks, and the
   file picker already prefetch.
2. **One scheduler, several preparers.** A shared scheduler in `lib/intent-prefetch/` owns what is
   common: the settings gate, the four-in-flight cap with Plan 175's skip rule, de-duplication by
   key, abort on root or environment change, and the telemetry. Each surface keeps its own
   preparer and claim. `fileOpenIntent` stays the files preparer: its 2,000 lines are claim
   validation specific to editor documents, and generalizing them would buy nothing for a query
   prefetch. Diffs and chats need only a query key and, for diffs, a token store.
3. **What "prepared" means.**
   - _File_: today's record (snapshot, buffer, Shiki and tree-sitter stages), unchanged.
   - _Diff_: `gitKeys.diff` and `gitKeys.blobDiff` in the query cache, plus both sides' token
     sources in a bounded in-memory store keyed by the two blob ids and the syntax configuration.
     Blob ids are content hashes, so an entry never goes stale; the store also serves the second
     visit. This needs an Editor API: `DiffSyntaxController.setFile(file, rows, prepared)`
     reprojects prepared sources synchronously instead of parsing.
   - _Chat_: a `retainSessionDetail` lease on hover, released after 30 s unless the open claims
     it, plus the workspace address as a cached query. No offscreen markdown render: the render is
     the cost, and rendering a session nobody opens is the waste this plan must not create.
   - _Quick open, search, Problems, References_: the active row goes to the files preparer.
   - _Commits_: `historyKeys.commit` for the cursor's neighbours; the active commit file row's
     `blobDiff` and diff tokens.
4. **Budgets.** Decided 2026-09-26: research recommendation. Four in flight per surface per
   environment, skip when full. No shared cross-surface memory budget: each store is already
   bounded (files 8 records / 32 MB, diff tokens a fixed number of entries, chats the existing
   32-entry LRU), and a shared budget would let one surface starve another. Remote machines get the
   same defaults: the logs hold no remote reads to tune from, and every `prefetch.intent` event
   carries `environmentId`, so a remote budget can be set from data later.
   `developer.simulatedLatencyMs` gives scenarios a remote-like round trip.
5. **Staleness.** Decided 2026-09-26: research recommendation. At claim, a clean record older than
   `FILE_SNAPSHOT_STALE_MS` is claimed anyway and paints; a background `fetchQuery` (p50 15 ms)
   revalidates it, and a changed version takes the same open-file refresh the watcher uses
   (`applyRefreshOpenFileOperation`, `features/workspace/hooks/use-events.ts:649`). The check that
   the content matches a fresh read stays; it no longer blocks the paint. The 95 stale claims
   become hits.
6. **Settings shape.** Owner question 1. Whatever the shape, keys are `application` scope (a
   toggle selects no binary and sets no flag), boolean, default on, and each is registered in the
   phase that wires its consumer.
7. **The snapshot mismatch.** Decided 2026-09-26: research recommendation. The editor paint
   snapshot stays and the diff one stays deleted. The snapshot covers a reload, which no press
   predicts (93 admitted paints in production since 09-22); prefetch covers presses. Phase 3
   deletes the diff's dead `presentationReady` path and the diff-paint row in
   `docs/instant-reload-implementation.md`.
8. **Measurement.** One wide event per intent, `prefetch.intent`, with `surface` (`files`,
   `diffs`, `chats`), `trigger` (`trajectory`, `hover`, `tab-key`, `active-row`, `adjacent-tab`),
   `outcome` (`hit`, `partial`, `stale`, `evicted`, `skipped-budget`, `skipped-disabled`,
   `aborted`, `failed`), `leadMs`, `prepareMs`, `bytes`, `workerMs`, `inFlight` and
   `environmentId`. `editor.file_open_intent` becomes its files instance, keeping its detailed
   fields. The press side logs `prefetch: 'hit' | 'partial' | 'miss'` and `firstPaint` (`textMs`,
   `colourMs`, `previewMs`) on the existing open events, so opens with no intent are counted.
   Hit rate is hits over opens; wasted work is `bytes` and `workerMs` summed over non-hits.

## Proposed phases

In order. Each phase registers its surface's toggle with its consumer and re-runs Phase 0's
scenarios before and after.

### Phase 0 — Measure (M)

- Scenarios `prefetch-first-paint` and `prefetch-chat-switch` from the research probe
  (`/work/tmp/research2/177/`), with selectors moved into `scripts/agent/selectors.ts` and a
  feature-map line. They report text, colour and preview milliseconds per press.
- `firstPaint` and `prefetch` on the open events: `editor.command.select_file` (fix its
  `[circular]` target), the diff open, and `chat.session_detail_subscription.summary` gains
  `firstSnapshotMs`.
- Files: `features/editor/state/apply-actions.ts`, `features/workbench/components/file-editor-body.tsx`,
  `features/editor/components/diff-pane.tsx`, `features/chat/state/session-detail-subscriptions.ts`,
  `scripts/agent/`.

### Phase 1 — Shared scheduler and the file fixes (M)

- `lib/intent-prefetch/`: the scheduler, the settings gate, the cap and the `prefetch.intent`
  event. `lib/prefetch-room.ts` folds into it, so the tree and picker directory prefetch count
  against the same cap.
- Files preparer on the scheduler: claim-time revalidation (question 5); the Shiki and tree-sitter
  stages run in parallel, since they use different workers; up to four snapshot fetches in
  flight, stages still one path at a time, newest first.
- Register `prefetch.files` (or the shape the owner picks), read by the scheduler.
- Proof: the hovered-then-7-s-later click paints coloured on its first frame; production `stale`
  outcomes drop to near zero after deploy.

### Phase 2 — Diff queries (S)

- Seed `gitKeys.blobDiff` from the `gitKeys.diff` response in `state/navigation.ts:673`, so a diff
  open is one round trip.
- Fix the checkpoint `ignoreWhitespace` miss (`features/chat/hooks/use-open-checkpoint-diff-document.ts`
  asks for what `features/chat-mode/utils/checkpoint-hunks.ts` already holds).
- `prefetchQuery` on hover and on the active row for git changes rows, commit file rows,
  checkpoint turn rows and changed-files cards; `historyKeys.commit` for the history cursor's
  neighbours.
- Register `prefetch.diffs`.

### Phase 3 — Prepared diff syntax (L, Editor and Platform)

- Editor (`packages/diff`): `prepareDiffSyntax(file, backend, configuration)` returning per-side
  token sources and their sessions; `DiffSyntaxController.setFile(file, rows, prepared)` adopts
  them and reprojects without a parse.
- Platform: a bounded in-memory store of prepared diff syntax keyed by `(oldObjectId, newObjectId,
syntax configuration)`, filled on intent after Phase 2's queries land and on unmount of a diff
  view, claimed by `DiffPane`. Entry count set from Phase 0's numbers; eviction disposes sessions.
- Delete `presentationReady`/`isSyntaxReady` wiring in `features/editor/components/diff-pane.tsx`
  and the diff-paint row in `docs/instant-reload-implementation.md`.
- Proof: the TypeScript diff's second visit paints coloured on its first frame; a hovered first
  open does too.

### Phase 4 — Every other file press (M)

The files preparer gains sources, each feeding its already-tracked active target:

- Quick open (`features/command-palette/hooks/use-files.ts:35`, the cmdk active value) and
  palette `edt `.
- Sidebar search and the search editor (`activeResultId`).
- Problems and References (keyboard active row and hover).
- Tree arrow-key focus (`packages/tree/src/hooks/useFileTreeKeyboard.ts:273`; moves with
  [Plan 178](178-tree-in-the-app.md) if that lands first).
- Keyboard tab commands: when a tab becomes active, prepare its previous and next neighbours and
  the previous editor.
- Chat file and stack-frame links (hover).

The cap keeps a held arrow key from flooding: a guess is skipped while four are in flight.

### Phase 5 — Chats (S)

- Cache the workspace address as a query keyed by path (a read over POST, per AGENTS.md), used by
  `openChat` and the workspace switcher; this removes a round trip from every chat open.
- Hover on rail rows, the palette's highlighted session and a session toast take a detail lease
  (30 s, released unless claimed). Delete `SIDEBAR_SESSION_DETAIL_PREWARM_LIMIT`.
- Register `prefetch.chats`.
- Ship the lease only if Phase 0's production `firstSnapshotMs` p90 is above 50 ms; otherwise
  this phase is the address cache alone, and the plan says so.

## Owner questions

1. **Settings shape.**
   - (a) One master switch, `prefetch.enabled`.
   - (b) One key per surface: `prefetch.files`, `prefetch.diffs`, `prefetch.chats`, all in one
     settings category so a search for "prefetch" lists them together.
   - (c) A master switch plus the per-surface keys.

   **Recommendation: (b).** It is the per-surface control the owner asked for, and with three keys
   a master switch adds a dependency the settings page cannot show, for a saving of two clicks.

## Verification

- Every phase re-runs `prefetch-first-paint` (and `prefetch-chat-switch` for Phase 5) before and
  after and reports text, colour and preview milliseconds per press.
- Performance claims cite `agent:browser trace` with `--compare`; cache claims cite `caches`.
- After each deploy, the production log shows `prefetch.intent` hits and misses per surface, and
  the open events' `prefetch` field shows how many presses had nothing prepared.

## What this plan does not do

- No persisted caches.
- No grammar or worker warm-up ([Plan 170](170-language-census.md)) and no parser change
  ([Plan 176](176-markdown-parser.md)). The first file of a language still pays a cold worker
  inside its preparation; Plan 170 removes that.
- No offscreen render of chat sessions.
- The file picker's directory cap belongs to Plan 175 Phase 6; Phase 1 only moves the counter.
