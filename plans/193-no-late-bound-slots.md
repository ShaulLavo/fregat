# Plan 193: no late-bound slots

## Status and authorization

- Status: PROPOSED 2026-09-27, ready. Owner direction, same day, on `lib/fix-with-agent.ts`'s
  bound callback: "i hate it … it feel like a workaround", then "write a plan for all your other
  findings where we can fix the workaround".
- Done as the first instance: `7f22085c0` (Fix with AI opens its draft through navigation).
- Effort: M. Phases land on their own; 1 goes first because 2 and 4 read through it.

## The shape

A module-level variable that a React effect fills (`bindX`, `registerX`, `setX`, a bridge
component), so non-React code can reach something the tree holds. It earns its place only when the
value exists only in a mounted component: a DOM node, a live socket, component-local held state.
Everywhere else the value already exists outside React (a store, the editor runtime, the query
cache, the application snapshot) and the effect only mirrors it, adding a "not bound yet" window,
a mount-order dependency and memos kept alive for the effect's deps.

The fix is always the same: read the value where it lives, or let the non-React owner of its
lifecycle push it. React subscribes; it does not feed.

## Findings

Surveyed 2026-09-27 across `apps/web`, `apps/tui` and `packages/*`; only `apps/web` has the shape.
Line numbers are from `7f22085c0`; reconcile before starting.

| #   | Slot                                                                                             | Filled by                              | Verdict                 |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------- |
| 1   | `state/navigation-binding.ts:4`                                                                  | `NavigationProvider` effect            | remove (phase 1)        |
| 2   | `features/editor/state/language-census.ts:12`                                                    | `useLanguageCensus` layout effect      | remove (phase 2)        |
| 3   | `features/editor/state/performance-trace.ts:114`                                                 | `EditorStateProvider` effect           | remove (phase 2)        |
| 4   | `useFileAvailability` watch                                                                      | `EditorStateProvider` layout effect    | remove (phase 2)        |
| 5   | `useWorkspaceCachePersistence` flush registrant                                                  | `AppRuntimeContent` effect             | remove (phase 2)        |
| 6   | `lib/simulated-latency.ts:7`                                                                     | `SimulatedLatencyBridge`               | remove (phase 3)        |
| 7   | `connections.configureMachines`                                                                  | `EnvironmentTransportsProvider` effect | remove (phase 3)        |
| 8   | `spellcheck.setAcceptedWords`                                                                    | `useSpellcheckDictionary`              | remove (phase 3)        |
| 9   | `fileOpenIntentOwner.setEnvironment` / `setRelatedPrefetch`, `languageServerDocuments.configure` | `EditorStateProvider` layout effects   | mostly remove (phase 3) |
| 10  | `keymap/state/runtime-binding.ts` settings refs                                                  | `CommandProvider` layout effect        | reduce (phase 4)        |
| 11  | `features/editor/state/color-theme-store.ts:43-44`                                               | `EditorColorThemeProvider` effects     | reduce (phase 5)        |

Keep, with the reason on record:

- Terminal session registry (`features/terminal/state/session-registry.ts:8`): the mounted panel's
  live socket. Optional already; the kill falls back to the server route.
- Group geometry (`features/workbench/state/group-geometry.ts:7-10`): DOM elements under a
  `ResizeObserver`.
- Lifecycle-flush callbacks from timeline, tree, changes list, reload views and the editor visible
  snapshot (`lib/lifecycle-flush.ts:9`): each captures DOM scroll or virtualizer state.
- Settings held display (`features/settings/state/selection.ts:6`): component-local held state,
  so commands act on what is painted.
- `bindDiffPlugin` (`features/editor/state/diff-presentation.ts:59`): a per-pane plugin instance.
- The command runtime binding itself: palette and dialog setters are React state (phase 4 only
  shrinks what it carries).

## Phase 1: navigation is bound at boot

`main.tsx:90` builds navigation at module scope, and `state/bootstrap.ts:45,55` attaches the
application to it outside React. Only `bindNavigation` waits for `NavigationProvider`'s effect.

- Call `bindNavigation(navigation)` in `main.tsx` beside `createNavigation`. `NavigationProvider`
  keeps its `pagehide` history flush and loses the bind.
- `test/render.tsx` binds the navigation it creates, so tests keep working without the provider
  doing it.
- `findNavigation` stays only if a caller can still run before boot binds it (the demo entry,
  `demo-entry.ts`); otherwise `fix-with-agent.ts` uses `getNavigation()` and `findNavigation` goes.
- Verify: `bun run typecheck`, `lib/tests/fix-with-agent.test.tsx`, `keymap` command tests,
  `scenario machine-connect-error` and `scenario session-undo` (both reach `getNavigation()` from
  outside React).

## Phase 2: the editor runtime owns its own active lifetime

`EditorStateProvider` mounts only for the active environment
(`components/active-environment-application.tsx:28`). Its effects therefore mean "while this
environment is active", which `state/application-runtime.ts` already decides outside React: it
calls `current.editor.suspend()` on a switch (`:132`), but `resume()` runs only from the
provider's effect (`state-provider.tsx:74`).

- `application-runtime.ts` calls `editor.resume()` for the environment it activates (creation and
  `activateEnvironment`), next to the `suspend()` it already makes. The provider effect goes.
- `resume()`/`suspend()` in `features/editor/state/runtime.ts` start and stop what the provider's
  effects did:
  - the language census source: `workspacePreloadLanguages()` reads the active runtime's
    `queryClient` and `workspaceStore` instead of `activeSource`. `bindLanguageCensus` goes.
    `useLanguageCensus` keeps only its `useQuery`. Coordinate with Plan 170, which extends the
    census.
  - the editor-open benchmark control: `registerEditorOpenBenchmarkControl` and its effect go;
    `requireEditorOpenBenchmarkControl` reads the active runtime's control.
  - `watchFileAvailability`: subscribed in `resume()` with `navigation.editorCommands(workspaceStore)`
    (navigation is passed to `createBootstrap`), unsubscribed in `suspend()`.
    `use-file-availability.ts` goes.
  - `subscribeWorkspaceCachePersistence`: the same move. First confirm `AppRuntimeContent` also
    mounts only for the active environment; if it spans all retained environments, subscribe in
    `createEnvironment` and dispose with the environment instead.
- "The active runtime" is read as `getNavigation().getSnapshot()` after phase 1, or passed in by
  `application-runtime.ts`. No new slot.
- Verify: `features/editor` runtime tests for resume/suspend and a machine switch;
  `scenario editor-syntax-shiki-settled` (census preload); `apps/web/scripts/editor-open-benchmark.mjs`
  once; `scenario workspace-switch` and `scenario editor-reload-paint` (cache persistence and
  flush on reload).

## Phase 3: settings reach non-React consumers by subscription

Four effects copy a setting into an object that is not React: latency (`use-simulated-latency.ts`),
machines (`environment-transports-provider.tsx:19-21`), spellcheck words
(`use-spellcheck-dictionary.ts`), and the editor's file-open environment and LSP match
configuration (`state-provider.tsx:44-71`).

- Add `subscribeLiveSettings(queryClient, listener)` in `features/settings/state/`: it fires on
  the settings document query and on the settings intent store, and hands the listener
  `readLiveSettingsProjection(queryClient)`. It must fire on optimistic writes, as `useSettingValue`
  does today, so a dial or a word toggles at once.
- The owners subscribe:
  - `application-runtime.ts` for latency (the primary query client) and for machines, which
    `connections` already reads from the mirror at start (`state/environment-connections.ts:661`).
    `connections.start()`/`stop()` can move there too.
  - `createEditorRuntime` for spellcheck words, syntax highlighting, tab size and the LSP match
    generation. The theme id and content hash come from a `subscribeEditorColorTheme` subscription
    in the same place.
- Deleted: `SimulatedLatencyBridge` and `use-simulated-latency.ts`, `use-spellcheck-dictionary.ts`,
  the machines effect, and the two layout effects in `EditorStateProvider` (the provider then only
  provides context). `lib/simulated-latency.ts` keeps its variable, now fed by a non-React owner;
  its comment about `lib/` not reading settings stays true.
- Check first where `useLanguageServerMatchConfiguration`'s context value comes from; if its source
  is React-local, that one input stays pushed from React.
- Verify: a settings test that flips each key through `setSetting` and reads the consumer (the
  latency fetcher's delay, `spellcheck` accepted words, `connections` machines, the file-open
  preparer's tab size); `scenario editor-spellcheck`; `scenario machine-protocol-mismatch`.

## Phase 4: the command runtime reads settings at dispatch

`command-provider.tsx:158-175` mirrors `diffViewMode`, `wallpaperEnabled` and `wallpaperSelection`
into `snapshotSettingsRef` from a layout effect. Commands can read
`readLiveSettingsProjection(queryClient)` when they run, as `command-provider.tsx:461` already
does for another value. `adaptersRef` (editor, settings and theme actions, `requestCloseTab`) and
the palette refs stay: they are React-owned actions and state.

- Verify: `keymap/tests/command-provider.test.tsx`; toggling the diff view and wallpaper from the
  palette straight after a settings change.

## Phase 5: editor theme selection from settings

`EditorColorThemeProvider` pushes the dark and light theme ids (`:39-42`) and the resolved colour
mode (`:80-82`) into module state that the Shiki resolver reads.

- The theme ids can come from the phase 3 subscription, except that `useSettingValue` also layers
  the Theme Studio preview (`AppearancePreviewContext`, React state). Move that preview into a
  store first, then subscribe.
- The colour mode mirrors `useTransitionedColorMode`, which lags one transition on purpose so the
  editor repaints in step with the page. It stays pushed from React unless the owner accepts
  losing that sync (question below).
- Verify: `scenario editor-theme-preview`, `scenario theme-studio-preview`,
  `scenario color-mode-preview`, each with `look`.

## Phase 6: the rule

Add to AGENTS.md › React: "A module variable filled from an effect so non-React code can reach it
is a last resort, for DOM nodes, live sockets and held component state. Anything else is read
where it lives or pushed by its non-React owner." No census: the shape is too varied to grep
reliably, and review catches it.

## Owner questions

1. Phase 5: may the editor's colour mode follow settings directly and drop the one-transition lag,
   or does the painted-frame sync stay (and with it that one React push)?

## Found along the way

- The Connect machine picker shows a refused connection as `TypeError: Failed to fetch`,
  `code: unknown` (seen in `scenario machine-connect-error`, 2026-09-27). The connect path passes a
  raw fetch failure to the dialog instead of a structured error with `why` and `fix`. Not in this
  plan's scope.
- The same run logs 11 console errors (`environment.connect`, level `error`) for one refused
  machine while it retries. AGENTS.md › Logs asks for one `warn` at the start of a recovering
  series and one `info` with a count at its end.
