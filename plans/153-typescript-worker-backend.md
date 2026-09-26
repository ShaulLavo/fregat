# Plan 153: TypeScript can run in the browser worker

## Status and authorization

- Status: CLOSED — Phase 1 landed; the Platform worker phases (2 and 3) were dropped by the owner
  on 2026-09-26: "I don't want Platform to know about it at all; that's a mistake. Platform always
  uses server TS; the worker should just be a nice-to-have Editor feature." Lane L7 built them and
  [Plan 185](185-server-typescript-only.md) removed them before PR #37 merged. The worker backend
  stays in the Editor repo (`@singapore-editor/typescript-lsp`, Editor PR #34).
- Priority: P3. The server path works; this is a second backend, useful where no server runs a
  language server (a remote machine without Node tooling, a read-only share) and as a fallback.
- Effort: M.
- Risk: MED. A whole-project program in a tab costs about 1.1 GB for `apps/web`.
- Planned at: Platform `9c1c45d1`, 2026-09-25, after Editor E054 completed
  (`Editor/docs/architecture/e054-worker-language-server-parity.md`).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

## Outcome

With the TypeScript backend set to the worker, a TypeScript file in Platform gets hover,
completion, diagnostics, rename, code actions, formatting, symbols and navigation from
`@singapore-editor/typescript-lsp` in a Web Worker, with no language server process, and the
server backend stays the default.

## What exists today

- E054 made the worker answer every method the server path answers; its parity harness is
  `Editor/packages/typescript-lsp/test/parity.test.ts`. It loads its standard library from the
  package, takes files through `setWorkspaceFiles`, `upsertWorkspaceFiles` and
  `deleteWorkspaceFiles`, and reports a crash as `$/serverExited` (`LSP_SERVER_EXITED` in
  `@singapore-editor/lsp`), which `LspConnection` turns into `LspServerExitedError`.
- Platform's TypeScript lane is a WebSocket to the server's proxy
  (`liveLanguageServerLane` and `languageServerLaneOptions` in
  `apps/web/src/features/editor/utils/language-server-plugin.ts`),
  which spawns tsgo or typescript-language-server (`apps/server/src/lsp/typescript/runtime.ts`,
  registered in `apps/server/src/lsp/registry.ts:583`).
- Platform's proxy sends the same `$/serverExited` (`packages/contracts/src/lsp-protocol.ts`), and the
  web lane reads the reason from `LspServerExitedError` in `onError` (Phase 1).
- Reads go through `GET /fs/read` one file at a time (`apps/server/src/fs/routes.ts:42`).

## Measurements that shape it (E054 Step 4)

On `apps/web` (`tsconfig.app.json`, 9,341 program files, 48 MB), preloading the exact file set
reached first diagnostics in 2.8 s with a 1.1 GB worker heap; 50 external edits cost the next
diagnostics about 300 ms. Synchronous pull took 31–46 s at 1 ms per host call and needs
cross-origin isolation, so it is not an option. Preload's catch is choosing the set: it was
recorded from the program itself. The server can produce it the same way.

## Decisions

- **D1 — setting and scope.** Proposed `lsp.typescript.backend: 'server' | 'worker'`, default
  `'server'`. It selects what runs, so it is `machine` scope, not `window`.
  Decided 2026-09-25: recommendation (completion wave)
- **D2 — memory ceiling.** The worker holds the whole program. Proposed: refuse the worker backend
  above a file-count or byte limit reported by Phase 2's list, and say why, rather than let a tab
  take gigabytes. Decided 2026-09-25: recommendation (completion wave)
- **D3 — where the file list comes from.** Proposed: a server route runs
  `tsgo -p <tsconfig> --listFilesOnly` for the file's project and returns paths and sizes. The
  alternative, resolving imports in the browser in rounds, needs no server TypeScript but costs a
  program rebuild per round. Decided 2026-09-25: recommendation (completion wave)

## Phases

### Phase 1: Exit notification in one shape

Point `LSP_SERVER_EXITED` in `packages/contracts` at `$/serverExited` and let the web lane read the
reason from `LspServerExitedError` in `onError` instead of its own `exit.params`. Evidence: the
existing proxy-session exit tests, and a server killed under `agent:browser` still shows its
catalog guidance once.

#### Phase 1 landed (2026-09-25)

- `LSP_SERVER_EXITED` in `packages/contracts` is `$/serverExited`, and `LspServerExitedParams` gained
  the optional `error` (code, message, why, fix) in the Editor's shape. Both proxy send sites
  (`proxy-session.ts` `closeConnections`, `routes.ts` `closeWithReason`) are typed against it.
- The web lane no longer registers an exit handler. `notifyServerExit` toasts only an
  `LspServerExitedError` that carries catalog guidance. The per-lane `exit.params` record and the
  client `lsp.server_exit` event are gone.
- An announced close now reaches the pool as `LspServerExitedError`, not the transport's close
  error, so the client events carry `exitOutcome`, `exitCode`, `exitSignal` and `serverFailed`
  (`utils/server-exit-fields.ts`) in place of the close code and message counts; the server's
  `lsp.socket.close` still records those. `lsp.connection.reconnecting` logs at info, so a server
  that died and came back leaves a client record. The lane's `onError` also runs when its ready
  notifications fail, so its event is `lsp.lane_failed`, with the error and the same exit fields.
- The per-lane record covered a final attempt whose server "died before it said anything". The
  proxy joins a socket to its backend in the same task that `acquire` resolves, and a process exit
  arrives as a later task. Under the new code the scenario's final `lsp.lane_failed` event carries
  `serverFailed: true` and `exitSignal: SIGKILL`, so the last attempt brought the guidance itself.
- Known gap: a crash streak whose last attempt fails another way (an initialize timeout, a refused
  socket, or `spawn_failed`, which carries no guidance on any attempt) gives up with no toast.
  `LspConnection` clears its exit on every new transport, so the remedy is Editor-side: keep the
  last announced exit across reconnect attempts and report it on give-up.
- Editor follow-up: `docs/architecture/e054-worker-language-server-parity.md` still says Platform
  sends `$/platform/serverExited`.
- Evidence: `proxy-session.test.ts` exit tests now expect `$/serverExited`. New tests in
  `language-server-plugin.test.ts` pin the method and params shape against `@singapore-editor/lsp`,
  show the guidance once on give-up with the `lsp.lane_failed` fields, and stay quiet for a clean
  close or a lost socket; `language-server-connection-pool.test.ts` pins the exit fields on
  `lsp.connection.reconnecting`. Scenario `editor-lsp-server-exit` asserts one toast and one copy of
  the fix on the page, then waits for the `lsp.lane_failed` log to reach the server
  (`/work/tmp/fregat-evidence/20260925T130643Z-scenario-editor-lsp-server-exit/`, whose log has one
  `lsp.connection.reconnecting` per restart and the `lsp.lane_failed` give-up). The throwaway
  server batches its log every 200 ms, so a run's copy keeps its tail.
- The toast reads the guidance straight from the exit params, the same field `serverFailed` reads,
  so guidance without a catalog code still reaches the user.

### Phase 2: A program's files from the server (dropped, removed by Plan 185)

`GET /lsp/typescript/program-files?root=&tsconfig=` returns the list D3 settles on, and a batched
read returns their text in one response. Evidence: a route test against a fixture project, and the
`apps/web` list matching `tsgo --listFilesOnly`.

#### Phase 2 landed (2026-09-25)

- `GET /lsp/typescript/program-files?root=&tsconfig=` (`apps/server/src/lsp/typescript/program-files.ts`)
  runs `<compiler> -p <tsconfig> --listFilesOnly` from `root` and returns
  `{ root, tsconfig, runtime, files: [{ path, size }], totals: { files, bytes }, skipped }`.
  Paths are workspace-relative, the form `GET /fs/read` takes. The compiler comes from
  `resolveTypeScriptCompiler` in `runtime.ts`: the runtime the language server uses, with a legacy
  package's `lib/tsc.js` beside its `tsserver.js`. The run is bounded at 60 s and 64 MB of output.
- `POST /lsp/typescript/program-files/read` takes `{ paths }` (at most 50,000) and returns
  `{ files: [{ path, content, size, version }], failed: [{ path, code }], totals }`, reading 32 at a
  time. Each file goes through `readTextFile`, the function behind `GET /fs/read`, with the same
  size limit; a refused or vanished file fails alone with its `FsError` code.
- Security: `root` must resolve (real path) to a directory with a workspace address, which
  `POST /fs/workspace-root` records when the app opens a folder. A tsconfig whose real path is
  outside that root is refused. A listed file is kept only when `/fs/read`'s rule accepts it
  (inside the server's filesystem root after `realpath`); the rest count as `skipped.outside`.
- Standard library files are dropped and counted as `skipped.library`: a `lib*.d.ts` whose
  directory holds `lib.es5.d.ts`. The worker loads its own by name from compilerOptions
  (`libraryFiles: 'bundled'`, 113 files from TypeScript 6.0.3 in
  `Editor/packages/typescript-lsp/src/worker/bundledLibraries.ts`).
- The batched read decodes binary-looking files: `apps/web`'s
  `features/terminal/state/session-registry.ts` has a NUL inside a template literal, and
  `acceptTextOnly` refused it. The compiler already read every listed file as source.
- Errors come from a new `lspErrors` catalog (`apps/server/src/lsp/errors.ts`):
  `PROGRAM_ROOT_NOT_OPEN` (403), `PROGRAM_TSCONFIG_OUTSIDE_ROOT` (403), `PROGRAM_LIST_FAILED` (422,
  with exit code and `TS` diagnostic codes in `internal`), `PROGRAM_LIST_LIMIT` (504). A config
  error that still lists files is not a failure. No setting is registered; Phase 3 applies D2 to
  `totals`.
- Evidence: `apps/server/src/lsp/tests/typescript-program-files.test.ts` (6 tests) drives the real
  app over a fixture project with the installed native TypeScript 7.0.2 and the legacy 6.0.3
  package: exact files and sizes, one package linked from outside the server root counted as
  `outside`, library counted, unopened root, tsconfig outside the root, a config that lists
  nothing, and the batched read matching `/fs/read` for the same file, including a source file
  with a NUL byte. Without the route wiring all 6 fail (404); with the registration check, the
  tsconfig containment or the library skip removed, the matching test fails; with `acceptTextOnly`
  back, the read test fails.
- `apps/web` (`tsconfig.app.json`, TypeScript 7.0.2, server root `/`): `tsc --listFilesOnly`
  printed 9,370 files, 65 of them standard library. The route returned 9,305 files, 45,344,297
  bytes, the same path set as the other 9,305 lines, skipped 65 library, 0 outside, 0 missing, in
  0.46 s. The batched read returned all 9,305 (45,344,297 bytes, 0 failed) in 0.43 s.
- For Phase 3: the list is the compiler's, so it holds real paths. A package under
  `node_modules/.bun/…` or a linked `@singapore-editor/*` package appears at its target, and the
  list has no `package.json` or tsconfig `extends` files. The worker resolves modules against the
  paths it holds, with `realpath` as the identity, so Phase 3 has to supply the files module
  resolution reads, the tsconfig chain, and the link paths, or the Editor worker has to take a
  realpath map. E054's 2.8 s preload recorded those reads from a host; this list does not.

### Phase 3: The worker lane (dropped)

Behind D1, the TypeScript lane builds `createTypeScriptLspPlugin` with `onApplyWorkspaceEdit` from
Platform's workspace-edit lifecycle, preloads Phase 2's files, and forwards Platform's file-change
events as `upsertWorkspaceFiles` and `deleteWorkspaceFiles`. Evidence: a scenario under
`scripts/agent/scenarios/` that renames across two files, applies a quick fix and formats with the
setting on, and `renders`/`trace` against the server backend on the same drive.

## Verification

- `bun run gates` and the touched workspaces' tests.
- The Phase 3 scenario, run with the backend set to each value; `look` on the editor with the
  worker backend.
- The worker's heap for `apps/web` read from the browser and compared with D2's limit.

## Out of scope

- Other languages (E054 is TypeScript only by owner decision, 2026-09-25).
- Sharing one worker across tabs.
