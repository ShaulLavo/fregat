# paged document contract

what `PagedDocument` expects from its source and what a host has to handle. back to the [readme](../README.md)

## the source

`source` owns file identity, authorization, range I/O and its own lifetime. it supplies `id`, `revision`, `byteLength`, and `readBytes(start, end, signal)` returning `{ revision, bytes }`.

ranges are half-open byte ranges. every response must match the opening revision and the exact requested byte count. a changed revision invalidates every view and clears retained pages. after a change or a session expiry, create a new source and document. never splice revisions into a live one.

each view read or copy validates the opening revision once with `readBytes(0, 0, signal)` before consuming retained pages. empty ranges return zero bytes and the current revision; a live file source checks identity and availability for them too. validation shares the range concurrency limit. remote sources pay one round trip per operation while cached page payloads stay local.

if the source rejects a read because its revision or session is gone, throw `new PagedSourceInvalidatedError(cause)`. the document becomes stale, aborts pending work and clears cached pages and checkpoints. other source failures propagate to the caller. a late failure from an aborted request leaves the document intact.

## positions

positions are global UTF-16 offsets into the raw decoded text. a UTF-8 BOM stays in, CRLF counts as two characters, and LF ends a row. row text includes a trailing CR when the file has one; the host may skip that CR when painting.

malformed UTF-8 decodes the way a streaming `TextDecoder` does, with replacement characters. a UTF-16 BOM is rejected with a capability error. other encodings need decoding support first.

the resident editor stores text with LF line endings and the BOM split off, so offsets from one mode need converting before use in the other.

## reading and cancelling

first rows render while the index scans. a jump past the scanned region waits for the index and stays cancellable. copying waits for the full index.

`readLines(line, count, signal?)` and `copyRange(start, end, signal?)` take a request-owned `AbortSignal`. aborting it cancels only that request, even after a newer one started. pass a query's cancellation signal straight through. `view.cancel()` cancels the current request. each view's next read or copy aborts its previous one, and views of one document share its cache.

hosts show pending, error and stale states, keep global line labels, and honor `truncated`. an unavailable range always surfaces as an error or a pending state, never as an empty string.

## limits and memory

defaults are in `PAGED_PROOF_OPTIONS`:

- 64 KiB pages, 8 MiB of cached raw bytes
- two requests in flight, two views
- at most 4096 sparse checkpoints, starting 256 KiB apart
- at most 128 rows and 524,288 UTF-16 units per returned window or copy (1 MiB of text)

a long line returns a bounded prefix with `truncated: true`. a copy over the cap fails. checkpoints record the byte offset, UTF-16 offset and line after an LF. when compaction reaches the checkpoint cap, their spacing doubles. the document keeps no full line-start array and no full decoded string.

index discovery reads the whole file once, even though resident text stays bounded. long lines can make a distant jump scan a long byte span from the LF checkpoint before it. the index scanner, in-flight responses and decoding hold a few extra page-sized buffers.

returned windows and copies belong to the caller. a host that keeps every result defeats the memory bound. drop old windows when a view moves, and dispose views and documents when they close.

## the proof run

after building the workspace, run the browser proof and the resident, streamed and paged comparison from the editor root:

```sh
node examples/stress/paged.mjs --output /work/tmp/editor-paged/result.json
```

results and the capability decision are in [the paged proof report](../../../docs/performance/e015-paged-proof.md).
