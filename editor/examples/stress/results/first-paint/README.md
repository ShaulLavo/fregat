# E003 first paint measurements

The 500,000-line plain-text cold open reached captured text in 188.2 ms, compared with 230.2 ms
before and 219.1 ms in the unchanged control. Attachment fell from 120.5/117.2 ms to 84.3 ms.
These are medians from three repetitions. The captured-text improvement is 42.0 ms against the
first baseline and 30.9 ms against its control. Warm captured text improved from 219.1/212.4 ms
to 197.6 ms. Prepared opens retain their existing path.

The diagnosis was a whole-document fallback-fold scan during attachment. In the separate cold
diagnostic, the baseline spent 34.8 ms scanning during open, from 120.4 to 155.2 ms. The candidate
still performed the scan, taking 30.5 ms from 262.0 to 292.5 ms, after captured text at 186.0 ms.
The warm diagnostic similarly moved a 37.0 ms scan out of attachment; the later scan took 36.4 ms.
Deferral removes this work from first text paint, not from the document's total work.

## Reproduce and verify

The runs use Chromium 148.0.7778.96, Node 26.7.0, Linux, and an Intel Core i7-14700K with 28 logical
CPUs and 33,370,660,864 bytes of RAM. E001's seed 60061 and fixture hashes are retained. Every run
used built public package exports through Vite production output served by Playwright routing.
No dev server, filesystem read, application startup, or fixture generation enters open timing.

Preserve matching core `src`, `dist`, and `package.json` before changing the implementation.
Dependencies must remain resolvable from the preserved directory. From the repository root:

```sh
bun run stress:build
node examples/stress/first-paint.mjs --core-directory /work/tmp/editor-e003-baseline --output /work/tmp/editor-e003/before.json
node examples/stress/first-paint.mjs --core-directory /work/tmp/editor-e003-baseline --output /work/tmp/editor-e003/control.json
node examples/stress/first-paint.mjs --output /work/tmp/editor-e003/after.json
node examples/stress/first-paint.mjs --core-directory /work/tmp/editor-e003-baseline --repetitions 1 --diagnostics --output /work/tmp/editor-e003/diagnostic-before.json
node examples/stress/first-paint.mjs --repetitions 1 --diagnostics --output /work/tmp/editor-e003/diagnostic-after.json
bun run --cwd examples/stress first-paint:proof
```

The last command replays the checked evidence and rewrites [comparison.json](comparison.json).
It validates 202 samples across the production matrix, diagnostics, ordinary holdout, and cleanup
probe. It requires matching configuration, fixture hashes, browser and hardware, complete groups,
finite timings, current text and revision, captured ink, and collection after acknowledged worker
disposal. Every prepared TypeScript sample already has colored pixels in its first text capture.
Missing samples, duplicate samples, unknown groups, and mismatched fixture hashes are rejected.
The proof is under `test/`, which the measurement source hash excludes.

## Production results

Each cell lists **before / unchanged control / after** medians in milliseconds. Text values end at
screenshot completion and include capture/transport costs. They are upper bounds, not exact first
paint timestamps. The report includes raw minimum, median, p95 and maximum for all metrics,
including construction, buffer creation, preparation, text callbacks, and highlighted captures.

| Fixture       | Mode     | Plugin      | State | Attachment            | Captured text         |
| ------------- | -------- | ----------- | ----- | --------------------- | --------------------- |
| Ordinary      | Direct   | None        | Cold  | 3.8 / 3.9 / 3.7       | 96.3 / 96.4 / 112.5   |
| Ordinary      | Direct   | None        | Warm  | 0.8 / 0.8 / 0.7       | 89.9 / 90.4 / 88.8    |
| Ordinary      | Prepared | None        | Cold  | 6.6 / 3.7 / 3.7       | 106.3 / 80.1 / 87.6   |
| Ordinary      | Prepared | None        | Warm  | 0.7 / 0.7 / 0.8       | 89.5 / 88.3 / 88.9    |
| Ordinary      | Direct   | Tree-sitter | Cold  | 4.0 / 7.0 / 4.1       | 95.4 / 91.3 / 97.5    |
| Ordinary      | Direct   | Tree-sitter | Warm  | 0.8 / 0.7 / 0.7       | 86.9 / 86.6 / 88.5    |
| Ordinary      | Prepared | Tree-sitter | Cold  | 3.7 / 3.5 / 3.6       | 82.3 / 82.4 / 79.0    |
| Ordinary      | Prepared | Tree-sitter | Warm  | 0.9 / 0.9 / 1.0       | 133.3 / 132.4 / 133.2 |
| 500,000 lines | Direct   | None        | Cold  | 120.5 / 117.2 / 84.3  | 230.2 / 219.1 / 188.2 |
| 500,000 lines | Direct   | None        | Warm  | 121.2 / 110.4 / 89.3  | 219.1 / 212.4 / 197.6 |
| 500,000 lines | Prepared | None        | Cold  | 130.8 / 126.7 / 130.4 | 213.8 / 199.0 / 206.2 |
| 500,000 lines | Prepared | None        | Warm  | 130.4 / 117.5 / 126.0 | 198.6 / 182.4 / 198.9 |
| 500,000 lines | Direct   | Tree-sitter | Cold  | 84.4 / 87.6 / 86.6    | 205.4 / 199.4 / 209.9 |
| 500,000 lines | Direct   | Tree-sitter | Warm  | 90.9 / 87.5 / 82.2    | 202.5 / 186.8 / 186.7 |
| 500,000 lines | Prepared | Tree-sitter | Cold  | 127.1 / 125.0 / 129.2 | 206.2 / 207.9 / 211.2 |
| 500,000 lines | Prepared | Tree-sitter | Warm  | 127.6 / 127.8 / 127.9 | 195.4 / 195.0 / 189.4 |

Cold means a fresh browser context. Warm means a fresh document following one unrecorded open in
the same context, retaining language/worker caches. Prepared documents finish metadata and the
initial 4,096-character syntax query before open timing; preparation still includes a complete
worker parse. Its cost is recorded separately. All modes use a fixed four-space tab policy.

## Ordinary-file holdout

The first matrix showed a 16.2 ms rise in ordinary cold/plain captured text while synchronous
attachment stayed flat. A separate five-repetition baseline/candidate holdout did not reproduce
that median difference:

| State | Attachment before / after | Synchronous open before / after | Captured text before / after |
| ----- | ------------------------- | ------------------------------- | ---------------------------- |
| Cold  | 3.9 / 3.7                 | 13.0 / 12.0                     | 96.0 / 97.5                  |
| Warm  | 0.6 / 0.6                 | 1.5 / 1.5                       | 89.5 / 89.2                  |

Cold capture ranges overlap: 82.4–111.6 ms before and 84.6–112.6 ms after. The original rise remains
in the table and raw records. The holdout supports capture variability rather than a sustained
ordinary-file slowdown; it does not identify the exact browser scheduling cause. These local
runs establish no universal latency threshold or CI gate.

Reproduce that subset with `--repetitions 5 --fixtures ordinary --plugins none --modes direct`,
once with the frozen `--core-directory` and once with the active core.

## Language readiness and cleanup

Diagnostic events separate language asset resolution, worker initialization/registration, parse,
and viewport query. The candidate's huge cold TypeScript diagnostic spent 34.4 ms resolving
assets, 21.1 ms registering the language, 2,206.7 ms parsing, and 134.1 ms querying the first range.
Text was already captured at 207.9 ms. Asset request/response records identify the actual worker
and WASM boundaries. Their runner wall-clock timestamps are separate from browser performance
timestamps. Diagnostic timings are not mixed with production comparisons.

The report's `firstHighlightedCaptureUpperBound` uses the text screenshot when that screenshot
already contains colored pixels and the current document's highlight event precedes it. Otherwise
it uses the later highlighted capture. This preserves the case where prepared text and syntax
appear together. Original second-capture durations remain in every raw sample.

An early attempt checked collection before the asynchronous worker disposal had completed. The
[cleanup probe](cleanup-probe.json) reproduced live `editor`/`buffer` references while one disposal
request remained pending; they disappeared after `awaitIdleFence()` and a new GC. The unchanged
baseline reproduced the same transition. The final matrix records both observations and requires
zero retained objects and zero worker requests after the fence. The gate was strengthened to use
the real disposal acknowledgment. Warm worker language caches and small source-epoch tombstones
remain until their browser context closes; worker heap bytes are not measured here.

## Raw evidence

- Production: [before](before.json), [unchanged control](control.json), [after](after.json).
- Diagnostics: [before](diagnostic-before.json), [after](diagnostic-after.json).
- Ordinary holdout: [before](ordinary-before-holdout.json), [after](ordinary-after-holdout.json).
- Disposal: [cleanup probe](cleanup-probe.json).
- Replay and all groups: [comparison](comparison.json), [verification script](../../test/verify-first-paint.mjs).
