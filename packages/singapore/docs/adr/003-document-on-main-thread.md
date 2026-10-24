# 003. Keep the canonical document on the main thread

Status: accepted
Date: 2026-09-25

## Context

The first architecture draft made workers authoritative for the document model and transactions. Workers already parse, highlight, draw the minimap and run the TypeScript language service. The question was how text reaches them, and whether they should own it.

The editor measured the shared-memory option. Tree-sitter had a SharedArrayBuffer text transport, so workers could read the document without copying it.

## Decision

The document, selections and undo stay on the main thread. Workers get ordinary strings: retained source chunks and incremental edits, each tagged with the snapshot version. The SharedArrayBuffer text transport was deleted. A separate atomic flag stays for cancellation, and the editor uses it only when the page is cross-origin isolated.

## Alternatives considered

- **A worker that owns the document.** This was the original plan. It is not built, and [Architecture](../../ARCHITECTURE.md#open-design-questions) still lists it as open.
- **Shared document storage over SharedArrayBuffer.** [The measurements](../performance/sab-transport-2026-09-12.md) found no latency advantage. Sharing cut the synchronous `postMessage` time, but encoding the text and decoding it in the worker cost more than that saving. After the transport fixes it ran at the same speed as the string path. It also needs a shared representation, synchronization and lifetime rules, and it requires cross-origin isolation.

## Consequences

Typing never waits on a worker, and an edit needs no round trip. Workers can lag, so every result carries the version it describes, and the editor checks it before use.

The main thread pays to post chunks and edits, and workers keep their own copy of the source they use. A major garbage collection of a very large piece tree is a main-thread pause. See [heap cost per piece](../performance/piece-heap-cost.md).

[Worker topology](../architecture/worker-topology.md) records each owner's cache limits and what happens after a crash.
