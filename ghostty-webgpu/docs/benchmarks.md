# Terminal comparison benchmarks

Generated from the checked-in JSON artifact. Lower is better except parse throughput.

## Run it

From `ghostty-webgpu`, run `bun run bench:compare -- --bundle /path/to/bundle` to build and measure.
Use `bun run bench:compare -- --smoke --bundle /path/to/bundle` for correctness only.
Use `bun run bench:compare -- --build-only --bundle /path/to/bundle` for a portable Node bundle.
On the target machine, enter that bundle and run `npm install --ignore-scripts`,
`npx playwright install chromium`, then `node comparison-runner.mjs --smoke`.
Run `node comparison-runner.mjs --output results` on AC power for measurements.
Headed Chromium windows open during the run. Set aside up to 30 minutes.
Regenerate the checked-in report with `node scripts/comparison-report.mjs docs/benchmarks/mac-m1/comparison.json docs/benchmarks.md docs/benchmarks/mac-m1/review.json`.

## Environment

- Commit measured: `7aaa1b78c9250572099127c14e4c82e9fe34aeba`. Source SHA-256: `41ca2ba16899e86ad8d558530af2c8eb0d6d6d98a6ddd5ae030eb770852e3d62`.
- Browser: 153.0.8010.12. OS: darwin 25.4.0 arm64.
- GPU: ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Version 26.4 (Build 25E246)). Headed hardware adapter: true.
- Font: JetBrains Mono 5.3.0, bundled regular/bold Latin faces. Emoji and CJK use the same OS fallback fonts.
- Font size: 12px. DPR: 2. Grid: 40 × 12.
- Libraries: ghostty-webgpu 0.2.0; xterm 6.0.0 with WebGL addon 0.19.0; ghostty-web 0.4.0.
- Repetitions: 3. Each table cell is the median of the per-run result, including per-run p50/p95.
- Artifact: [comparison.json](benchmarks/mac-m1/comparison.json).

## Method

Each case opens a fresh browser context. All 1, 8, or 17 terminals remain visible in a fixed grid.
Library order alternates forward/reverse between repetitions and rotates on the third repetition.
Byte/string paths alternate too. A warmup precedes each timed operation.
Chromium launches with a device scale of 2 so resize-observer backing pixels agree with DPR.
Its WebGL context limit is 32 for every case, allowing all 17 xterm WebGL terminals to remain live.
Parse throughput uses unopened parsers and complete UTF-8 corpora in 4 KiB chunks.
All prebuilt chunks are queued before awaiting completion, so xterm can batch its asynchronous writes.
Each parse-only fixture owns a fresh WASM runtime. Runtime construction is outside timing for both Ghostty libraries.
Every parse-only terminal enters the alternate screen before timing, so history allocation does not affect parser throughput.
The string chunks are decoded before timing. String-to-WASM encoding remains inside the timed library call.
MB means 1,000,000 bytes. The real-log fixture is an archived 256-entry public Git history log, repeated to at least 1 MiB.
xterm DOM and WebGL share a parser; their parse results are independent repetitions of that same parser.

Write latency starts at the browser write call. Input latency starts at the captured keydown event,
crosses a loopback WebSocket byte echo, and ends at a compositor capture containing the colored glyph.
Chromium screencast timestamps identify the first captured frame showing the glyph, not a library render callback.
This is captured-frame latency, not an optical display measurement. Capture overhead and capture cadence remain in the measurement.
Screencasting is stopped for burst, CPU, and memory measurements.

Burst output writes at least 4 KiB per terminal per animation frame for each corpus.
Frame intervals come from requestAnimationFrame timestamps. Dropped frames are inferred from the measured idle refresh period,
rounded to the nearest number of display intervals. They are missed animation-frame opportunities, not GPU presentation counters.
CPU sums Chromium process CPU time, including browser, renderer, and GPU, as a percentage of one core.

Memory per terminal and per 10k rows is the post-GC CDP used JS heap plus backing storage delta, divided by terminal count.
Output memory is sampled after the 60-frame ASCII output phase, outside CPU timing. Initial memory is the idle baseline.
This is retained JS/backing storage, not total terminal memory. WASM linear-memory capacity is reported separately.
Renderer/GPU RSS deltas cover all Chromium processes and include browser allocation noise and shared resources.
GPU allocation is not available per terminal. Negative deltas are retained as measurement noise.
Each Ghostty library shares one WASM runtime per context, matching its supported multi-terminal use.
The 10k fixture contains exactly 10,000 retained 40-column ASCII history rows per terminal.
The native adapter sets upstream SCROLLBACK_MAX_BYTES to 64 MiB through the runtime ABI, in addition to the 10k line limit.
The session API exposes the line limit only; the adapter checks its pinned internal terminal before applying the byte option.
The default byte budget retained only 2,014 rows in the initial attempt. The final run asserts all 10k rows.
ghostty-web also receives a 64 MiB budget: its 0.4.0 scrollback option is passed to the upstream max_scrollback byte field.
At scrollback: 10000, it retained only 1,852 rows. Its pinned [patch](https://github.com/coder/ghostty-web/blob/9e4e126d/patches/ghostty-wasm-api.patch) documents that option as lines.
xterm has a 10k row limit. Burst phases clear history first; legacy retention is byte-budget-only.

## Results

### 1 terminal, bytes

| Measure                  |  ghostty-webgpu |     xterm WebGL |       xterm DOM | ghostty-web |
| ------------------------ | --------------: | --------------: | --------------: | ----------: |
| parse/ascii              |     189.96 MB/s |      70.66 MB/s |      65.83 MB/s |  61.92 MB/s |
| parse/sgr                |      84.60 MB/s |      62.57 MB/s |      63.11 MB/s |  33.11 MB/s |
| parse/unicode            |      89.24 MB/s |      67.28 MB/s |      72.22 MB/s |  55.84 MB/s |
| parse/cursor             |     167.11 MB/s |      64.41 MB/s |      67.20 MB/s |  56.67 MB/s |
| parse/logs               |     357.99 MB/s |      69.30 MB/s |      69.10 MB/s |  64.79 MB/s |
| write/p50                |        14.16 ms |        12.19 ms |        12.97 ms |  unmeasured |
| write/p95                |        19.61 ms |        23.08 ms |        21.74 ms |  unmeasured |
| input/p50                |        30.82 ms |        30.27 ms |        30.64 ms |  unmeasured |
| input/p95                |        46.36 ms |        32.17 ms |        46.48 ms |  unmeasured |
| burst/ascii/p50          |        16.67 ms |        16.67 ms |        16.67 ms |  unmeasured |
| burst/ascii/p95          |        18.58 ms |        18.58 ms |        18.40 ms |  unmeasured |
| burst/ascii/dropped      |     0.00 frames |     0.00 frames |     0.00 frames |  unmeasured |
| burst/sgr/p50            |        16.67 ms |        16.67 ms |        16.67 ms |  unmeasured |
| burst/sgr/p95            |        18.61 ms |        18.59 ms |        18.48 ms |  unmeasured |
| burst/sgr/dropped        |     0.00 frames |     0.00 frames |     0.00 frames |  unmeasured |
| burst/unicode/p50        |        16.67 ms |        16.67 ms |        16.67 ms |  unmeasured |
| burst/unicode/p95        |        18.64 ms |        18.59 ms |        18.53 ms |  unmeasured |
| burst/unicode/dropped    |     0.00 frames |     0.00 frames |     0.00 frames |  unmeasured |
| burst/cursor/p50         |        16.67 ms |        16.67 ms |        16.67 ms |  unmeasured |
| burst/cursor/p95         |        18.64 ms |        18.67 ms |        18.64 ms |  unmeasured |
| burst/cursor/dropped     |     0.00 frames |     0.00 frames |     0.00 frames |  unmeasured |
| burst/logs/p50           |        16.67 ms |        16.67 ms |        16.67 ms |  unmeasured |
| burst/logs/p95           |        18.64 ms |        18.50 ms |        18.55 ms |  unmeasured |
| burst/logs/dropped       |     0.00 frames |     0.00 frames |     0.00 frames |  unmeasured |
| idle/cpu                 |     8.84 % core |    13.85 % core |    13.57 % core |  unmeasured |
| output/cpu               |    37.64 % core |    35.97 % core |    38.27 % core |  unmeasured |
| memory/terminal          |        0.82 MiB |        1.61 MiB |        1.14 MiB |  unmeasured |
| memory/10k               |        0.39 MiB |        7.17 MiB |        7.17 MiB |  unmeasured |
| memory/output/terminal   |        2.72 MiB |        9.10 MiB |        8.60 MiB |  unmeasured |
| memory/initial/wasm      |  1.50 MiB total |  0.00 MiB total |  0.00 MiB total |  unmeasured |
| memory/initial/rss-delta | 51.00 MiB total | 43.70 MiB total | 25.80 MiB total |  unmeasured |
| memory/history/wasm      |  5.06 MiB total |  0.00 MiB total |  0.00 MiB total |  unmeasured |
| memory/history/rss-delta | 58.44 MiB total | 57.03 MiB total | 38.38 MiB total |  unmeasured |
| memory/output/wasm       |  7.13 MiB total |  0.00 MiB total |  0.00 MiB total |  unmeasured |
| memory/output/rss-delta  | 32.23 MiB total | 76.11 MiB total | 75.70 MiB total |  unmeasured |

### 1 terminal, string

| Measure                  |  ghostty-webgpu |     xterm WebGL |  xterm DOM | ghostty-web |
| ------------------------ | --------------: | --------------: | ---------: | ----------: |
| parse/ascii              |     180.64 MB/s |      65.19 MB/s | 62.42 MB/s |  unmeasured |
| parse/sgr                |      79.83 MB/s |      58.52 MB/s | 58.27 MB/s |  unmeasured |
| parse/unicode            |      82.73 MB/s |      76.93 MB/s | 77.82 MB/s |  unmeasured |
| parse/cursor             |     147.59 MB/s |      60.60 MB/s | 61.43 MB/s |  unmeasured |
| parse/logs               |     268.61 MB/s |      62.44 MB/s | 64.53 MB/s |  unmeasured |
| write/p50                |        11.95 ms |        12.55 ms | unmeasured |  unmeasured |
| write/p95                |        23.08 ms |        21.95 ms | unmeasured |  unmeasured |
| input/p50                |        30.46 ms |        30.78 ms | unmeasured |  unmeasured |
| input/p95                |        32.87 ms |        46.89 ms | unmeasured |  unmeasured |
| burst/ascii/p50          |        16.66 ms |        16.67 ms | unmeasured |  unmeasured |
| burst/ascii/p95          |        18.53 ms |        18.49 ms | unmeasured |  unmeasured |
| burst/ascii/dropped      |     0.00 frames |     0.00 frames | unmeasured |  unmeasured |
| burst/sgr/p50            |        16.67 ms |        16.67 ms | unmeasured |  unmeasured |
| burst/sgr/p95            |        18.57 ms |        18.65 ms | unmeasured |  unmeasured |
| burst/sgr/dropped        |     0.00 frames |     0.00 frames | unmeasured |  unmeasured |
| burst/unicode/p50        |        16.67 ms |        16.67 ms | unmeasured |  unmeasured |
| burst/unicode/p95        |        18.57 ms |        18.59 ms | unmeasured |  unmeasured |
| burst/unicode/dropped    |     0.00 frames |     0.00 frames | unmeasured |  unmeasured |
| burst/cursor/p50         |        16.66 ms |        16.67 ms | unmeasured |  unmeasured |
| burst/cursor/p95         |        18.56 ms |        18.62 ms | unmeasured |  unmeasured |
| burst/cursor/dropped     |     0.00 frames |     0.00 frames | unmeasured |  unmeasured |
| burst/logs/p50           |        16.68 ms |        16.67 ms | unmeasured |  unmeasured |
| burst/logs/p95           |        18.56 ms |        18.57 ms | unmeasured |  unmeasured |
| burst/logs/dropped       |     1.00 frames |     0.00 frames | unmeasured |  unmeasured |
| idle/cpu                 |     8.82 % core |    15.72 % core | unmeasured |  unmeasured |
| output/cpu               |    33.64 % core |    39.42 % core | unmeasured |  unmeasured |
| memory/terminal          |        0.82 MiB |        1.60 MiB | unmeasured |  unmeasured |
| memory/10k               |        0.39 MiB |        7.17 MiB | unmeasured |  unmeasured |
| memory/output/terminal   |        2.72 MiB |        9.08 MiB | unmeasured |  unmeasured |
| memory/initial/wasm      |  1.50 MiB total |  0.00 MiB total | unmeasured |  unmeasured |
| memory/initial/rss-delta | 66.17 MiB total | 33.02 MiB total | unmeasured |  unmeasured |
| memory/history/wasm      |  5.06 MiB total |  0.00 MiB total | unmeasured |  unmeasured |
| memory/history/rss-delta | 73.52 MiB total | 45.52 MiB total | unmeasured |  unmeasured |
| memory/output/wasm       |  7.13 MiB total |  0.00 MiB total | unmeasured |  unmeasured |
| memory/output/rss-delta  | 89.89 MiB total | 74.84 MiB total | unmeasured |  unmeasured |

### 8 terminals, bytes

| Measure                  |   ghostty-webgpu |      xterm WebGL |        xterm DOM | ghostty-web |
| ------------------------ | ---------------: | ---------------: | ---------------: | ----------: |
| write/p50                |         14.06 ms |         13.43 ms |         15.00 ms |  unmeasured |
| write/p95                |         19.38 ms |         17.48 ms |         21.33 ms |  unmeasured |
| input/p50                |         30.50 ms |         30.37 ms |         30.82 ms |  unmeasured |
| input/p95                |         32.19 ms |         47.58 ms |         40.30 ms |  unmeasured |
| burst/ascii/p50          |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/ascii/p95          |         18.08 ms |         18.57 ms |         17.68 ms |  unmeasured |
| burst/ascii/dropped      |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/sgr/p50            |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/sgr/p95            |         16.70 ms |         17.49 ms |         17.16 ms |  unmeasured |
| burst/sgr/dropped        |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/unicode/p50        |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/unicode/p95        |         18.24 ms |         16.69 ms |         16.77 ms |  unmeasured |
| burst/unicode/dropped    |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/cursor/p50         |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/cursor/p95         |         18.60 ms |         18.56 ms |         18.65 ms |  unmeasured |
| burst/cursor/dropped     |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/logs/p50           |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/logs/p95           |         17.19 ms |         16.68 ms |         16.70 ms |  unmeasured |
| burst/logs/dropped       |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| idle/cpu                 |      8.63 % core |     21.09 % core |     19.37 % core |  unmeasured |
| output/cpu               |     59.57 % core |     71.41 % core |     60.44 % core |  unmeasured |
| memory/terminal          |         0.21 MiB |         0.48 MiB |         0.25 MiB |  unmeasured |
| memory/10k               |         0.27 MiB |         6.93 MiB |         7.02 MiB |  unmeasured |
| memory/output/terminal   |         1.60 MiB |         7.46 MiB |         7.32 MiB |  unmeasured |
| memory/initial/wasm      |   4.94 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/initial/rss-delta |  68.45 MiB total |  59.30 MiB total |  17.34 MiB total |  unmeasured |
| memory/history/wasm      |  29.94 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/history/rss-delta | 106.66 MiB total | 151.19 MiB total | 113.53 MiB total |  unmeasured |
| memory/output/wasm       |  46.06 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/output/rss-delta  |  94.95 MiB total | 222.95 MiB total | 209.36 MiB total |  unmeasured |

### 8 terminals, string

| Measure                  |   ghostty-webgpu |      xterm WebGL |        xterm DOM | ghostty-web |
| ------------------------ | ---------------: | ---------------: | ---------------: | ----------: |
| write/p50                |         12.28 ms |         13.85 ms |         11.83 ms |  unmeasured |
| write/p95                |         19.72 ms |         15.20 ms |         18.67 ms |  unmeasured |
| input/p50                |         30.21 ms |         30.25 ms |         30.68 ms |  unmeasured |
| input/p95                |         43.33 ms |         39.02 ms |         48.14 ms |  unmeasured |
| burst/ascii/p50          |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/ascii/p95          |         17.29 ms |         16.73 ms |         17.81 ms |  unmeasured |
| burst/ascii/dropped      |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/sgr/p50            |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/sgr/p95            |         17.52 ms |         17.90 ms |         17.44 ms |  unmeasured |
| burst/sgr/dropped        |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/unicode/p50        |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/unicode/p95        |         17.51 ms |         18.64 ms |         16.68 ms |  unmeasured |
| burst/unicode/dropped    |      0.00 frames |      1.00 frames |      0.00 frames |  unmeasured |
| burst/cursor/p50         |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/cursor/p95         |         17.72 ms |         18.61 ms |         18.64 ms |  unmeasured |
| burst/cursor/dropped     |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/logs/p50           |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/logs/p95           |         17.07 ms |         18.27 ms |         16.68 ms |  unmeasured |
| burst/logs/dropped       |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| idle/cpu                 |      8.54 % core |     19.90 % core |     18.17 % core |  unmeasured |
| output/cpu               |     59.62 % core |     70.53 % core |     57.91 % core |  unmeasured |
| memory/terminal          |         0.21 MiB |         0.46 MiB |         0.25 MiB |  unmeasured |
| memory/10k               |         0.27 MiB |         6.95 MiB |         7.02 MiB |  unmeasured |
| memory/output/terminal   |         1.60 MiB |         7.46 MiB |         7.32 MiB |  unmeasured |
| memory/initial/wasm      |   4.94 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/initial/rss-delta |  63.72 MiB total |  48.56 MiB total |  16.67 MiB total |  unmeasured |
| memory/history/wasm      |  29.94 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/history/rss-delta | 106.84 MiB total | 137.59 MiB total | 110.80 MiB total |  unmeasured |
| memory/output/wasm       |  46.06 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/output/rss-delta  | 150.45 MiB total | 207.78 MiB total | 208.55 MiB total |  unmeasured |

### 17 terminals, bytes

| Measure                  |   ghostty-webgpu |      xterm WebGL |        xterm DOM | ghostty-web |
| ------------------------ | ---------------: | ---------------: | ---------------: | ----------: |
| write/p50                |         13.32 ms |         12.87 ms |         14.60 ms |  unmeasured |
| write/p95                |         28.27 ms |         23.33 ms |         22.23 ms |  unmeasured |
| input/p50                |         30.09 ms |         30.61 ms |         30.75 ms |  unmeasured |
| input/p95                |         47.63 ms |         31.43 ms |         33.04 ms |  unmeasured |
| burst/ascii/p50          |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/ascii/p95          |         18.61 ms |         18.67 ms |         17.49 ms |  unmeasured |
| burst/ascii/dropped      |      0.00 frames |      2.00 frames |      0.00 frames |  unmeasured |
| burst/sgr/p50            |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/sgr/p95            |         16.72 ms |         18.60 ms |         33.33 ms |  unmeasured |
| burst/sgr/dropped        |      0.00 frames |      4.00 frames |      9.00 frames |  unmeasured |
| burst/unicode/p50        |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/unicode/p95        |         16.68 ms |         17.15 ms |         33.34 ms |  unmeasured |
| burst/unicode/dropped    |      0.00 frames |      0.00 frames |     10.00 frames |  unmeasured |
| burst/cursor/p50         |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/cursor/p95         |         18.47 ms |         18.15 ms |         18.63 ms |  unmeasured |
| burst/cursor/dropped     |      0.00 frames |      0.00 frames |      0.00 frames |  unmeasured |
| burst/logs/p50           |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/logs/p95           |         18.48 ms |         50.00 ms |         50.00 ms |  unmeasured |
| burst/logs/dropped       |      0.00 frames |     14.00 frames |     15.00 frames |  unmeasured |
| idle/cpu                 |      8.80 % core |     23.12 % core |     24.04 % core |  unmeasured |
| output/cpu               |    103.20 % core |     84.86 % core |     87.43 % core |  unmeasured |
| memory/terminal          |         0.17 MiB |         0.33 MiB |         0.22 MiB |  unmeasured |
| memory/10k               |         0.27 MiB |         6.99 MiB |         6.99 MiB |  unmeasured |
| memory/output/terminal   |         1.51 MiB |         7.34 MiB |         7.24 MiB |  unmeasured |
| memory/initial/wasm      |   9.50 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/initial/rss-delta | 107.91 MiB total |  92.72 MiB total |  29.92 MiB total |  unmeasured |
| memory/history/wasm      |  62.13 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/history/rss-delta | 179.81 MiB total | 274.84 MiB total | 215.67 MiB total |  unmeasured |
| memory/output/wasm       |  96.31 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/output/rss-delta  | 228.09 MiB total | 420.31 MiB total | 369.95 MiB total |  unmeasured |

### 17 terminals, string

| Measure                  |   ghostty-webgpu |      xterm WebGL |        xterm DOM | ghostty-web |
| ------------------------ | ---------------: | ---------------: | ---------------: | ----------: |
| write/p50                |         14.55 ms |         11.85 ms |         12.69 ms |  unmeasured |
| write/p95                |         18.52 ms |         20.43 ms |         23.82 ms |  unmeasured |
| input/p50                |         30.11 ms |         30.76 ms |         30.46 ms |  unmeasured |
| input/p95                |         32.07 ms |         31.04 ms |         46.89 ms |  unmeasured |
| burst/ascii/p50          |         16.67 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/ascii/p95          |         18.58 ms |         18.68 ms |         16.69 ms |  unmeasured |
| burst/ascii/dropped      |      0.00 frames |      2.00 frames |      0.00 frames |  unmeasured |
| burst/sgr/p50            |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/sgr/p95            |         16.68 ms |         18.59 ms |         33.33 ms |  unmeasured |
| burst/sgr/dropped        |      0.00 frames |      5.00 frames |      9.00 frames |  unmeasured |
| burst/unicode/p50        |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/unicode/p95        |         18.63 ms |         18.66 ms |         33.33 ms |  unmeasured |
| burst/unicode/dropped    |      0.00 frames |      0.00 frames |     10.00 frames |  unmeasured |
| burst/cursor/p50         |         16.66 ms |         16.67 ms |         16.67 ms |  unmeasured |
| burst/cursor/p95         |         18.56 ms |         16.68 ms |         17.40 ms |  unmeasured |
| burst/cursor/dropped     |      0.00 frames |      2.00 frames |      0.00 frames |  unmeasured |
| burst/logs/p50           |         16.66 ms |         16.67 ms |         16.68 ms |  unmeasured |
| burst/logs/p95           |         16.68 ms |         33.33 ms |         50.00 ms |  unmeasured |
| burst/logs/dropped       |      0.00 frames |     12.00 frames |     17.00 frames |  unmeasured |
| idle/cpu                 |      8.58 % core |     25.23 % core |     24.03 % core |  unmeasured |
| output/cpu               |    103.52 % core |     85.75 % core |     89.04 % core |  unmeasured |
| memory/terminal          |         0.17 MiB |         0.33 MiB |         0.22 MiB |  unmeasured |
| memory/10k               |         0.27 MiB |         6.99 MiB |         6.99 MiB |  unmeasured |
| memory/output/terminal   |         1.51 MiB |         7.34 MiB |         7.24 MiB |  unmeasured |
| memory/initial/wasm      |   9.50 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/initial/rss-delta | 108.80 MiB total |  80.22 MiB total |  37.06 MiB total |  unmeasured |
| memory/history/wasm      |  62.13 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/history/rss-delta | 183.41 MiB total | 261.03 MiB total | 222.13 MiB total |  unmeasured |
| memory/output/wasm       |  96.31 MiB total |   0.00 MiB total |   0.00 MiB total |  unmeasured |
| memory/output/rss-delta  | 268.61 MiB total | 407.00 MiB total | 363.64 MiB total |  unmeasured |

## Wins and losses

These comparisons use one terminal and the byte path. They report every measured metric against both other libraries.
Win/loss labels describe the observed medians; they carry no statistical-significance claim. Tail latency uses 12 samples per run.

| Measure                  | Against xterm WebGL          | Against xterm DOM           | Against ghostty-web        |
| ------------------------ | ---------------------------- | --------------------------- | -------------------------- |
| parse/ascii              | win (189.96 vs 70.66 MB/s)   | win (189.96 vs 65.83 MB/s)  | win (189.96 vs 61.92 MB/s) |
| parse/sgr                | win (84.60 vs 62.57 MB/s)    | win (84.60 vs 63.11 MB/s)   | win (84.60 vs 33.11 MB/s)  |
| parse/unicode            | win (89.24 vs 67.28 MB/s)    | win (89.24 vs 72.22 MB/s)   | win (89.24 vs 55.84 MB/s)  |
| parse/cursor             | win (167.11 vs 64.41 MB/s)   | win (167.11 vs 67.20 MB/s)  | win (167.11 vs 56.67 MB/s) |
| parse/logs               | win (357.99 vs 69.30 MB/s)   | win (357.99 vs 69.10 MB/s)  | win (357.99 vs 64.79 MB/s) |
| write/p50                | loss (14.16 vs 12.19 ms)     | loss (14.16 vs 12.97 ms)    | unmeasured                 |
| write/p95                | win (19.61 vs 23.08 ms)      | win (19.61 vs 21.74 ms)     | unmeasured                 |
| input/p50                | loss (30.82 vs 30.27 ms)     | loss (30.82 vs 30.64 ms)    | unmeasured                 |
| input/p95                | loss (46.36 vs 32.17 ms)     | win (46.36 vs 46.48 ms)     | unmeasured                 |
| burst/ascii/p50          | loss (16.67 vs 16.67 ms)     | loss (16.67 vs 16.67 ms)    | unmeasured                 |
| burst/ascii/p95          | loss (18.58 vs 18.58 ms)     | loss (18.58 vs 18.40 ms)    | unmeasured                 |
| burst/ascii/dropped      | tie                          | tie                         | unmeasured                 |
| burst/sgr/p50            | loss (16.67 vs 16.67 ms)     | loss (16.67 vs 16.67 ms)    | unmeasured                 |
| burst/sgr/p95            | loss (18.61 vs 18.59 ms)     | loss (18.61 vs 18.48 ms)    | unmeasured                 |
| burst/sgr/dropped        | tie                          | tie                         | unmeasured                 |
| burst/unicode/p50        | loss (16.67 vs 16.67 ms)     | loss (16.67 vs 16.67 ms)    | unmeasured                 |
| burst/unicode/p95        | loss (18.64 vs 18.59 ms)     | loss (18.64 vs 18.53 ms)    | unmeasured                 |
| burst/unicode/dropped    | tie                          | tie                         | unmeasured                 |
| burst/cursor/p50         | loss (16.67 vs 16.67 ms)     | loss (16.67 vs 16.67 ms)    | unmeasured                 |
| burst/cursor/p95         | win (18.64 vs 18.67 ms)      | win (18.64 vs 18.64 ms)     | unmeasured                 |
| burst/cursor/dropped     | tie                          | tie                         | unmeasured                 |
| burst/logs/p50           | loss (16.67 vs 16.67 ms)     | loss (16.67 vs 16.67 ms)    | unmeasured                 |
| burst/logs/p95           | loss (18.64 vs 18.50 ms)     | loss (18.64 vs 18.55 ms)    | unmeasured                 |
| burst/logs/dropped       | tie                          | tie                         | unmeasured                 |
| idle/cpu                 | win (8.84 vs 13.85 % core)   | win (8.84 vs 13.57 % core)  | unmeasured                 |
| output/cpu               | loss (37.64 vs 35.97 % core) | win (37.64 vs 38.27 % core) | unmeasured                 |
| memory/terminal          | win (0.82 vs 1.61 MiB)       | win (0.82 vs 1.14 MiB)      | unmeasured                 |
| memory/10k               | win (0.39 vs 7.17 MiB)       | win (0.39 vs 7.17 MiB)      | unmeasured                 |
| memory/output/terminal   | win (2.72 vs 9.10 MiB)       | win (2.72 vs 8.60 MiB)      | unmeasured                 |
| memory/initial/wasm      | 1.50 vs 0.00 MiB total       | 1.50 vs 0.00 MiB total      | unmeasured                 |
| memory/initial/rss-delta | 51.00 vs 43.70 MiB total     | 51.00 vs 25.80 MiB total    | unmeasured                 |
| memory/history/wasm      | 5.06 vs 0.00 MiB total       | 5.06 vs 0.00 MiB total      | unmeasured                 |
| memory/history/rss-delta | 58.44 vs 57.03 MiB total     | 58.44 vs 38.38 MiB total    | unmeasured                 |
| memory/output/wasm       | 7.13 vs 0.00 MiB total       | 7.13 vs 0.00 MiB total      | unmeasured                 |
| memory/output/rss-delta  | 32.23 vs 76.11 MiB total     | 32.23 vs 75.70 MiB total    | unmeasured                 |

## Correctness and limits

The runner asserts ASCII, SGR, wide text, cursor overwrite, byte echo, glyph presentation, and exact history length.
Successful first-repetition correctness checks retain Unicode/ZWJ text and a screenshot.
Review those screenshots for glyph layout differences; parser acceptance alone cannot prove Unicode shaping parity.
Firefox and Safari were not measured. This run qualifies headed Chromium on the recorded hardware only.
The corpus and font hashes, raw latency samples, raw frame intervals, process CPU snapshots, memory buckets,
actual execution order, and failed cases are retained in JSON.
Completed isolated parser samples remain valid when a later rendered case fails. Other metrics from failed cases are excluded. A metric appears in the tables only after all three repetitions complete.

- ghostty-web/bytes/1, repetitions 1, 2, 3: page.evaluate: RuntimeError: memory access out of bounds
- ghostty-web/bytes/8, repetitions 1, 2, 3: page.evaluate: RuntimeError: memory access out of bounds
- ghostty-web/bytes/17, repetitions 1, 2, 3: page.evaluate: RuntimeError: memory access out of bounds
- ghostty-web/string/1, repetitions 1, 2, 3: page.evaluate: RangeError: offset is out of bounds
- ghostty-web/string/8, repetitions 1, 2, 3: page.evaluate: RuntimeError: memory access out of bounds
- ghostty-web/string/17, repetitions 1, 2, 3: page.evaluate: RuntimeError: memory access out of bounds
- xterm-dom/string/1, repetitions 3: Error: Presented green glyph timed out; latest capture: {"timestamp":1790833518220.968,"colors":{"red":0,"green":0}}

## Screenshot review

Reviewed the first terminal in every first-repetition screenshot across both input paths and all three counts, plus the full 17-terminal grids for all four renderers. The missing ghostty-web/string/1 timing-run image was checked in the separate headed correctness smoke.

- ASCII, SGR text, Japanese text, combining accents, and cursor overwrite are visible across the screenshots. All 17 hosts are populated in each full grid.
- Native woman-technologist output includes a white rectangular glyph where the other renderers show the laptop. This is a native rendering loss on this fixture.
- Native and xterm WebGL show family-emoji constituents; xterm DOM shows composed emoji. ghostty-web splits them in the headed timing-run screenshots but composes them in its string-path correctness smoke. These default modes do not establish Unicode/ZWJ shaping parity.
- Default ANSI palette shades and ghostty-web row spacing differ. The font, font size, DPR, and terminal grid are held constant.

### Qualification notes

- The measurement matrix completed 72 cases in 10 minutes 52 seconds: 53 completed rendered cases and 19 failures. Native WebGPU and xterm WebGL completed all their cases.
- ghostty-web 0.4.0 fails in Unicode burst output on both paths at 1, 8, and 17 terminals, and its string parser phase fails at Unicode. Its independently qualified byte parser samples remain reported. Rendered metrics and failed parser batches remain unmeasured.
- xterm DOM/string/1, repetition 3, timed out awaiting a captured green glyph. The direct failure screenshot shows the echoed glyph, while the last screencast classifier reported zero green ink. This is a capture qualification failure, not evidence of an xterm renderer failure.
- The recorded run used a brightness floor of 150 in its pixel classifier. The current runner recognizes antialiased channel-dominant ink and saves timeout capture images. A later headed correctness-only smoke passed all four renderers and both paths; no timing values from that smoke replace the recorded run. The exact cause of the recorded timeout remains unconfirmed.
- Per-10k memory deltas include first ASCII-output and renderer-cache growth. Retained JS/backing storage and WASM capacity are separate buckets; neither is a total-memory measurement.

### Evidence

- [Native WebGPU, 17 terminals](benchmarks/mac-m1/ghostty-webgpu-bytes-17.png)
- [xterm WebGL, 17 terminals](benchmarks/mac-m1/xterm-webgl-bytes-17.png)
- [xterm DOM, 17 terminals](benchmarks/mac-m1/xterm-dom-bytes-17.png)
- [ghostty-web, 17 terminals](benchmarks/mac-m1/ghostty-web-bytes-17.png)
- [Compositor capture failure](benchmarks/mac-m1/failure-xterm-dom-string-1-2.png)
- [Headed capture correctness artifact](benchmarks/mac-m1/smoke-headed/comparison.json)
- [ghostty-web/string/1 headed correctness screenshot](benchmarks/mac-m1/smoke-headed/ghostty-web-string-1.png)
