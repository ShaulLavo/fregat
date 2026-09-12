# Chat And Logs Wiring Notes

## Summary

The workbench sidebar now mounts the existing chat and logs panels as first-class sidebar tabs:

- `apps/web/src/features/workbench/components/sidebar-panel.tsx` renders `ChatSidePanel` for `chat` and `LogsPanel` for `logs`.
- `apps/web/src/features/workbench/utils/workbench-panels.ts` includes `chat` and `logs` in `WorkbenchSidebarTab`.
- `apps/web/src/lib/workspace-cache.ts` accepts `chat` and `logs` in cached workbench panel state.

Alternative placements considered:

- Dedicated right-hand panel: better for persistent agent context beside files, but it adds a new layout surface and panel-state model.
- Bottom tab: cheap to expose, but chat and logs both want vertical reading space and compete with the terminal.
- Sidebar tab MVP: smallest honest mount because both entry components are already panel-shaped and the sidebar/header vocabulary already had chat/logs affordances.

## Mount Requirements

Chat:

- `main.tsx` owns the application runtime, focus, hotkeys, and command bus. `components/active-environment-application.tsx` mounts the selected QueryClient, verifies server identity, and supplies the retained editor runtime and tooltip provider.
- Module state: `useChatProjectionStore` and related chat projection/detail subscription stores under `apps/web/src/features/chat/state/`.
- The environment transport registry owns one closable chat transport per confirmed environment; `useChatTransport` selects the addressed owner.
- Each transport captures its QueryClient owner's origin. Workbench switches preserve the independent connections and projections. The [federation reference](federated-environments.md) records ownership and recovery.
- Backend routes: `orchestrationWsRoutes` and `orchestrationRoutes` registered in `apps/server/src/app.ts`.

Logs:

- The active environment's QueryClient and the outer `FocusProvider` are supplied by the application.
- Queries and live subscriptions retain the HTTP client associated with that QueryClient through `lib/environments/state/query-clients.ts`. An environment switch cannot redirect an in-flight request.
- Query keys and cache invalidation: `logsKeys` from `apps/web/src/lib/query-keys.ts`.
- Backend routes: `_log/dashboard/{summary,events,event,live}` from `apps/server/src/observability/routes.ts`, registered via `observabilityRoutes()` in `apps/server/src/app.ts`.
- Log source: structured JSONL files under `logs/`, configured by the observability variables in `.env.example`.

## Runtime Findings

Browser verification used the already-running dev server at `http://localhost:5173`. The same Vite server was also reachable at `http://[::1]:5173`, but the API allowlist in `.env.example` covers `localhost` and `127.0.0.1`, not the IPv6 origin, so `localhost` is the correct verification origin.

Chat mounted without a browser console error. The first render showed the draft composer while the provider probe was settling; after the probe completed, the panel showed the draft composer, `GPT-5.5`, and `Codex ready`. Local logs showed orchestration WebSocket subscription activity and `chat.pipeline.codex_adapter.snapshot.complete`.

Logs mounted without a browser console error. The panel showed the toolbar, timeline, metrics, and live event list from the existing dashboard routes. In the verification session it read 1,836 events from the current JSONL logs.

No new provider, context, server route, or backend code was required.

## Backend Prerequisites

Chat requires the existing app server to be running with orchestration routes enabled. `apps/server/src/app.ts` registers both the orchestration routes and the default provider registry.

The default provider registry in `apps/server/src/provider/provider-adapter-registry.ts` registers `CodexProviderAdapter` from `apps/server/src/provider/adapters/codex.ts`. A fully usable chat session depends on the local `codex` binary and auth state that adapter probes. There are no Codex-specific variables in `.env.example`; the relevant environment documented there is the local app/server wiring (`VITE_SERVER_URL`, `SERVER_ALLOWED_ORIGINS`) and observability settings.

Logs need the existing `_log/dashboard` routes in `apps/server/src/observability/routes.ts` and the configured JSONL log directory from `.env.example`. No additional logs backend work was found.

## Knip Result

Command: `bunx knip --no-config-hints`

Post-mount result: no files under `apps/web/src/features/chat/` or `apps/web/src/features/logs/` are reported as unused.

Remaining unused-file entries:

- `apps/web/src/features/editor/state/editor-dirty-paths.ts`
- `apps/web/src/features/workbench/components/panel-unavailable.tsx`
- `apps/web/test/fixtures/workbench-file-server/repo/src/editor-tab-a.ts`
- `apps/web/test/fixtures/workbench-file-server/repo/src/editor-tab-b.ts`
- `apps/web/test/fixtures/workbench-file-server/repo/src/editor-tab-c.ts`

Chat/logs-related static-analysis notes:

- `@singapor/diff` is still reported as an unused dependency in `apps/web/package.json`.
- `logsKeys` is still reported as an unused export from `apps/web/src/lib/query-keys.ts`, although the mounted logs files import and use it.

## Recommendation

Finish wiring rather than shelve. The existing panels mount through a small front-end change, the provider and logs routes are already registered, and both panels render against the running app. Next steps should be concrete integration work: decide whether sidebar remains the final placement, add a chat-specific focus area if chat gets pane-scoped keybindings, add cheap smoke coverage for the mounted tabs, and resolve the remaining knip findings separately instead of deleting chat/logs code.

## Verification

- `bun run --filter web typecheck` passed before and after the mount.
- `bun run --filter web lint` passed with existing warnings in `scripts/editor-scroll-benchmark.mjs`, `test/factories/chat.ts`, and `vitest.config.ts`.
- `bun run --filter web test` passed on the clean rerun: 85 files, 446 tests.
- Initial full test run failed two DOM tests by timeout while knip was running in parallel; rerunning the two failed tests alone passed, and the subsequent full run passed.
