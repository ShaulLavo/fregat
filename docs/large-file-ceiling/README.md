# Large-file ceiling: measurements (Plan 112)

Measured 2026-09-25 for [Plan 112](../../plans/112-large-file-ceiling.md). Raw rows are in
[`results/`](results/); every table below is read from those files.

## Setup

- Platform `origin/main` 9f3438258, whose `apps/server`, `apps/web` and `packages` match the
  deployed release ed96e9f1. Editor `origin/main` e2fd299, the same code as c23cd30.
- Web: a production build of that tree (`vite build --base /`), served with its API by a
  throwaway server (`scripts/agent/isolated-server.ts`, `WEB_ROOT` set, `MAX_TEXT_FILE_BYTES`
  raised to 2 GiB so the run finds the real failure). Chromium 153 headless shell, 1440x900.
- Fixtures: the Editor's own `.ts` sources concatenated to the target size, ASCII only (so V8
  holds them one byte per unit), first line a unique marker. One file per workspace, no Git repo.
- Each size gets a fresh server and browser. RSS per process kind is sampled every 50 ms from
  `/proc`; "heap" is the main renderer isolate after a forced GC (CDP `Runtime.getHeapUsage`),
  which excludes workers.
- Keystroke latency: `keydown.timeStamp` to the next `requestAnimationFrame`, 30 keys 80 ms apart,
  3 s after the first text paint. Save: Ctrl+S to the `/fs/write` response.
- Everything ran inside the machine's heavy-slot wrapper, a 7 GB memory scope for browser, server
  and language servers together. A run that crosses it is killed; that is recorded as a result.

The harness is `app-bench.ts`, `piece-memory.mjs`, `string-probe*.{js,mjs}` and
`webkitgtk-probe.py` under `/work/tmp/research/112/`. Research rules keep it out of the repo;
Plan 112's Phase 1 lands it as `bench:large-file`.

## Engine string ceilings

`'a'.repeat(n)` and `'一'.repeat(n)` binary-searched, then the three ways a body becomes text
(`TextDecoder.decode`, `Response.text()`, `Response.json()`) tried past the ceiling.

| Engine                    | Runtime                 | Max length (UTF-16 units)                                 | Past the ceiling                                                                                                                                  |
| ------------------------- | ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| V8                        | Node 26.7               | 536,870,888 (2^29−24), both widths                        | Throws `Cannot create a string longer than 0x1fffffe8 characters`                                                                                 |
| V8                        | Chromium 153            | 536,870,888, both widths                                  | `TextDecoder.decode` and `Response.text()` **return `""`** at 512.1, 768 and 1023.9 MiB. `Response.json()` throws "Unexpected end of JSON input". |
| SpiderMonkey              | Firefox 155             | 1,073,741,822 (2^30−2)                                    | `TextDecoder.decode` at the ceiling failed; wider probe exceeded the 7 GB scope                                                                   |
| JSC                       | Bun 1.4.0               | ≥ 2,147,483,647 one-byte, ≥ 2^30 two-byte (bound reached) | All three paths succeed to 1 GiB                                                                                                                  |
| JSC (Electrobun on Linux) | system WebKitGTK 2.52.6 | same as Bun (bound reached)                               | Not probed                                                                                                                                        |

Playwright's WebKit build did not launch here (`libicudata.so.74` missing), so macOS/Safari JSC
is represented by Bun and WebKitGTK. Chromium also held 6 GiB of decoded strings in one tab
without an allocation failure, so the V8 heap cage is not the limit for decoded text.

The Chromium row is the dangerous one: past 512 MiB a raw-bytes read yields an empty document
with no error. Any transport that decodes on the client has to compare the decoded length with
the size it was sent.

## Plain text (`.txt`, no syntax, no language server)

| Size    | Open → text | Renderer RSS settled | Server RSS at open | Heap: open / typed / saved | Key p50 / p95 / max | Save             | Browser RSS during save |
| ------- | ----------: | -------------------: | -----------------: | -------------------------: | ------------------: | ---------------- | ----------------------: |
| 1 MiB   |      296 ms |              292 MiB |            191 MiB |               24 / 25 / 26 |      9 / 17 / 19 ms | 200, 96 ms       |                 740 MiB |
| 10 MiB  |      438 ms |              402 MiB |            233 MiB |               46 / 57 / 67 |     12 / 25 / 27 ms | 200, 254 ms      |                 974 MiB |
| 50 MiB  |    1,146 ms |              894 MiB |            390 MiB |            150 / 197 / 247 |   15 / 133 / 142 ms | 200, 1.4 s       |               1,796 MiB |
| 100 MiB |    1,917 ms |            1,400 MiB |            700 MiB |            281 / 372 / 473 |   14 / 261 / 291 ms | 200, 3.1 s       |               3,033 MiB |
| 150 MiB |    2,627 ms |            1,693 MiB |            953 MiB |            412 / 550 / 550 |   15 / 332 / 359 ms | **413**, 6 s     |               4,605 MiB |
| 200 MiB |    1,614 ms |            2,082 MiB |          1,193 MiB |            482 / 323 / 511 |    10 / 17 / 111 ms | **413**, 7 s     |               5,786 MiB |
| 300 MiB |    2,202 ms |            2,083 MiB |          1,413 MiB |                  358 / 417 |    11 / 31 / 184 ms | renderer crashed |                       — |
| 400 MiB |       never |                    — |          1,395 MiB |                          — |                   — | —                |                       — |

- At 200 and 300 MiB typing started before background indexing finished (heap after open is
  lower than at 150 MiB), so their key latencies are not steady state.
- 100 MiB with one non-Latin-1 character (`results/app-twobyte.jsonl`): heap 381 / 472 / 672 MiB,
  key p95 253 ms, save 5.6 s. V8 stores the whole document two bytes per unit.
- 250 MiB with the default 200 MiB limit (`results/app-refusal.jsonl`): the tab opens on an
  empty-looking line 1 with "The file is larger than the workspace size limit." and Retry.
- 400 MiB: the server's JSON serialization throws `RangeError: Out of memory` in Elysia's
  `json` handler; the tab shows an empty line 1 and "The file server could not complete the
  filesystem operation."

## TypeScript (`.ts`: Tree-sitter, Shiki, TypeScript language server)

| Size    | Open → text | Renderer RSS settled | Server tree RSS | Heap: open / typed / saved | Key p50 / p95 / max | Save        | Peak during save (browser / server) |
| ------- | ----------: | -------------------: | --------------: | -------------------------: | ------------------: | ----------- | ----------------------------------: |
| 1 MiB   |      397 ms |              667 MiB |         488 MiB |               39 / 42 / 46 |     12 / 30 / 32 ms | 200, 86 ms  |                     1,215 / 610 MiB |
| 10 MiB  |      368 ms |            1,134 MiB |       1,290 MiB |               68 / 81 / 82 |  118 / 165 / 172 ms | 200, 433 ms |                   2,318 / 3,698 MiB |
| 50 MiB  |    1,454 ms |            2,073 MiB |       1,449 MiB |             82 / 225 / 224 |  8 / 360 / 2,608 ms | 200, 65 s   |                   4,856 / 2,707 MiB |
| 100 MiB |      ~1.5 s |     5,295 MiB (peak) | up to 1,790 MiB |                          — |                   — | —           |          whole scope killed at 7 GB |

`results/rss-ts-100.jsonl` has the 100 MiB timeline: text painted, then the renderer (main thread
plus its workers) climbed to 2.3 GB in 5 s and 5.3 GB in 20 s while the server tree held
0.6–1.8 GB, and the scope was killed.

The 50 MiB save's 65 s is server-side: `fs.write` logged `durationMs: 54814` and completed 2 ms
after an `lsp.document_symbols` event, so the Bun event loop was busy relaying the language
server's document-symbol traffic while the write waited (inferred from the timestamps in the
server log, not profiled).

## Transport: JSON versus raw bytes, in the browser

Same fixture, a blank page on the app's origin, `fetch` then `res.json()` (today's `/fs/read`)
or `res.text()` (the `/fs/blob` shape), timed in the page, peaks sampled across processes.

| Size    | JSON total | Raw total | Server RSS peak, JSON | Server RSS peak, raw |
| ------- | ---------: | --------: | --------------------: | -------------------: |
| 1 MiB   |      11 ms |    5.5 ms |               184 MiB |              184 MiB |
| 10 MiB  |     110 ms |     30 ms |               237 MiB |              212 MiB |
| 50 MiB  |     279 ms |     62 ms |               358 MiB |              278 MiB |
| 100 MiB |     479 ms |    134 ms |               583 MiB |              168 MiB |
| 150 MiB |     743 ms |    169 ms |               766 MiB |              178 MiB |
| 200 MiB |     976 ms |    292 ms |               884 MiB |              569 MiB |
| 300 MiB |   1,590 ms |    431 ms |             1,399 MiB |              167 MiB |
| 400 MiB |  500 error |    525 ms |             1,379 MiB |              979 MiB |

Half of the JSON time is before the first byte: the server reads, decodes, hashes and
stringifies before responding, while `/fs/blob` streams `Bun.file` and answers headers in 2–7 ms.
The raw server peak is noisy because it samples a streaming body; the JSON peak grows with size.

## Piece memory (E011's question)

Node 26.7, the textbuffer package from Editor e2fd299, `--expose-gc`, heap deltas after two GCs.
Rows are 200 MiB unless stated; the other sizes scale linearly (`results/piece-*.jsonl`).

| State                                      |  Pieces | Memory beyond the text     |
| ------------------------------------------ | ------: | -------------------------- |
| Opened, line index built (6.0 M lines)     |       1 | 32 MiB (5.6 B per line)    |
| + 10,000 typed keys at one caret           |       3 | +0.35 MiB                  |
| + 10,000 scattered 3-unit inserts/deletes  |  20,003 | +5.0 MiB (≈265 B per edit) |
| Same 20,000 edits, every snapshot retained |  20,003 | +34 MiB (≈1.8 KB per edit) |
| 50 MiB, 200,000 scattered edits            | 399,181 | +95 MiB                    |

Text is 200 MiB one-byte or 400 MiB two-byte. The textbuffer's own structures are 8–16 % of the
text at open and stay in single-digit percent through ordinary editing. In the app the main heap
is 2.8x the document at open, so most non-text memory is view and plugin state, not pieces.
Piece memory only rivals the text after hundreds of thousands of scattered edits.

## Keystroke profile at 100 MiB plain text

CPU profile of the 30 keys on an unminified build (`results/app-profile.jsonl`): 1,677 ms of the
typing window is one path, the minimap's edit update:

`postEditUpdate → documentEditPayload → createEditorSecondaryViewProjection → get foldMarkers →
markerSource().all()` materializes and sorts every fold marker in the document.

`createEditorSecondaryViewProjection` builds `foldSummaries` eagerly
([Editor `packages/editor/src/public/secondaryViews.ts:147`](../../../Editor/packages/editor/src/public/secondaryViews.ts)),
and `documentEditPayload` ([`packages/minimap/src/workerClient.ts:674`](../../../Editor/packages/minimap/src/workerClient.ts))
needs only selections and a summary patch. Every flushed minimap update pays O(folds in the
document).

## Copies on the save path

`FileSyncService.save` materializes the document
([`file-sync-service.ts:217`](../../apps/web/src/features/editor/state/file-sync-service.ts)), then
`writeFileContent` UTF-8-encodes it into a `Blob` only to log `contentBytes`
([`file-server.ts:323`](../../apps/web/src/lib/file-server.ts)), Eden serializes the JSON body and
`fetch` encodes it again. After the write, `setFileSnapshotQueryData`
([`file-sync-service.ts:238`](../../apps/web/src/features/editor/state/file-sync-service.ts)) keeps
the materialized text in the query cache while the buffer still holds the original, so the heap
rises by one document per first save (100 MiB: 372 → 473 MiB; two-byte: 472 → 672 MiB). Bun's
default `maxRequestBodySize` is 128 MiB (bun-types `serve.d.ts:676`; a 129 MiB POST returns 413
on Bun 1.4.0) and `apps/server/src/index.ts:63` does not raise it, so a 128–200 MiB file opens
under the default limit and cannot be saved.
