# Plan 153: TypeScript can run in the browser worker

## Status and authorization

- Status: PROPOSED — D1–D3 need the owner before Phase 1.
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
  (`apps/web/src/features/editor/utils/language-server-plugin.ts:243`, `webSocketRoute` at `:320`),
  which spawns tsgo or typescript-language-server (`apps/server/src/lsp/typescript/runtime.ts`,
  registered in `apps/server/src/lsp/registry.ts:583`).
- Platform's exit notification is `$/platform/serverExited` (`packages/contracts/src/lsp-protocol.ts:39`),
  handled in `language-server-plugin.ts:347` with its own bookkeeping.
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
- **D2 — memory ceiling.** The worker holds the whole program. Proposed: refuse the worker backend
  above a file-count or byte limit reported by Phase 2's list, and say why, rather than let a tab
  take gigabytes.
- **D3 — where the file list comes from.** Proposed: a server route runs
  `tsgo -p <tsconfig> --listFilesOnly` for the file's project and returns paths and sizes. The
  alternative, resolving imports in the browser in rounds, needs no server TypeScript but costs a
  program rebuild per round.

## Phases

### Phase 1: Exit notification in one shape

Point `LSP_SERVER_EXITED` in `packages/contracts` at `$/serverExited` and let the web lane read the
reason from `LspServerExitedError` in `onError` instead of its own `exit.params`. Evidence: the
existing proxy-session exit tests, and a server killed under `agent:browser` still shows its
catalog guidance once.

### Phase 2: A program's files from the server

`GET /lsp/typescript/program-files?root=&tsconfig=` returns the list D3 settles on, and a batched
read returns their text in one response. Evidence: a route test against a fixture project, and the
`apps/web` list matching `tsgo --listFilesOnly`.

### Phase 3: The worker lane

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
