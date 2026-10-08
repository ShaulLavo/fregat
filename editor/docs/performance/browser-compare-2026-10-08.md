# Browser editor comparison experiment

This noisy experiment compares Singapore, Monaco and CodeMirror 6 in headless Chromium on Linux. It measures a repeated TypeScript document with lexical highlighting enabled. It also builds separate small core and TypeScript editor entry points to measure compressed deployment size.

The run shares the host with other scheduled jobs. It is an exploratory baseline. A quiet rerun is required before these numbers become public performance claims. Scheduler overlap evidence belongs with the raw samples.

The typing and open clocks end at animation-frame opportunities. They do not measure physical display presentation. These numbers describe this fixture, machine and setup. They do not establish an editor-wide ranking.

## Reproduce

The [committed benchmark](https://github.com/ShaulLavo/fregat/tree/main/editor/bench/compare) runs from a fresh Fregat checkout with Bun and Node. The root lockfile pins Singapore's dependencies. The standalone benchmark lockfile pins the competitors and browser tooling.

```sh
bun install --frozen-lockfile
cd editor/bench/compare
bun install --frozen-lockfile
bunx playwright install chromium
bun run test
bun run build
bun run bench --condition noisy --keys 20 --scroll-frames 60 --timeout 300000 --output ./results
node summarize.mjs ./results/experiment.json
```

The [benchmark README](https://github.com/ShaulLavo/fregat/blob/main/editor/bench/compare/README.md) lists the smoke run, injected-delay control, installed-browser option and resume command. A host's heavy-job scheduler is optional. The committed scripts have no dependency on that host integration.

## What runs on each page

All pages use a 1280 by 720 viewport, DPR 1, a 14 px monospace font, a 20 px line height and wrapping off. The runner checks computed visible-text font metrics, host dimensions and the actual scroll viewport. The host is a flex column, giving Singapore's flex child a definite height. The scroll viewport must be 690–720 px high and 1,200–1,280 px wide, allowing native scrollbar space. Each editor must keep its rendered row pool between 1 and 300 rows. The guard runs at open, each caret reposition and after scrolling. Singapore imports its required public base stylesheet and uses its default dark palette. Monaco and CodeMirror use their default light palettes. Each file contains repeated short TypeScript declarations. The runner records exact byte count, line count and SHA-256. One MiB means 1,048,576 bytes. ASCII keeps byte count and editor UTF-16 offsets equal.

| Editor       | Highlighting                                                     | Supporting features                                                               |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Singapore    | Public `typeScript()` Tree-sitter plugin, CSS Custom Highlights  | Core defaults, no gutter plugin                                                   |
| Monaco       | TypeScript Monarch tokenizer                                     | Minimap, gutters, folding and current-line tint off; `largeFileOptimizations` off |
| CodeMirror 6 | Lezer TypeScript mode through `javascript({ typescript: true })` | `basicSetup`, with gutters hidden                                                 |

Every page has lexical highlighting. Language servers, diagnostics and semantic tokens are absent. Singapore's current Tree-sitter pipeline must finish its initial full-document parse before it can answer viewport token queries. Monaco can show colored viewport tokens while background tokenization continues. CodeMirror prioritizes the viewport and bounds its parse-ahead work. The harness checks visible highlighting, but Singapore's implementation makes a full-document parse a prerequisite for that check. The highlighted-open row compares user-visible viewport startup under these configurations; it is not a like-for-like comparison of equal highlighting work or full-document completion.

Monaco normally reduces large-file features. This comparison turns its large-file optimization off before constructing the model so TypeScript tokenization remains enabled. The raw sample records the model's large-file tokenization flag. CodeMirror retains the other defaults in `basicSetup`, including its current-line background. Default text insets are retained, so the first text column and top padding can differ. Singapore retains its core defaults. The supporting feature sets differ.

Three repetitions rotate editor order. Each editor occupies each run position once. Every sample uses a fresh browser context. Module loading and fixture generation finish before the open clock starts. The browser constructs its document with the same pure fixture module used by the Node-side identity calculation. Only the requested size crosses the Playwright channel. The default scan tests 1, 10, 50, 100 and 200 MiB.

## Measurement definitions

### Open

The first clock starts immediately before editor construction and model adoption. It stops after two animation-frame callbacks. The second waits for visible syntax readiness and two more callbacks. Singapore readiness requires nonempty token ranges in the CSS Highlight registry. Monaco requires colored token spans. CodeMirror requires language spans in a rendered line.

The first value is a frame opportunity after mount. The second includes syntax startup for the viewport. In Singapore this also waits for the initial full-document parse; Monaco and CodeMirror can highlight the viewport first. These are different amounts of prerequisite work, so this row is not like for like as a parser-speed measurement. It still records the user's wait for visible highlighting in the tested setup. Neither clock proves that pixels reached a display. A screenshot follows the settled open and heap observation, providing separate visual evidence.

### Typing

Playwright sends trusted native key presses at the end and middle of each document. It types `q` at the end and `z` in the middle. Distinct letters keep text from the first location from satisfying the second location's rendered-text check.

The capture listener records the browser key event timestamp. A MutationObserver waits for document length to grow by one, then two animation-frame callbacks end the clock. Each sample checks the full growing letter sequence in rendered text. After each location it reads the exact inserted range from the editor's document and compares it with the expected sequence.

The runner retains listener lag, time to the observed mutation and time to the frame opportunity. It also retains Event Timing entries associated with the exact keydown timestamp. Chromium's Event Timing threshold is 16 ms, so short interactions can have no entry.

A separate positive control adds 120 ms in the capture listener before the editor handles the key. The verifier requires each editor's median mutation latency to grow by at least 96 ms. This checks that the clock includes delayed input work. The initial 30 ms control moved Monaco's median mutation clock by about 15 ms because the delay consumed an existing frame wait. The accepted control uses 120 ms to exceed that scheduling window. Both observations are retained.

The viewport-validated 120 ms control passed for every editor. Median mutation-latency increases were 120.1 ms for Singapore, 106.2 ms for Monaco and 119.7 ms for CodeMirror. Calibration observations validate detection of added synchronous work; they do not calibrate physical presentation latency. Earlier controls used an invalid unconstrained Singapore viewport and are archived with that setup's logs. They are excluded from the accepted comparison.

Highlight readiness is checked only at initial open. The later typing and scroll protocol keeps each TypeScript language mode enabled and checks text, geometry and movement; it does not require completed highlighting in every newly visited viewport or after each edit. Those timings measure interaction with the configured editors, not time to fully highlighted text after navigation or input.

The measured matrix uses 20 keys per location and pools 60 keys per location across three successful repetitions and reports nearest-rank p50 and p95. Keys are isolated. They do not model sustained typing, a paste, composition or a held key. The two-frame observation adds scheduling overhead and frame quantization. Close values can reflect that quantization.

### Scroll

The measured matrix scrolls 200 px per frame for 60 frames, approximately 600 text lines. The script defaults to 120 frames. A Chromium DevTools trace records main-thread script, microtasks, events, style, layout and paint. The reducer clips selected complete events to each measured frame and unions overlapping spans. Nested events count once. The trace's scroll-start marker identifies the renderer thread.

The scroll-work column measures the selected main-thread work in milliseconds per frame. Frame intervals are reported separately. Worker CPU, compositor work, raster threads and GPU time are outside the scroll-work metric. The JSON retains raw frame intervals and reduced per-frame work. Representative 10 MiB traces allow the reduction to be inspected.

### Heap

After visible highlighting, the runner waits one second and requests garbage collection. It collects V8 heap usage for the renderer and dedicated workers, with separate raw observations and a summed `usedSize`. It also records `backingStorageSize`.

This is JavaScript heap after open. It is not process RSS or total editor memory. The values do not establish the cost of WASM linear memory, DOM nodes or GPU resources. Parsing and background work may still be active at the observation point. A low V8 heap value alone cannot establish a low total-memory editor.

### Bundle size

Separate production entry points exclude the measurement code. Singapore core imports `@singapore-editor/core/editor` and `@singapore-editor/core/style.css`; the TypeScript entry adds `typeScript()`. CodeMirror core mounts `EditorView` and `EditorState`; its TypeScript entry adds `basicSetup` and the language mode. Monaco mounts its editor API and declares an editor worker; the TypeScript entry adds the lexical language registration.

The Singapore build resolves public package exports to checkout source. It needs no prebuilt workspace output. Vite builds ES2023 production code, emits workers and assets, and writes no source maps or inline assets. The build warns about large chunks, a Markdown dependency's browser-externalized Node filesystem import and a default web-tree-sitter WASM path. The tested TypeScript pages load their emitted runtime and grammar successfully; this run does not verify the unrelated Markdown or default-loader paths.

The core rows compare minimal mounting entry points, with unequal built-in features. CodeMirror core has no `basicSetup`. Singapore and Monaco keep the features their core editor imports include. These rows measure import cost, not feature parity.

The compressed deployment total sums every emitted file, compressed independently with gzip level 9 and Brotli quality 11. JavaScript, CSS, fonts, workers, lazy chunks and grammar WASM count. This measures the complete emitted deployment. It can exceed the bytes fetched for the first viewport. The manifest records each file's kind, size and hash so JavaScript and lazy assets can be separated.

## Failure accounting and limits

A 30-second visible-highlighting deadline and a 300-second whole-sample deadline for the measured matrix bound each attempt. The whole deadline includes heap collection, typing and scroll. A stuck sample closes Chromium and starts a new browser. Failures stay in the output. Resume keeps completed identities, including failures, and rejects a changed machine, browser, source or configuration.

A returned failure can retain completed open and heap observations. The outer whole-sample timeout records the deadline and discards in-progress metrics; a saved screenshot alone cannot turn that timeout into a completed measurement.

A successful size means this complete protocol passed at that size. An open can succeed while later input or scroll fails. The largest passing size is a tested bound under these deadlines and resource limits, not an editor's absolute file-size limit. A pass at 200 MiB leaves larger files unmeasured.

The first setup also left Singapore's host as a block container. Its flex child had no constrained height, so the host-only guard failed to detect an oversized scroll viewport. The slow open and typing crashes from that setup are invalid comparison observations. Their logs remain under `invalid-layout`, excluded from result tables. The corrected pilot and matrix validate the child's real viewport and bound the rendered row pool.

The first matrix transferred the document through Playwright. At 100 and 200 MiB, Chromium's DevTools pipe closed before editor construction: `max_buffer_size=104857600` and `Connection closed, not enough capacity`. That is a harness transport limit, and those rows do not establish an editor's size limit. The failed matrix is retained as setup evidence; the corrected comparison generates the fixture inside the browser.

The fixture does not cover one very long line, varied identifiers, mixed languages, diagnostics, completions, search, multiple cursors or accessibility. Repeating the same declaration can favor a tokenizer or parser differently from a real project file. Headless Chromium is one browser on one Linux machine. Firefox, WebKit and physical presentation remain unmeasured here.

The summary verifier requires the complete sample matrix and usable 1 MiB baseline rows for every editor. It checks trusted input, rendered text, key count and scroll evidence. Failed 10 MiB and larger attempts remain measured outcomes, with an explicit error required for each failure. Completed open observations also retain the geometry check when later work fails. Open and heap values in the aggregate tables use the median of fully successful repetitions; partial observations are identified separately. The tables must be read with their usable/attempted counts.

## Machine and versions

The experiment ran on 2026-10-08 UTC on an Intel Core i7-14700K, 28 logical CPUs, with 31.1 GiB of usable RAM. The host ran Linux x64, kernel `7.2.8-arch1-2`. Playwright 1.63.0 used Chromium `153.0.8010.12` in headless mode. Node was 26.7.0, Bun 1.4.2 and Vite 8.3.1. No CPU affinity was applied.

Singapore's core, textbuffer, Tree-sitter and language packages were 0.2.6. Monaco was 0.57.0. CodeMirror's `codemirror` package was 6.0.2, state 6.7.6, view 6.43.14 and JavaScript language package 6.2.5. Product source came from [baseline 523ccf51](https://github.com/ShaulLavo/fregat/commit/523ccf51c459dee0424cfb7829fd527f033b9a5a). The JSON records lockfile and benchmark source hashes.

The ordinary bench job used the host scheduler's 9 GiB memory ceiling and no reserved CPU set. Other jobs and preview servers overlapped the experiment. A renderer crash or deadline is an outcome under this setup; this run does not determine its root cause.

## Compressed deployment experiment

All sizes below are KiB, or 1,024 bytes. Totals include every emitted asset. The JavaScript column excludes CSS and WASM.

| Entry                 | Raw total | Gzip total | Brotli total | Gzip JavaScript |
| --------------------- | --------: | ---------: | -----------: | --------------: |
| singapore-core        |     886.8 |      233.5 |        191.9 |           231.5 |
| singapore-typescript  |  30,732.5 |    3,074.1 |      1,988.5 |           319.9 |
| monaco-core           |   3,033.2 |      773.1 |        614.1 |           759.3 |
| monaco-typescript     |   3,038.7 |      775.3 |        616.0 |           761.5 |
| codemirror-core       |     194.5 |       62.1 |         54.2 |            62.1 |
| codemirror-typescript |     487.9 |      161.4 |        136.1 |           161.4 |

Singapore's core deployment is smaller than Monaco's and larger than CodeMirror's minimal core. Its TypeScript deployment is larger than both. This public language import emitted 25 WASM assets, 28.8 MiB raw, and 64 JavaScript files. Those emitted assets dominate its deployment total. They are lazy assets; this experiment did not measure initial network transfer. Singapore's JavaScript-only TypeScript output is smaller than Monaco's, while its complete TypeScript deployment is much larger.

## Browser comparison experiment results

Values are milliseconds except heap, which is MiB. Usable counts include the complete open, typing and scroll protocol. An em dash means no fully usable repetition.

| Editor     | MiB | Usable | First frame | Highlighted open | JS heap |
| ---------- | --: | -----: | ----------: | ---------------: | ------: |
| singapore  |   1 |    3/3 |        29.3 |            299.9 |     7.1 |
| monaco     |   1 |    3/3 |        49.2 |            123.8 |    10.5 |
| codemirror |   1 |    3/3 |        28.4 |             52.4 |     4.8 |
| singapore  |  10 |    3/3 |        29.6 |          1,517.7 |    25.2 |
| monaco     |  10 |    3/3 |        89.7 |            169.4 |    29.5 |
| codemirror |  10 |    3/3 |        31.5 |             56.1 |    17.4 |
| singapore  |  50 |    3/3 |        40.3 |          7,310.6 |   105.6 |
| monaco     |  50 |    3/3 |       268.0 |            340.5 |    90.8 |
| codemirror |  50 |    3/3 |        76.3 |            103.5 |    72.7 |
| singapore  | 100 |    3/3 |        50.8 |         16,136.8 |   206.1 |
| monaco     | 100 |    3/3 |       489.2 |            559.2 |   157.0 |
| codemirror | 100 |    3/3 |       125.8 |            146.1 |   142.0 |
| singapore  | 200 |    0/3 |           — |                — |       — |
| monaco     | 200 |    3/3 |       969.7 |          1,050.5 |   293.9 |
| codemirror | 200 |    3/3 |       232.8 |            265.2 |   285.3 |

### Input-to-frame opportunity experiment

| Editor     | MiB | End p50 | End p95 | Middle p50 | Middle p95 |
| ---------- | --: | ------: | ------: | ---------: | ---------: |
| singapore  |   1 |    31.7 |    32.3 |       31.2 |       31.5 |
| monaco     |   1 |    48.4 |    48.9 |       48.5 |       48.9 |
| codemirror |   1 |    31.9 |    33.3 |       31.8 |       32.4 |
| singapore  |  10 |    32.0 |    32.3 |       32.0 |       32.4 |
| monaco     |  10 |    48.7 |    49.0 |       48.8 |       49.1 |
| codemirror |  10 |    32.3 |    32.7 |       32.0 |       32.6 |
| singapore  |  50 |    32.1 |    32.6 |       32.1 |       32.4 |
| monaco     |  50 |    47.6 |    48.7 |       48.4 |       48.9 |
| codemirror |  50 |    32.2 |    32.8 |       32.2 |       32.7 |
| singapore  | 100 |    31.7 |    32.3 |       32.1 |       32.5 |
| monaco     | 100 |    47.0 |    48.6 |       46.7 |       48.4 |
| codemirror | 100 |    31.8 |    32.6 |       31.9 |       32.5 |
| singapore  | 200 |       — |       — |          — |          — |
| monaco     | 200 |    47.0 |    48.7 |       46.9 |       48.3 |
| codemirror | 200 |    32.1 |    32.5 |       32.2 |       32.7 |

### Scroll experiment

| Editor     | MiB | Main-thread work p50 | Work p95 | Frame interval p50 | Interval p95 |
| ---------- | --: | -------------------: | -------: | -----------------: | -----------: |
| singapore  |   1 |                  1.5 |      2.7 |               16.7 |         16.7 |
| monaco     |   1 |                  1.5 |      2.3 |               16.7 |         16.7 |
| codemirror |   1 |                  0.5 |      4.1 |               16.7 |         16.7 |
| singapore  |  10 |                  0.3 |      0.5 |               16.7 |         16.8 |
| monaco     |  10 |                  1.3 |      1.8 |               16.7 |         16.8 |
| codemirror |  10 |                  0.4 |      2.9 |               16.7 |         16.8 |
| singapore  |  50 |                  1.0 |      1.6 |               16.7 |         16.7 |
| monaco     |  50 |                  1.3 |      1.6 |               16.7 |         16.7 |
| codemirror |  50 |                  2.7 |      3.5 |               16.7 |         16.7 |
| singapore  | 100 |                  1.2 |      2.1 |               16.7 |         16.7 |
| monaco     | 100 |                 16.5 |     17.1 |               16.7 |         16.7 |
| codemirror | 100 |                  5.1 |     14.7 |               16.7 |         16.7 |
| singapore  | 200 |                    — |        — |                  — |            — |
| monaco     | 200 |                 16.6 |     17.2 |               16.7 |         16.7 |
| codemirror | 200 |                  0.4 |     34.0 |               16.7 |         33.3 |

## What Singapore wins and loses in this experiment

- **The first-frame opportunity is lower than Monaco's at every shared passing size.** At 10 MiB, Singapore records 29.6 ms, Monaco 89.7 ms and CodeMirror 31.5 ms. Singapore is also lower than CodeMirror at 50 and 100 MiB. This clock ends before visible TypeScript readiness, so it does not establish a faster highlighted open.
- **Highlighted open loses to both competitors at every shared passing size.** At 10 MiB, Singapore's median is 1,517.7 ms, Monaco's 169.4 ms and CodeMirror's 56.1 ms. At 100 MiB, Singapore reaches 16,136.8 ms, versus 559.2 ms and 146.1 ms. The visible-highlighting clock grows sharply with file size in Singapore. Its initial full-document parse is a prerequisite for viewport highlighting, while Monaco and CodeMirror can highlight the viewport first. The row therefore retains Singapore's user-visible startup loss but is not a like-for-like comparison of equal parsing work.
- **The input-to-frame proxy is lower than Monaco's and close to CodeMirror's.** At 10 MiB, end p50/p95 is 32.0/32.3 ms for Singapore, 48.7/49.0 ms for Monaco and 32.3/32.7 ms for CodeMirror. The middle observations show the same broad pattern. Small differences from CodeMirror are within the frame-quantized observation method; this is no proof of faster physical presentation.
- **Scroll main-thread work has mixed results.** Singapore's 1 MiB p50 is slightly above Monaco's and above CodeMirror's. At 10 MiB its 0.3 ms p50 is lower than both. At 100 MiB its 1.2 ms p50 is lower than Monaco's 16.5 ms and CodeMirror's 5.1 ms. Worker and compositor work are excluded. CodeMirror's non-monotonic 200 MiB observations and p95 spikes are another reason to retain the raw data and rerun quietly.
- **JavaScript heap wins against Monaco at 1 and 10 MiB, then loses at 50 and 100 MiB.** Singapore uses 25.2 MiB at 10 MiB, versus Monaco's 29.5 MiB and CodeMirror's 17.4 MiB. At 100 MiB it uses 206.1 MiB, versus 157.0 MiB and 142.0 MiB. CodeMirror has the lowest observed V8 heap at every shared passing size. These are V8 observations, with no total-memory ranking.
- **Core deployment size beats Monaco and loses to CodeMirror.** Singapore's complete TypeScript deployment loses to both, with emitted lazy grammar WASM dominating the total. JavaScript-only and complete-deployment totals tell different stories.

### Tested file-size bounds and failures

All 45 identities are retained; 42 completed the full protocol. Singapore passed all three repetitions through 100 MiB. Its three 200 MiB attempts failed because visible highlighting did not appear within the 30-second deadline. This is its largest fully passing tested size under this protocol. It is not an absolute capacity limit.

Monaco and CodeMirror passed all three repetitions through the scan's 200 MiB upper bound. Larger files remain unmeasured for both. The scheduler recorded no OOM kills and a 4.7 GiB peak for the complete job, below its 9 GiB ceiling. That does not establish total memory for any individual editor.

### Measurement condition and evidence

The ordinary bench job ran from 08:57:43.964 to 09:05:16.788 UTC, including the build, pilot, control and matrix. It waited 653.6 seconds for admission and ran for 452.8 seconds. It had no reserved CPU set. Reconstructed receipt intervals show overlapping build, suite, browser and light jobs; a preview server and a later browser job were still active when the run ended. Their identities and commands are redacted. Overlap duration does not quantify interference. These remain noisy experiments.

The following evidence is committed alongside this method:

- [Raw accepted matrix](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/experiment.json.gz), [aggregate summary](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/summary.json), [six-row pilot](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/pilot.json.gz) and [120 ms control](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/control-120.json.gz).
- [Redacted scheduler receipt and reconstructed overlaps](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/scheduler.json), plus a [live registry snapshot](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/scheduler-live.json).
- Reviewed 10 MiB screenshots for [Singapore](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/singapore-10-0.png), [Monaco](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/monaco-10-0.png) and [CodeMirror](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/codemirror-10-0.png). Each shows colored TypeScript at the specified font and line height. Raw geometry records the real 720 px scroll viewport and bounded row pool.
- Representative 10 MiB traces for [Singapore](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/singapore-10-scroll.trace.json.gz), [Monaco](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/monaco-10-scroll.trace.json.gz) and [CodeMirror](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08/codemirror-10-scroll.trace.json.gz). Each has 61 frame marks delimiting 60 measured intervals. The measured runner used a fixed 10 MiB filename, so its later 10 MiB traces overwrote the earlier 1 MiB files. The committed trace-name regression fix preserves both sizes on future runs. The accepted matrix's retained 10 MiB traces and reduced per-frame observations are unaffected.
- [Invalid setup archive](https://github.com/ShaulLavo/fregat/tree/main/editor/docs/performance/browser-compare-2026-10-08/invalid-layout), explicitly labeled inside each experiment JSON and excluded from these tables. Its crashes are no evidence of an editor crash under the corrected setup.

To verify the committed matrix from `editor/bench/compare`:

```sh
node summarize.mjs ../../docs/performance/browser-compare-2026-10-08/experiment.json.gz
```

The raw run-start Git SHA identifies the checkpoint before the final harness changes were committed. The benchmark content hash records the actual build and measurement files, including fixture generation and validation. Those measured files are preserved in [measurement checkpoint b1219b6b](https://github.com/ShaulLavo/fregat/commit/b1219b6b495031eae1275a0a216437eb0005f3f2). Later fixes separate trace filenames, strengthen resume provenance and reject incomplete positive-control evidence; their source hash differs from the accepted measurement. The accepted matrix predates the served-build hash field and has no resume timestamps. Its recorded source checkpoint, observations and result tables are unchanged. New runs hash every file in all six served editor builds, including HTML, CSS, workers and lazy assets, and refuse resume if those identities or the minimal-bundle manifest differ. Runs without recorded served-build hashes cannot resume. Product source was unchanged from the linked baseline.
