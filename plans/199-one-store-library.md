# Plan 199: One store library, and `useSyncExternalStore` only at the edges

## Status and authorization

- Status: PROPOSED 2026-09-27. The rule landed in AGENTS.md ("React"). The sites below are left.
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
   objects), inside a `use-*` hook.

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
| A1  | `features/command-palette/state/recent-commands-store.ts`                            | module `let` + `createSubscriptions` + identity cache comment                                                              | confirmed |
| A2  | `features/logs/state/filter-store.ts`                                                | `let filters`, defaults cache kept only for identity, loop comment                                                         | confirmed |
| A3  | `features/git/state/reload.ts`, `features/settings/state/reload.ts`                  | `WeakMap<QueryClient,…>` + listener set, read by `use-reload-owner`                                                        | confirmed |
| A4  | `features/workbench/utils/visible-tree-item-count-store.ts`, `tree-toolbar-store.ts` | factory with snapshot + listener set                                                                                       | confirmed |
| A5  | `features/chat/state/active-transports.ts`                                           | `Map` + `createSubscriptions`; `transport-provider.tsx`, `queued-follow-up-senders.tsx` read `transportFor(id)` per render | confirmed |
| A6  | `features/editor/state/color-theme-store.ts` (363 lines)                             | three module `let`s + listener set; provider reads three lambdas                                                           | confirmed |
| A7  | `lib/markers/store.ts`                                                               | factory with cached `resources`; `hooks/use-markers.ts`                                                                    | likely    |
| A8  | `lib/keep-alive/state/store.ts`, `features/search/state/preview-budget.ts`           | factory stores; the budget also measures DOM                                                                               | likely    |

A2: once the filters are `{ filters: LogsFilterState | null }` in a store, the hook selects
`filters ?? defaults` through a selector memoized on the settings value, and the identity-only
defaults cache goes. A3: the owner is a `QueryClient`, so key the store by environment and keep
the generation symbol; decide at the row whether a `Map` in state or one store per owner reads
better. A6 is the largest; do it last in this group.

### B. zustand stores read through raw `useSyncExternalStore` (web)

| #   | Where                                                                                  | Fix                                                                                                           |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| B1  | `features/environments/hooks/use-auth.ts` (`authStore.getState`)                       | `useStore(connections.authStore)`; small, consistency                                                         |
| B2  | `hooks/use-environment-connections.ts` (`store.getState`, uses `machines`)             | `useStore(connections.store, (s) => s.machines)`                                                              |
| B3  | `features/chat-mode/hooks/use-rail-order-overrides.ts` + `state/rail-order-intents.ts` | `useStore(railOrderIntents, selectRailOrderOverrides)`; the `cachedActive` cache becomes that selector's memo |
| B4  | `features/workspace/hooks/use-projected-tree-model.ts` + `state/tree-intents.ts`       | same shape as B3                                                                                              |

The intent queues in B3/B4 are zustand already (`client-core/optimistic/queue.ts`). The gain here
is one reading idiom; the render count should not change. Say so in the commit.

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
`apps/tui/package.json` gains `zustand`, pinned to the version client-core already uses.

### D. Snapshots that derive per read

Each passes today because it returns a primitive or a cached reference; each breaks on its first
edit that returns an object.

| #   | Where                                                           | Note                                                                                                                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `features/editor/providers/color-theme-provider.tsx:62-74`      | three lambdas over one source; folds into A6                                                                                                           |
| D2  | `features/editor/components/history-pane.tsx:82-89`             | `historyBarrierGroup(buffer)` caches per buffer in the service; keep, but say so where it is read                                                      |
| D3  | `features/editor/hooks/use-workspace-edit-state.ts`             | hand-rolled selector hook; works because `selectWorkspaceEditRecovery`/`Preview` return held refs. Becomes `useStore` once the service exposes a store |
| D4  | `features/workbench/hooks/use-group-split-availability.ts`      | packs two booleans into a number and keeps a manual `useCallback` for the snapshot. With a geometry store and `useShallow` both go                     |
| D5  | `features/chat-mode/hooks/use-session-checkout-refresh.ts:17`   | packs four worktree fields into a `\0` string, then splits it in the effect. `useShallow` over an object reads better                                  |
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

After A–C, add `externalStore` to a census (`scripts/lint/`): `useSyncExternalStore` outside a
`use-*.ts` file, or with a `getSnapshot` that returns `getState`/`getSnapshot` of a store, fails
unless `scripts/lint/external-store-allow.json` names it with a reason. Add it to `gates`.

## Proof per row

- A and B: the feature's existing DOM tests, and a store test only where the row changes behavior
  (A2 defaults following `logs.defaultTimeRange`).
- C2–C5: render counts before and after, driving a chat turn in the TUI with `MockProviderAdapter`.
  C2 must show the workspace no longer re-rendering per chat event.
- D4/D5: `bun run compiler:memos` on the file; the manual memo goes.
- `bun run gates` and the TUI typecheck on every row.
