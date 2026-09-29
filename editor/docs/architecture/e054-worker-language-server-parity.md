# E054: the TypeScript worker at language-server parity

Completed 2026-09-25. `@singapore-editor/typescript-lsp` answers every method Platform gets from its
server-side TypeScript backend, loads its standard library without the network, takes project files
one at a time, and reports its own crash the way a server process does. The Editor demo renames
across files, applies a quick fix, formats, and shows an outline with no server running.

## Parity, before and after

`packages/typescript-lsp/test/parity.test.ts` drives one scripted session through the real
`LspClient`: a workspace file, an opened document, an edit, then every row below. A row is
`supported` only when the capability is advertised and the answer carries what the feature needs;
a capability advertised without a row fails the suite. Run against the worker as it stood at
`ed5b2e2`, the same harness produced the left column.

| Method                                                        | Before (`ed5b2e2`)          | After                                                                                     |
| ------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| hover, definition, references, implementation, typeDefinition | supported                   | supported                                                                                 |
| completion                                                    | supported                   | supported                                                                                 |
| `completionItem/resolve`                                      | not advertised              | supported (detail, documentation, auto-import edits)                                      |
| signatureHelp                                                 | not advertised              | supported (label offsets, active parameter, rest parameters)                              |
| documentHighlight                                             | not advertised              | supported (read and write kinds)                                                          |
| documentSymbol                                                | not advertised              | supported (tree in document order, or flat with containers)                               |
| `workspace/symbol`                                            | not advertised              | supported (standard library left out)                                                     |
| prepareRename, rename                                         | not advertised              | supported (versioned `documentChanges` or a `changes` map)                                |
| codeAction                                                    | not advertised              | supported (quick fixes with VS Code's preferred-fix ranking, refactors, organize imports) |
| `codeAction/resolve`                                          | not advertised              | supported (refactor edits computed when chosen)                                           |
| formatting, rangeFormatting, onTypeFormatting                 | not advertised              | supported (the request's indentation, the document's line ending)                         |
| `textDocument/diagnostic`                                     | **advertised, not handled** | supported (`resultId`, `unchanged`, debounced, cancellable)                               |
| semanticTokens full, range                                    | supported                   | supported                                                                                 |

A client that declares pull diagnostics is no longer pushed to: every `LspClient` declares it, and
both paths computing the same diagnostics per keystroke was the waste. A document change with more
than one document open sends `workspace/diagnostic/refresh`, so the others are asked again.

Completion used to cut TypeScript's list to its first 100 entries before anything was typed, and
said the list was complete. An auto-import sorts late, so typing more never brought it back. The
typed word now filters first, and a capped list is marked incomplete.

## Where the code is

The worker file is a three-line shim over `src/worker/session.ts`, a server with no transport:
messages in, messages out. Tests drive the session in process (`test/inProcessWorker.ts`) behind
the same `LspWorkerLike` a `Worker` presents, so every suite runs real TypeScript. Each method lives
in its own module under `src/worker/`. `projectHost.ts` replaces `@typescript/vfs`, which is gone:
its update re-parsed the whole file and made every updated file a program root.

## How the worker gets a project's files

Step 4 measured preload against synchronous pull on Platform's `apps/web`
(`tsconfig.app.json`: 9,341 program files, 48 MB of text, 6,260 of the files in `node_modules`),
opening `src/features/git/components/change-file-row.tsx`, in a Bun worker. Reproduce with
`bun bench/fileProvider.ts --project <apps/web> --config tsconfig.app.json --target <file>`.

| Strategy                              | Latency per host call | First diagnostics | Program files | Host round trips | Worker heap | After 50 external edits |
| ------------------------------------- | --------------------- | ----------------- | ------------- | ---------------- | ----------- | ----------------------- |
| preload (ideal set, one message)      | n/a                   | 2,758 ms          | 9,341         | 0                | 1,117 MB    | 306 ms                  |
| synchronous pull, whole project       | 0 ms                  | 3,196 ms          | 9,341         | 40,341           | 1,084 MB    | 309 ms                  |
| synchronous pull, open file's closure | 0 ms                  | 2,314 ms          | 6,207         | 27,181           | 771 MB      | 276 ms                  |
| synchronous pull, whole project       | 1 ms                  | 45,867 ms         | 9,341         | 40,341           | 1,076 MB    | 371 ms                  |
| synchronous pull, open file's closure | 1 ms                  | 31,060 ms         | 6,207         | 27,181           | 766 MB      | 298 ms                  |

Synchronous pull blocks once per uncached question, and TypeScript's module resolution asks tens of
thousands of them. At one millisecond each, a cheap local HTTP round trip, first diagnostics take
half a minute or more. It also needs cross-origin isolation. **Preload won** and is what shipped:
the host pushes files, then keeps them current with `editor/typescript/upsertFiles` and
`editor/typescript/deleteFiles` (`upsertWorkspaceFiles` and `deleteWorkspaceFiles` on the plugin).
Each change reaches the program as one versioned file; a tsconfig or package.json rebuilds it. The
plan's stop condition was not reached: 2.8 s to first diagnostics on `apps/web` is usable.

The preload row is preload's best case: the bundle was recorded by building the same program on the
host first, so it holds exactly the files the program reads. A host with no resolver of its own has
to choose that set another way; Platform's server can list it (`tsgo --listFilesOnly`). The worker's
memory is the program's, not the strategy's: about 1.1 GB for the whole of `apps/web`.

## Standard library

The library ships with the package: `src/worker/bundledLibraries.ts` (generated by
`scripts/generate-bundled-libraries.ts`) holds one lazy `?raw` import per `lib.*.d.ts`, built into
a chunk each, and the worker loads only the reference closure of the program's `lib` or default
library: for the default ES2023 target, 67 of the 108 files (2.9 MB) in 10 rounds, one per
reference depth. `createTypeScriptLspPlugin()` therefore works offline with no
options, as the simple API requires. `libraryFiles: 'cdn'` opts into TypeScript's playground copy;
a loader function answers the worker's `editor/typescript/libraryFiles` request for a host that
supplies its own. The generic `serverRequestHandlers` option on `lsp-plugin` carries that request,
through the connection pool too: the first borrower with a handler answers.

## A crash is an exit

`TypeScriptLspWorkerOwner` posts `$/serverExited` (`LSP_SERVER_EXITED` in `@singapore-editor/lsp`)
with the worker's error before it fails the transport, in the same shape Platform's server path
sends as `$/serverExited`. `LspConnection` records the notification and reports the close
that follows as `LspServerExitedError`, once, with status `error`; before, a worker crash reached
`onError` twice and said nothing about why. The WebSocket session in `./server` forwards the
notification to its socket.

## Verification

- `bun run test` in `packages/typescript-lsp`: the parity harness, one test per method in
  `test/methods.test.ts` (shapes and positions in multi-line files), the session's protocol in
  `test/worker.test.ts` (push to a non-pulling client, incremental upsert and delete, tsconfig
  rebuild, host-supplied libraries), `test/libraries.test.ts`.
- `bun run test` in `packages/lsp-plugin`: server-request handlers through the pool, and a close
  after `$/serverExited` reported as that exit.
- `bunx playwright test` in `examples/app`: `fixes, formats, renames across files and outlines with
no language server`, with the CDN routed to fail.

## Left for later

- Platform adopting the worker (a backend setting, a file provider over Platform's fs routes, and
  its exit constant aligned with `$/serverExited`) is Platform's plan.
- `onTypeFormatting` is answered but no Editor feature asks for it; the Editor's own reindent runs on
  typed closers.
- Refactors that need more input (`isInteractive`) and fix-all source actions are not offered.
- The program's memory is not bounded by the worker.

## Host project identity and live buffers

A host can pass `canonicalPaths` when a package is reachable through a symlink and its real path.
The worker uses one canonical identity for source files, roots, versions and unsaved overlays,
while workspace edits retain the URI of an open document. Native `tsx` and `jsx` syntax ids are
accepted and mapped to the protocol's `typescriptreact` and `javascriptreact` ids.

`synchronizeLanguageServerBuffer` in `lsp-plugin` attaches another live text buffer to a connection
without mounting another editor. It uses the same document synchronization controller and exact
text snapshots as view synchronization, including edit provenance and repeated URI transitions.
Dispose the attachment when its buffer leaves the host's live document store.
