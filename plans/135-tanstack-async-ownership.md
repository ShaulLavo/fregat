# Plan 135: Give TanStack ownership of async caches and route preparation

Status: **IN PROGRESS on L6. P0–P2 complete. P3–P8 pending.**
Priority: P2. Effort: L, split into independently verifiable phases. Risk: medium for
resource caches, high for pagination and settings recovery.
Planned against Platform `aeff92d7` plus the working tree on 2026-09-21.

## Outcome

Query owns async reads, cached resources, deduplication, and operation status in React
and non-React code. Mutations own effects. Router starts the queries a destination can
predict. Pacer retains scheduling where it is already in use. Domain state still owns
selection, document edits, stream projections, and resource lifetimes.

The user selected this direction after replacing a hand-written promise cache for the
settings and terminal imports. This plan completes that family of work and introduces
route loading where the current architecture supports it. It does not turn every
Promise into a query or move the workbench under route components.

## Drift and dependencies

Before implementation, run:

```bash
git status --short
git diff --stat aeff92d7..HEAD -- apps/web packages/client-core packages/markdown apps/server
git diff -- apps/web/src/main.tsx apps/web/src/state apps/web/src/features/settings apps/web/src/features/terminal
```

Inspect staged changes too. The baseline includes unrelated in-progress work; preserve it. In particular,
settings and terminal module queries exist in the working tree, while HEAD still contains
the removed promise helper. Do not recreate that helper from an older plan.

Read `AGENTS.md`. Follow feature boundaries, exact-file imports, depth at most three,
structured errors, and the existing query/mutation key ownership rules. Runtime-neutral
packages use `@tanstack/query-core`, with no dependency on React or application modules.

Overlap to reconcile, without reimplementing those plans:

- Plan 109 owns boot weight and the first-frame contract. Its `retryable-import.ts`
  description predates the current working tree. Keep settings, terminal, Mermaid, and
  Markdown parser payloads out of the initial static import graph.
- Plan 128 includes navigation subscriptions and lifetime work. This plan adds pure route
  preparation; it does not replace that coordinator or its store.
- Plan 094 owns web/TUI parity. Pagination query definitions belong in client-core and
  must serve both consumers rather than growing another web-only implementation.
- File freshness and conflict handling are settled (Plan 134, done). Do not introduce speculative file
  reads around its admission rules as part of this plan.

`PLAN.md` remains authoritative for cross-project scheduling. This plan is an unscheduled
proposal; no source migration, commit, deployment, or runtime restart is authorized by it.

## Research: what Router can do here

Installed versions, checked from resolved package metadata: Router `1.170.35`, React
Query and query-core `5.102.8`.

### Current application topology

- `apps/web/src/state/router.ts` builds a code-based route tree with `defaultPreload: false`.
  Pending delays are zero. It currently has no query context.
- `state/routes/root.ts`, `workspace.ts`, `workbench.ts`, and `chat.ts` describe URL matching
  and validation. They contain no loaders or route components. Settings has local and
  remote `/workbench/settings` leaves; terminal is a panel, not a route leaf.
- `providers/navigation-provider.tsx` renders `<RouterProvider ... />` and application
  children as siblings. The editor, terminals, and settings surfaces are not Router outlets.
- `state/navigation-coordinator.ts` subscribes to history, `onBeforeNavigate`, and
  `onResolved`. `commit()` awaits Router navigation, then applies the address.
  `applyCurrent()` activates the destination through `features/address/state/apply-view.ts`.
- `features/address/utils/route-options.ts:hasAvailableRoute` requires every matched route
  to have success status. A thrown loader error would currently make the destination
  unavailable before the normal pane can show its error state.
- `state/bootstrap.ts` attaches the application after cached boot preparation or descriptor
  acquisition. `main.tsx` warms restored views before `createRoot`. Moving all startup
  warmup into Router would lose that earlier opportunity.
- A source scan found no `<Link>` or `preloadRoute()` callers. Turning on intent preloading
  globally would not make command-palette navigation or arbitrary buttons preload.

### Library findings and decision

Router supports loaders that prepare an external Query cache. Keep query options shared
between the loader and the eventual consumer; do not keep a second copy of the result in
route loader data. [External data loading](https://tanstack.com/router/latest/docs/guide/external-data-loading)

`beforeLoad` runs serially through matched routes, while loaders run in parallel. Use
`beforeLoad` for required context/validation, not independent resource fetches. Set
`defaultPreloadStaleTime: 0` when introducing Query-backed route preloads so Query decides
freshness. Declare only the search inputs that affect preparation in `loaderDeps`.
[Data loading](https://tanstack.com/router/latest/docs/guide/data-loading)

Code-based routes support `.lazy()` and `createLazyRoute`. Automatic splitting is a
file-based routing feature. Neither is a reason to move persistent pane UI into outlets:
our current route records have no components to split. Keep component imports as resource
queries unless a future feature is genuinely rendered by a route.
[Code splitting](https://tanstack.com/router/latest/docs/guide/code-splitting)

The installed query-core source already exposes `queryClient.query(options)` and marks
`fetchQuery`, `prefetchQuery`, and `ensureQueryData` deprecated. New imperative reads in
this plan use `query()`. Optional warmups handle rejection explicitly; critical reads
propagate it to their operation owner. Phase 0 removes all deprecated imperative Query
APIs throughout repository-owned source, tests, and executable examples, including the
infinite-query variants. The user explicitly expanded this plan to include that migration.
[Current prefetching API](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)

A read-only in-process experiment used the installed Router, a memory history, a root
context containing a QueryClient, and a componentless settings route. Preload followed by
`router.load()` invoked its loader twice, performed the query function once, and left both
matches successful with cached data available. This establishes library capability, not
application timing or browser performance. Repeat it as an application test in Phase 2.

**Decision:** introduce non-blocking, read-only route warmups first. Keep destination
application, stream attachment, terminal creation, selection, settings writes, and native
picker opening out of loaders. A loader must never await application activation that is
itself waiting for `onResolved`. No route cancellation may indiscriminately cancel a
shared resource query another pane still needs.

## Cache and lifetime contracts

Use three explicit scopes:

| Scope                      | Owner                                                                                   | Examples                                                               |
| -------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Browser resources          | One application-owned core QueryClient, passed explicitly to resource hooks and loaders | Immutable module imports, Mermaid library, Ghostty runtime             |
| Environment reads          | Existing per-origin QueryClient, preserving identity admission                          | Chat history pages, settings recovery                                  |
| Instance/service resources | Injected or instance-owned core client with explicit disposal                           | Palette-specific highlighters; server capability and repository lookup |

Create `apps/web/src/lib/resources/state/query-client.ts` for the browser resource client.
Do not wrap the whole application with another provider: descendants still need their
environment QueryClient. Keep the resource client visible to the existing cache inspection
command through a separate named resource entry, without pretending it has a server owner.
Package consumers receive explicit clients or own an instance; they must not import this
web module. Add direct query-core dependencies where required and use the installed version.

For each query, write down its identity, freshness, retention, failure behavior, and owner
before changing callers:

- Browser-local initialization uses `networkMode: 'always'` so an offline flag does not
  block work that may already be local. Actual remote reads retain network-aware behavior.
- Use `'static'` for immutable build modules. Mutable themes/registrations need revision
  identity or invalidation, not unconditional static caching by display name.
- Disable structural sharing for opaque handles such as IDB connections, highlighter
  instances, and renderer runtimes. Never persist/dehydrate these values.
- Retain a process/browser singleton deliberately. Finite query GC does not close a handle;
  its owner must close/dispose it and remove the query when its lifetime ends.
- Query functions must resolve a defined value. Initialization currently returning
  `Promise<void>` must return the initialized resource or a defined completion marker.
- A render-time synchronous read may use successful query data. Do not retain a second
  promise map or separate pending/error store. Preserve any stable snapshot required by a
  rendering contract as a derived view, with a test for identity.
- Cache the requested resource, not its UI fallback. Failure can render plain text/default
  colors while Query retains the failure and permits the next intentional retry.
- Browser module loading may itself retain failures. Test actual chunk failure behavior;
  do not claim that resetting Query guarantees a new network request. If the browser cannot
  retry a failed module URL, provide the existing reload recovery path with a clear action.

## Inventory and migration order

Paths below are implementation scope, together with their direct callers, owned query keys,
focused tests, package manifests/lockfile, and browser verification scenarios.

| Phase | Source                                                                                                                           | Replace/preserve                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1     | `apps/web/src/features/settings/utils/page-query.ts`, terminal `utils/panel-query.ts`, their `components/deferred-*`, `main.tsx` | Move module queries to browser resources; replace deprecated imperative preload calls               |
| 3     | `apps/web/src/features/editor/state/color-theme-store.ts`                                                                        | Replace `loadedThemeById`; consolidate registration loading; preserve theme selection/preview state |
| 3     | `apps/web/src/lib/code-theme/state/preview.ts`                                                                                   | Replace highlighter promise and per-theme preview promise map                                       |
| 3     | `apps/web/src/features/chat/state/mermaid.ts` and `hooks/use-mermaid.ts`                                                         | Query owns library acquisition and status; retain renderer configuration/IDs                        |
| 3     | `apps/web/src/features/terminal/state/mount.ts:initializeGhostty`                                                                | Replace initialization promise; retain live terminal ownership                                      |
| 4     | `packages/markdown/src/state/extensions.ts`                                                                                      | Replace extension promise map; preserve derived frozen extension snapshot identity                  |
| 4     | `packages/markdown/src/utils/shiki-highlighter.ts`                                                                               | Replace per-instance initialization/language promises; retain palette-specific lifetime             |
| 5     | `apps/web/src/features/editor/state/history-store.ts`, chat `state/attachment-blobs.ts`                                          | Query owns database acquisition; retain transaction adapters and storage rules                      |
| 6     | `apps/web/src/features/chat/state/session-earlier-pages.ts`, its page-status store, `packages/client-core/src/chat/owner.ts`     | Shared page-read queries/observers; preserve streaming projection and merge rules                   |
| 7     | `packages/client-core/src/settings/snapshot-admission.ts`                                                                        | Replace recovery promise dedup only; preserve epoch/generation/acknowledgment protocol              |
| 8     | `apps/server/src/fs/search-tool-runner.ts`, `apps/server/src/git/upstream-fetch.ts`                                              | Replace lookup promise maps; preserve Pacer throttling and worktree-shared fetch budget             |

Known behavior to reproduce before changing it:

- Editor history retains a rejected database-open promise; attachment storage clears it.
- Mermaid retains failure as a fulfilled null for the browser session.
- Markdown language loading marks a language loaded even when core initialization failed,
  retaining the settled language promise. The same language cannot retry initialization.
- Theme `ensureRegistrationLoaded()` can start a registration load without entering it in
  the existing promise map when no selected-theme load is in progress.
- Core chat pagination checks selected session ID when settling. Reproduce A→B→A while an
  old A request is outstanding; session equality alone may not identify the current request.
  Treat this as a suspected race until the regression test demonstrates it.

## Implementation phases

### 0. Remove deprecated imperative APIs across the repository

Completed 2026-09-25: 46 calls in 24 files migrated. None used ensure/infinite variants or selected option factories. Required failures propagate; optional warmups retain a non-rejecting void result. The AST gate fails on the prior source and passes after migration, including seven direct/optional/computed/alias/prose tests. Twelve owner test files pass with 110 cases; web types pass. `query:check` runs in verify, gates and CI. Repeat the sweep after the final rebase.

This is a required first phase, independent of the resource-cache redesign. Scope all
repository-owned TypeScript/JavaScript under `apps/`, `packages/`, and `scripts/`, including
tests and executable examples. Also update active documentation and maintained TanStack
skill examples. Do not edit vendored dependencies, generated bundles, or immutable history.
The synchronization exclusions below do not exempt deprecated API calls: migrate those
calls while preserving their surrounding domain behavior.

The 2026-09-21 scan found **35 references in 22 source/test files**: 26 `fetchQuery` and
9 `prefetchQuery`; no source references to ensure or infinite variants. Repeat the scan
at execution time. Known production callers are `main.tsx`, `state/navigation.ts`,
`keymap/providers/command-provider.tsx`, `features/file-picker/hooks/use-directory-transition.ts`,
`features/editor/providers/state-provider.tsx`, editor `state/history-persistence.ts`,
`features/chat-mode/state/notification-host.ts`, `features/settings/hooks/use-bundle-export.ts`,
`features/workspace/hooks/use-tree.ts` and `use-events.ts`,
`features/terminal/state/register-checkout.ts`, `lib/file-snapshot-query-cache.ts`,
`features/chat/hooks/use-open-checkpoint-diff-document.ts`, and
`features/git/utils/admit-mutation.ts`, all below `apps/web/src/`.

Apply a semantic migration, not a blind text replacement:

| Deprecated method         | Replacement                                      | Preserve/check                                                                                                           |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `fetchQuery`              | `query`                                          | Freshness, return value, error propagation, retry and cancellation                                                       |
| `prefetchQuery`           | `query` with explicit rejection handling         | Optional failure; retain `Promise<void>` with `.then(() => undefined).catch(() => undefined)` when callers require it    |
| `ensureQueryData`         | `query` with explicit freshness policy           | Old default accepted stale cached data; per-call `staleTime: 'static'` preserves cache-presence semantics where intended |
| `fetchInfiniteQuery`      | `infiniteQuery`                                  | Page parameters/count and result type                                                                                    |
| `prefetchInfiniteQuery`   | `infiniteQuery` with explicit rejection handling | Optional failure and void contract as above                                                                              |
| `ensureInfiniteQueryData` | `infiniteQuery` with explicit freshness policy   | Cached pages and background revalidation behavior                                                                        |

New `query()` execution applies an options object's `select`; old `fetchQuery()` returned
raw query-function data. Audit factories shared with hooks and decide whether each imperative
caller requires raw or selected data. Do not change the cache's raw data shape to fix a type
error. Avoid new casts. Remove `revalidateIfStale` at migrated ensure call sites: explicitly
preserve cached-immediate/background-refresh semantics when required, or document and test
the intentional switch to awaiting fresh data. Never carry the obsolete option silently.
For fire-and-forget optional work use `void client.query(options).catch(...)`; simply
replacing the method would create unhandled rejections. Required reads must still reject.

Migrate each owner with its tests in the same unit. Do not introduce aliases named after
the old methods, wrappers to preserve obsolete APIs, or separate temporary promise caches.
The installed version already supports replacements; this phase needs no dependency upgrade.

Add an executable prevention check through the existing lint/census infrastructure. Scope
it to deprecated QueryClient API usage in maintained source/test/example files and integrate
it into `verify` and CI. Cover direct, optional, and literal-computed calls plus any method
alias/destructuring forms in the repository. Do not rely on a text-only count that treats
deprecation explanations as calls. Test the check with a forbidden call and alias, a valid
`query`/`infiniteQuery` call, and text that merely documents the old method. The check itself
must not require an allowlist entry to name the APIs it prohibits. Reuse existing tooling
where possible rather than adding a second general lint framework.

**Verify:** focused tests for each changed owner, corresponding package typechecks, and the
new prevention check all pass. Cover required rejection, optional non-rejection/void result,
fresh/stale/missing data, selected/raw return values, same-key concurrency, and infinite
page preservation for any infinite caller found. The following search is an additional
inventory check; expected result is no deprecated calls, not necessarily no prose mentions:

```bash
rg -n '\b(fetchQuery|prefetchQuery|ensureQueryData|fetchInfiniteQuery|prefetchInfiniteQuery|ensureInfiniteQueryData)\b' apps packages scripts --glob '*.{ts,tsx,js,mjs}' --glob '!**/node_modules/**' --glob '!**/dist/**'
```

The skills were corrected while writing this revision: project Query skill
`.agents/skills/tanstack-query-best-practices/` and personal Router skill
`~/.agents/skills/tanstack-router-best-practices/`. Their entrypoints now require checking
the installed API and their executable examples use current methods. Keep personal skills
at the shared source-of-truth path; do not copy them into Codex/Claude symlink directories.
Recheck those examples after any Query upgrade.

### 1. Establish browser resource ownership

Completed 2026-09-25. Shared browser resource client, module consumers/preloads, cache inspection, offline/prewarm/concurrency tests and browser loading evidence are recorded in [verification](../docs/verification/2026-09-25-query-ownership.md).

Implement the resource client and migrate only the already-query-backed settings/terminal
modules and startup reads first. Share exactly the same client and options at preload and
render. Keep feature query keys in their current feature-owned files. Update resource cache
inspection in `scripts/agent/browser.ts`/its existing cache collector, without changing
server-client ownership validation.

Add focused tests proving simultaneous preload/render requests share one query execution,
prewarmed data renders without a loading flash, and a resource query can run offline.
Match `apps/web/test/fixtures.ts` and existing test providers. Do not mock application modules.

Verify: web typecheck, focused module-loading tests, compiler census, and
`PORT=3001 bun run agent:browser scenario settings-cold-load`. Inspect both loading and loaded
screenshots and the captured console/log window. The PORT override selects the existing dev
API rather than a production port inherited from the environment.

### 2. Add a safe Router preparation path

Completed 2026-09-25. Explicit client context and optional settings loaders pass 330 tests across the address/resource suite. Direct URL, command, back/forward, both rails and real failed-module Reload recovery pass in Chromium. The trace pair establishes no latency benefit.

Scope: `state/router.ts`, `state/routes/root.ts`, `state/routes/workbench.ts`, their direct
construction callers, `main.tsx`, and `features/address/tests`.

1. Type root context with the resource QueryClient using `createRootRouteWithContext`.
   Supply it explicitly from router construction. Tests supply a fresh client.
2. Add a settings leaf loader, shared by the local/remote route factory. Start
   `context.resources.query(settingsPageQueryOptions)` without awaiting it. Handle its
   rejection as an optional warmup, with the query retaining the error for pane recovery.
   A failed import must not change `hasAvailableRoute()` or prevent address application.
3. Set `defaultPreloadStaleTime: 0`. Keep `defaultPreload: false` initially. An explicit
   preload test proves the loader is safe; a later focus/hover trigger must call
   `router.preloadRoute()` itself or use a real Router Link. Do not add speculative hover
   behavior throughout the command UI as part of this phase.
4. Retain pre-root restored-view warmup. Route preparation supplements that earlier boot
   path and helps later navigation. Terminal, Mermaid, and palette-specific highlighting
   still have on-demand consumers because they can appear on many routes.
5. Do not preload file snapshots, remote connections, or chat projections yet. Those need
   destination environment resolution independent of the active environment and must use
   the existing snapshot/admission path. Record a separate extension only after timing and
   side-effect tests show that the read is both safe and useful.

Add `features/address/tests/route-preparation.test.ts`: local and remote settings routes,
explicit preload without activation, one execution across preload/consumer, rejection that
does not make a valid route unavailable, rapid navigation away, and independence from an
unattached application. Exercise the real router factory; no fake router implementation.

Verify: the new tests plus existing router, navigation-ownership, continuous-navigation,
and cached-bootstrap tests. In the browser, verify direct URL, command navigation, back/
forward, and a settings view opened outside the settings leaf. Trace the same navigation
before/after; claim a latency benefit only if the trace demonstrates it. If loaders start
no earlier in a relevant path, keep that path's consumer query and omit its loader.

### 3. Migrate web resource caches

Migrate each inventory entry as one unit with its callers and obsolete state removed.
Theme registrations should have one acquisition query reused by selection and previews.
Include theme content revision when mutable registration content can change under one ID.
Do not cache a light/dark fallback under the failed theme's key.

Mermaid library acquisition is a read; rendering/configuring its mutable renderer is a
separate operation. Preserve ordering where required rather than treating every render as
an immutable cached result. Ghostty initialization must stay independent of PTY/terminal
lifetimes: a parked terminal remains mounted and switching modes creates no second shell.

Verify: theme store, editor-theme hook, preview state/hook tests, and focused Mermaid/Ghostty
failure/retry tests. Add concurrent-load and preview/commit races using real query-core.
Run relevant browser theme, Markdown, and terminal scenarios from `agent:browser list`.

### 4. Migrate Markdown resources with instance isolation

Add query-core to `packages/markdown`. Shared extension imports may share an injected
resource client. Highlighter initialization and grammar registration must be keyed by
highlighter instance plus language, or use an instance-owned client. Language alone is
not enough: two palettes must not share a mutable highlighter.

Eliminate `ready`/`loading` caches and separate async status flags. Preserve the synchronous
highlighting API and derived extension snapshot identity, with explicit disposal. Failed
initialization must not mark a grammar successfully loaded. Fallback stays plain text;
another intentional request can retry after a failure without a render retry loop.

Verify: package typecheck/tests, especially `src/components/tests/markdown.test.tsx`, plus
new same-language failure-then-success, concurrent grammar, palette isolation, and disposal
tests. Verify Mermaid/math/raw HTML/code in the web consumer without growing eager chunks.

### 5. Migrate IndexedDB acquisition

Key acquisition by database name/version in the browser resource client. Clear failed
acquisition through Query retry semantics. On version change or explicit close, remove the
closed connection and reacquire on next demand. Never cache a closed handle as success.

Keep transaction-to-Promise adapters. Review reads/writes at their operation owner before
adding queries/mutations: do not nest a second mutation around an existing serialized
editor or attachment operation. Database connection caching is separate from record caching.

Verify in a real browser: opening fails then succeeds; two callers share opening; version
change replaces the handle; history trimming and attachment size limits remain enforced;
write completion occurs after transaction commit. Use fixtures with isolated database names.

### 6. Consolidate history-page read state in client-core

Create shared page query definitions in `packages/client-core/src/chat/`, keyed by owning
environment/session and the exact request boundary. Capture the current boundary at action
time, as the existing loader does. Include a history lifetime/generation where a reconnect
can make the same boundary refer to a different snapshot.

Use core observers for non-React consumers and hooks/observers for web status. Preserve the
canonical streaming projection; query results are page acquisition, not a second writable
chat history. Delete the web in-flight map and its pending/error store when callers move.
Use an owner/request generation to prevent old completions from affecting a new selection.
Do not force `useInfiniteQuery` onto a projection whose live merge contract differs.

Verify existing web `state/tests/session-earlier-pages.test.ts` and core chat-owner tests.
Add double-click dedup, exhausted history, retry, live append, reconnect, disposal,
environment isolation, and A→B→A with completions deliberately out of order. Exercise web
scrollback and the TUI consumer before considering the shared migration complete.

### 7. Move settings recovery dedup without changing admission

A dedicated recovery query on the existing settings QueryClient owns the recovery read
and evidence publication. Its key includes the recovery/admission lifetime. Use
`staleTime: 0`: each new recovery after the preceding operation settles must perform a
fresh read; concurrent callers join the current operation. A static or infinitely fresh
result would incorrectly reuse evidence across successive server epochs. Do not recursively request the document
query whose query function already invokes admission: that can wait on itself. Reuse the
transport boundary, then pass its evidence into unchanged epoch/generation admission rules.

The current `AdmissionState.recovery` is also an admission barrier. Incoming updates join
an existing recovery before checking retired epochs or acknowledging intents. Preserve that
barrier using the query-backed operation, whose pending lifetime extends through evidence
publication/admission, not just the HTTP response. Read/join its operation through Query
instead of storing another promise beside it. Do not let the recovery operation join itself.

Remove `AdmissionState.recovery` only after deduplication and barrier behavior are proven.
Keep deferred intent acknowledgments, supersession checks, and the settings write queue.
Verify concurrent unexpected epochs share a read, reset rejects stale recovery, reordered
stream/response delivery remains correct, provider invalidation has the same evidence,
and failed recovery can retry. Add a same-epoch update arriving during recovery that cannot
acknowledge early, and two successive server epoch changes within one owner lifetime that
require two fresh reads. Run the existing settings owner/admission tests in core
and their web consumer tests before landing this phase.

### 8. Migrate server lookup caches

Use service/process-owned query-core clients for command availability and Git common-dir
resolution. Scope command keys to the execution environment if mutable. Define negative
capability expiry so installing a missing binary does not require restarting the server.
Repository lookup invalidation must account for deleted/recreated roots.

Keep `AsyncThrottler`, its common-directory/remote key, and failure cooldown. Query owns the
lookup result; Pacer owns when `git fetch` runs. Do not change repository locks or process
shutdown coordination.

Verify `fs/tests/search-tool-runner.test.ts` and `git/tests/upstream-fetch.test.ts`, with
concurrent lookup, failed lookup retry, negative-result refresh, root replacement, shared
worktree budget, and cooldown assertions.

## Verification commands

Run the narrow tests named by each phase, then relevant typechecks/gates. Commands below
are defined by current package scripts; planning did not run the application suites.

| Purpose              | Command from repository root                                                                                                                                    | Expected                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Web types            | `bun run --cwd apps/web typecheck`                                                                                                                              | Exit 0                        |
| Address tests        | `cd apps/web && bun --bun vitest run --project node --project dom src/features/address/tests`                                                                   | All relevant tests pass       |
| Web focused tests    | `cd apps/web && bun --bun vitest run --project node --project dom <changed-test-paths>`                                                                         | All selected tests pass       |
| Markdown types/tests | `bun run --cwd packages/markdown typecheck` and `bun run --cwd packages/markdown test`                                                                          | Exit 0                        |
| Core types/tests     | `bun run --cwd packages/client-core typecheck` and `cd packages/client-core && bunx vitest run <changed-test-paths>`                                            | Exit 0                        |
| Server types/tests   | `bun run --cwd apps/server typecheck` and `cd apps/server && bun --bun vitest run src/fs/tests/search-tool-runner.test.ts src/git/tests/upstream-fetch.test.ts` | Exit 0                        |
| Changed-file lint    | `bunx oxlint --config .oxlintrc.json <changed-ts-paths>`                                                                                                        | No new findings               |
| Compiler             | `bun run compiler:census`                                                                                                                                       | No unexcused refusals         |
| Boundaries           | `bun run boundaries:check`                                                                                                                                      | No new boundary violations    |
| Formatting           | `bunx oxfmt --check <changed-paths>`                                                                                                                            | Exit 0                        |
| Browser              | `PORT=3001 bun run agent:browser scenario settings-cold-load`                                                                                                   | Completed; inspected evidence |
| Diff                 | `git diff --check`                                                                                                                                              | Exit 0                        |

Record baseline failures rather than attributing unrelated work to this plan. Follow the
`verify-fregat` skill for browser evidence. Preserve structured wide-event logging as
errors move out of old catch handlers. Inspect the built bundle for unexpected eager
resource imports when resource dependencies change; coordinate bundle gates with Plan 109.

## Explicit exclusions and completion

Keep these mechanisms unless a separate behavioral analysis proves a narrower replacement:

- Native picker exclusivity in `components/use-pick-entry.tsx`.
- Environment connection ownership, RPC opening, LSP pooling, and terminal/process startup
  or shutdown coordination. These control live resources, not just cached read results.
- Repository/attachment/workspace-edit lanes, settings write serialization, event/stream
  adapters, and transaction completion promises. Mutation scopes do not automatically
  preserve reentrant locks or streaming leases.
- File/document snapshots, live chat projection, synchronous render memoization, font files
  cached on disk, and existing server persistence. Do not duplicate their authorities.

Completion requires Phase 0 and all eight subsequent phases, the deprecated-API gate
passing in verify/CI, and removal of the named
promise caches/status stores, and evidence that excluded synchronization retains its
behavior. If a cache cannot move without violating a lifetime contract, record that exact
remaining site and its required follow-up; do not mark the whole plan complete.

Re-evaluate the phase before proceeding if destination preloading needs application
activation, a package must import web state, a generic query key crosses environments or
highlighter instances, a lifecycle owner cannot be identified, or the change would weaken
settings/document admission. Resolve ordinary file movement and naming choices directly;
only architectural scope changes require revising the plan.

Update this file and its index row as phases land. Do not edit unrelated user changes,
create a branch, commit, publish, or deploy without a separate instruction.
