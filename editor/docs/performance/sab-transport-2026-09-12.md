# SAB transport measurements, 2026-09-12

The contribution refactor will use ordinary strings and retained chunks with incremental edits,
keep the existing separate workers, and remove Tree-sitter's SAB text transport. Shared document
storage and worker co-location are outside the refactor. The separate atomic cancellation flag stays.

The current Tree-sitter SAB transport has no demonstrated latency advantage in these workloads.
It reduces synchronous `postMessage` duration, but encoding and worker decoding cost more than that saving.
Four synthetic direct readers improved in both runs; one reader regressed. Those conditional savings
do not justify shared document storage's representation, synchronization, and lifetime complexity.

These are instrumented worker-request measurements, not input-to-paint measurements or a completed
E009 evaluation. Production code was not changed.

## Decision, 2026-09-25

Decided 2026-09-25: owner — delete the SAB text transport. After the transport fixes it runs at the
same speed as the string path and never got faster; the numbers below predate those fixes.

- E057 deleted it on 2026-09-26, ahead of Platform
  [Plan 099](../../../platform/plans/099-document-contributions.md): source chunks reach the
  worker as strings only, the `useSharedBuffers` option and the transport comparison benchmarks are
  gone, and the atomic cancellation flag stays. `bench:syntax` (Bun, string path both times) was
  unchanged: 100,000-line initial total 1,233 / 1,187 ms before and 1,188 / 1,181 ms after, the
  200-fence edit 7.8 / 7.2 ms before and 9.3 / 6.8 ms after.
- E010 (shared allocator and hash map), E012 (epoch reclamation) and E013 (shared document
  snapshots) are closed as no-go for this reason. Their plans are in git history before this
  commit.
- E009 (worker transport costs) is folded into Plan 099 unit 6 and closed in the Editor backlog.
- E011 (packed piece tree) is parked under Platform
  [Plan 112](../../../platform/plans/112-large-file-ceiling.md), revived only if 112 shows piece
  memory dominates.

## Current Tree-sitter path

Each cell is the median in milliseconds from run 1 / run 2. Each run has 12 repetitions per arm.
The edit rows contain 20 acknowledged tail edits per repetition. The second string arm executes
the same implementation in another worker to expose variation unrelated to SAB.

| Workload                                        | Strings           | Current SAB       | Second string control |
| ----------------------------------------------- | ----------------- | ----------------- | --------------------- |
| 10k lines, fresh document, full parse and query | 117.138 / 118.110 | 118.135 / 118.972 | 116.870 / 118.002     |
| 50k lines, fresh document, full parse and query | 614.190 / 612.102 | 616.877 / 619.137 | 608.945 / 611.862     |
| 10k lines, acknowledged edit                    | 0.465 / 0.475     | 0.470 / 0.485     | 0.470 / 0.475         |
| 50k lines, acknowledged edit                    | 2.460 / 2.362     | 2.395 / 2.400     | 2.435 / 2.370         |
| 50k lines, 2k-line paste, parse only            | 9.005 / 8.985     | 9.205 / 9.085     | 9.082 / 8.990         |

Pairing repetitions matters. For the 50k full request, the median SAB-minus-string paired difference
was **−2.147ms in run 1 and +2.155ms in run 2**. The identical string control also changed direction:
−3.897ms and +2.368ms. These observations do not establish a total-request SAB improvement.
For edit comparisons, the summary first reduces the 20 edits to one median per repetition; it does
not treat 240 correlated edits as 240 independent trials.

The directly measured source costs are much clearer. The 50k source contains 901,667 UTF-16 code
units in 56 chunks. Run 2 medians:

| Work                         | Strings  | Current SAB |
| ---------------------------- | -------- | ----------- |
| Main descriptor construction | 0.0125ms | 1.4550ms    |
| Synchronous `postMessage`    | 0.4750ms | 0.0300ms    |
| Worker source resolution     | 0.0150ms | 1.5075ms    |

The SAB arm adds about **1ms of measured main-thread work** and **1.49ms of worker source work**.
Run 1 shows the same costs. Smaller `postMessage` time alone would have hidden that result.
The full parse/query request is much larger, so these costs do not explain every total-time difference.

[Source construction](../../packages/tree-sitter/src/treeSitter/source.ts) starts from JavaScript
strings, allocates a SAB per new or changed chunk, and fills it with `charCodeAt`. The worker copies
the shared view into an ordinary typed array and decodes it into a cached string. The parser then
reads strings. This is shared transport between two string representations.

Chunk retention already works with both transports. These trials transmitted only 11–30 code units
for each tail edit, three chunks for the paste, and no source for queries. SAB cannot claim those
incremental-update savings. When an append chunk grows, the implementation still republishes its
whole current contents; these small-tail trials do not measure the worst case near 16Ki units.

## What the direct-reader prototype measured

The prototype sends one immutable publication to 1, 2, or 4 real workers. Each worker scans all code
units to count line breaks and ASCII words and compute a checksum. The string arm retains its source
too. The SAB arm encodes once and reads the shared `Uint16Array` directly, without decoding to a string.
These are synthetic readers, not integrated Shiki, minimap, search, or LSP consumers.

The table includes SAB allocation and encoding, all messages, scanning, and receipt of all replies.
Each cell is the median in milliseconds from run 1 / run 2, with 12 publications per arm per run.

| Source size     | Readers | Strings         | Shared direct readers |
| --------------- | ------- | --------------- | --------------------- |
| 1M UTF-16 units | 1       | 3.907 / 3.757   | 4.160 / 4.155         |
| 1M UTF-16 units | 2       | 4.335 / 4.240   | 4.110 / 4.085         |
| 1M UTF-16 units | 4       | 5.345 / 5.320   | 4.105 / 4.147         |
| 8M UTF-16 units | 1       | 26.900 / 25.785 | 30.628 / 28.318       |
| 8M UTF-16 units | 2       | 28.900 / 29.123 | 29.500 / 31.418       |
| 8M UTF-16 units | 4       | 34.468 / 34.317 | 30.972 / 30.823       |

Four readers completed about **22–23% sooner at 1M units** and **10% sooner at 8M units**.
Shared storage won 21/24 paired publications at 1M and 23/24 at 8M across both runs.
These synthetic gains do not establish an integrated editor benefit or a universal break-even reader count.
Two readers were insufficient for the larger source, and one reader was slower at both sizes.

At four readers, main-thread preparation plus posting also improved: roughly 1.9ms to 1.3ms at 1M
units, and 9.9ms to 9.0ms at 8M in run 2. Encoding remains meaningful main-thread work.
Two additional retained scans send no source in either arm. Those results are preserved in the raw
data and summaries; retaining ordinary strings already removes repeat publication costs.

## Decision for the contribution refactor

The document runtime owns revisions and the committed change stream. Every consumer registers through
the contribution API, which owns delivery, acknowledgement, scheduling, cancellation, and lifetime.
Adapters send incremental data to the existing separate workers and the remote LSP connection.
Workers retain ordinary strings, chunks, or derived summaries as their consumer requires.

Remove the existing `shared-utf16` text transport and its obsolete callers and tests during the
refactor. Preserve chunk retention and small incremental updates. The four-byte atomic cancellation
flag remains a separate mechanism and does not require encoding document text.

The common API does not require identical payloads or another worker. Keep bounded string reads,
clipped line summaries, and LSP serialization behind consumer-specific adapters. Shared document
storage, immutable shared pages, and worker co-location are excluded from this work.

The text-transport decision is settled. Broader latency, memory, and result-representation research
remains incomplete under E009. E010 through E013 are deferred independent research and require an
explicit decision to revisit shared document storage. These measurements and the prototype remain
available as evidence, without making shared storage a prerequisite for the contribution refactor.

## Method and reproducibility

- Editor baseline: `64926519bfdd39f4afcfae225019a932d3e27785`, no dirty tracked source.
- Machine: Intel Core i7-14700K, 28 logical CPUs, Linux x64. Chromium 148.0.7778.96, Bun 1.4.0.
- Both runs use fresh Chromium processes. Five actual parse/edit/query warmups per worker precede
  measurement. Grammar setup is outside measurement; documents use unique runtime IDs.
- The production TypeScript contribution resolves its TSX grammar. The benchmark uses the real
  worker, piece table, source descriptor, chunk retention, and disposal barrier. Build-time wrappers
  force the source arm and record scalar timings; production files are unchanged.
- Both arms run in the same isolated page with identical worker isolation and atomic cancellation
  capability. Balanced six-order permutations cover SAB and two string arms. No other benchmark or
  build ran during either published measurement.
- Request timing starts before descriptor construction and ends when the client resolves. It includes
  instrumentation overhead, worker work, result construction and delivery. Snapshot edits and edit
  payload construction are outside this timer. Full-open samples request full-file results; these
  are not the app's viewport-only open time. Parse-only edits are followed by separate range queries.
- Result versions, captures, packed tokens and style palette, folds, brackets, errors, and injections
  have matching digests across arms. Traffic counts match too. Six source round-trip cases cover lone
  surrogates, pairs split at 4096/16384 units, BOM, replacement characters, and NUL. Direct-reader
  workers also validate a Unicode corpus. This does not exhaust parser behavior on Unicode inputs.
- There are 1,800 syntax samples and 432 direct-reader samples in each published run. No cancelled
  sequential requests, degraded parses, digest mismatches, or browser errors occurred.
- Allocation counters are logical payload accounting. UTF-16 units × 2 is not a measurement of V8
  string storage, cloned bytes, total heap, or WASM memory. Memory, burst cancellation, heavily
  fragmented documents, undo/replacement, retained-document pressure, other engines, and paint
  remain outside this experiment.

The actual [Platform development page capability capture](sab-transport-2026-09-12-platform.json)
reports `crossOriginIsolated: false` and no `SharedArrayBuffer` at `http://127.0.0.1:3300/`.
The benchmark supplies isolation through Playwright interception at that origin; it does not start
a server or change Platform headers. Its SAB results therefore describe an isolated host configuration,
not the currently running development page.

From the Editor repository, reproduce one run and its summary:

```sh
bun packages/tree-sitter/bench/transport-run.mjs --repetitions 12 --lines 10000,50000 --edits 20 --warmups 5 --fanout --output /work/tmp/sab-bench/reproduced.json
bun packages/tree-sitter/bench/transport-summary.mjs /work/tmp/sab-bench/reproduced.json --json-output=/work/tmp/sab-bench/reproduced-summary.json
```

Raw results include machine metadata and SHA-256 hashes of benchmark sources, compiled bundles, and
assets: [run 1](sab-transport-2026-09-12-run-1.json.gz), [run 2](sab-transport-2026-09-12-run-2.json.gz).
The summary command also accepts `--markdown-output=PATH`; decompress saved raw files before using it.

All five benchmark files pass focused lint and formatting checks. Browser execution supplies the
behavioral check. Package typecheck reports only the existing possibly-undefined access at
`packages/editor/src/editor/indentationGuess.ts:83`; no benchmark type errors remain.
