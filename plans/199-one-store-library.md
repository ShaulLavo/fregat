# Plan 199: One store library, and `useSyncExternalStore` only at the edges

## Status and authorization

- Status: IN PROGRESS 2026-09-27. The rule landed in AGENTS.md ("React"). All of A that moves (A1, A2, A4–A6, A8 keep-alive),
  B1–B4, D1 and D5 are done; A3, A7, D4 and the preview budget stay (reasons below).
  TUI C2–C4 are done; C1, C5 and C6 are left.
- Origin: owner, 2026-09-27: "we prob abuse useSyncExternalStore too hard". Afterwards the owner
  approved the survey: hand-built stores become zustand, zustand stores read without a selector
  get selectors, snapshots that derive per read are cut down, and the TUI is in scope.
- Size: M. Web: `bun run deploy`. TUI: no deploy. Each row ships on its own.

## The rule (AGENTS.md)

1. State that outlives a component is a zustand store. `createStore` (`zustand/vanilla`) when
   non-React code touches it; `useStore(store, selector)` in React. A service with a lifecycle
   keeps its state in a store it exposes, like `connections.store` in
   `apps/web/src/state/environment-connections.ts`.
2. Selectors return a primitive, a held reference, or go through `useShallow`. A derived object is
   a selector memoized on its inputs.
3. Raw `useSyncExternalStore` only for sources zustand cannot own (DOM, renderer events, mutable
   objects), and never over a whole store snapshot. It may live anywhere.

## Library: stay on zustand

zustand is already in about 80 web files, in `packages/client-core` (`optimistic/queue.ts`,
`environments/state/store.ts`), and its vanilla store runs without React, which client-core and the
TUI need. `useStore` is `useSyncExternalStore` with a selector, so every site below moves over in
the same shape. Alternatives, and why each loses:

- TanStack Store: fits the TanStack family but does the same job; a migration for no gain.
- Jotai: atoms suit per-key UI state but read awkwardly outside React, where most of our stores
  are written (transports, services, key listeners).
- Valtio / Legend: proxy tracking; a second mental model beside TanStack Query's immutable data.

No second library. If one ever replaces zustand, it replaces all of it.

## Survey (2026-09-27)

`confirmed` = read end to end. Line numbers drift; reconcile before each row.

### A. Hand-built module stores → zustand (web)

| #   | Where                                                                                | Today                                                                                                                      | Status    |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| A1  | `features/command-palette/state/recent-commands-store.ts`                            | module `let` + `createSubscriptions` + identity cache comment                                                              | **done**  |
| A2  | `features/logs/state/filter-store.ts`                                                | `let filters`, defaults cache kept only for identity, loop comment                                                         | **done**  |
| A3  | `features/git/state/reload.ts`, `features/settings/state/reload.ts`                  | `WeakMap<QueryClient,…>` + listener set, read by `use-reload-owner`                                                        | confirmed |
| A4  | `features/workbench/utils/visible-tree-item-count-store.ts`, `tree-toolbar-store.ts` | factory with snapshot + listener set                                                                                       | **done**  |
| A5  | `features/chat/state/active-transports.ts`                                           | `Map` + `createSubscriptions`; `transport-provider.tsx`, `queued-follow-up-senders.tsx` read `transportFor(id)` per render | confirmed |
| A6  | `features/editor/state/color-theme-store.ts` (363 lines)                             | three module `let`s + listener set; provider reads three lambdas                                                           | **done**  |
| A7  | `lib/markers/store.ts`                                                               | factory with cached `resources`; `hooks/use-markers.ts`                                                                    | likely    |
| A8  | `lib/keep-alive/state/store.ts`, `features/search/state/preview-budget.ts`           | factory stores; the budget also measures DOM                                                                               | likely    |

A2: once the filters are `{ filters: LogsFilterState | null }` in a store, the hook selects
`filters ?? defaults` through a selector memoized on the settings value, and the identity-only
defaults cache goes. A3: the owner is a `QueryClient`, so key the store by environment and keep
the generation symbol; decide at the row whether a `Map` in state or one store per owner reads
better. A6 is the largest; do it last in this group.

Done: A1 reads its list at module load (storage reads are safe there) and drops the lazy cache.
A2's hook takes the defaults from `useSettingValue`, so they follow a settings change while the
panel is open; `readLogsFilters()` still reads the mirror. A4 is one per-panel
`state/navigator-header-store.ts`, covered by `components/tests/file-navigator-header.test.tsx`.
A5 exposes `activeTransports` and `hooks/use-active-transport.ts`; the disposer's old `notify()`
after `close()` changed nothing a reader saw (same reference), so it is gone. A8's keep-alive store
exposes its `entries` store; the outlet reads it with `useStore`. A6 is `colorThemeStore`
(`selection`, `activeColorMode`, `preview`, `loadedRevision`); a registration landing bumps
`loadedRevision` where it used to notify. An unsynced selection is read from the mirror on each
read, where the old code froze it at the first read. Its getters take the state as an optional
argument and serve as the provider's selectors (D1). Browser tests `prepared-open` and
`syntax-worker` pass.

Stays: A3 is a `WeakMap` keyed by `QueryClient`, mutated in place; a zustand `Map` would keep dead
clients alive and the hooks only watch the per-owner generation. A7 keeps mutable indexes and builds
its sorted list lazily; a store would rebuild it on every diagnostics publish. The preview budget is
a ResizeObserver source with a number snapshot (rule 3).

### B. zustand stores read through raw `useSyncExternalStore` (web)

| #   | Where                                                                                  | Fix                                                                                                           |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| B1  | `features/environments/hooks/use-auth.ts` (`authStore.getState`)                       | `useStore(connections.authStore)`; small, consistency                                                         |
| B2  | `hooks/use-environment-connections.ts` (`store.getState`, uses `machines`)             | `useStore(connections.store, (s) => s.machines)`                                                              |
| B3  | `features/chat-mode/hooks/use-rail-order-overrides.ts` + `state/rail-order-intents.ts` | `useStore(railOrderIntents, selectRailOrderOverrides)`; the `cachedActive` cache becomes that selector's memo |
| B4  | `features/workspace/hooks/use-projected-tree-model.ts` + `state/tree-intents.ts`       | same shape as B3                                                                                              |

The intent queues in B3/B4 are zustand already (`client-core/optimistic/queue.ts`). The gain here
is one reading idiom; the render count should not change. Say so in the commit.

Done: all four. B3/B4's projection functions take the queue state as an optional argument, so they
serve as `useStore` selectors and imperative reads alike.

### C. TUI

The TUI has no zustand dependency and 30 files call `useSyncExternalStore`, nearly all over a
whole snapshot. `apps/tui/src/host/state/observable-store.ts` is a hand-built vanilla store
(`replace`, `patch`, `subscribe`, `getSnapshot`, abort-signal dispose) behind 11 stores.

| #   | Where                                                                                                                                                                                                                                                                                                                                  | Today                                                                                                        | Fix                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `host/state/observable-store.ts` and its 11 users                                                                                                                                                                                                                                                                                      | hand-built store                                                                                             | zustand `createStore`; keep the signal-driven dispose as a small wrapper (zustand has no dispose)                                 |
| C2  | chat owner: `components/workspace.tsx:61`, `worktrees/components/manager.tsx:35`, `commands/components/palette.tsx:51`, `agent-rail/components/rail.tsx:99`, `agent/components/screen.tsx:36`, `agent-stage/hooks/use-stage.ts:34`                                                                                                     | whole `ChatOwner` snapshot; `workspace.tsx` sits near the root, so every chat event re-renders the workspace | `ChatOwner` (`client-core/chat/owner.ts`, TUI-only) keeps state in an exposed store; each site selects its slice                  |
| C3  | focus registry: `workbench/components/workbench.tsx:42` (uses `scope.screen`), `components/status.tsx:15` (`current.area`), `agent-stage/components/stage.tsx:78` (`overlay`), `settings/components/browser.tsx:77` (`scope`), `files/components/view.tsx:80`, `commands/hooks/use-pane-focus.ts:18`, `agent/components/screen.tsx:37` | whole snapshot, one field used                                                                               | `FocusRegistry` exposes a store; select the field                                                                                 |
| C4  | settings owner: `settings/hooks/use-setting-value.ts`                                                                                                                                                                                                                                                                                  | every `useSettingValue` re-renders on any setting change and resolves the theme each render                  | select `resolveThemeSettings(…)[key]`; `keybinding-editor.tsx:35` and `sync-notice.tsx:7` select their one field                  |
| C5  | session: `components/application.tsx:37`, `terminal/components/pane.tsx:20`, `git/components/pane.tsx:22`, `logs/components/pane.tsx:34`                                                                                                                                                                                               | whole connection state for `kind`/`owner`                                                                    | select                                                                                                                            |
| C6  | render ticks: `tree/components/tree.tsx:38`, `agent-stage/hooks/use-stage.ts:33`                                                                                                                                                                                                                                                       | `useSyncExternalStore` whose value is thrown away, to force a render                                         | find what the render reads (`tree.controller`, drafts) and select that; if the source is mutable, a revision counter in its store |
| C7  | `theme/hooks/use-theme.ts`, `use-system-color-mode.ts`                                                                                                                                                                                                                                                                                 | renderer events                                                                                              | keep (rule 3)                                                                                                                     |

Order: C4 first (every settings reader), C2 (hottest path), C3, C5, then C1 and C6.

Done: `SettingsOwner`, `ChatOwner` and `FocusRegistry` keep their state in an exposed zustand
`store`; `getSnapshot`/`subscribe` stay for the 198 imperative reads and two non-React subscribers.
C4: `useSettingValue` selects its key; `settings/tests/use-setting-value.test.tsx` failed before
(another key's write re-rendered a reader twice) and passes after. C2: the workspace reads places
through `files/hooks/use-places.ts`, which selects the four projection references session events
leave alone; `files/tests/use-places.test.tsx` shows no re-render across streamed replies while a
whole-snapshot reader re-renders, and fails when the hook selects the whole projection. The rail,
agent screen and manager select their fields; the palette and stage read the whole store.
C3: focus readers select their field, except `commands/hooks/use-pane-focus.ts`, which keeps the
whole snapshot: `useCommandFocus` refreshes availability and re-activates in every render, and six
approval tests in `agent-stage/tests/requests.test.tsx` fail without those renders. Moving that
refresh into the registry would let it narrow too.
TUI suite in this container: 400 pass; 4 fail identically on the base commit (Bun 1.3.11 against
the pinned 1.4.2: a SQLite message, git worktree cleanup, two manager dialogs).
`apps/tui/package.json` gains `zustand`, pinned to the version client-core already uses.

### D. Snapshots that derive per read

Each passes today because it returns a primitive or a cached reference; each breaks on its first
edit that returns an object.

| #   | Where                                                           | Note                                                                                                                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `features/editor/providers/color-theme-provider.tsx:62-74`      | **done** with A6: three selectors over `colorThemeStore`                                                                                               |
| D2  | `features/editor/components/history-pane.tsx:82-89`             | `historyBarrierGroup(buffer)` caches per buffer in the service; keep, but say so where it is read                                                      |
| D3  | `features/editor/hooks/use-workspace-edit-state.ts`             | hand-rolled selector hook; works because `selectWorkspaceEditRecovery`/`Preview` return held refs. Becomes `useStore` once the service exposes a store |
| D4  | `features/workbench/hooks/use-group-split-availability.ts`      | stays: ResizeObserver source (rule 3); the packed number keeps the snapshot a primitive, and `compiler:memos` marks the `useCallback` needed           |
| D5  | `features/chat-mode/hooks/use-session-checkout-refresh.ts:17`   | **done**: `useShallow` over `{ id, branch, headCommit, path }` replaces the `\0` string                                                                |
| D6  | `keymap/hooks/use-shortcut-hint.ts`, `use-any-shortcut-hint.ts` | derive a label per read; primitive, stays (rule 3: DOM key events)                                                                                     |

Also sweep zustand selectors that build a fresh array or object (`.filter`, `.map`, `{ … }`)
without `useShallow` or a memoized selector. Nine `useShallow` sites exist today; a first grep on
2026-09-27 found none unsafe, so the sweep is a check, not a list.

### E. Stays on `useSyncExternalStore` (rule 3)

`features/file-picker/hooks/use-media-query.ts`, `features/settings/hooks/use-system-color-mode.ts`,
`keymap/state/held-modifiers.ts` (attaches key listeners on first subscriber),
`features/workbench/state/group-geometry.ts` (ResizeObserver; see D4),
`hooks/use-editor-gutter-inset.ts`, `features/workspace/components/tree-host.tsx:108-119`,
`features/workbench/components/markdown-preview-pane.tsx:67` (buffer revision),
`packages/markdown/src/hooks/use-markdown-extensions.ts`.

Services with a lifecycle (`workspace-edit-service`, `language-server-status-source`,
`diagnostic-peek-source`, `lib/focus/state/service.ts`, `state/navigation-coordinator.ts`,
`application`) move to an exposed store only when a row touches them; not a sweep.

### F. Looked at, no change

- `features/chat/hooks/use-session-earlier-page.ts` subscribes to a `QueryObserver` by hand. The
  transport owns one observer per session (`client-core/chat/earlier-pages.ts`), kept alive while
  its timeline is parked, so `useQuery` would create a second observer with a different lifetime.
  Driving TanStack core directly is fine. Minor: the `observers` map grows by one per session
  opened until the transport is disposed; bounded, left.

## Gate

After A–C, add `externalStore` to a census (`scripts/lint/`): a `useSyncExternalStore` whose
`getSnapshot` returns a store's whole `getState`/`getSnapshot` fails unless `scripts/lint/external-store-allow.json` names it with a reason. Add it to `gates`.

## Proof per row

- A and B: the feature's existing DOM tests, and a store test only where the row changes behavior
  (A2 defaults following `logs.defaultTimeRange`).
- C2–C5: render counts before and after, driving a chat turn in the TUI with `MockProviderAdapter`.
  C2 must show the workspace no longer re-rendering per chat event.
- D4/D5: `bun run compiler:memos` on the file; the manual memo goes.
- `bun run gates` and the TUI typecheck on every row.
