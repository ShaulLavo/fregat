# Large-file secondary fold projection

Measured 2026-09-28 against Editor `ad59752ea540bd8d4490563fc1fa2a2d5c2fd78d`.
The candidate changes only `createEditorSecondaryViewProjection`: fold summaries now materialize
on the first request and reuse that array. Minimap text/selection payloads never request folds.
The unit regression failed on the control because constructing the projection called the fold
getter once, then passed with zero reads until a consumer explicitly requested summaries.

## Browser reproduction

Build packages with `bun run stress:build`, then run:

```sh
node examples/stress/boundary.ts --configs minimap,folds --sizes 10485760 \
  --operations 50 --warmups 10 --key-delay 80 --output /work/tmp/editor-112/run.json
```

The E033 workload opens two shared views over 10 MiB of repeating indented functions, with 32
fragmenting edits before opening. It waits five seconds, captures both views, performs ten warm-up
keys, then fifty measured native keys. Text export, undo and object release checks all pass.
This fixture stresses fold count. It does not represent every language or long-line document.
The unpaced burst hid this regression because it completed before the minimap's 300ms flush.

| Configuration             | Control input→applied p95 | Candidate input→applied p95 | Control input→frame p95 | Candidate input→frame p95 |
| ------------------------- | ------------------------: | --------------------------: | ----------------------: | ------------------------: |
| Minimap                   |                  158.6 ms |                      2.2 ms |                159.1 ms |                   15.9 ms |
| Same text without minimap |                    2.0 ms |                      1.4 ms |                 16.2 ms |                   15.6 ms |

An earlier control/candidate pair gave 153.6/2.4ms with minimap. The saved matched pair includes
worker GC sampling in both arms. The first pair's control lacked worker sampling, so the saved
matched pair above is the primary comparison. These are local exploratory measurements, not
calibrated CI thresholds. Next-frame timing is not physical display latency.

Main-renderer post-typing heap falls from 277.3 to 144.9 MiB. Each minimap worker retains about
49.3 MiB after typing in both versions. Worker memory is reported separately by attaching CDP
to each worker target, running GC and reading `Runtime.getHeapUsage`. Its backing-storage count
includes ArrayBuffers and external strings; it does not separate live parser trees from WASM
allocator capacity. The main renderer and workers are distinct isolates, not process RSS.

Raw matched results: [control](e112-results/fold-control-10.json),
[candidate](e112-results/fold-candidate-10.json). Full local captures and screenshots are in
`/work/tmp/editor-112-performance/`. The candidate screenshot was read and shows both text views
and minimap bitmaps. Both views and their buffer are collectible after disposal.

## Remaining costs

The minimap worker still rebuilds trailing line offsets and copies the line-summary array on an
edit, in `applyMinimapDocumentSummaryPatch`. This change removes the main-thread fold scan; it
makes no claim to remove those worker costs or bound minimap resident memory.

The stock Tree-sitter microbenchmark requests whole-document queries. At 1.8 MiB of TypeScript
it measured 279ms initial parsing, 811ms querying, 7ms incremental parsing and 903ms requerying.
That differs from the application's windowed queries and cannot establish its syntax ceiling.
The stock run later failed its Markdown fixture with an invalid fetch URL. Its combined Bun RSS
is not a per-worker memory attribution. Plan 112's application benchmark owns syntax/LSP tiers
and the 200 MiB end-to-end acceptance result.

## Larger standalone cases

With one view, 50 paced native keys and the same indented corpus, the candidate passed text/undo
and release checks at 50 and 200 MiB. Plain-text input-to-applied p95 was 1.0/0.9ms and next-frame
p95 was 15.4/16.1ms. See [plain results](e112-results/plain-large.json).

At 50 MiB with minimap, p95 was 2.0ms applied and 11.9ms next-frame. Its worker retained 244.8 MiB
JS heap after typing; see [minimap results](e112-results/minimap-50.json). At 200 MiB the minimap
case painted, then Chromium crashed during the first measured burst. The runner produced no
success JSON; the pre-input screenshot remains at
`/work/tmp/editor-112-performance/candidate-200-minimap.json.minimap.209715200.png`.
The main-thread fix therefore supports the plain-text frame target, while the host still needs a
minimap residency tier. These are standalone Editor cases, not filesystem save measurements.
