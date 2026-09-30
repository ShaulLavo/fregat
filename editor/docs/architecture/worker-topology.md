# Worker Topology

Status: Phase 11 working note.

This document records cache ownership, cache limits, and restart behavior for worker owners that
exist today. A worker owner is the object responsible for creating the worker, exposing inspection,
owning disposal, and defining what happens after a worker failure.

## Summary

| Owner | Package | Cache limit | Restart behavior |
|---|---|---|---|
| `TreeSitterWorkerClient` | `@singapore-editor/tree-sitter` | Per worker document cache keeps at most 6 parsed snapshots and at most 8,000,000 retained source units, while preserving the newest 2 snapshots. Owner-side source chunk accounting is per live document and cleared on document disposal, source-cache errors, crash, or owner disposal. | A crash terminates the worker, rejects pending requests, clears owner caches, and leaves lifecycle `crashed`. The next request on the same owner creates a fresh worker generation; failed requests are not replayed automatically. |
| `MinimapWorkerOwner` | `@singapore-editor/minimap` | No cross-document worker cache. The client owns one current minimap projection, one queued update, latest token source, style signatures, and a CSS color cache cleared on theme/style invalidation or disposal. | A crash terminates the worker and leaves lifecycle `crashed`. There is no automatic restart on the same owner; recreate the minimap contribution/client. Disposal waits for a worker `disposed` acknowledgement before terminating. |
| `ShikiWorkerOwner` | `@singapore-editor/core/shiki` | Owner caches theme-request promises by sorted theme key. Worker caches one tokenizer per open document and highlighters by sorted language/theme key. These caches are lifecycle-scoped, not size-bounded. | A crash terminates the worker, rejects pending requests, clears owner theme cache, and leaves lifecycle `crashed`. The next request on the same owner creates a fresh worker generation; failed requests are not replayed automatically. |
| `TypeScriptLspWorkerOwner` | `@singapore-editor/typescript-lsp` | No owner-side document cache. The owner tracks posted-message count, listener counts, and last error. The worker owns LSP document/project state for the lifetime of the worker. | A crash posts `$/serverExited` to the client, terminates the worker, clears listeners, and leaves lifecycle `crashed`. There is no automatic restart on the same owner; recreate the LSP transport/session/connection. |

There is not yet a separate document worker owner. The main-thread document engine remains the
document truth until that Phase 11 item is implemented.

## Removed Compatibility Singleton Paths

These package-level helpers were removed from the first-party route so callers must own worker
lifetimes explicitly.

| Runtime | Removed path | Required owner path | Current status |
|---|---|---|---|
| Tree-sitter | `registerTreeSitterLanguagesWithWorker`, `parseWithTreeSitter`, `editWithTreeSitter`, `queryRangeWithTreeSitter`, `selectWithTreeSitter`, `disposeTreeSitterDocument`, `disposeTreeSitterWorker`, `inspectTreeSitterWorker` | `TreeSitterWorkerClient` or `createTreeSitterWorkerBackend()` owned by the editor runtime or syntax provider | Removed from the worker client and package index. First-party tests, benchmarks, and structural selection create or receive an owner explicitly. |
| Shiki tokenizer | `createShikiHighlighterSession`, `loadShikiTheme`, `disposeShikiWorker` | `createShikiWorkerOwner()` owned by the editor runtime, highlighter provider, or diff syntax service | Removed from the worker client and Shiki package index. The Shiki plugin and diff syntax service create owners explicitly. |
| Minimap | None | `MinimapWorkerOwner` owned by the minimap client | No singleton compatibility path exists. |
| TypeScript LSP | None | `TypeScriptLspWorkerOwner` owned by the plugin transport or server session | No singleton compatibility path exists. |

Do not reintroduce package-level worker singletons. New integration code must accept an explicit
owner, backend, or session factory and must dispose that owner during editor/runtime teardown.

## Tree-sitter Syntax Worker

Owner: `TreeSitterWorkerClient`.

Inspection:

- `lifecycle`
- `pendingRequests`
- `workerGeneration`
- `cache.registeredLanguages`
- `cache.sourceChunks.documents`
- `cache.sourceChunks.sentChunks`
- `cache.sourceChunks.sourceEpochs`
- `lastError`

Caches:

- Owner language registration signatures prevent reposting unchanged language descriptors.
- Owner source chunk retention tracks which piece-table source chunks have already been sent for
  each document. It stores chunk ids and epochs, not source text.
- Worker document caches store parsed snapshots and Tree-sitter trees per document.
- Worker language runtimes keep parser/query state per registered language.
- Worker source caches store chunk payloads needed to resolve piece-table backed input.

Limits:

- Parsed snapshot retention is capped by `MAX_RETAINED_SNAPSHOTS = 6` per document.
- Retained parsed source is capped by `MAX_RETAINED_SOURCE_UNITS = 8_000_000` per document.
- The two newest parsed snapshots are preserved even when the source-unit cap is exceeded.
- Older snapshots are evicted by least-recent use among snapshots older than the newest two.
- Owner-side source chunk accounting has no numeric cap; it is bounded by live document count and is
  cleared by document disposal, source-cache invalidation, crash, or owner disposal.

Disposal and restart:

- `disposeDocument(documentId)` invalidates owner source chunk accounting and posts
  `disposeDocument` to the worker.
- `dispose()` posts `dispose`, terminates the worker, clears language/source accounting, rejects
  pending requests, and leaves lifecycle `disposed`.
- On native worker error, the owner terminates the worker, rejects pending requests, clears
  language/source accounting, stores `lastError`, and leaves lifecycle `crashed`.
- The next request on the same owner creates a new worker generation and runs `init` again.
- Callers must reissue failed parse/query work. The owner does not replay failed requests.

## Minimap Worker

Owner: `MinimapWorkerOwner`, with `MinimapWorkerClient` owning the editor-facing projection state.

Inspection:

- `lifecycle`
- `postedRequests`
- `disposalAcknowledged`
- `lastError`

Caches:

- The worker renderer holds one current minimap document summary, token list, selections,
  decorations, layout, and frame state.
- The client keeps the latest full-document snapshot reference, latest token source, one pending
  coalesced update, current render token, style signatures, and slider feedback state.
- The client `ColorResolver` caches resolved CSS colors by input string. It is cleared on base
  style/theme invalidation and disposal.

Limits:

- There is no cross-document minimap cache.
- There is one queued pending update per client; rapid content/token/viewport updates are merged.
- The color cache has no numeric cap because it is scoped to one minimap client and cleared on
  style invalidation/disposal.

Disposal and restart:

- `dispose()` moves the owner to `disposing`, posts `dispose`, and resolves only after the worker
  responds with `disposed`.
- After acknowledgement, the owner terminates the worker and marks lifecycle `disposed`.
- Late non-disposal worker messages are ignored by the disposed client.
- On native worker error, the owner terminates the worker, rejects any pending disposal promise,
  records `lastError`, and leaves lifecycle `crashed`.
- There is no automatic restart on the same owner. Recreate the minimap contribution/client to get a
  new worker.

## Shiki Tokenizer Worker

Owner: `ShikiWorkerOwner`.

Inspection:

- `lifecycle`
- `pendingRequests`
- `cache.themeRequests`
- `workerGeneration`
- `lastError`

Caches:

- Owner theme request cache stores in-flight and resolved theme loads by sorted theme key.
- Worker `documents` stores one incremental tokenizer per open document.
- Worker `documentTasks` serializes operations per document.
- Worker `highlighterPromises` stores Shiki highlighters by sorted language/theme key.

Transport:

- Token results use the same `PackedEditorTokens` structure-of-arrays transport as Tree-sitter:
  three transferable `Uint32Array` buffers plus a value-interned style palette. The owner unpacks
  the buffers immediately into the editor-facing indexed token array.

Limits:

- Owner theme-request cache has no numeric cap. Failed theme requests delete their key; owner
  disposal or crash clears the cache.
- Worker document tokenizer cache is bounded by open Shiki highlighter sessions. Session disposal
  posts `disposeDocument`, which deletes that document state.
- Worker highlighter cache has no numeric cap while the worker is alive. It is lifecycle-scoped and
  cleared on full worker disposal/crash.

Disposal and restart:

- `disposeDocument(documentId)` posts a document disposal request without creating a worker if none
  exists.
- `dispose()` posts `dispose`, terminates the worker, clears owner theme cache, rejects pending
  requests, and leaves lifecycle `disposed`.
- Session-level late tokenizer results are ignored after the highlighter session is disposed.
- On native worker error, the owner terminates the worker, rejects pending requests, clears owner
  theme cache, stores `lastError`, and leaves lifecycle `crashed`.
- The next request on the same owner creates a new worker generation. Failed requests are not
  replayed automatically.

## TypeScript LSP Worker

Owner: `TypeScriptLspWorkerOwner`.

Inspection:

- `lifecycle`
- `postedMessages`
- `messageListeners`
- `errorListeners`
- `lastError`

Caches:

- The owner has no document cache and no language-service cache.
- The worker owns the LSP server state for its lifetime: open documents, workspace files, the
  standard-library files the program's `lib` closure named, diagnostic timers, and the project host
  (`src/worker/projectHost.ts`) that holds every file at a version. Workspace files change one at a
  time through `editor/typescript/upsertFiles` and `deleteFiles`; only a tsconfig or package.json
  change rebuilds the program.
- LSP document/project state is cleared by LSP shutdown/exit handling or worker termination.

Limits:

- Owner-side memory is bounded to counters/listener sets and last error.
- Worker-side TypeScript service memory is lifecycle-scoped and not size-bounded by the owner. It
  is the program's: 1.1 GB for Platform's `apps/web` (9,341 files), measured by
  `bench/fileProvider.ts` in E054.

Disposal and restart:

- `terminate()`/`dispose()` detaches listeners, terminates the worker, clears owner listener sets, and
  leaves lifecycle `disposed`.
- Native worker errors mark lifecycle `crashed`, record `lastError`, detach listeners, terminate the
  worker, post `$/serverExited` (`LSP_SERVER_EXITED` in `@singapore-editor/lsp`) with the error to
  the message listeners, and then notify owner error listeners. `LspConnection` reports the close
  that follows as `LspServerExitedError`, once, and sets status `error`.
- The owner does not recreate the worker after `crashed` or `disposed`; `postMessage` fails once the
  lifecycle is not `ready`.
- Restart requires a new LSP transport/session/connection, which creates a new owner.

## Required Policy For New Worker Owners

Every new worker owner must document:

- lifecycle states and inspection shape
- request accounting and cancellation behavior
- cache ownership and numeric limits, or an explicit statement that the cache is lifecycle-scoped
- document disposal behavior
- worker disposal acknowledgement semantics
- native worker error behavior
- whether restart is automatic, lazy on next request, or requires owner recreation
