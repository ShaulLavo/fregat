# Server surface inventory: what a full front end to `apps/server` must speak

Scope: everything `createApp` mounts (`apps/server/src/app.ts:173-232`), the wire contracts in
`packages/contracts/src`, and how `apps/web` binds to it. All paths absolute under
`/work/projects/platform/`. Line numbers are from the working tree at the time of reading.

---

## 0. One-page summary

| Concern                            | Fact                                                                                                                                                                                                                                                                                                                                                                                                            | Source                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Transport                          | One Elysia app (Bun) on loopback, default `127.0.0.1:3001`. HTTP (GET/POST only), SSE (GET/POST returning `text/event-stream`), 3 WebSocket endpoints.                                                                                                                                                                                                                                                          | `apps/server/src/index.ts:18-19`, `app.ts:187`                                                                                        |
| Auth                               | **Origin allowlist only.** No token, no cookie, no session. Every HTTP request and every WS upgrade must carry an `Origin` header that is byte-equal to an allowlisted origin. Missing `Origin` = `401 UNAUTHORIZED`; unknown `Origin` = `403 FORBIDDEN_ORIGIN`.                                                                                                                                                | `apps/server/src/auth.ts:22-29, 43-65, 67-69, 75-86, 96-103`                                                                          |
| Default allowlist                  | `http://{localhost,127.0.0.1}:{3000,4173,5173}`; override with `SERVER_ALLOWED_ORIGINS=a,b,c`.                                                                                                                                                                                                                                                                                                                  | `auth.ts:22-29`, `index.ts:25, 116-124`                                                                                               |
| Precedent for a non-browser client | The desktop shell (a Bun process) already sends a synthetic `Origin` header on plain `fetch`. A TUI does the same.                                                                                                                                                                                                                                                                                              | `apps/desktop/src/bun/index.ts:46, 202, 303`                                                                                          |
| Identity                           | `/health` and the orchestration WS handshake both carry `environmentId` (durable, in SQLite) and the WS handshake also carries `serverInstanceId` (per process).                                                                                                                                                                                                                                                | `app.ts:199-211`, `orchestration/ws-rpc.ts:41-62`                                                                                     |
| Protocol version                   | `ORCHESTRATION_WS_PROTOCOL_VERSION = 4`.                                                                                                                                                                                                                                                                                                                                                                        | `packages/contracts/src/orchestration-ws.ts:32`                                                                                       |
| Client library                     | Web uses `@elysia/eden` treaty (`^1.4.10`) against `type App` from `server/client-contract`. Eden is runtime-neutral (global `fetch` + `WebSocket`) and Bun has both, so a Bun TUI can reuse treaty for HTTP+SSE. It cannot set a WS `Origin` through Eden (Eden does `new WebSocket(url)` with no options), so the three WS endpoints need a hand-rolled `new WebSocket(url, { headers: { Origin } })` in Bun. | `apps/web/src/lib/client.ts:14-18`, `node_modules/@elysia/eden/dist/chunk-FXT7FC66.mjs` (class `T`)                                   |
| Instrumentation headers            | `x-client-instance: <uuid>` on every HTTP request (attributes server logs to the client). Client-side logs POST to `/_log/ingest?instance=<id>`. CORS also allows `x-evlog-source` but nothing sends it today.                                                                                                                                                                                                  | `apps/web/src/lib/instance-id.ts:8-9`, `apps/server/src/observability/logging.ts:84-89`, `client-logging.ts:28,162-168`, `app.ts:179` |
| Error envelope                     | `{ error: { code, message } }` with HTTP status from the code table. Elysia `VALIDATION` failures are rewritten to `INVALID_PATH` (400).                                                                                                                                                                                                                                                                        | `app.ts:292-331`, `fs/errors.ts:36-58, 116-123`                                                                                       |
| Dates                              | Contracts declare ISO strings. Eden revives date-shaped strings into `Date` objects, which the web undoes with `normalizeEdenDates`. A raw-`fetch` client never has this problem.                                                                                                                                                                                                                               | `apps/web/src/lib/eden-events.ts:61-69`, `orchestration-http-snapshots.ts:40-43`                                                      |

---

## 1. App composition and middleware order

`apps/server/src/app.ts:173-232` in mount order (order matters for auth):

1. `applyObservability(app)` — wide-event logging per request (`app.ts:174`).
2. `cors(...)` — `allowedHeaders: ['authorization','content-type','x-client-instance','x-evlog-source']`, `exposeHeaders: ['cache-control','content-length','content-type','x-fs-mtime-ms','x-fs-path']`, `methods: ['GET','POST','OPTIONS']`, `origin` callback = allowlist (`app.ts:177-190`). **No PUT/PATCH/DELETE anywhere** — provider cancel and settings writes are POSTs for this reason (`provider/routes.ts:89-90`, `settings/routes.ts:27-28`).
3. `onError` → `appErrorPayload` (`app.ts:191, 292-331`).
4. `onBeforeHandle(recordClientInstance)` reads `x-client-instance` (`app.ts:192-194`, `observability/logging.ts:84-89`).
5. **`orchestrationWsRoutes` mounted BEFORE the auth guard** so the WS upgrade succeeds and the server can send an explicit `1008 unauthorized` close instead of a bare HTTP refusal (`app.ts:195-196`, `ws-rpc.ts:97-105`).
6. `onBeforeHandle(authGuard(auth))` — origin check for everything after this line (`app.ts:197`).
7. Then: `observabilityRoutes`, `/health`, `/lsp/match`, `/lsp/semantic-tokens`, `ws /lsp`, `ws /terminal`, provider, orchestration HTTP, attachments, fonts, wallpaper, settings, git, fs (`app.ts:198-229`).

`/terminal` and `/lsp` WS handlers re-check the origin themselves inside `open` via `authenticateWebSocketData` because the guard hook does not run for the upgrade (`terminal/service.ts:104-115`, `lsp/routes.ts:105-117`, `auth.ts:67-69, 88-94`). They close with **no code and no reason** on auth failure (`terminal/service.ts:114`, `lsp/routes.ts:116`) — only the orchestration socket uses 1008.

Process env consumed at boot (`index.ts:18-27, 33-47`): `PORT`, `FS_HOST|HOST` (must be loopback: `index.ts:133-137`), `FS_SYSTEM_ROOT`, `FS_WORKSPACE_ROOT`, `FS_WATCH`, `SERVER_ALLOWED_ORIGINS`, `FS_DEV_MAX_TEXT_FILE_BYTES`, `FS_TREE_CONCURRENCY`, `PLATFORM_SETTINGS_FILE`, `PLATFORM_SECRETS_FILE`, settings policy env (`settings/policy.ts`).

Server-owned local state lives under `~/.platform` (`apps/server/src/home.ts:4-18`): SQLite platform DB, attachments, fonts, language servers, settings file.

---

## 2. Auth in detail (what a TUI must do)

- `createAuthConfig` (`auth.ts:36-41`) has one principal, `kind: 'local'` with `filesystem:read|write` — capabilities are never checked per route today.
- `authGuard` (`auth.ts:43-65`): `origin = request.headers.get('origin')`; `localBrowserOriginError` (`auth.ts:75-79`): no origin → `FsError('UNAUTHORIZED')` (401); origin not in list → `FsError('FORBIDDEN_ORIGIN')` (403). Comparison is exact string `includes` (`auth.ts:82-86`).
- WS: `originFromWebSocketData(data)` reads `data.headers.origin ?? data.headers.Origin` (`auth.ts:88-94`).
- The comment at `auth.ts:96-103` and `docs/environments-and-remote-plan.md:175-196` make the design explicit: **there is no token mode and none is planned until a client that cannot SSH exists**. Bearer tokens in `localStorage` are listed as a non-goal (`docs/environments-and-remote-plan.md:281`).

**Consequence for a TUI:** send `Origin: http://localhost:5173` (or whatever the server was started with) on every `fetch` and every WS upgrade. Bun's `fetch` accepts an `Origin` header; Bun's `WebSocket` accepts `{ headers }` in its options bag. The desktop app does exactly this for `fetch` (`apps/desktop/src/bun/index.ts:46, 199-203, 300-304`). Alternatively start the server with `SERVER_ALLOWED_ORIGINS` including a TUI-specific origin string such as `tui://local` — the allowlist is a plain string compare, so any string works.

CORS itself is irrelevant to a non-browser client; only the `Origin` header check matters.

---

## 3. Route inventory

Legend: **R/R** request/response; **SSE** server-sent event stream (one-way, client aborts by closing); **WS** bidirectional socket. All bodies/query are validated with valibot schemas; query values arrive as strings and are coerced.

### 3.1 `/health` — R/R

|               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health` | Returns `HealthDescriptor & fs.info()` (`app.ts:199-211`). Fields: `ok: true`, `environmentId`, `label` (hostname), `protocolVersion` (=4), `serverVersion` (package.json), `platform: { os, arch }`, plus `workspaceRoot`, `systemRoot`, `homePath`, `defaultPath`, `metadataDbPath`, `maxTextFileBytes`, `workspaceIndex` (status), `nativeWatcherCount`, `watchEnabled` (`fs/service.ts:164-175`, `fs/watch.ts:118-123`). Schema `healthDescriptorSchema` is `looseObject` (`packages/contracts/src/health.ts:4-14`). Behind the auth guard. |

The web records the descriptor into the environments store and refuses identity drift (`apps/web/src/lib/environments/state/store.ts:76-86, 129-146`).

### 3.2 Orchestration — HTTP (`apps/server/src/orchestration/routes.ts`)

All under `/orchestration`.

| Path                                                                               | Kind    | Request                                                                                     | Response                                                                                     | Notes                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /orchestration/commands`                                                     | R/R     | `ClientOrchestrationCommand` (`clientOrchestrationCommandSchema`)                           | `OrchestrationDispatchResult { deduped, sequence }`                                          | Same engine call as WS `dispatchCommand` (`routes.ts:62-79`).                                                                   |
| `GET /orchestration/shell-snapshot`                                                | R/R     | —                                                                                           | `OrchestrationShellSnapshot`                                                                 | Full projects+threads shell (`routes.ts:80-90`). Large body; deliberately HTTP since protocol v3 (`orchestration-ws.ts:26-29`). |
| `GET /orchestration/thread-detail?threadId=`                                       | R/R     | `threadId`                                                                                  | `OrchestrationThreadDetailSnapshot`                                                          | Newest 200 messages + 200 activities window (`routes.ts:91-116`, `orchestration-snapshots.ts:83, 131-144`).                     |
| `POST /orchestration/thread-search`                                                | R/R     | `{ query: 2..200 chars, limit?: 1..50 (default 20) }`                                       | `{ matches: [{ threadId, projectId, source: 'user'                                           | 'assistant', snippet ≤240, messageCreatedAt }] }`                                                                               | `routes.ts:117-133`, `orchestration-ws.ts:56-98`. |
| `GET /orchestration/turn-diff?threadId&fromTurnCount&toTurnCount&ignoreWhitespace` | R/R     | ints as strings; `ignoreWhitespace` only `"true"` opts in                                   | `GitFileDiff[]`                                                                              | `routes.ts:37-42, 134-150`                                                                                                      |
| `GET /orchestration/full-thread-diff?threadId&toTurnCount&ignoreWhitespace`        | R/R     |                                                                                             | `GitFileDiff[]`                                                                              | `routes.ts:44-48, 151-166`                                                                                                      |
| `GET /orchestration/shell-stream?afterSequence=`                                   | **SSE** | `afterSequence` default `0`                                                                 | frames of `OrchestrationShellStreamFrame`; SSE `event:` = `frame.kind`; heartbeat every 15 s | `routes.ts:167-183`, `routes.ts:19`                                                                                             |
| `GET /orchestration/thread-detail-stream?threadId&afterSequence`                   | **SSE** |                                                                                             | frames of `OrchestrationThreadStreamFrame`                                                   | `routes.ts:184-203`                                                                                                             |
| `POST /orchestration/replay`                                                       | R/R     | `OrchestrationReplayEventsInput { afterSequence, aggregateKind?, aggregateId?, threadId? }` | `{ events: OrchestrationEvent[] }`                                                           | No `limit` on HTTP variant (`routes.ts:204-218`, `orchestration-snapshots.ts:184-193`).                                         |

The SSE variants exist and are equivalent to the WS subscriptions; the web app uses the WS for streams and HTTP for the two snapshots (`apps/web/src/features/chat/transport/create-chat-transport.ts:28-38`).

### 3.3 Orchestration — WebSocket RPC (`/orchestration/rpc`) — see §4.

### 3.4 Terminal — `ws /terminal` — see §5.

### 3.5 LSP — `ws /lsp` plus two HTTP helpers — see §6.

### 3.6 Provider (`apps/server/src/provider/routes.ts`)

| Path                                               | Kind       | Request                   | Response                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /providers`                                   | R/R        | —                         | `ProviderListResult { providers: ProviderSnapshot[] }` (`routes.ts:44-46`, `contracts/provider.ts:107-132`). Snapshot carries `providerInstanceId`, `driverKind`, `displayLabel`, `enabled`, `installed`, `version`, `status: ready        | warning          | error                                                                         | disabled`, `auth {status,type,label,email}`, `models[] {slug,name,shortName,isCustom,capabilities{defaultReasoningEffort,reasoningEfforts[],supportsExtendedThinking}}`, `runtimeModes[]`, `traits {supportsApprovals,supportsFullAccess,supportsInterrupt,supportsSessionStop,supportsStreaming,supportsUserInput}`, `supportsSignIn?`. |
| `GET /providers/:providerInstanceId/commands?cwd=` | R/R        |                           | `ProviderCommandCatalog { providerInstanceId, commands[] {name,description,argumentHint,aliases}, skills[] {name,description,path,scope,enabled}, supported }` — never errors, degrades to `supported:false` (`routes.ts:47-56, 126-178`). |
| `GET /providers/:id/auth`                          | R/R        |                           | `ProviderAuthResult { providerInstanceId, auth, checkedAt, supportsSignIn, signInMethods[] }` (`routes.ts:59-62, 186-198`).                                                                                                                |
| `POST /providers/:id/auth/login`                   | R/R        | `{ method: 'subscription' | 'console'                                                                                                                                                                                                                                  | 'sso', email? }` | `ProviderLoginAttempt { attemptId, providerInstanceId, method, state: pending | succeeded                                                                                                                                                                                                                                                                                                                                | failed | cancelled, startedAt, completedAt, message?, outputTail[] }` (`routes.ts:63-75`). Opens a browser on the **server host** — poll the next route. |
| `GET /providers/:id/auth/login/:attemptId`         | R/R (poll) |                           | `ProviderLoginAttempt` (`routes.ts:76-88`).                                                                                                                                                                                                |
| `POST /providers/:id/auth/login/:attemptId/cancel` | R/R        |                           | `ProviderLoginAttempt` (`routes.ts:91-102`).                                                                                                                                                                                               |
| `POST /providers/:id/auth/logout`                  | R/R        |                           | `ProviderAuthResult` (`routes.ts:103-116`).                                                                                                                                                                                                |

Built-in instances: `codex` (default, `DEFAULT_PROVIDER_INSTANCE_ID`) and `claude` (`contracts/provider.ts:196-227`, `orchestration-runtime.ts:103-104`). Runtime modes: `'full-access' | 'approval-required' | 'auto-accept-edits'`; interaction modes `'default' | 'plan'` (`orchestration-runtime.ts:4-9`).

### 3.7 Attachments (`apps/server/src/attachments/routes.ts`)

| Path                         | Kind         | Response                                                                                                                                                  |
| ---------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /attachments/:fileName` | R/R (binary) | image bytes with `cache-control: private, max-age=31536000, immutable` (`routes.ts:12, 24-45`). 404 → `{ error: { message: 'attachment unavailable' } }`. |

URL is derived client-side: `chatAttachmentUrlPath({id, mimeType})` → `/attachments/<encodeURIComponent(id)><ext>` with ext from `CHAT_ATTACHMENT_FILE_EXTENSIONS` (gif/jpg/png/webp only) (`contracts/chat-model.ts:94-131`). Uploads ride inside `thread.turn.start` as `attachments[] { type:'image', id, name, mimeType, sizeBytes, dataUrl }` (max 8, 10 MiB each, data-URL length bounded) (`chat-model.ts:30-87`, `orchestration-commands.ts:256`).

### 3.8 Fonts (`apps/server/src/fonts/routes.ts`) — browser-oriented

| Path                                 | Kind   | Response                                   |
| ------------------------------------ | ------ | ------------------------------------------ |
| `GET /fonts`                         | R/R    | Nerd Font download links (`routes.ts:10`). |
| `GET /fonts/:name/preview?text=`     | binary | woff2 subset (`routes.ts:11-23`).          |
| `GET /fonts/:name`                   | binary | ttf (`routes.ts:24-35`).                   |
| `POST /fonts/batch { names: 1..20 }` | R/R    | `{ [name]: base64                          | null }` (`routes.ts:36-51`). |

A terminal renders with the user's terminal font; a TUI can ignore this group.

### 3.9 Wallpaper (`apps/server/src/wallpaper/routes.ts`) — browser-oriented

`GET /wallpaper/info`, `GET /wallpaper/still`, `GET /wallpaper` (`routes.ts:33-72`). Serves the host desktop wallpaper (macOS). 404 otherwise. Ignore for a TUI.

### 3.10 Settings (`apps/server/src/settings/routes.ts`)

| Path                           | Kind       | Request                                               | Response                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /settings`                | R/R        | —                                                     | `SettingsSnapshot { values, layers[], diagnostics[], serverVersion {epoch, sequence} }` (`routes.ts:37`, `contracts/settings/wire.ts:80-85`). `layers[]` carry the raw file text + parse errors + key ranges (`wire.ts:50-78`).                                                                         |
| `POST /settings/write`         | R/R        | `SettingsMutationRequest { mutationId, target: 'user' | 'workspace', operations[] }`— ops:`set{key,value}`, `reset{keys}`, `keybinding.set{command,keys}`, `keybinding.remove{command}`, `model.setHidden{ref,hidden}`, `model.setOrder{order}`, `provider.setEnabled{providerInstanceId,enabled,createIfMissing?}` (`contracts/settings/mutations.ts:180-223`) | `SettingsMutationResult { mutationId, appliedVersion, changedSettingIds, duplicate, snapshot }` (`mutations.ts:231-238`). Body is parsed inside the handler so typed `settings.*` errors survive (`routes.ts:26-34, 168-203`). |
| `GET /settings/events`         | **SSE**    | —                                                     | `event: settings`, data `SettingsEvent { changedSettingIds, originMutationId?, snapshot }`; heartbeat 15 s (`routes.ts:20, 48-56`, `mutations.ts:240-244`).                                                                                                                                             |
| `GET /settings/raw?target=user | workspace` | R/R                                                   |                                                                                                                                                                                                                                                                                                         | raw layer document (`routes.ts:57`).                                                                                                                                                                                           |
| `POST /settings/raw`           | R/R        | `{ writeId, target, text, baseRevision }`             | `SettingsRawWriteResult` (`routes.ts:58-65`, `mutations.ts:246-260`).                                                                                                                                                                                                                                   |

Registry ids a TUI would consume (`contracts/settings/keys.ts`): `chat.defaultRuntimeMode`, `chat.defaultInteractionMode`, `search.*`, `files.showHidden`, `files.autoSave*`, `terminal.integrated.*`, `providers.instances`, `models.hidden`, `models.order`, `keybindings.overrides`, `logs.*`, plus server-consumed `lsp.*`. Purely visual ones (`workbench.*`, `editor.font*`, `window.transparency`) do not apply to a terminal.

### 3.11 Observability (`apps/server/src/observability/routes.ts`)

| Path                                       | Kind      | Notes                                                                                                                                                               |
| ------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /_log/ingest?instance=`              | R/R (204) | Client log drain; body = one event or array, each `{ level, timestamp, eventId?, ...fields }`; dedupes on `eventId` (`routes.ts:50-59`, `client-ingest.ts:47-119`). |
| `GET /_log/dashboard/summary`              | R/R       | `LogDashboardSummary` (`routes.ts:62-64`, `contracts/log-dashboard.ts:60-74`). Filters: `areas, levels, search, since, slowMs, sources, until` (`routes.ts:17-27`). |
| `GET /_log/dashboard/events?cursor&limit`  | R/R       | `LogEventsResult { detailsById, events[], nextCursor, total }` (`routes.ts:65-67`).                                                                                 |
| `GET /_log/dashboard/event?id=`            | R/R       | `LogEventDetail` or 404 (`routes.ts:68-80`).                                                                                                                        |
| `GET /_log/dashboard/live?pollIntervalMs=` | **SSE**   | `event: event`, data `LogLiveStreamItem` (`routes.ts:81-94`).                                                                                                       |

### 3.12 Git (`apps/server/src/git/routes.ts`, schemas `git/contracts.ts`, DTOs `packages/contracts/src/git.ts`)

All under `/git`. `path` is workspace-relative and optional (default `''`).

| Path                                                                    | Kind             | Request                                      | Response                                                 |
| ----------------------------------------------------------------------- | ---------------- | -------------------------------------------- | -------------------------------------------------------- |
| `GET /git/repo?path`                                                    | R/R              |                                              | `{ repository: GitRepositoryInfo                         | null }` (`service.ts:180-184`) |
| `GET /git/status?path`                                                  | R/R              |                                              | `GitStatusResult { repository, files: GitFileStatus[] }` |
| `GET /git/diff?path&staged=`                                            | R/R              | `staged` `"true"                             | "1"`                                                     | `GitFileDiff[]`                |
| `GET /git/diff/blob?path&oldPath&oldObjectId&newObjectId`               | R/R              |                                              | `GitFileDiff[]`                                          |
| `GET /git/file?path&ref=HEAD`                                           | R/R              | ref grammar `^[A-Za-z0-9_][A-Za-z0-9._/-]*$` | `{ content, path, ref }` (`service.ts:357-367`)          |
| `GET /git/branches?path`                                                | R/R              |                                              | `GitBranchesResult`                                      |
| `GET /git/base-refs?path`                                               | R/R              |                                              | `GitBaseRefChoicesResult`                                |
| `GET /git/branch-diff?path&base`                                        | R/R              |                                              | `GitBranchDiffResult`                                    |
| `GET /git/worktrees?path`                                               | R/R              |                                              | `GitWorktree[]`                                          |
| `POST /git/worktrees/create { path?, sessionId, base?, branch? }`       | R/R              |                                              | `GitWorktreeCreateResult`                                |
| `POST /git/worktrees/remove { path?, worktreePath, force? }`            | R/R              |                                              | `GitWorktreeRemoveResult`                                |
| `POST /git/stage                                                        | unstage          | discard { paths[] }`                         | R/R                                                      |                                | `GitStatusResult`                                                           |
| `POST /git/apply-patch { path?, patch, reverse?, target: index          | worktree }`      | R/R                                          |                                                          | `GitStatusResult`              |
| `POST /git/commit { path?, message }`                                   | R/R              | empty message opens a message file           | `GitCommitResult` (`kind: committed                      | message-file`)                 |
| `POST /git/commit-message { path? }`                                    | R/R              | uses provider LLM                            | `{ message, modelSelection, source: staged               | working }`                     |
| `POST /git/commit-stream { path?, message }`                            | **SSE via POST** |                                              | `event:` = `progress                                     | result                         | failed`, data `GitCommitProgressEvent` (`routes.ts:85-100`, `git.ts:93-96`) |
| `POST /git/checkout { path?, branch }`                                  | R/R              |                                              | `GitStatusResult`                                        |
| `POST /git/create-branch { path?, branch, checkout=true, startPoint? }` | R/R              |                                              | `GitBranchesResult`                                      |
| `POST /git/fetch                                                        | pull { path? }`  | R/R                                          |                                                          | `{ output, repository }`       |
| `POST /git/push { path? }`                                              | R/R              |                                              | `GitPushResult`                                          |
| `GET /git/branch-remote-state?path`                                     | R/R              |                                              | `GitBranchRemoteState`                                   |
| `GET /git/pull-request?path`                                            | R/R              | via `gh`                                     | `GitPullRequestState`                                    |
| `POST /git/pull-request { path?, base?, body?, draft?, title }`         | R/R              |                                              | `GitPullRequestCreateResult`                             |

### 3.13 Filesystem (`apps/server/src/fs/routes.ts`, schemas `fs/contracts.ts`)

All under `/fs`. Paths are workspace-relative strings ≤ 4096 (`contracts.ts:13`).

| Path                                                                                                                                                                                                   | Kind               | Request                                                                                                                     | Response                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /fs/stat?path`                                                                                                                                                                                    | R/R                |                                                                                                                             | `TreeEntry` (`contracts/tree-entry.ts:8-20`: `name, path, canonicalPath?, type, targetType?, size, mtimeMs, birthtimeMs, version`)   |
| `GET /fs/tree?path&depth=1..10&entryType`                                                                                                                                                              | R/R                |                                                                                                                             | `FileTreeResult { path, entries: FileTreeEntry[] }` (children nested)                                                                |
| `GET /fs/read?path`                                                                                                                                                                                    | R/R                |                                                                                                                             | `ReadFileResult { path, content, mtimeMs, size, version }` (`fs/read.ts:7-13`); errors `FILE_TOO_LARGE` 413, `INVALID_TEXT_FILE` 415 |
| `GET /fs/blob?path`                                                                                                                                                                                    | binary             |                                                                                                                             | raw bytes; headers `x-fs-path`, `x-fs-mtime-ms`, `x-fs-version`, `content-length` (`routes.ts:140-151`)                              |
| `GET /fs/search/events?path&query&limit&caseSensitive&excludeGlobs&fileLimit&includeContent&includeGlobs&includeNames&entryType&matchMode&maxDepth&streamNameMatchesEarly&useWorkspaceIndex&wholeWord` | **SSE**            | booleans as `"true"/"false"/"1"/"0"` (`contracts.ts:23-26, 60-76`)                                                          | `event:` = `match                                                                                                                    | warning                                                   | done    | error`; data per `WorkspaceSearchEvent` (`contracts/workspace-search.ts:107-118`, `routes.ts:153-173`). Errors are yielded as an `error` event, not a broken stream (`sse.ts:107-119`). |
| `GET /fs/events?path=&paths=a,b`                                                                                                                                                                       | **SSE**            | one or many roots; `''` = whole workspace (`contracts.ts:176-179`, `watch.ts:676-691`)                                      | first frame `event: ready`, data `{ type:'ready', root:'' }` (`watch.ts:354`), then `created                                         | changed                                                   | deleted | renamed`with`path, oldPath?, entry?, origin?, sequence, version?, writeId?` (`contracts/watch-events.ts:3-44`). Filtered by subscribed roots (`watch.ts:539-551`).                      |
| `GET /fs/recents?limit&mode=file                                                                                                                                                                       | folder&showHidden` | R/R                                                                                                                         |                                                                                                                                      | `{ entries: TreeEntry[] }`                                |
| `POST /fs/recents { path }`                                                                                                                                                                            | R/R                |                                                                                                                             | `TreeEntry`                                                                                                                          |
| `POST /fs/workspace-root { generation ≥1, path }`                                                                                                                                                      | R/R                | opens/re-roots the workspace index                                                                                          | `{ entry, status:'opened'                                                                                                            | 'superseded', workspaceIndex }` (`fs/service.ts:185-215`) |
| `POST /fs/write { path, content, baseVersion?, expectedMtimeMs?, origin?, writeId? }`                                                                                                                  | R/R                | optimistic concurrency → `FILE_CHANGED` 409                                                                                 | `TreeEntry`-like                                                                                                                     |
| `POST /fs/create-file { path, content?, overwrite? }`                                                                                                                                                  | R/R                |                                                                                                                             | entry                                                                                                                                |
| `POST /fs/create-folder { path, recursive? }`                                                                                                                                                          | R/R                |                                                                                                                             | entry                                                                                                                                |
| `POST /fs/rename { from, to, overwrite? }`                                                                                                                                                             | R/R                |                                                                                                                             | entry                                                                                                                                |
| `POST /fs/copy { from, to, overwrite?, recursive? }`                                                                                                                                                   | R/R                |                                                                                                                             | entry                                                                                                                                |
| `POST /fs/delete { path, recursive? }`                                                                                                                                                                 | R/R                |                                                                                                                             |                                                                                                                                      |
| `POST /fs/workspace-edit/prepare`                                                                                                                                                                      | R/R                | `WorkspaceEditPrepareRequest { bodyDigest 'sha256:…', operationId uuid, operations[], origin:'workspace-edit', workspace }` | `WorkspaceEditResult`                                                                                                                |
| `POST /fs/workspace-edit/commit                                                                                                                                                                        | finalize           | abort                                                                                                                       | rollback                                                                                                                             | undo                                                      | redo`   | R/R                                                                                                                                                                                     | `{ expectedGeneration, operationId, transitionId }` | `WorkspaceEditResult` |
| `POST /fs/workspace-edit/recover`                                                                                                                                                                      | R/R                | `+ recoveryTarget`                                                                                                          | `WorkspaceEditResult`                                                                                                                |
| `POST /fs/workspace-edit/release`                                                                                                                                                                      | R/R                | `+ acknowledgePartial?`                                                                                                     | `WorkspaceEditResult`                                                                                                                |
| `GET /fs/workspace-edit/status?operationId`                                                                                                                                                            | R/R                |                                                                                                                             | `WorkspaceEditStatusResult`                                                                                                          |
| `GET /fs/workspace-edit/recovery?workspace`                                                                                                                                                            | R/R                |                                                                                                                             | `WorkspaceEditRecoveryListResult`                                                                                                    |

(`routes.ts:32-134`; workspace-edit types `contracts/workspace-edit.ts:1-142`; server schemas `fs/contracts.ts:234-425`.)

`WatchClientMessage` (`subscribe|unsubscribe|ping`) exists in contracts (`watch-events.ts:46-49`) but **nothing on the server reads it** — file watching is SSE-only with roots fixed at request time.

---

## 4. Orchestration WebSocket RPC protocol (`/orchestration/rpc`)

Server: `apps/server/src/orchestration/ws-rpc.ts`. Contract: `packages/contracts/src/orchestration-ws.ts`. Web client: `apps/web/src/features/chat/transport/orchestration-rpc-client.ts`.

### 4.1 Connect and handshake

1. Client opens `ws(s)://<origin>/orchestration/rpc` (`orchestration-rpc-client.ts:703-708`) with an allowlisted `Origin`.
2. Server `open`: auth via `authenticateWebSocketData`; on failure `close(1008, 'unauthorized')` (`ws-rpc.ts:97-105`).
3. Server immediately **pushes** the first frame (`ws-rpc.ts:108-111`):
   ```json
   {
     "kind": "connected",
     "config": {
       "environmentId": "<durable id from environment_identity table>",
       "protocolVersion": 4,
       "serverVersion": "<apps/server package.json version>",
       "serverInstanceId": "<crypto.randomUUID() per process>",
       "startedAt": "<ISO>",
       "capabilities": { "resume": true, "synchronizedMarker": true },
       "limits": { "replayMaxEvents": 1000, "resumeMaxGap": 1000 }
     }
   }
   ```
   (`ws-rpc.ts:41-62`, schema `orchestration-ws.ts:223-244`.)
4. The web client treats the socket as open **only after** `connected` (`orchestration-rpc-client.ts:365-371, 400-418`), with a 10 s connect timeout (`:29, 324-329`). It records the handshake into the environments store; if `environmentId` differs from a previously recorded one for that origin it throws identity-drift and closes (`store.ts:60-75, 129-146`). If `serverInstanceId` changed, the connection `generation` bumps and every TanStack query is invalidated (`environments/utils/connection.ts:40-52`, `server-restart-invalidation.ts:6-26`).
5. Client compares `protocolVersion` to `ORCHESTRATION_WS_PROTOCOL_VERSION` (`connection.ts:54-59`).

### 4.2 Client → server frames (`orchestration-ws.ts:129-194`)

All frames are JSON text. Elysia validates against `orchestrationWsClientMessageSchema` (`ws-rpc.ts:92`).

| `kind`        | Fields                                                                                                                      | Answer                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `request`     | `requestId` (non-empty string, client-chosen), `method: 'dispatchCommand'`, `command: ClientOrchestrationCommand`           | `response` with `OrchestrationDispatchResult`         |
| `request`     | `requestId`, `method: 'threadDetailPage'`, `input: { threadId, beforeMessage?: {id,createdAt}                               | null, beforeActivity?, limit?: 1..1000 }`             | `response` with `OrchestrationThreadDetailPage { threadId, snapshotSequence, messages[], activities[], hasEarlier }` (rows oldest-first) |
| `request`     | `requestId`, `method: 'replayEvents'`, `input: { afterSequence, aggregateKind?, aggregateId?, threadId?, limit?: 1..1000 }` | `response` with `{ events: OrchestrationEvent[] }`    |
| `request`     | `requestId`, `method: 'serverConfig'`                                                                                       | `response` with the same config object as `connected` |
| `subscribe`   | `subscriptionId` (client-chosen), `method: 'subscribeShell'`, `afterSequence?` (default 0)                                  | stream of `subscription.next`                         |
| `subscribe`   | `subscriptionId`, `method: 'subscribeThread'`, `threadId`, `afterSequence?`                                                 | stream of `subscription.next`                         |
| `unsubscribe` | `subscriptionId`                                                                                                            | none (server aborts silently, `ws-rpc.ts:355-369`)    |
| `ping`        | `requestId`                                                                                                                 | `pong { requestId }`                                  |

Result schemas are keyed by method in `ORCHESTRATION_WS_RESULTS` (`orchestration-ws.ts:280-285`); the response envelope carries no method, so the client must remember the method per `requestId` (`orchestration-rpc-client.ts:204-244`).

### 4.3 Server → client frames (`orchestration-ws.ts:241-322`)

| `kind`                  | Shape                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `connected`             | `{ config }` (first frame only)                                                                                                |
| `response`              | `{ requestId, ok: true, data }` or `{ requestId, ok: false, error: { code?, message, name?, status? } }` (`ws-rpc.ts:451-465`) |
| `subscription.next`     | `{ subscriptionId, item }` where `item` is a shell item, a thread item, or `{ kind: 'synchronized', sequence }`                |
| `subscription.error`    | `{ subscriptionId, error }` — emitted only if the stream threw and was not aborted (`ws-rpc.ts:295-314`)                       |
| `subscription.complete` | `{ subscriptionId }` — emitted when the generator ends without abort (`ws-rpc.ts:316-338`)                                     |
| `pong`                  | `{ requestId }`                                                                                                                |

Re-using a `subscriptionId` replaces the previous subscription (`ws-rpc.ts:253`). On socket close all subscriptions abort (`ws-rpc.ts:128-140, 371-377`).

### 4.4 Subscription item shapes (`orchestration-snapshots.ts:146-182`, `orchestration-ws.ts:201-214`)

Shell stream (`subscribeShell` / `GET /orchestration/shell-stream`):

- `{ kind:'snapshot', snapshot: OrchestrationShellSnapshot { snapshotSequence, projects: OrchestrationProjectShell[], threads: OrchestrationThreadShell[], updatedAt } }`
- `{ kind:'project-upserted', sequence, project }`
- `{ kind:'project-removed', sequence, projectId }`
- `{ kind:'thread-upserted', sequence, thread: OrchestrationThreadShell }`
- `{ kind:'thread-removed', sequence, threadId }`
- `{ kind:'synchronized', sequence }`

`OrchestrationThreadShell` (`orchestration-snapshots.ts:42-68`) is the rail row: `id, projectId, title, modelSelection, runtimeMode, interactionMode, branch, worktreePath, latestTurn, createdAt, updatedAt, archivedAt, session, latestUserMessageAt, pendingApprovalCount, pendingUserInputCount, hasActionableProposedPlan, planProgress?`. Note it does **not** carry the settle/snooze/pin lifecycle fields that `OrchestrationThread` has (`chat-model.ts:315-350`).

Thread stream (`subscribeThread` / `GET /orchestration/thread-detail-stream`):

- `{ kind:'snapshot', snapshot: OrchestrationThreadDetailSnapshot { snapshotSequence, thread: OrchestrationThread, proposedPlans[], checkpoints[] } }`
- `{ kind:'event', event: OrchestrationEvent }` — only for the subscribed thread and only these event types: `thread.message-sent, thread.turn-start-requested, thread.turn-interrupt-requested, thread.session-stop-requested, thread.activity-appended, thread.proposed-plan-upserted, thread.turn-diff-completed, thread.checkpoint-revert-requested, thread.reverted, thread.session-set` (`streams.ts:85-96, 612-617`).
- `{ kind:'synchronized', sequence }`

Shell deltas are coalesced in 25 ms windows / 512 events; only the latest event per aggregate produces one row read (`streams.ts:82-83, 406-449`). A client applying shell items therefore never sees the underlying events, only current rows. **Assistant message streaming is not in the shell stream** — the shell only flips `latestTurn`/`session`; text deltas arrive on the thread stream as `thread.message-sent` events with `streaming: true` (the internal `thread.message.assistant.delta` command projects to that event; `orchestration-commands.ts:337-345`, `orchestration-events.ts:177-187`).

### 4.5 Resume, cursors, and the `synchronized` marker

- `afterSequence` is the highest **stream sequence** the client has applied; `0` = no cursor → snapshot (`orchestration-ws.ts:155-162`).
- Server `resumePlan(afterSequence)` (`streams.ts:137-148`): snapshot when `afterSequence <= 0` (`no-cursor`), when cursor is ahead of head (`cursor-ahead`), when `head - afterSequence > 1000` (`gap-too-large`), or when the retained tail (4000 events, `streams.ts:75`) no longer covers it (`history-evicted`); otherwise **replay** the retained events after the cursor as delta items. Either way the server then emits `{ kind:'synchronized', sequence }` and goes live (`streams.ts:272-299, 301-323`).
- Because `serverInstanceId` changes per process and the retained tail is in memory, a cursor from a previous server generation is always answered by a snapshot. The client must expect a snapshot frame at any subscription start and reset its projection.
- Client-side dedupe: `guardOrchestrationStreamSequence` drops any item whose sequence ≤ last applied (`orchestration-sequence.ts:15-28`). With `afterSequence = N` it starts at `N-1` so a snapshot at `N` is still accepted (`orchestration-rpc-client.ts:710-712`). Snapshot items use `snapshot.snapshotSequence`, events use `event.sequence`, others use `item.sequence`.
- **The web client does not model `synchronized` explicitly** (no matches in `apps/web/src/features/chat`); it passes through the guard and the projection ignores unknown kinds. A TUI can use it to flip a "catching up" indicator.

### 4.6 Command receipts and dedupe

- Every client command carries a client-minted `commandId` (`orchestration-commands.ts:34-36`). `dispatchClientCommand` looks up a receipt first: an `accepted` receipt returns `{ deduped: true, sequence: resultSequence }`; a `rejected` receipt throws `previouslyRejectedCommandError` (`engine.ts:164-201, 524-531`; receipts `command-receipts.ts:26-59`). So retrying a command after a socket drop is safe and idempotent.
- Commands carry no timestamps; the server stamps everything (`orchestration-commands.ts:38-44`).
- Ids (`projectId`, `threadId`, `messageId`, `turnId`, `commandId`) are opaque non-empty trimmed strings, branded only at the type level (`contracts/chat-ids.ts:10-22`) — a client mints them (web uses `crypto.randomUUID()`).

### 4.7 Client command catalog (24 types, `orchestration-commands.ts:302-327`)

`project.create {projectId,title,workspaceRoot,createWorkspaceRootIfMissing?,defaultModelSelection?}`, `project.meta.update {projectId,title?,workspaceRoot?,defaultModelSelection?,scripts?}`, `project.reorder {projectId,orderKey}`, `project.delete {projectId,force?}`, `thread.create {threadId,projectId,title,modelSelection,runtimeMode?,interactionMode?,branch?,worktreePath?}`, `thread.meta.update {threadId,title?,modelSelection?,branch?,expectedBranch?,worktreePath?}`, `thread.delete`, `thread.archive`, `thread.unarchive`, `thread.settle`, `thread.unsettle {reason:'user'}`, `thread.snooze {snoozedUntil}`, `thread.unsnooze {reason:'user'}`, `thread.pin {orderKey?}`, `thread.unpin`, `thread.pin.reorder {orderKey}`, `thread.runtime-mode.set {runtimeMode}`, `thread.interaction-mode.set {interactionMode}`, `thread.turn.start {threadId,turnId,message:{messageId,role:'user',text ≤1e6,attachments?},modelSelection?,titleSeed?,runtimeMode?,interactionMode?,sourceProposedPlan?,bootstrap?:{createThread:{projectId,title,modelSelection,runtimeMode?,interactionMode?,branch?,worktreePath?,requestWorktree?}}}`, `thread.turn.interrupt {turnId?}`, `thread.session.stop`, `thread.approval.respond {requestId,decision:'accept'|'acceptForSession'|'decline'|'cancel'}`, `thread.user-input.respond {requestId,answers:Record<string,unknown>}`, `thread.checkpoint.revert {turnCount}`.

`thread.turn.start` with `bootstrap.createThread` creates the thread and starts the turn in one command — the way the web starts a brand-new chat (`orchestration-commands.ts:106-131, 263`).

### 4.8 Event catalog (30 types, `orchestration-events.ts:300-331`)

Base fields on every event: `sequence, eventId, aggregateKind:'project'|'thread', aggregateId, occurredAt, commandId|null, causationEventId|null, correlationId|null, actorKind:'client'|'server'|'provider', metadata {providerTurnId?,providerItemId?,adapterKey?,requestId?,ingestedAt?}, type, payload` (`orchestration-events.ts:264-283`). Types: `project.created|meta-updated|reordered|deleted`, `thread.created|meta-updated|deleted|archived|unarchived|settled|unsettled|snoozed|unsnoozed|pinned|unpinned|pin-reordered|runtime-mode-set|interaction-mode-set|message-sent|turn-start-requested|turn-interrupt-requested|session-stop-requested|session-set|activity-appended|proposed-plan-upserted|turn-diff-completed|checkpoint-revert-requested|reverted|approval-response-requested|user-input-response-requested`.

Domain shapes a renderer needs (`chat-model.ts`): `OrchestrationMessage {id,threadId,role:'user'|'assistant'|'system',text,attachments,turnId,streaming,createdAt,updatedAt}` (:173-183); `OrchestrationThreadActivity {id,threadId,tone:'info'|'tool'|'thinking'|'approval'|'error',kind,summary,payload:unknown,turnId,sequence?,createdAt}` (:193-203); `OrchestrationSession {threadId,status:idle|starting|running|waiting|ready|interrupted|stopped|error,providerName,providerInstanceId?,providerSessionId,runtimeMode,activeTurnId,lastError,updatedAt}` (:232-253); `OrchestrationLatestTurn {turnId,state:running|interrupted|completed|error,requestedAt,startedAt,completedAt,assistantMessageId,sourceProposedPlan?}` (:267-275); `OrchestrationProposedPlan` (:205-221); `OrchestrationCheckpointSummary` (:286-294); approval/user-input questions `UserInputQuestion {id,prompt,header?,answerKind:text|single-select|multi-select,options[],allowOther,secret}` (`orchestration-runtime.ts:60-85`) ride inside activity payloads.

### 4.9 Liveness

Web pings every 30 s with `{ kind:'ping', requestId }` and tears down the socket if no `pong` within 10 s (`orchestration-rpc-client.ts:31-32, 555-595`). Request timeout 60 s, "slow" marker at 4 s (`:30, 34, 212-244`). Close code 1008 is rendered as "rejected before any data" (`:756-762`).

---

## 5. Terminal WebSocket protocol (`/terminal`)

Server: `apps/server/src/terminal/service.ts`. Contract: `packages/contracts/src/terminal.ts`.

- URL: `ws://<origin>/terminal?root=<workspace-relative dir>&session=<id>` (`service.ts:491-497`; the web sends exactly `{ root, session }`, `apps/web/src/lib/server-sockets.ts:31-42`). `session` defaults to `'default'` and is truncated to 96 chars (`service.ts:62-63, 513-520`). Persistent session key = `[rootRelativePath, sessionId]` (`service.ts:522-524`).
- `open` (`service.ts:101-158`): origin auth (bare close on failure), resolve root through workspace paths (bare close if outside), then either **attach to an existing session** (`existing.attach`) or spawn a new PTY.
- Spawn: shells tried in order `$SHELL, bash, sh` (win32: `$SHELL, %COMSPEC%, powershell.exe, cmd.exe`) (`service.ts:536-542`), env = server env + `TERM=xterm-256color`, `COLORTERM=truecolor` (`:548-554`), initial size **80x24** (`:60-61`) — the client must send `resize` right after `ready`. PTY runs in a child Node process bridge (`NodePtyBridge`, `:597-690`).
- Server → client JSON text frames (`terminal.ts:13-17`): `{ type:'ready', shell, cwd }` (sent on spawn and again on every re-attach, `:304-308`), `{ type:'output', data:string }` (UTF-8 text; on re-attach the buffered last **256 KiB** is sent as one `output`, `:64, 260-267, 339-351`), `{ type:'exit', exitCode:number|null }`, `{ type:'error', message }`.
- Client → server JSON text frames (`terminal.ts:8-11`): `{ type:'input', data:string }`, `{ type:'resize', cols:2..500, rows:1..200 }` (clamped, `terminal.ts:3-6, 88-93`), `{ type:'dispose' }` (kills the PTY and forgets the session, `:282-285`).
- Detach semantics: closing the socket **does not kill the shell**; the session waits 10 min (`TERMINAL_DETACHED_TTL_MS`, `:65, 269-274, 318-325`) for a re-attach with the same `root`+`session`, then kills. A second socket attaching to the same key closes the first (`:310-316`) — one viewer at a time.
- Bytes: everything is JSON-wrapped UTF-8 strings; no binary frames. Output is not chunk-aligned to UTF-8 boundaries by contract, though the bridge decodes with a streaming `TextDecoder` (`:697-698`).

---

## 6. LSP protocol (`/lsp` + `/lsp/match` + `/lsp/semantic-tokens`)

Server: `apps/server/src/lsp/routes.ts`, `lsp/proxy-session.ts`. Contract: `packages/contracts/src/lsp-protocol.ts`.

- `GET /lsp/match?path=<file>&root=<dir>&server=<id?>` → `LspMatch[]` (`{ root, serverId, features: Partial<Record<LspFeatureId, number>> }`) ranked per feature; feature ids: `completion, hover, navigation, signatureHelp, diagnostics, codeActions, formatting, rename, documentHighlights, semanticTokens` (`routes.ts:22-35`, `lsp-protocol.ts:41-62`). Settings `lsp.servers`, `lsp.languageServers`, `lsp.experimental.tyForPython` are consulted live (`app.ts:150-161`).
- `GET /lsp/semantic-tokens?path&root&server` → `{ negotiated: LspNegotiatedSemanticTokens|null, root, serverId } | null` (`routes.ts:52-71`).
- `ws /lsp?path=<file>&root=<dir>&server=<serverId>` (`routes.ts:343-358`; web sends `{ path, root, server }`, `server-sockets.ts:44-59`). `server` is **required** for the socket — without it `resolveExplicitLspRouteMatch` returns null and the server sends `$/serverExited {outcome:'no_server_match'}` then closes (`routes.ts:119-135, 184-193, 287-308`). Spawn failure → `outcome:'spawn_failed'`.
- On the socket the client speaks **plain LSP JSON-RPC 2.0 as JSON text frames** (no `Content-Length` framing; `routes.ts:379-386` accepts string/ArrayBuffer/Uint8Array/object). Messages sent before the backend is acquired are queued (`routes.ts:197-265`).
- The proxy pools one backend per `(root, serverId)` and intercepts: `initialize` (answered from the cached `initializeResult`, sent to the backend once; `proxy-session.ts:438, 734-769, 783-786`), `shutdown` (answered `null` locally, `:439-442`), `textDocument/semanticTokens/full` (converted to delta against a shared baseline; `:443-465`), notifications `initialized`, `exit` (disposes this connection only), `textDocument/didOpen|didChange|didClose` (ref-counted across tabs), `$/cancelRequest` (id-remapped) (`:828-845`). Everything else is forwarded with request-id remapping.
- Proxy-originated notifications the client must tolerate (`lsp-protocol.ts:24, 27, 39`): `workspace/semanticTokens/refresh` and `workspace/diagnostic/refresh` re-emitted **as notifications (no id)**; `$/serverExited { serverId, outcome, exitCode, exitSignal, stderrTail?, error? }` immediately before the proxy closes the socket.
- Idle timeout and delta behaviour read from `lsp.idleTimeoutMs`, `lsp.semanticTokens.delta` settings (`app.ts:165-170`).

---

## 7. SSE framing (shared by every `*-stream`/`events` route)

`apps/server/src/sse.ts`:

- Headers `cache-control: no-cache`, `connection: keep-alive`, `content-type: text/event-stream`, `transfer-encoding: chunked` (`sse.ts:10-15`).
- Each frame is Elysia's `sse({ event, data })` serialization: `event: <name>\ndata: <JSON>\n\n`. `event` is the item's discriminator (`kind` for orchestration/git/logs, `type` for fs) (`orchestration/routes.ts:174`, `fs/routes.ts:51, 64`).
- Heartbeat frames `event: heartbeat`, `data: null` every `heartbeatMs` (15 s on orchestration, settings, logs; none on fs streams) (`sse.ts:6, 82-105`).
- `toErrorYieldingSse` (used by `/fs/search/events`) converts a thrown error into a final `event: error` frame instead of aborting (`sse.ts:107-119`).
- The stream ends when the client aborts the request (`request.signal`), which is how the web cancels (`sse.ts:48-80`; web passes `fetch: { signal }`, `use-events.ts:807-812`).
- A Bun client can consume these with `fetch` + `response.body` reader and a minimal SSE parser, or reuse Eden's built-in `text/event-stream` async iterator (`node_modules/@elysia/eden/dist/chunk-TTKI5TQ7.mjs`), which the web wraps in `parseEdenSseStream` (`eden-events.ts:36-59`).

---

## 8. How the web binds (and what a Bun TUI copies)

| Web module                                                            | What it does                                                                                                                                                                                                                                     | TUI equivalent                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/client.ts:7-43`                                     | `treaty<App>(origin, { headers: () => ({ 'x-client-instance': id }) })`, one client per origin, `getClient()` returns the active origin's. Default origin `http://localhost:3001` or `VITE_SERVER_URL`.                                          | Same code works under Bun; add `headers: { Origin }`. Optionally pass a custom `fetcher` (treaty supports `t.fetcher`).                |
| `apps/web/src/lib/instance-id.ts:8-23`                                | `crypto.randomUUID()` per process, sent as `x-client-instance` and `?instance=` on the log drain.                                                                                                                                                | Identical.                                                                                                                             |
| `apps/web/src/lib/server-sockets.ts:31-59`                            | `client.terminal.subscribe({ query })` / `client.lsp.subscribe({ query })` — Eden builds the WS URL by string concatenation **without URL-encoding query values** (`chunk-FXT7FC66.mjs` fn `K`), and calls `new WebSocket(url)` with no headers. | Build the URL with `URLSearchParams` and `new WebSocket(url, { headers: { Origin } })` (Bun supports headers). Do not use Eden for WS. |
| `apps/web/src/lib/eden-events.ts:23-69`                               | `unwrapEdenResponse` (`{data,error}` envelope → throw on error), `parseEdenSseStream`, `normalizeEdenDates` (Eden revives ISO strings to `Date`).                                                                                                | If using treaty, keep `normalizeDates`; if using raw `fetch`, skip.                                                                    |
| `features/chat/transport/orchestration-rpc-client.ts` (791 lines)     | Full WS RPC client: connect gating on `connected`, request map by `requestId`, subscription queues, heartbeat, reconnect-on-demand (a new socket is opened lazily by the next call; there is no background reconnect loop).                      | Port nearly verbatim; it depends on `useEnvironmentsStore` for handshake bookkeeping and on client logging — replace those two seams.  |
| `features/chat/transport/chat-transport.ts:16-33`                     | `ChatTransport` interface: `dispatchCommand, replayEvents, shellStream, threadDetailPage, threadDetailSnapshot, threadDetailStream, retainThreadDetail, loadEarlierPage, close`.                                                                 | This is the exact client-side contract to implement.                                                                                   |
| `features/chat/transport/orchestration-http-snapshots.ts:27-80`       | Snapshots via HTTP with a timeout signal.                                                                                                                                                                                                        | Same.                                                                                                                                  |
| `lib/environments/utils/connection.ts:40-59`, `state/store.ts:60-146` | Handshake → `generation` bump on new `serverInstanceId`; identity-drift refusal when `environmentId` changes for an origin.                                                                                                                      | Keep both checks: they are the only signals of a server restart / wrong server.                                                        |
| `lib/environments/state/activity.ts`                                  | Per-origin `AbortSignal` that closes every socket/stream on environment switch.                                                                                                                                                                  | Same pattern.                                                                                                                          |
| `lib/client-logging.ts:28, 162-168`                                   | Batches client logs to `POST /_log/ingest?instance=`. Falls back to `sendBeacon`.                                                                                                                                                                | POST with `fetch`; no beacon.                                                                                                          |

---

## 9. Browser assumptions a TUI must replace

- **`Origin` header**: browsers add it automatically; a TUI must add it by hand (§2). Nothing else in auth is browser-specific.
- **CORS** (`app.ts:178-190`): irrelevant outside a browser, but the GET/POST-only method set is a server fact that shaped the API (no DELETE/PUT).
- **Eden WS**: `new WebSocket(url)` with no headers and unencoded query strings (§8).
- **`localStorage`**: `lib/workspace-cache-storage.ts:5-7, 40, 87, 98` persists workbench UI state under `platform.workspace-state.v19.*` — chat drafts, rail order, selection, diff scope etc. (see `docs/environments-and-remote-plan.md:117`). A TUI needs its own per-user cache (e.g. a JSON file under `~/.platform`). Not server state.
- **`window`/`document`/`navigator`**: `lifecycle-flush.ts`, `clipboard.ts`, `default-nerd-font.ts`, `platform/bridge.ts` (Electrobun bridge), `platform/backdrop.ts` — all presentational.
- **Fonts/wallpaper routes**: browser-only material.
- **Attachments**: the web builds `<img src>` from `chatAttachmentUrlPath`; a TUI would fetch bytes and either render via a terminal image protocol or show a placeholder.
- **Provider sign-in** opens a browser on the server host and is polled; fine from a TUI on the same machine, awkward remotely.
- `import.meta.env.VITE_*` for server URL and log level (`client.ts:11`, `client-logging.ts:170-181`) → CLI flags/env in a TUI.

---

## 10. Things a TUI could reuse directly or steal

1. `packages/contracts` wholesale: every schema is valibot and runtime-neutral (`packages/contracts/src/index.ts`). Validate every inbound WS/SSE frame with `orchestrationWsServerMessageSchema`, `orchestrationShellStreamFrameSchema`, `orchestrationThreadStreamFrameSchema`, `parseTerminalServerMessage`, `settingsEventSchema`.
2. `server/client-contract` `type App` + `@elysia/eden` treaty for HTTP and SSE under Bun (`apps/server/src/client-contract.ts`).
3. `apps/web/src/features/chat/transport/orchestration-rpc-client.ts` and `orchestration-sequence.ts` as the WS RPC client and cursor guard.
4. `apps/web/src/lib/environments/utils/connection.ts` (pure) for handshake/generation logic.
5. The projection writers in `apps/web/src/features/chat/state/chat-projection-writers.ts` (reduce events/shell items into view state) — worth extracting into a shared package rather than re-deriving.
6. `packages/contracts/src/composer-tokens.ts` (mentions/slash parsing) and `fuzzy-rank.ts`, `workspace-search-match.ts` for palette/search UX.
7. The desktop's `requestHeadersForProbe` pattern for synthetic `Origin` (`apps/desktop/src/bun/index.ts:300-304`).

---

## 11. Risks and open questions

- Auth is origin-only; a TUI that hardcodes `Origin: http://localhost:5173` is spoofing a browser origin. Cleaner: register a dedicated origin string via `SERVER_ALLOWED_ORIGINS` and make the launcher (`scripts/runtime-network.ts:58-67`) include it. Real sessions are explicitly deferred (`docs/environments-and-remote-plan.md:186-188`).
- Terminal and LSP sockets close with no code on auth failure; only orchestration uses 1008. A TUI cannot distinguish "unauthorized" from "root invalid" on `/terminal` without reading server logs.
- Eden's WS query builder does not URL-encode; roots containing `&`, `#`, `%` or spaces break (`chunk-FXT7FC66.mjs` fn `K`). Hand-roll.
- The shell stream never carries assistant text; the TUI must hold a thread subscription for every thread it renders live (the web caps this with `retainThreadDetail` ref-counting in `thread-detail-subscriptions`).
- `synchronized` is emitted but unmodelled client-side; the resume/gap decision is server-side and invisible except via logs.
- `replayEvents` over HTTP has no `limit`; over WS it is capped at 1000 (`orchestration-ws.ts:103-108`).
- `WatchClientMessage` is dead contract; do not implement subscribe/unsubscribe over the watch stream.
- The settings document is per environment; the web always reads the primary's (`docs/environments-and-remote-plan.md:170-175`). A TUI must decide which server's `/settings` is "the" settings.
- Elysia WS frame validation: invalid client frames are rejected by Elysia's schema layer before `message()` runs (`ws-rpc.ts:92`); the exact error frame (if any) Elysia sends was not verified here.
- Dates: contracts type them as strings but a treaty client receives `Date` objects unless normalized — a subtle source of valibot failures in a TUI that mixes treaty and raw parsing.
