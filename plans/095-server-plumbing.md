# Consolidate duplicated server plumbing in apps/server

Status: proposed, implementation not started. Requested 2026-09-11.

This plan owns census items 6.2, 6.3, 6.4, 6.5 and 6.6. It is independent of
[Plan 092](092-path-and-uri-helpers.md), [Plan 093](093-web-react-and-store-ceremony.md) and
[Plan 094](094-client-core-web-tui-parity.md) and may run beside them.
[Root PLAN.md](../PLAN.md) owns execution order; this document owns only the internal order below.

Work in the stated order. The WebSocket adapters and the fsync pairs are byte-identical collapses
with no decision attached. The atomic writer must follow the fsync extraction because its durability
levels are named in terms of it. The queue and the git lane are gated on decisions recorded below.

## Reconcile the baseline

The planning baseline is Platform `75caae889d967fed0e0c8df85aa315670ef9fe49`, working tree clean.
Every line reference below was opened at that commit.

| Existing owner                                       | Work to build on                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/server/src/utils/shell.ts`                     | The only current `utils/` module; a pure, stateless, dependency-free helper file  |
| `apps/server/src/sse.ts`                             | The precedent for a top-level shared runtime module with seven importers          |
| `apps/server/src/fs/errors.ts`                       | `FsError` (`:89`, extends `EvlogError`), `mapNodeError`, `nodeErrorCode` (`:128`) |
| `apps/server/src/fs/mutation-target.ts`              | Exported `statOptional`/`lstatOptional` over `statSafely` (`:99`)                 |
| `apps/server/src/fs/write.ts`                        | The reference atomic write: uuid temp, fsync file, rename, fsync directory        |
| `apps/server/src/settings/json-document.ts`          | Stage/commit split with a revision precondition between the two halves            |
| `apps/server/src/git/repository-lane.ts`             | `gitCommonDirectory` (`:14`) and the AsyncLocalStorage lane protocol              |
| `apps/server/src/orchestration/streams.ts`           | Retained-event bound, replay/gap protocol, batch coalescing                       |
| `apps/server/src/observability/structured-errors.ts` | `createStructuredError` / `createInternalError` — the only sanctioned throw path  |

Corrections to the census, found by reopening the cited lines:

- 6.3's `settings/json-document.ts:160` is the doc comment; the function is `stageSettingsFile` at
  `:161`.
- 6.5 records `orchestration/streams.ts` as exiting only on an explicit `close()`. It also wires
  `signal?.addEventListener('abort', subscriber.close, { once: true })` at `streams.ts:190`, so the
  abort path funnels through `close()`. The genuine outlier is
  `provider/provider-adapter-registry.ts:698`, a bare `for (;;)` with no abort path.
- 6.6 states that the upstream-fetch scheduler keys a _lane_ with a non-realpath'd path. It does
  not. `git/service.ts:174` feeds `UpstreamFetchScheduler`, which uses the value as a throttle key
  (`git/upstream-fetch.ts:48`, the common directory joined to the remote name) and never calls
  `withGitRepositoryLane`. All four real lane keyers already realpath: `git/service.ts:499` and
  `:1272` through `commonDirectory` (`:193`), `git/worktrees.ts:47` and `:51` through
  `gitCommonDirectory` (`:14`). The realpath decision therefore changes a duplicate-`git fetch`
  window and a temp-index path spelling, not lane identity.
- 9.8's "thirteen `fs/` modules" carrying the two-line `catch (error) { if (error instanceof FsError)
throw error; throw mapNodeError(error) }` is twelve at this commit. It stays either way.

Confirmed unchanged and used below: `lsp/routes.ts:354,372,376`; `terminal/service.ts:788,804,824`;
`orchestration/ws-rpc.ts:467,482`; `fs/workspace-edit.ts:1679,1742,2162,2171`;
`fs/workspace-edit-journal.ts:290,450,459,468`; `fs/write.ts:11,69,84`;
`settings/json-document.ts:230`; `settings/transaction.ts:551`; `installation/install.ts:21`;
`provider/status-cache.ts:111`; `fs/app-save-marker.ts:130`; `machines/remote-scripts.ts:55`;
`settings/store.ts:306`; `machines/events.ts:20`; `orchestration/streams.ts:157`;
`provider/provider-adapter-registry.ts:687`; `fs/watch.ts:509`; `db/migrations.ts:53,70,74`;
`git/service.ts:174,193`; `git/checkpoint-store.ts:153`; `git/utils/worktree-paths.ts:69,96`;
`lsp/typescript/runtime.ts:107`; `packages/client-core/src/chat/rail/{session-order.ts:26,
project-order.ts:39, unread.ts:30}`; `packages/client-core/src/commands/palette.ts:198,202`;
`packages/contracts/src/fuzzy-rank.ts:251,284`;
`packages/tree/src/utils/model/{gitStatus.ts:16, dragAndDrop.ts:15,19, pathHelpers.ts:20,43}`;
`packages/client-core/src/files/{path-input.ts:65, path.ts:10}`.

## Obey the server's error and logging rules

- Never `new Error`. `apps/server/src/fs` throws `FsError` (`fs/errors.ts:89`) or maps through
  `mapNodeError`; every other feature uses its `structured-errors.ts` wrapper. Shared helpers below
  throw nothing they can avoid throwing — a helper that swallows and rethrows moves the throw site
  into shared code and renames it in the logs.
- The wide event stays at the operation. `orchestration/streams.ts:166` and `:187` emit
  `chat.pipeline.stream_hub.unsubscribe` / `.subscribe`; those calls stay in `streams.ts`. A shared
  queue that logs them would make every server subscription emit a chat-pipeline event.
- Do not extract the twelve-module `catch`/`mapNodeError` pair. A thunk-taking version costs more
  lines than it saves and hides the throw site.

## Decide before writing code

1. **Do the weaker durability levels survive as named options?** (6.4) Three of seven writers do not
   fsync at all. A single writer either promotes them (extra `fsync` per provider status refresh and
   per app-save marker write) or keeps `durability: 'rename' | 'fsync-file' | 'fsync-all'`.
   Recommendation: keep the levels, make the argument required so no call site inherits a default.
2. **Does the shared writer chmod after create?** (6.4) `open(path, 'wx', mode)` is masked by the
   process umask. `fs/workspace-edit.ts:1695` and `fs/workspace-edit-journal.ts:295` follow the
   create with an explicit `chmod`; `settings/json-document.ts:169` does not, and `fs/write.ts:40`
   chmods only when a mode was passed. Recommendation: chmod whenever a mode is requested, and
   record that the settings file's mode becomes exact rather than umask-dependent.
3. **Does the shared queue stay unbounded?** (6.5) None of the five has backpressure. See the
   per-caller consequences below before answering.
4. **Realpath always for the git common directory?** (6.6) Settle this before any new caller keys a
   lane, a throttle, or a path with it.
5. **Is `ENOTDIR` "missing" for an existence check?** (6.3) `lsp/typescript/runtime.ts:102` and
   `:112` swallow `ENOENT` or `ENOTDIR`; the other four swallow `ENOENT` only. `ENOTDIR` is what a
   path whose parent component is a file returns, which for an existence check is missing.
   Recommendation: yes, and widen the narrow sites deliberately rather than by merge.

## Collapse the three WebSocket adapters

`websocketKey` is three byte-identical copies: `lsp/routes.ts:372`, `terminal/service.ts:804`,
`orchestration/ws-rpc.ts:482`. The adapter core is the same in all three: hoist `close` and `send`,
guard with `typeof close === 'function' ? close.call(value, code, reason) : undefined`, then return
`data`, `key`, and a bound `send`.

Differences to reconcile, and the winner:

- **Query lookup.** `lsp/routes.ts:376` tests `isRecord(data.query)` and then the value's type
  inside the block; `terminal/service.ts:824` tests both in one `&&`. Both fall through to
  `new URL(data.url).searchParams.get(key)` inside a `try`/`catch` when the query value is absent or
  not a string, and both return `null` on a malformed URL. The two are behaviour-identical; keep
  either spelling.
- **Message type.** `lsp/routes.ts:350` and `orchestration/ws-rpc.ts` send `string`;
  `terminal/service.ts:785` sends `string | Uint8Array` (binary PTY frames). Parameterise the
  adapter over the message type. Do not widen the LSP socket to accept `Uint8Array`.
- **Extra fields.** LSP adds `path`, `root`, `serverId` (`routes.ts:365–368`); terminal adds `input`
  (`service.ts:799`, a valibot parse of four query values); ws-rpc adds none. These stay at their
  call sites and are composed onto the shared adapter's result.

Home: `apps/server/src/utils/websocket.ts` — pure and stateless, matching `utils/shell.ts`.

Call sites to update: `lsp/routes.ts:103,173,184`, `terminal/service.ts:100,275,285`,
`orchestration/ws-rpc.ts:94,120`.

`orchestration/ws-rpc.ts:490` also holds an `elapsedMs` copy owned by
[Plan 091](091-error-and-timing-helpers.md). Same file, two plans: whichever lands second rebases.

## Collapse the fsync pairs, then extract fsync.ts

Free half first, zero behaviour change: inside `fs/workspace-edit.ts`, `fsyncFile` (`:2162`) and
`fsyncDirectory` (`:2171`) are the same body twice in one class; `fs/workspace-edit-journal.ts:459`
and `:468` likewise. Collapse each pair to one private `fsync`, and update its callers — eight in
`workspace-edit.ts` (`:1659,1660,1666,1696,1702,1704`, plus the `fsyncDirectories` loop at `:2181`)
and ten in `workspace-edit-journal.ts` (`:240,241,249,254,263,264,296,299,317,380`).

Then add `apps/server/src/fs/fsync.ts`:

- `fsyncPath(target)` for the `node:fs/promises` callers — `fs/write.ts:69` (`syncPath`) and
  `settings/json-document.ts:230` (`fsyncDirectory`, exported).
- `fsyncVia(open, target)` for the driver callers, where `open` is the workspace-edit driver's.

Differences to reconcile:

- The two classes go through `this.driver.open`; `write.ts` and `json-document.ts` through
  `node:fs/promises`. That is the whole reason for two exports, not one with a flag.
- `settings/transaction.ts:551` `fsyncDirectorySync` stays separate: it `mkdirSync`s first and uses
  the descriptor API (`openSync`/`fsyncSync`/`closeSync`), not a `FileHandle`.
- Neither export catches. `fs/write.ts:32` maps node errors through `mapNodeError` and
  `json-document.ts` has its own path; a `catch` inside `fsync.ts` would relabel both throw sites.

## Take the remaining server-internal collapses

**One migration, three names.** `db/migrations.ts:70` `migrateMetadataDatabase` and `:74`
`migrateOrchestrationDatabase` are pure pass-throughs to `migratePlatformDatabase` (`:53`). Two
production call sites, `orchestration/engine.ts:145` and `fs/metadata.ts:55`, plus test call sites in
`provider/tests/{provider-service,provider-session-reaper,
provider-session-directory,provider-shutdown}.test.ts`. Delete both names; greenfield, no alias.
`testing.ts:12` already re-exports only `migratePlatformDatabase`.

**ENOENT-tolerant stat, five copies, three predicates.** Home is the already-exported
`fs/mutation-target.ts:88` `lstatOptional`, plus a driver-taking variant for the two workspace-edit
classes (`fs/workspace-edit.ts:1742`, `fs/workspace-edit-journal.ts:450`). Reconcile, in order:

- Which codes mean missing — decision 5 above. `lsp/typescript/runtime.ts:107` is the wide one.
- `git/utils/worktree-paths.ts:96` hand-rolls `error instanceof Error && 'code' in error` where
  `nodeErrorCode` (`fs/errors.ts:128`) already exists. Switch it; same answer, one spelling.
- `lsp/typescript/runtime.ts:113` rethrows as a structured `invalidRuntime` error (`:121`). That
  wrapper stays at the call site — it carries the LSP code, status, why and fix.

## Unify the atomic writer

Seven write-temp-then-rename implementations at four durability levels, verified:

| Site                               | Temp name                         | fsync file    | fsync dir     | Mode               | Sync? |
| ---------------------------------- | --------------------------------- | ------------- | ------------- | ------------------ | ----- |
| `fs/write.ts:11`                   | `.<base>.<uuid>.tmp` (`:84`)      | yes (`:41`)   | yes (`:29`)   | preserves existing | async |
| `settings/json-document.ts:161`    | `.<base>.<uuid>.tmp` (`:168`)     | yes (`:173`)  | on commit     | caller's (`:169`)  | async |
| `fs/workspace-edit.ts:1679`        | via driver, uuid                  | yes (`:1696`) | yes (`:1704`) | 0o600 + chmod      | async |
| `fs/workspace-edit-journal.ts:290` | via driver, uuid                  | yes (`:296`)  | yes (`:299`)  | 0o600 + chmod      | async |
| `installation/install.ts:21`       | `<dest>.<uuid>.tmp`               | no            | no            | 0o700 (`:23`)      | async |
| `provider/status-cache.ts:111`     | `<file>.<pid>.tmp` (`:117`)       | no            | no            | default            | sync  |
| `fs/app-save-marker.ts:130`        | `<file>.<pid>.<now>.tmp` (`:132`) | no            | no            | default            | sync  |

Home: `apps/server/src/fs/atomic-write.ts`, with the explicit `durability` argument from decision 1.

Differences to reconcile before the merge:

- **Temp naming.** `<file>.<pid>.tmp` is not collision-safe: two writers to one path in one process
  share a pid and clobber each other's temp file. The uuid scheme wins at every site.
- **Durability.** Promoting `install.ts`, `status-cache.ts` and `app-save-marker.ts` to `fsync-all`
  is a silent write-amplification; demoting the other four loses a crash guarantee the workspace-edit
  journal depends on. Decision 1 settles it; the argument is required, never defaulted.
- **Mode.** Decision 2. `install.ts:23` is the only 0o700 caller and must keep it.
- **Sync writers cannot use an async helper.** `provider/status-cache.ts:111` is called from
  `:88` and `fs/app-save-marker.ts:130` from `recordAppSave` (`:29`), `consumeAppSave` (`:47`,
  `:52`) and `forgetAppSave` (`:68`), all synchronous public APIs. Either `atomic-write.ts` exports
  a sync sibling with the same durability vocabulary, or those two keep their bodies and only adopt
  the uuid temp name. Do not make the callers async to fit the helper.
- **Preconditions stay at the call site.** `fs/write.ts:19` validates `baseVersion`/`expectedMtimeMs`
  before the rename; `settings/json-document.ts` re-reads the revision in
  `tryCommitStagedSettingsFile` (`:188`); `workspace-edit-journal.ts:293` asserts the temp path is
  missing and `:297` that the manifest is replaceable. None of this moves into the helper.
- **Watcher registration stays at the call site.** `fs/workspace-edit.ts:1688` registers the temp
  path with `this.changes.addTransactionPaths` before creating it. A shared writer that creates the
  temp file without that registration surfaces the temp file as a filesystem event to every client.
- **Error wrapping stays at the call site.** `fs/write.ts:32` maps through `mapNodeError`;
  `installation/install.ts:26` throws `createStructuredError` with code `installation.WRITE_FAILED`;
  `provider/status-cache.ts:123` swallows into `recordChatPipelineWarning`; `app-save-marker.ts`
  does not catch. Four policies, four call sites, one helper that throws the raw node error.
- **`machines/remote-scripts.ts:55` is not an eighth copy.** It lives inside a JavaScript source
  string shipped to a remote host (`remote-scripts.ts:12` onward) with no module graph to import
  from. It keeps its own `<file>.<pid>.tmp`; note the collision hazard in a comment there and stop.

## Decide the queue before extracting it

Five listener→async-generator bridges: `settings/store.ts:306`, `machines/events.ts:20`,
`orchestration/streams.ts:157`, `provider/provider-adapter-registry.ts:687`, `fs/watch.ts:509`.

They disagree on four axes, and the shared primitive must answer each explicitly:

- **Waiter model.** `settings/store.ts:309` and `machines/events.ts:22` hold a single `wake` slot
  (one consumer); `orchestration/streams.ts:159` and `provider-adapter-registry.ts:691` hold a
  waiter array; `fs/watch.ts:25` uses a mutable `WakeSlot` so the wake can be swapped. Note also that
  `settings/store.ts` clears the slot after waking and `machines/events.ts` does not, so the latter
  retains a resolved resolver's closure between events. The shared primitive clears the slot.
- **Direct handoff.** `orchestration/streams.ts:176–180` hands a batch straight to a parked waiter
  and only queues when there is none; the other four always queue and then wake. The observable
  difference is ordering under a concurrent publish; pick queue-always and prove the batch order in
  `streams.test.ts` rather than assuming it.
- **Termination.** `settings/store.ts:318`, `machines/events.ts:34` and `fs/watch.ts:514` exit on an
  `AbortSignal`; `orchestration/streams.ts:163` exits on `close()`, which resolves pending waiters
  with `{ done: true }`, and `:190` wires abort into that same `close()`;
  `provider-adapter-registry.ts:698` has no abort path at all and its `finally` at `:711` calls
  `waiters.splice(0)`, dropping resolvers without resolving them. The shared primitive supports both
  abort and close, and resolves every pending waiter on teardown.
- **Payload granularity and seeding.** `orchestration/streams.ts` yields batched
  `OrchestrationEvent[]`; the rest yield single items — a generic `T` covers both.
  `machines/events.ts:21` replays an `initial` array; keep that as an option, not the default.

**Backpressure (decision 3).** None of the five bounds its queue. What a bound would mean per caller:

- `fs/watch.ts:355–372` is the exposed one: a branch switch or a large checkout pushes thousands of
  events, and the server holds all of them until the client socket drains.
- `orchestration/streams.ts` is the only caller that can already express "you fell behind": it
  bounds retained history with `appendBounded(…, RETAINED_EVENT_LIMIT)` (`:203`), answers a stale
  cursor with `{ kind: 'snapshot', reason: 'history-evicted' }` (`:157`), and coalesces batches
  downstream (`:297`). A bound here degrades to a snapshot rather than dropping data.
- `settings/store.ts`, `machines/events.ts` and `provider-adapter-registry.ts` are low-rate; a bound
  buys nothing and a silent drop would lose a settings change.

Recommendation: keep the queue unbounded by default, take an optional `limit` plus an overflow
callback, and let only the orchestration hub opt in, wiring overflow to its existing snapshot path.

Home: `apps/server/src/async-queue.ts`, beside `apps/server/src/sse.ts`. Not
`apps/server/src/utils/async-queue.ts` as the census proposes — AGENTS.md restricts `utils/` to
pure, stateless code with no subscriptions, and this is a subscription bridge. `sse.ts` is the
existing precedent for a shared top-level runtime module.

If census 9.13's dead SSE routes (`orchestration/routes.ts:216,233`) are deleted first, this item
has two fewer consumers to re-verify. Do not block on it.

## Settle realpath, then widen the repository lane

Five resolutions of `git rev-parse --git-common-dir`:

| Site                             | Resolution                                                                  |
| -------------------------------- | --------------------------------------------------------------------------- |
| `git/repository-lane.ts:14`      | `path.resolve` + `realpath` (exported)                                      |
| `git/service.ts:193`             | `path.resolve` + `realpath` — a duplicate of it                             |
| `git/service.ts:174`             | `path.resolve`, **no realpath**                                             |
| `git/checkpoint-store.ts:153`    | **no realpath**, plus an `isAbsolute` branch `path.resolve` already handles |
| `git/utils/worktree-paths.ts:69` | `path.resolve` + `realpath`, via `-C`                                       |

Decide realpath-always (decision 4), then fold the four into `gitCommonDirectory`, widened to accept
either runner shape. The consequences, corrected from the census:

- `git/service.ts:174` is the `UpstreamFetchScheduler`'s `resolveCommonDir`. Its value becomes a
  throttle key at `git/upstream-fetch.ts:48` and is cached per root at `:52`. Without realpath, the
  same repository reached through a symlinked root (`/tmp/x` versus `/private/tmp/x` — the normal
  case on macOS) produces two throttle keys and therefore two concurrent `git fetch` runs for one
  remote. Realpath-always closes that window.
- `git/checkpoint-store.ts:153` builds a temp index path inside the common dir. Realpath changes
  only the spelling of that path; git locks the resolved file either way. Delete the `isAbsolute`
  branch in the same edit.
- Lane identity does not change: all four lane keyers already realpath.

Also in `repository-lane.ts`: `withGitRepositoryLane` (`:19`) and `withGitRepositoryLaneStream`
(`:39`) run the same protocol — re-entrancy check against the ALS store, chain on `pending`, mint a
`Promise.withResolvers` completion, build the lease map, and in `finally` invalidate the lease,
resolve, and delete the pending entry only if it is still ours. Extract
`acquireLane(commonDirectory): { context, release }` in the same file. The generator's pumping loop
(`:52–58`, each `iterator.next()` inside `active.run(context, …)`) and its `iterator.return()` before
release (`:60–66`) are genuinely different and stay.

## Finish the package-internal rows of 6.3

These three rows of 6.3 are not in `apps/server`; they are small and land here rather than nowhere.

- **Rail timestamps.** `chat/rail/session-order.ts:26`, `project-order.ts:39` and `unread.ts:30` are
  the same NaN-safe `Date.parse`; only `session-order.ts:25` carries the comment explaining that a
  malformed stamp sinks to the epoch, and `unread.ts` names it `stampMs`. Move one copy to
  `packages/client-core/src/chat/rail/timestamp.ts`, keep the comment, pick one name.
- **Palette tokenizer.** `commands/palette.ts:198` `queryPieces` is byte-identical to the private
  `packages/contracts/src/fuzzy-rank.ts:251`. The palette filters with one tokenizer and ranks with
  the other, so a future divergence mis-scores silently. Export `queryPieces` from `fuzzy-rank.ts`
  and re-export it from the contracts index. `compareNumbers` differs only in shape —
  `palette.ts:202` is the `if` form, `fuzzy-rank.ts:284` a nested ternary that AGENTS.md forbids —
  so the shared home takes the `if` form.
- **Tree path helpers.** `dragAndDrop.ts:15` `isCanonicalDirectoryPath` is byte-identical to
  `pathHelpers.ts:43`. `gitStatus.ts:16` `getAncestorDirectoryPaths` is _not_ the same
  implementation as `pathHelpers.ts:20`: the former walks with `indexOf` and slices prefixes in one
  linear pass, the latter `split`s and rebuilds a joined prefix per ancestor, which is quadratic in
  segment count. They agree on `'a/b/c'`, `'/a/b'`, `'a//b'`, `'a/'`, `'a'` and `''`. Keep the linear
  loop as the body, keep `pathHelpers.ts`'s exported name and signature, and land one test per edge
  rather than merging on inspection. `dragAndDrop.ts:19` `getPathBasename` has no twin in
  `pathHelpers.ts` and is not a `basename` merge candidate — see
  [Plan 092](092-path-and-uri-helpers.md) for that family.
- **Root normalizer.** `files/path-input.ts:65` `withoutTrailingSlash` is equivalent to
  `files/path.ts:10` `normalizeWorkspaceRoot`; its `'/'` special case is already covered by the
  `replace(/\/+$/, '')` on the next line. Share only the normalizer. The converters around it
  (`path.ts:33,48` versus `path-input.ts:33,3`) are deliberately different — one serializes tab
  state and rejects `..`, the other validates human typing and resolves it.

The fourth non-server row of 6.3 — the `performance.now` fallback at
`client-core/src/settings/{mutation-policy.ts:67, stream.ts:215, intent-store.ts:355}` — belongs to
[Plan 091](091-error-and-timing-helpers.md), which adds `@workspace/observability` to
`packages/client-core` for its `elapsedMs` work. Do not land it here.

## Verify plausible failures

App tests run `bun --bun vitest` from `apps/server` and `apps/web`; `packages/*` run plain `vitest`.
Run the named file, not the suite.

| Failure to catch                                                   | Narrowest check                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared adapter drops `path`/`root`/`serverId` or the binary `send` | `apps/server/src/lsp/tests/routes.test.ts`, `apps/server/src/terminal/tests/service.test.ts`                                                                  |
| RPC socket close/key handling changes                              | `apps/server/src/orchestration/tests/ws-rpc.test.ts`                                                                                                          |
| Collapsed `fsync` loses the directory sync after a rename          | `apps/server/src/fs/tests/workspace-edit.test.ts`, `apps/server/src/settings/tests/transaction-recovery.test.ts`                                              |
| Shared writer swallows the base-version / revision precondition    | `apps/server/src/settings/tests/write-versioning.test.ts`, `write-concurrency.test.ts`, `apps/server/src/fs/tests/mutation-containment.test.ts`               |
| Temp file leaks into watcher output or is left behind on failure   | `apps/server/src/fs/tests/watch.test.ts`, `apps/server/src/fs/tests/workspace-edit.test.ts`                                                                   |
| Sync writers made async, or marker/status writes lost              | `apps/server/src/fs/tests/app-save-marker.test.ts`, `apps/server/src/provider/tests/driver-registry.test.ts`                                                  |
| Launcher mode or atomic install regressed                          | `apps/server/src/installation/tests/install.test.ts`                                                                                                          |
| Renamed migration breaks a boot path                               | `apps/server/src/db/tests/migrations.test.ts`, `apps/server/src/orchestration/tests/session-projection.test.ts`                                               |
| Queue loses an event, reorders a batch, or hangs on abort/close    | `apps/server/src/orchestration/tests/streams.test.ts`, `apps/server/src/settings/tests/store-watch.test.ts`, `apps/server/src/machines/tests/service.test.ts` |
| Watch generator stops draining or leaks an abort listener          | `apps/server/src/fs/tests/watch.test.ts`                                                                                                                      |
| Realpath change splits or merges a lane, or moves the temp index   | `apps/server/src/git/tests/repository-lane.test.ts`, `worktrees.test.ts`, `checkpoint-store.test.ts`                                                          |
| Duplicate `git fetch` window stays open through a symlinked root   | `apps/server/src/git/tests/upstream-fetch.test.ts` — add a symlinked-root case                                                                                |
| Ancestor-path merge changes an answer                              | `packages/tree/src/utils/tests/controller.test.ts` plus a new per-edge table test                                                                             |
| Rail ordering or palette grouping shifts                           | `apps/web/src/features/chat-mode/utils/tests/session-rail-model.test.ts`, `apps/web/src/features/command-palette/tests/command-palette-utils.test.ts`         |

Type-level proof for the mechanical edits: `bun run typecheck` in `apps/server` after the adapter,
migration and `lstatOptional` collapses. No repository-wide suite, no absolute test count.

## Do not do this here

- `jsonEqual` (6.1) and its contracts re-export — [Plan 090 regression record](../docs/duplicate-defect-regressions.md).
- `elapsedMs`, `errorSummary`, `errorMessage`, `isRecord` and the client-core `performance.now`
  fallback — [Plan 091](091-error-and-timing-helpers.md).
- Path, URI and `basename` unification, including `apps/server/src/fs/path.ts` containment and the
  LSP path helpers (3.4, 3.8) — [Plan 092](092-path-and-uri-helpers.md).
- The session-busy predicate, the git-status partition, and anything landing in
  `packages/client-core` for web↔TUI parity — [Plan 094](094-client-core-web-tui-parity.md).
- Deleting the unused contracts exports and the dead orchestration SSE routes —
  [Plan 096](../docs/web-layering.md).

## Completion checklist

- [ ] All five decisions above are recorded with an answer before the corresponding edit lands.
- [ ] `apps/server/src/utils/websocket.ts` serves all three sockets; no socket gained a message type
      it did not have.
- [ ] `apps/server/src/fs/fsync.ts` exists; `settings/transaction.ts:551` is untouched.
- [ ] `apps/server/src/fs/atomic-write.ts` takes a required durability argument; preconditions,
      watcher registration and error wrapping remain at their call sites.
- [ ] `machines/remote-scripts.ts:55` is unmerged and carries a comment saying why.
- [ ] `apps/server/src/async-queue.ts` resolves every pending waiter on teardown and emits no log
      events of its own.
- [ ] `gitCommonDirectory` is the only common-dir resolution; the realpath answer is applied at all
      four former sites.
- [ ] No `new Error` was introduced; every new throw carries `code`, `status`, `why` and `fix`.
- [ ] The twelve-module `FsError`/`mapNodeError` catch pair is still written out at each site.
