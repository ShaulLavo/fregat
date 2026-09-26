# Plan 173: Two devices opening one workspace

## Status and authorization

- Status: RESEARCH DONE (2026-09-25) — findings, model and phases below. Owner question answered
  2026-09-26. Nothing here authorizes implementation.
- Priority: P2. It becomes a product question once [Plan 143](143-phone-layout.md) makes the
  phone a real client.
- Planned at: Platform `9f343825`, 2026-09-25. Origin: CI work on 2026-09-25.

## Outcome

A phone and a desktop can open the same workspace, or different ones, on one server at the same
moment, and each gets a defined result.

## What exists today

- "Latest workspace open wins" is one number per server: `latestWorkspaceOpenGeneration` in
  `apps/server/src/fs/service.ts`. `claimWorkspaceOpen` rejects any generation at or below it, and
  `openWorkspaceRootObserved` answers `status: 'superseded'`.
- Each client makes its own generation: `claimWorkspaceOpenGeneration()` in
  `apps/web/src/features/workspace/state/open-generation.ts` is `max(Date.now(), last + 1)`, per
  tab. Two clients therefore race on wall-clock time, and a device whose clock runs behind loses.
- The server holds one workspace index scope (`installWorkspaceIndexScope`), so a second open of a
  different root replaces the first client's index.
- The web client carries `superseded` through `features/workspace/hooks/use-open-root.ts` into
  `features/address/state/apply-view.ts`, which logs it as the restore status.

## Research questions

1. Where else the rule reaches: routes, the index scope, watchers, and anything keyed on "the
   open workspace".
2. Should generations be per client (a connection or client id), so one client's newer open only
   supersedes its own older one?
3. Should the server hold one index scope per open root instead of one per server?
4. What the losing client sees today, and what it should see: nothing, a notice, or a normal open.

Deliverable: the rule's new shape and the executable plan, ahead of Plan 143's phone shell.

## Research findings (2026-09-25)

Read from `origin/main` at `2a0d37ac7`; no lane branch carries a newer copy of this plan. T3 Code
read at `7a12aff4` (up to date with upstream on 2026-09-25).

### The open path today

Client:

1. Every navigation entry point ends in `openWorkspaceRootForOwner`
   (`apps/web/src/features/workspace/state/open-root.ts:32`), reached through
   `navigation.openWorkspace` → `applyAddressView` (`features/address/state/apply-view.ts:129`) →
   `openEnvironmentWorkspaceRoot` (`state/application-runtime.ts:139-165`). Callers: the folder
   picker (`components/app-workspace.tsx:30`), recent-root restore on boot
   (`features/workspace/hooks/use-restore-recent-root.ts:41`) and any address that names a
   workspace.
2. `open-root.ts:45` claims a generation (`open-generation.ts:4`,
   `max(Date.now(), last + 1)`, module state, so per tab), then `open-root.ts:46` activates the
   root in the active-project store **before** the request is sent.
3. `open-root.ts:50` runs the `openRoot` mutation (`utils/open-root-mutation.ts:20`) →
   `openWorkspaceRootPath` (`lib/file-server.ts:560`) → `POST /fs/workspace-root` with
   `{ generation, path }`.
4. A second opener: `watchRootValidation` (`features/workspace/state/root-validation.ts:83-96`)
   re-posts the same route with a fresh generation whenever a tab mounts with a root or its root
   changes (`hooks/use-validate-root-folder.ts:16-19`). So every reload of every tab is an open.

Server:

5. Route `apps/server/src/fs/routes.ts:90-92`; body `contracts.ts:181-184` (`generation` is a
   positive safe integer, nothing ties it to a client).
6. `openWorkspaceRootObserved` (`service.ts:217-230`): `claimWorkspaceOpen` (`:651-656`) rejects
   `generation <= latestWorkspaceOpenGeneration` (one field, `:133`); after
   `registerWorkspaceAddress` it re-checks (`:222`, `:658-660`) and answers `superseded`
   (`:662-668`) if anyone's newer open arrived meanwhile.
7. `installWorkspaceIndexScope` (`:670-687`) keeps one scope (`:134`): a different root builds a
   new `WorkspaceIndex` with its own watch subscription and retires the old one (`:689-695`).

The generation arrived in `5837e7cf3` ("fix(search): follow active workspace root", 2026-08-22).
Its job was ordering one tab's rapid switches so a slow open of A cannot install A's index after B.
The cross-client behaviour is a side effect.

### Q1. Where the rule reaches

Keyed on "the one open workspace":

- The index scope and nothing else on the server. Its readers: `searchEvents` (`service.ts:496`)
  → `searchWithTools` (`search.ts:426-434`); `PathIndexSearchProvider.ready` (`:147-153`) and
  `ContentIndexFilter.ready` (`:196-202`) use it only when `scanRoot` equals the search root
  (`:570-575`). `info()` (`service.ts:185`) reports its status, and `/health` spreads `info()`
  (`app.ts:385`). The open response carries it too (`service.ts:228`), and the web logs it
  (`lib/file-server.ts:526`, `:593-594`).
- The index's own watch stream (`service.ts:680-684`, `:755-765`) lives and dies with the scope.
- Test infrastructure already works around it: `apps/web/vitest.browser.config.ts:210-227`
  queues opens across parallel browser pages (`a73143e14`, 2026-09-25) because overlapping pages
  get `superseded`.

Not keyed on it, checked:

- File events are per subscription (`service.ts:559-567`, `routes.ts:63-82`), and native
  watchers are shared and ref-counted by root (`watch.ts:27-30`, `:344-353`).
- Workspace addresses are an idempotent metadata write (`registerWorkspaceAddress`).
- Machines already track owners per client instance (`machines/service.ts:41-86`, keyed by the
  `x-client-instance` header in `machines/routes.ts:74-78`).
- Only the web app calls `/fs/workspace-root`; the TUI, desktop shell and Mac client do not
  (grep of `apps/tui`, `apps/desktop`, `apps/mac`, `packages/client-core`).

Losing the index costs speed, not correctness: without a matching ready index, search falls back
to `fd` for names and unfiltered `rg` for content (`search.ts:434-457`).

### Q4. What a losing client sees today

A "loser" is any open whose generation is at or below the server's latest, from any tab or device.

- **Boot from an address** (a bookmark or shared link on the phone): the coordinator starts
  `pending` (`state/navigation-coordinator.ts:132`), and `finish` returns before publishing when
  the result is `superseded` (`:281`, via `:343-348`). `useRestoreRecentWorkspaceRoot` returns
  `status === 'pending'` while the address claims a root (`use-restore-recent-root.ts:46`), and
  `AppWorkspace` shows the "Restoring workspace" skeleton while there is no root
  (`app-workspace.tsx:41-48`). Result: the skeleton stays until the next navigation. Traced
  in code; not driven in a browser (all heavy slots were taken).
- **Boot from recents:** `restoreRecentWorkspaceRoot` settles on `superseded`
  (`use-restore-recent-root.ts:41-43`, `:57-58`) and the tab shows the empty "choose a folder"
  state for a folder that exists. No message.
- **Switching roots with one already open:** the editor keeps the old root, but `open-root.ts:46`
  already moved the active-project store, and chat mode follows that store
  (`chat-mode/providers/session-controller.tsx:36-37`, `chat-mode/state/session-commands.ts:170-174`).
  Chat shows the new project over the old editor. A command-palette open settles as
  `cancelled / domain-discarded` (`keymap/workspace-commands.ts:224-226`); nothing is shown.
- **Root validation:** `validateRootPath` ignores `superseded` silently (`root-validation.ts:95`).
  That part is harmless.
- **The device whose index was replaced** is never told. Its index moved away, so its searches drop to
  `fd`/`rg`, and its next reload or validation moves the index back: two clients on two roots
  ping-pong a full index rebuild on every open. Measured with `/work/tmp/research/173/probe.ts`: a real `FileSystemService` over `/work/projects` with watching on, run once on 2026-09-25:
  the desktop opens `platform` (index ready in 234 ms, 5,124 entries), the phone opens `Editor`
  and replaces it (553 ms, 1,616 entries), the desktop reloads and replaces it back (272 ms). Each
  swap throws away a ready index.

Clock skew: in the same probe, a phone whose clock runs 5 s behind opens `Editor` one real
second after the desktop opened `platform`, and gets `superseded`; the index stays on `platform`.
A device loses any open it makes within its clock lag of another tab's last open, and validation
re-opens on every tab mount (step 4), so a lagging phone loses often while a desktop is in use.

### Q2. Per-client or server-issued generations

With the model below, neither: the open stops changing server state, so nothing needs ordering.

If the index stays attached to the open call instead, per-client beats server-issued. The web
already sends a per-tab id on every request (`lib/instance-id.ts:8-23`, `lib/client.ts:64`), the
server already validates it (`machines/routes.ts:74-78`), and a per-client counter starting at 1
needs no clock. Server-issued generations cost a round trip or per-connection state and solve the
same ordering problem. Either way the per-client variant still needs a way to learn that a client
left, which is the lease below.

### Q3. One index per open root

Yes. T3 Code has no "open workspace" on the server at all. Every search names its `cwd`, and
indexes live in an Effect `LayerMap` keyed by `variant + cwd` with a 15-minute idle TTL
(`references/t3code/apps/server/src/workspace/WorkspaceSearchIndex.ts:41`, `:538-570`); each
index caps at 25,000 entries (`:37`). Per-client demand is a lease: clients report activity with
scopes such as `{ type: 'vcs-status', cwd }`, keyed by auth session and RPC client id, 45 s
default TTL, dropped when the socket's scope closes
(`apps/server/src/background/BackgroundPolicy.ts:37-60`, `:273-287`;
`apps/server/src/ws.ts:633-646`, `:2689-2705`; `packages/contracts/src/background.ts:48-61`,
where `ClientKind` already includes `mobile`). Work for a scope runs while any live lease wants it.

Cost of a second index here: in the probe, `heapUsed` after a forced GC moved by 2–5 MB across every step,
including after `close()`, so one index of this repo (5,124 entries) sits below the probe's
resolution. Its build is the real cost (234–553 ms of scanning above), and a shared root needs
only one. Native watchers are already shared per root (`watch.ts:344-353`), so a second index on
a root a client is watching adds no watcher.

### The model

**Recommendation: index scopes keyed by root, held by the client's project event stream.**

- The server keeps `Map<absoluteRoot, IndexScope & { holders: number; idleTimer }>`.
- Every client with a root open already keeps exactly one `scope: 'project'` stream on
  `/fs/events` for that root, reconnecting in a loop
  (`features/workspace/state/event-streams.ts:41-50`, started by `hooks/use-events.ts:182`). That
  stream is the lease: opening it acquires the root's scope (building the index if absent),
  closing it releases. SSE heartbeats every 15 s (`apps/server/src/sse.ts:7`) surface a dead
  phone connection on the next write.
- The last release arms an idle timer; the scope is retired when it fires. A phone that
  backgrounds and returns inside the window finds the index warm.
- `POST /fs/workspace-root` validates and registers the address and returns the entry. It installs
  nothing, so `generation`, `claimWorkspaceOpen`, `isCurrentWorkspaceOpen`,
  `supersededWorkspaceOpen`, `latestWorkspaceOpenGeneration`, the server's `superseded` status
  and `open-generation.ts` are all deleted. Ordering within a tab stays where it already works,
  on the client (`open-root.ts:56-61`: `isCurrent`, `isActiveWorkspaceRoot`, abort).
- Search looks up the index by its root (`indexes.get(context.root.absolutePath)`), which is the
  equality `search.ts:570-575` already enforces.
- `info()` and `/health` report a list of index statuses (root, readiness, holder count); the
  open response drops `workspaceIndex`.

What each client sees: a normal open, always. Two devices on one root share one index; on two
roots each has its own. `superseded` survives only as a client-local result of that tab's own
newer navigation, which publishes its own status, so the stuck skeleton and the chat/editor
split both lose their cause. No notice is needed: nothing was lost.

Rejected alternatives:

- Per-client generations with the index still installed by the open: fixes the clock race but
  keeps "last open wins" for the index, so two devices on two roots still ping-pong rebuilds.
- A notice to the losing client: it would describe a server limitation the user cannot act on.
- Explicit lease RPC with heartbeats (T3's shape): correct, but Platform already has a
  per-root, per-client, heartbeated connection doing the same job.

## Owner questions

1. **How long does an index nobody watches stay warm?** Options: retire at once; 5 minutes;
   15 minutes (T3 Code). Recommendation: 15 minutes, so a phone that sleeps between glances
   returns to a warm index. An idle index of this repo costs a few MB at most (see Q3).
   Decided 2026-09-26: owner — 15 minutes; one index per root, capped at 4 (Plan 110 Q1).

## Proposed phases

1. **Server: scopes per root.** Replace the single scope and generation in `fs/service.ts` with
   the keyed map, acquire/release on the project stream in `events()`, idle retirement, lookup
   by root in `searchEvents`, list status in `info()`. Drop `generation` from
   `openWorkspaceRootBodySchema` and `workspaceIndex` from the open response. Rewrite
   `fs/tests/workspace-index.test.ts:518-560` as: two roots both ready at once; same root, two
   holders, one index; last release retires after the TTL (injected clock).
2. **Web: delete the generation.** Remove `open-generation.ts` and its two callers
   (`open-root.ts:45`, `root-validation.ts:94`), the server-`superseded` branch in
   `open-root.ts:59`, `openRoot` variables' `generation`, the demo transport's
   `workspaceIndex` (`demo/transport/http.ts:125`, `:246`), and the open queue in
   `vitest.browser.config.ts:210-227`.
3. **Prove it.** An `agent:browser` scenario with two contexts on two roots: both quick-open
   searches report `search.provider: 'index'` in the wide event, and a reload of one does not
   change the other's provider. Deploy with `--server`.
