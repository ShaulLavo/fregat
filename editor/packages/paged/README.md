# Read-only paged UTF-8 documents

Experimental range-backed viewing for files larger than the resident editor budget. This is a
separate document contract. It does not implement `TextSnapshot` or expose editing, history,
saving, language features or unbounded whole-document copy.

```ts
const document = new PagedDocument(source)
const view = document.createView()
const indexing = document.initialize()
const first = await view.readLines(0, 24)
await indexing
const distant = await view.readLines(1_000_000, 24)
const copied = await view.copyRange(distant.rows[0].offset, distant.rows[0].offset + 100)
view.dispose()
document.dispose()
await source.dispose?.()
```

`source` owns file identity, authorization, range I/O and its external lifetime. It supplies
`id`, `revision`, `byteLength`, and `readBytes(start, end, signal)` returning `{revision, bytes}`.
Ranges are half-open byte ranges. Every response must match the opening revision and exact
requested byte count. Changed revisions invalidate every view and clear retained pages. The host
should create a new source/document after a change or session expiry; it must not splice revisions.
If the source rejects a read because its revision or session is no longer available, throw
`new PagedSourceInvalidatedError(cause)`. The document becomes stale, aborts pending work and clears
cached pages and checkpoints. Other source failures propagate to the caller. An aborted request's
late failure cannot invalidate the document.

Positions are global raw-decoded UTF-16 offsets. UTF-8 BOMs are preserved, CRLF contributes both
characters, and LF defines rows. Row text includes a trailing CR when present; the host may omit
that CR when painting. Malformed UTF-8 follows streaming `TextDecoder` replacement semantics.
UTF-16 BOMs are rejected with a capability error. UTF-8 is the source contract; other encodings
require decoding support before use. This differs from the resident editor's normalized LF/BOM
representation, so offsets cannot be transferred between those modes without conversion.

First rows can render while the index scans. A jump beyond the discovered region waits for index
progress and remains cancellable. Every view's next read/copy aborts its previous request; two
views share the document cache. Hosts must show pending/error/stale states, keep global line labels,
and honor `truncated`. An unavailable range is never represented by an empty string.

`readLines(line, count, signal?)` and `copyRange(start, end, signal?)` accept a request-owned
`AbortSignal`. Aborting it cancels only that request, including after a newer request starts.
Pass query cancellation signals directly; `view.cancel()` explicitly cancels the current request.

Defaults are explicit in `PAGED_PROOF_OPTIONS`: 64 KiB pages, 8 MiB cached raw bytes, two requests
in flight, two views, at most 4096 sparse checkpoints, 128 rows and 524288 UTF-16 units per returned
window or copied range. The text cap is 1 MiB at two bytes per UTF-16 unit. A large line returns a
bounded prefix with `truncated: true`; a large copy request fails. Checkpoints record byte offset,
UTF-16 offset and global line after LF. Their initial 256 KiB spacing doubles when compaction
reaches the checkpoint cap. No full line-start array or full decoded string is retained.

Index discovery reads the whole file once, even though text residency stays bounded. Long lines
can make a distant jump scan a long byte span from its preceding LF checkpoint. An index scanner,
in-flight responses and decoding hold a few additional page-sized buffers. Returned windows/copies
are caller-owned: a host retaining every result defeats the bounded-memory contract. Release old
windows when a view changes, and dispose views/documents when closed.

The browser proof and resident/streamed/paged comparison run through
`node examples/stress/paged.ts --output /work/tmp/editor-paged/result.json` after building the
workspace. See `docs/performance/e015-paged-proof.md` for evidence and the capability decision.
