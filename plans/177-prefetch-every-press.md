# Plan 177: Prefetch every press

## Status and authorization

- Status: Phases 0–4 done (3 and 4 on 2026-09-27). Phase 5 is the address cache, which is done;
  the chat detail lease waits on its production gate (see Phase 5). Research done 2026-09-26.
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
  - Fixed 2026-09-26 (wave 2 lane B), the four above: a file opened from the chat git pane
    reuses the pane's whitespace-counted turn diff; `POST /fs/workspace-address` is a query per
    folder (addresses are permanent per canonical path); the symbol key carries its shape (`flat`
    or `tree`); the log sanitizer marks only a real cycle `[circular]` (a value two fields share
    was the `select_file` case).
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

Done 2026-09-26 (wave 2, lane F). The open events carry `prefetch` (`hit`, `partial`, `miss`,
and `live` for a document already open) and `firstPaint` (`textMs`, `colourMs`, `highlight`);
`editor.command.select_tab` (keyboard and mouse tab switches, which never reached `select_file`)
and `editor.command.open_diff` are new events, each held open until its target paints colour (at
most 10 s). `previewMs` is measured by the scenario only: the markdown live preview emits no
event. The `[circular]` target is lane B's fix. Baseline, dev build, second run after a Vite start
(`/work/tmp/fregat-evidence/20260926T142611Z-scenario-prefetch-first-paint/`,
`…T142717Z-scenario-prefetch-chat-switch/`), text / colour ms: quick open TS cold 121 / 348,
warm 86 / 122; quick open md cold 109 / 208, warm 72 / 104; keyboard next tab 38–54 / 82–116;
tree md no dwell 81 / 120, 1.5 s hover md 40 / 40, TS 64 / 180; git diff md first 309 / 349,
revisit 130 / 269; TS diff first 381 / 897, revisit 104 / 496; chat switch 63–123 first message.

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

Done 2026-09-26 (wave 2, lane F). `lib/intent-prefetch/state/scheduler.ts` holds the switches and
the four-in-flight room check; `lib/prefetch-room.ts` is gone and tree and picker folder guesses
(surface `folders`) follow `prefetch.enabled`. `prefetch.enabled` and `prefetch.files`
(`dependsOn` the master) are registered, application scope, default on, category Prefetch.
The files preparer: a clean record is claimed whatever its age (the opened tab's own snapshot
query refetches once stale and replaces the document if the version moved); both stages start
together; a queued path's read starts at once while another path prepares, up to four snapshot
reads in flight. `editor.file_open_intent` is now `prefetch.intent` with `surface: 'files'`,
`outcome` `hit` or `partial` in place of `promoted`, and `prepareMs`, `workerMs`, `inFlight`.
Deviations: disabled intents log nothing (`skipped-disabled` would be one line per hover); a
record whose started family changes with the environment is rebuilt, since no family waits
queued any more, and the queued-structural-range refresh is deleted with it. Proof
(`/work/tmp/fregat-evidence/20260926T143828Z-scenario-prefetch-first-paint/`): 7 s hover md
67 / 67 ms (was 100 / 141), 1.5 s hover TS 70 / 70 (was 64 / 180). Settings rows:
`…T144001Z-scenario-prefetch-settings/`. Production `stale` counts are the coordinator's
post-deploy check.

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

Implemented 2026-09-26 in wave 2 lane F, awaiting coordinator merge. The `prefetch.diffs`
application setting depends on the master. Git change and commit file rows prepare their read on
hover, focus and the keyboard cursor; checkpoint turn files and changed-files cards share the turn
read; history prepares the cursor's neighbours. Query-owned leases deduplicate, cap the diff family
at four per environment, and keep admitted reads fetching through row leave until the response
settles. Git read routes do not propagate aborts, so client cancellation would free room while the
server keeps working. Checkpoint open commands claim the shared read for both clicks and keyboard
activation, including when the counted-turn read is still pending. No hover issues a provider command. Commit details hold their displayed subject while the
next query resolves.

PR #136 review fixes are covered by real delayed Git subprocesses and the checkpoint turn-files
list. Leaving eight rows admits four Git operations; revisiting shares the pending read, and
settlement frees capacity. Enter survives cursor movement and list unmount while both turn reads
are pending; click remains covered. Admitted queries retain an observer through settlement so a
viewer mounting and unmounting cannot abort them.

The response-seeding prerequisite was missing: `/git/diff` returned patches without sources.
Single-file responses now include the immutable blob text using the existing text-size guards;
directory reads remain patch-only. The shared query options seed the blob key before returning.
The checkpoint whitespace fix was already merged in #87. Phase 3 syntax preparation is unchanged.

Proof: `prefetch-first-paint` trace before
`/work/tmp/fregat-evidence/20260926T202105Z-trace-prefetch-first-paint/`, after with `--compare`
`/work/tmp/fregat-evidence/20260926T203737Z-trace-prefetch-first-paint/`. First diff text ms:
Markdown 136 → 104, TypeScript 99 → 71; second files 89 → 58 and 94 → 70. Revisit text
60 → 69 and 61 → 61. Colour still follows text, as expected before Phase 3.
`prefetch-diff-queries`, with a 300 ms delayed read, measured 397 ms off versus 37 ms on,
zero blank frames, zero blob requests and zero provider commands. Its screenshots and
`inspection.json` cache dump are in
`/work/tmp/fregat-evidence/20260926T203844Z-scenario-prefetch-diff-queries/`.
The final rebased scenario also checks history neighbour and commit-file reuse, with zero blank
frames during commit selection: 412 ms off versus 70 ms on, evidence at
`/work/tmp/fregat-evidence/20260926T205522Z-scenario-prefetch-diff-queries/`.
Settings dependency proof: `/work/tmp/fregat-evidence/20260926T204110Z-scenario-prefetch-settings/`.
The focused scheduler, blob-reuse and diff-syntax tests pass, as do the server's single-file,
immutable-snapshot and text-limit checks. Browser font requests hit Vite's worktree symlink
allow-list, so captures use fallback fonts; the baseline and after run share that limitation. The P0 trace screenshot also catches fixture
teardown notices after all measurements; the dedicated query scenario leaves the page before cleanup.
Whole-trace scripting increased 312 ms across the roughly 55-second run, so the performance claim
is the measured diff press latency, not overall CPU use.

- Seed `gitKeys.blobDiff` from the `gitKeys.diff` response in `state/navigation.ts:673`, so a diff
  open is one round trip.
- Fix the checkpoint `ignoreWhitespace` miss (`features/chat/hooks/use-open-checkpoint-diff-document.ts`
  asks for what `features/chat-mode/utils/checkpoint-hunks.ts` already holds).
- `prefetchQuery` on hover and on the active row for git changes rows, commit file rows,
  checkpoint turn rows and changed-files cards; `historyKeys.commit` for the history cursor's
  neighbours.
- Register `prefetch.diffs`.

### Phase 3 — Prepared diff syntax (L, Editor and Platform)

Done 2026-09-27. The Editor change is in singapore `199ba7e` ([singapore#60](https://github.com/ShaulLavo/singapore/pull/60)); `editor-ref` pins that branch's head.

- **Editor API.**
  - `prepareDiffSyntax(file, { backend, side, signal })` returns a `PreparedDiffSyntaxSource` per
    side: the token stream plus the session that recolours it on a theme change.
  - `DiffPlugin.setFile(file, prepared)` adopts sources that cover the pane's side synchronously.
    A preparation that is still running is awaited in place of a second parse.
  - `releasePreparedSyntax()` hands the current file's streams back to the host when the view
    leaves it.
- **Store.** Platform keeps prepared diff syntax in `features/editor/state/prepared-diff-syntax.ts`.
  This is interim: [Plan 197](197-editor-highlighting-service.md) moves the store into the Editor's
  highlighting service (owner review, 2026-09-28).
  - It is keyed per source side by syntax source, language and an FNV-1a fingerprint of that side's
    lines, with line count and length. Keying on the drawn text means a checkpoint's rewritten old
    side can never match a blob's.
  - It holds 16 sides (eight two-sided diffs); eviction disposes the entry.
  - It is cleared when its syntax provider is disposed.
- **Filling.**
  - _On intent:_ when a git diff read settles while its row is still a guess (not claimed, not left,
    not already on screen), the editor runtime's bound preparer parses both sides. That runs as the
    `editor.diff-syntax.prepare` mutation, one at a time, with room for four. The `prefetch.intent`
    event's `workerMs` records the time spent.
  - _On leave:_ a diff view stores its parse when it leaves.
- **Deletions.** The dead `presentationReady` wiring in `diff-pane.tsx` and the diff-paint row in
  `docs/instant-reload-implementation.md` are gone.
- **Found on the way.**
  - Preparing a read that a press had already claimed parsed the same file twice beside the view,
    and the unhovered first TypeScript diff took about 1,000 ms to colour. The claim check,
    in-flight adoption and the on-screen check fixed it.
  - Keyboard tab neighbours (Phase 4) competed with a new diff tab's parse; they now wait for it
    (see Phase 4).
- **Checkpoint turn rows** are not prepared on intent: their read is the whole turn. They reuse a
  parse on revisit, since a view stores its parse when it leaves.
- **Proof.** `scenario prefetch-first-paint` gained a "git diff ts2, 1.5 s hover" step. Medians of
  four runs, baseline versus change, text / colour ms: TypeScript diff revisit 164/650 → 162/162,
  hovered first TypeScript diff 194/552 → 190/190, markdown diff revisit 164/241 → 180/180.
  Unhovered first opens are unchanged (TypeScript 174/656 → 169/638, markdown 237/434 → 262/429).
  Tests: the Editor `preparedSyntax.test.ts` covers adoption, side mismatch, release, recolour,
  in-flight and abort. Platform: `diff-tokens.test.tsx` shows the first `setText` carrying tokens
  and a revisit that creates no sessions; `diff-intent.test.tsx` hands diffs to the bound preparer
  and not commit details.

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

Done 2026-09-27.

- **Intent fields.** `FileOpenIntent` gains the sources `quick-open`, `search`, `problems`,
  `references` and `chat-link`, and a `trigger`, which the `prefetch.intent` files event records.
  `rootPath` is optional and defaults to the editor's current root.
- **Hooks.** `useFileIntent(source)` and `useActiveRowFileIntent(path, source)`, both in
  `lib/file-open-intent/hooks/`, feed:
  - quick open's highlighted file and `edt `'s highlighted editor (through `HighlightReporter`);
  - the sidebar search's and the search editor's active result;
  - Problems, by active row and Foresight; References, by active row and its existing hover
    preview;
  - chat file chips and stack frames on hover. A chat link resolves against the chat's own root,
    so a link under another project's root is rejected, as the plan expected.
- **Tree focus.** Arrow-key focus in the tree prefetches the focused row with trigger `focus`: a
  file prepares, a folder lists.
- **Tab neighbours.** The editor runtime watches the active tab (`watchAdjacentTabIntents`) and
  prepares the next and previous tab and the previous editor. It waits 250 ms and then the syntax
  workers' idle fence: preparing at once competed with the new tab's own parse and slowed a first
  diff open by 50–90 ms.
- **Queue limit.** The files preparer keeps only the four newest queued guesses, and a dropped one
  logs `skipped-budget`, so a held arrow key cannot queue a read per row. Automatic triggers
  (`active-row`, `adjacent-tab`, `focus`) log nothing for `already-active` or `already-mounted`.
- **Proof** (the same four runs as Phase 3), text / colour ms:
  - quick open TypeScript, first of its language: 500/1500 → 254/440;
  - quick open TypeScript, warm: 247/398 → 174/174;
  - quick open markdown, first: 314/434 → 236/236;
  - quick open markdown, warm: 286/310 → 156/156;
  - keyboard next tab to a markdown file: 176/294 → 185/185.
    Other rows are within noise.
- Service tests cover the queue limit (`skipped-budget`, newest four kept); the byte-budget test
  now prepares sequentially.

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

- **Foresight** (owner review, 2026-09-28). Git change, commit and turn file rows start their diff
  read when Foresight predicts a press; pointer-enter no longer starts one. Leaving the row holds
  the read for 2 s. Problems rows prepare their file through Foresight as well. Only chat links
  prepare on a plain hover. `prefetch-diff-queries` now counts blob reads per file, because a
  Foresight trajectory also prepares rows it crosses.

### Phase 5 — Chats (S)

2026-09-27:

- The address cache was already done by lane B: `registeredWorkspaceAddress` is a query that
  `openChat` and `openWorkspace` both use.
- `SIDEBAR_SESSION_DETAIL_PREWARM_LIMIT` is deleted.
- **The lease is not shipped.** Its gate is production `firstSnapshotMs` p90 above 50 ms, and those
  logs are on the owner's machine: `bun run logs --since 7d` filtered to
  `chat.session_detail_subscription.summary`. The field lands only when a subscription ends (15
  min idle or LRU), so read it over days. `prefetch.chats` is registered with the lease if the gate
  passes.

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
   Decided 2026-09-26: owner — (c), and the settings page learns to show the dependency: a
   `dependsOn` field in the registry renders child keys indented and disabled while the parent is
   off (Plan 167 Part D, done). The master switch is `prefetch.enabled`.

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
