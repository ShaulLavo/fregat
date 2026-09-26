# Plan 175: Opening a very large folder

## Status and authorization

- Status: IMPLEMENTED 2026-09-26 — all phases, D1–D4 as recommended and D3 unconditional. See
  [Progress](#progress-2026-09-26) for where the build departed from the plan.
- Priority: P1. Opening `/work` froze the prod server for 10.8 s and left it holding 92% of the
  machine's inotify watches.
- Planned at: Platform `86ac6f6b0`, 2026-09-26. Origin: the owner opened `/work` as a workspace in
  prod and reported what went wrong; this plan is the log read of that session.

## Outcome

Any folder opens without freezing the server, however large. A folder too large to watch opens
with limited live updates and says so. An unreadable folder reads "no access". A click during a
folder switch leaves the switch running. The picker's prefetch stays bounded on long lists. The log
alone explains each of these.

## The report

Symptoms the owner reported on 2026-09-26, release `20260925T173354Z-ed96e9f1-main`:

1. Very slow before anything happened.
2. An error message.
3. The app stayed on the old workspace, but `/work` joined the recent list.
4. It felt buggy.
5. `/work/containers` showed an error in the file tree.
6. "There are more bugs I did not mention."

Timeline from `/work/platform-production/logs/2026-09-26.jsonl` (UTC; the owner's clock is UTC+3):

| UTC                 | What happened                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 06:33:45 – 06:33:56 | The picker lists `/work` and prefetches all 16 of its folders within one second, then 574 folders inside `/work/tmp`. Each prefetch is a `stat` and a `tree`: about 1,150 requests.                                |
| 06:34:38.9          | The owner picks `/work`. The picker records it as recent before the open starts.                                                                                                                                   |
| 06:34:38.9 – :49.8  | `POST /fs/workspace-root` takes 10,839 ms (`watch.readyMs` 10,838). The server writes no log line at all in that window; a `git status` sent meanwhile takes 5,539 ms on the client.                               |
| 06:34:44.3          | A navigation in the old workspace supersedes the switch (`address.restored`, `superseded`, "A newer navigation owns the application."). No event says what that navigation was, and the aborted open logs nothing. |
| 06:34:49.8          | The watcher reports `EACCES: permission denied, watch '/work/containers'` as `WATCH_FAILED`, and the client toasts "The file server could not complete the filesystem operation."                                  |
| 06:36:49            | The second try opens in 15 ms: the first try had already installed `/work`'s watcher and index scope on the server.                                                                                                |
| 06:36:49 – 06:37:09 | Expanding `/work/containers` fails 12 times: `500 OPERATION_FAILED`, each request retried once.                                                                                                                    |

State afterwards, read at 06:40 from `/proc` and `/health`:

- The prod server holds 484,687 inotify watches against `fs.inotify.max_user_watches` = 524,288.
- `/work`'s index holds 1,079,982 entries after a 172,292 ms rescan and reads `failed`
  (`rebuildReason: watch-error`). Server peak RSS 3.0 GB.
- Until Phase 3 ships, opening `/work` again takes the same watches. Switching the app to another
  folder should release them (the index scope retires and the project stream closes); unverified.

## Findings

**F1 — The recursive watch freezes the server.** `FileChangeHub.createNodeWatcher`
(`apps/server/src/fs/watch.ts:394`) calls Bun's `fs.watch(root, { recursive: true })`, which walks
the tree and registers every directory synchronously on the main thread. It cannot skip a subtree
(`watch.ts:358`), so `node_modules` and `.git` count: `/work` has 484,658 directories. Over this
checkout (45,036 directories, warm cache) the attach takes 128 ms and stalls the main thread for
136 ms, about 3 µs a directory; `/work` took 10.8 s, about 22 µs a directory.

**F2 — The watch spends the machine's inotify budget.** One directory is one watch. `/work` alone
is 92% of the per-user limit, so while it is open every other watcher on the machine (the dev
server's Vite, editors, Hyprland) can fail with `ENOSPC`. Skipping ignored names while crawling
would still leave 149,896 directories under `/work`, so a limit is needed whatever watcher runs.

**F3 — An unreadable folder counts as a watcher failure.** Bun 1.4.0 reports `EACCES` for an
unreadable subdirectory and keeps delivering events for the rest of the tree (checked with a
`chmod 000` sibling: writes in two other folders both arrived). `watcher.on('error')`
(`watch.ts:405`) turns it into `WATCH_FAILED` (`watch.ts:826`), the client toasts it
(`features/workspace/hooks/use-events.ts:196`), and the project stream restarts.

**F4 — The index rescans only to fail.** `WorkspaceIndex.applyWatchEvents` answers any watch error
with `rebuildAndMarkFailed` (`apps/server/src/fs/workspace-index.ts:182`), which runs a full
rebuild (`:273-281`) and then marks the index failed. On `/work` that was a 172 s scan nothing
reads; search falls back to `fd` and `rg`.

**F5 — Permission errors are generic 500s.** `mapNodeError` (`apps/server/src/fs/errors.ts:133`)
maps `ENOENT`, `EEXIST`, `ENOTDIR` and `EISDIR`; `EACCES` becomes `OPERATION_FAILED`, 500. The
tree marks the row `error` with that message (`features/workspace/components/tree-pane.tsx:494`).
Every query retries once (`lib/environments/state/query-clients.ts:34`), 4xx included.

**F6 — Any navigation cancels a pending folder switch.** `begin`
(`apps/web/src/state/navigation-coordinator.ts:154`) cancels the running operation, and so does
`transient` (`:653`), which opening a tab uses (`state/navigation.ts:223`). While the open was
frozen, the only sign of it was `NavigationStatus`'s thin sweep labelled "Opening destination"
(`components/navigation-status.tsx:21`), so a click in the old workspace cancelled it.

**F7 — A cancelled switch leaves traces.** The picker records the pick as recent before anything
opens (`components/file-picker-dialog.tsx:240`), though the opener already records on success
(`features/workspace/state/open-root.ts:89`). `open-root.ts:46` moves the active-project store to
the new root before the request, and the abort path (`:92`) returns without moving it back or
logging; Plan 173 Q4 describes the chat-over-old-editor split this causes. The server installs the
new root's index scope regardless, which is Plan 173's.

**F8 — The picker's prefetch is unbounded.** `FileRow` registers every directory row with
Foresight (`features/file-picker/components/file-row.tsx:54`), whose defaults run mouse
trajectory, keyboard and scroll prediction. Each prefetch runs `loadDirectoryData`, which stats the
folder (`features/file-picker/utils/data-helpers.ts:54`) before listing it, though the row already
holds that entry. The file tree registers with the same Foresight manager
(`features/workspace/utils/intent-prefetch-registry.ts:61`).

**F9 — The logs could not tell the whole story.** No event records an index build (the 172 s scan
was read from `/health`), which navigation superseded which (`finish` returns before logging a
superseded result, `navigation-coordinator.ts:281`), an aborted open (`observeClientOperation`
skips aborted operations, `lib/client-logging.ts:112`), or how many directories a watch covers.
`workspace.events.summary` files `/work`'s watch failure under `work/projects/platform`, the root
its scope started with.

Elsewhere: the single server-wide index scope and the open generation are Plan 173 Phases 1–2; the
reaper warning logged every five minutes for session `6029a465…` is Plan 147 item 3; the Mac
environment's protocol-mismatch errors the same morning belong to Plans 150–151. `@parcel/watcher`
stays out: `f01849c6d` measured 8.3–21.9 s attaches and lost writes in new, moved-in, renamed and
recreated directories.

## Decisions

Each says whether it leaves the code simpler, the same, or more complex. Decided 2026-09-26:
the owner took every recommendation, and D3 without its condition ("we are not scared of
complexity that much").

- **D1 — The watch limit.** Recommended: a server-wide total of directories under recursive
  watches, setting `files.watchDirectoryLimit`, `machine` scope (inotify is per machine, and a
  workspace file must never raise it), default 200,000. That fits four roots the size of this
  checkout and leaves 62% of the per-user limit to the rest of the machine. Alternative: a
  per-root limit, easier to explain and blind to several large roots open at once. Same
  complexity either way.
- **D2 — A folder over the limit.** Recommended, simpler than today: the root gets one shallow
  watch, open files keep their own watches, no index is built (search already falls back to `fd`
  and `rg`), the tree refetches a folder when it is expanded and its loaded folders when the window
  regains focus, and the tree header says live updates are limited. Alternative, more complex: a
  shallow watch per expanded folder, which means the client sends its expanded set and the stream
  resubscribes whenever it changes.
- **D3 — A worker for the watch.** Moving `fs.watch` into a Bun worker frees the main thread
  during the walk: over this checkout the longest main-thread gap drops from 136 ms to 6 ms, with
  the attach unchanged (128 → 131 ms). More complex: a worker module and an event relay, about 80
  lines. Decided: always, with no measurement gate.
- **D4 — Clicks during a folder switch.** Recommended: the switch wins. A navigation whose
  destination is the workspace being left settles `superseded` at once and leaves the switch
  running; browser Back and Forward still cancel it. `NavigationStatus` names the folder being
  opened. One guard over the existing `pendingOutsideWorkspace` (`navigation-coordinator.ts:563`),
  slightly more code. Alternative: keep "last navigation wins" and show a notice when a switch is
  cancelled. Decided: the guard, as a stopgap. The owner's better answer is an optimistic switch
  that lands before the server answers, which makes the window disappear; that is a separate plan.

## Phases

### Phase 1 — Logs that would have explained this

Same complexity: fields on events that exist, plus one wide event.

1. `fs.workspace_index.build`, one wide event per rebuild: root, reason, `durationMs`,
   `entryCount`, `fileCount`, `skippedEntryCount`, `scanWarningCount`, and the readiness it ended
   in.
2. The attach's `watch` block (`watch.ts:462-470`) gains the unreadable-directory count and the
   first five of their paths, and (from Phase 3) the directory count, the limit and the mode,
   `recursive` or `limited`.
3. `navigation.completed` also logs superseded results, with
   `supersededBy: { generation, kind }`, where `kind` is `request`, `transient`, `history`,
   `attach` or `unavailable`.
4. `workspace.root_open_superseded` fires on the abort path (`open-root.ts:92`) too, with the
   path, the elapsed time and which check ended it: `aborted`, `not-current` or `server`.
5. `workspace.events.summary` records the root of each subscription it counts.

Proof: write Phase 7's `workspace-switch-click-during-open` scenario now and run it before any
other phase lands. Its log names the navigation that superseded the switch, and the index build
shows up without `/health`.

### Phase 2 — Unreadable folders read "no access"

The same or simpler.

1. `mapNodeError`: `EACCES` and `EPERM` become `PERMISSION_DENIED`, 403, through the catalog with
   `why` and `fix`. Suggested copy: message "Permission denied", why "The server's user cannot read
   this path.", fix "Change the path's permissions, or open a folder the server's user can read."
2. The watcher's error handler records `EACCES` and `EPERM` in the attach wide event and emits
   nothing. Any other error stays `WATCH_FAILED`, and its message names the folder.
3. `applyWatchEvents` marks the index failed on a watch error without rebuilding; the rebuild runs
   when a fresh stream reports `ready`.
4. A `retry` function in `query-clients.ts`: one retry for network errors and 5xx, none for a 4xx,
   which repeats the same way every time. It applies app-wide.
5. The tree model keeps the error code. A `PERMISSION_DENIED` folder shows `no access`; its `title`
   names the path and says the server cannot read it; intent prefetch skips it.

Tests: in `apps/server/src/fs/tests`, a `chmod 000` directory (skipped when the tests run as uid 0,
which reads everything): `tree` answers 403 `PERMISSION_DENIED`; a stream on its parent delivers a
sibling's write and no error; an index over it stays `ready`. Web: a tree-model test for the
no-access state and a retry-policy test (a 4xx runs once, a 5xx twice).

### Phase 3 — The watch limit

Slightly more code (a counting walk and one branch); the limited mode deletes work.

1. Before a recursive watch attaches, count the directories under the root with an async `readdir`
   walk that stops at the remaining limit. Count every directory, because Bun's watch registers
   every one. Measured on a warm cache: this checkout, 45,036 directories in 65 ms; `/work` stops
   at 100,000 after 184 ms, and counts all 452,846 in 693 ms; longest main-thread gap 8 ms.
2. The hub keeps a running total over its recursive watchers (`nativeWatchers`, `watch.ts:90`),
   and a root attaches only if it fits under `files.watchDirectoryLimit`. Language-server watches
   (`apps/server/src/fs/tree-watch.ts`) go through the same hub, so the limit covers them.
3. Over the limit, D2 applies. The stream's `ready` carries
   `{ mode: 'limited', directoryCount, limit }`, and no index scope is built
   (`apps/server/src/fs/service.ts:670`, or Plan 173's per-root acquire if that lands first).
4. When limited, the tree header shows a quiet `Live updates limited` label whose `Tooltip` gives
   the numbers, for example "452,846 folders, over the 200,000 folder watch limit. Open files and
   the top level still update.", and links to the setting. Final copy follows the Copy rules.
5. `ENOSPC` while attaching becomes `WATCH_LIMIT_REACHED`: message "The system file-watch limit is
   reached", fix "Lower files.watchDirectoryLimit, close a large folder, or raise
   fs.inotify.max_user_watches." It is the one watch failure the user can act on, so it keeps its
   toast.
6. Register the setting in the same pass as its consumer, then `bun run settings:reference`.
7. For D3, measure the attach at the limit on a cold cache: a fixture of about 200,000 directories
   under `/work/tmp/plan175-*`, the dentry cache dropped with `sysctl vm.drop_caches=2` (root: ask
   the owner to run it with `!`), then the same warm.

Tests: the hub with a limit of 5 over a six-directory temp tree reports `limited` and attaches one
shallow watch; two roots whose sum passes the limit leave the second limited; in a limited root a
top-level write arrives and a write two levels down does not. No index scope for a limited root,
and quick open answers through `fd`.

### Phase 4 — The watch in a worker

More complex. `fs.watch` moves into a Bun worker that posts `{ event, filename }` batches and
errors; `handleNodeEvent` and everything after it stay on the main thread. Proof: Phase 3's
measurement repeated, longest main-thread gap under 50 ms.

### Phase 5 — A folder switch finishes

Simpler overall: one place records a recent, one place moves the active project, and one guard is
added.

1. D4, in `request` and `transient`.
2. `NavigationStatus` during a workspace switch shows `Opening {folder name}` with a
   `Spinner size='xs'`, and its `title` gives the full path.
3. `open-root.ts`: drop the early `activateWorkspaceRoot(workspaceRoot)` (`:46`); the active
   project moves when the open lands (`:72`).
4. Delete the picker's recent write (`file-picker-dialog.tsx:240`,
   `features/file-picker/hooks/use-record-recent-mutation.ts` and its mutation key). Both
   folder-picker consumers (`components/app-workspace.tsx`,
   `features/environments/components/project-picker.tsx`) open through `navigation.openWorkspace`,
   whose opener records on success.

Tests: coordinator — a pending switch to B, then a `request` and a `transient` for A: B applies and
both settle `superseded`; a history traversal cancels B. Open-root — an aborted open leaves the
active project and the recents unchanged.

### Phase 6 — Bounded prefetch

Slightly more code (a cap).

1. Measure first: log which Foresight predictor fired, per picker session and per tree, then turn
   off the one that floods long lists. Scroll prediction is the expected culprit.
2. At most four speculative directory prefetches in flight per surface; a new intent when four are
   running cancels the oldest (`cancelQueries` on its key). The picker's selection preload
   (`file-picker-dialog.tsx:204-208`) stays outside the cap.
3. A row prefetch lists the folder only. The row supplies the current entry, so its `stat` goes.
4. The pending prefetch plan (owner direction 2026-09-26: prefetch every async press, with
   per-surface toggles) inherits this cap as its per-surface budget.

Proof: `file-picker-prefetch-bound` scrolls a 600-folder fixture in the picker; `fs.tree` requests
stay under the rows shown plus four, with no per-row `fs.stat`.

### Phase 7 — Prove and ship

Scenarios under `scripts/agent/scenarios/`, selectors in `scripts/agent/selectors.ts`, and a
feature-map line each. Fixtures live under `/work/tmp/plan175-*`; the lowered limit is written into
the run's own temp home.

- `workspace-open-large-root`: more directories than the lowered limit, plus a `chmod 000` child.
  Open it through the picker. The switch lands, no error toast appears, the unreadable folder shows
  `no access` after one request, the limited label shows, and the log has the watch attach with
  `mode: limited` and no index build.
- `workspace-open-unreadable-child`: the same fixture under the limit. Recursive watch, one
  unreadable path in the attach event, index `ready`.
- `workspace-switch-click-during-open`: the scenario delays the open request and clicks a tab in
  the old workspace meanwhile. The switch still lands.
- `file-picker-prefetch-bound`: Phase 6's proof.

Then `bun run deploy --server` and re-open `/work` in prod: the server's inotify count (from
`/proc/<pid>/fdinfo`) stays at or under the limit, the log has no gap during the open, and
`/work/containers` reads `no access`. Commit and push.

## Order

Phase 1 first. Phase 2 next: it is the smallest, and it fixes symptoms 2 and 5 and the failed
index. Then Phases 3, 4, 5 and 6 in any order, then Phase 7.

## Progress (2026-09-26)

All seven phases landed (committed with other sessions' work in `bed2fd6c3` and `d42184dc2`).
Evidence: `workspace-open-large-root`, `workspace-open-unreadable-child`,
`workspace-switch-click-during-open` and `file-picker-prefetch-bound` under
`/work/tmp/fregat-evidence/20260926T07*`.

Departures, each for a reason found while building:

- **Errors go only to the streams that use the failing watcher.** The hub broadcast every
  watcher error to every stream, which is why `/work`'s failure toasted in platform's stream and
  was filed under `work/projects/platform` (F9's last sentence). Errors and the new `coverage`
  message carry the watcher root.
- **A limited root is upgraded when room frees.** On a switch the old root is still watched while
  the new one is counted, so the new one came out limited for good. A released recursive watch now
  offers its room to limited roots: the hub attaches the full watch, sends `coverage`, the client
  resyncs and drops the indicator, and the index builds (`watch-limit-freed`).
- **Phase 2's 403 needed a tree repaint.** Rows only ask for their decoration when something else
  re-renders them, so `no access` (and the old `error`) waited for an unrelated repaint.
  `FileTreeModel.refreshDecorations()` is called when a folder's load state changes.
- **Phase 5 item 3 keeps the early activation.** Chat follows the active project on the next frame
  by design (`active-project.ts`), so the open moves it back when it is abandoned instead of moving
  it later.
- **D4 fires once the destination is known.** A request's destination is only known after its
  async preparation; the guard applies from commit on, which covers the slow root open and keeps a
  same-workspace preparation cancellable. The old click-wins test was rewritten to the new rule.
- **Phase 6:** the cap skips a guess when four listings are loading instead of cancelling the oldest,
  because a click's load shares the prefetch's query key. The `stat` stays in a row prefetch: the
  current entry's canonical path comes from it. Measured on a 600-folder list, scroll prediction
  asked for 112 of 145 row prefetches; it is off (`configureIntentPrediction`), and the picker list
  ignores intents for 150 ms after a scroll. Sweep plus 12 wheel turns went from 77 listings to 33,
  none from scrolling.
- **Copy for a spent limit.** When other roots use the whole limit the tooltip says so; the first
  run showed "more than -44,846 folders" because the fixture server's own workspace was watched.
