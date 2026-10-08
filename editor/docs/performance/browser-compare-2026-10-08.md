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

All pages use a 1280 by 720 viewport, DPR 1, a 14 px monospace font, a 20 px line height and wrapping off. The runner checks computed visible-text font metrics and viewport dimensions. Singapore imports its required public base stylesheet and uses its default dark palette. Monaco and CodeMirror use their default light palettes. Each file contains repeated short TypeScript declarations. The runner records exact byte count, line count and SHA-256. One MiB means 1,048,576 bytes. ASCII keeps byte count and editor UTF-16 offsets equal.

| Editor       | Highlighting                                                     | Supporting features                                                               |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Singapore    | Public `typeScript()` Tree-sitter plugin, CSS Custom Highlights  | Core defaults, no gutter plugin                                                   |
| Monaco       | TypeScript Monarch tokenizer                                     | Minimap, gutters, folding and current-line tint off; `largeFileOptimizations` off |
| CodeMirror 6 | Lezer TypeScript mode through `javascript({ typescript: true })` | `basicSetup`, with gutters hidden                                                 |

Every page has lexical highlighting. Language servers, diagnostics and semantic tokens are absent. These highlighting engines do different work. Monaco tokenizes visible text. CodeMirror's language mode parses incrementally. Singapore uses its Tree-sitter plugin and worker pipeline. Highlight readiness checks the visible viewport, with no requirement to finish parsing the entire document.

Monaco normally reduces large-file features. This comparison turns its large-file optimization off before constructing the model so TypeScript tokenization remains enabled. The raw sample records the model's large-file tokenization flag. CodeMirror retains the other defaults in `basicSetup`. Singapore retains its core defaults. The supporting feature sets differ.

Three repetitions rotate editor order. Each editor occupies each run position once. Every sample uses a fresh browser context. Module loading and fixture generation finish before the open clock starts. The browser constructs its document with the same pure fixture module used by the Node-side identity calculation. Only the requested size crosses the Playwright channel. The default scan tests 1, 10, 50, 100 and 200 MiB.

## Measurement definitions

### Open

The first clock starts immediately before editor construction and model adoption. It stops after two animation-frame callbacks. The second waits for visible syntax readiness and two more callbacks. Singapore readiness requires nonempty token ranges in the CSS Highlight registry. Monaco requires colored token spans. CodeMirror requires language spans in a rendered line.

The first value is a frame opportunity after mount. The second includes syntax startup for the viewport. Neither clock proves that pixels reached a display. A screenshot follows the settled open and heap observation, providing separate visual evidence.

### Typing

Playwright sends trusted native key presses at the end and middle of each document. It types `q` at the end and `z` in the middle. Distinct letters keep text from the first location from satisfying the second location's rendered-text check.

The capture listener records the browser key event timestamp. A MutationObserver waits for document length to grow by one, then two animation-frame callbacks end the clock. Each sample checks the full growing letter sequence in rendered text. After each location it reads the exact inserted range from the editor's document and compares it with the expected sequence.

The runner retains listener lag, time to the observed mutation and time to the frame opportunity. It also retains Event Timing entries associated with the exact keydown timestamp. Chromium's Event Timing threshold is 16 ms, so short interactions can have no entry.

A separate positive control adds 120 ms in the capture listener before the editor handles the key. The verifier requires each editor's median mutation latency to grow by at least 96 ms. This checks that the clock includes delayed input work. The initial 30 ms control moved Monaco's median mutation clock by about 15 ms because the delay consumed an existing frame wait. The accepted control uses 120 ms to exceed that scheduling window. Both observations are retained.

The 120 ms control passed for all three editors. Median mutation-latency increases were 116.2 ms for Singapore, 105.5 ms for Monaco and 119.9 ms for CodeMirror. These calibration observations validate detection of added synchronous work; they do not calibrate physical presentation latency.

The measured matrix uses 20 keys per location and pools 60 keys per location across three successful repetitions and reports nearest-rank p50 and p95. Keys are isolated. They do not model sustained typing, a paste, composition or a held key. The two-frame observation adds scheduling overhead and frame quantization. Close values can reflect that quantization.

### Scroll

The measured matrix scrolls 200 px per frame for 60 frames, approximately 600 text lines. The script defaults to 120 frames. A Chromium DevTools trace records main-thread script, microtasks, events, style, layout and paint. The reducer clips selected complete events to each measured frame and unions overlapping spans. Nested events count once. The trace's scroll-start marker identifies the renderer thread.

The scroll-work column measures the selected main-thread work in milliseconds per frame. Frame intervals are reported separately. Worker CPU, compositor work, raster threads and GPU time are outside the scroll-work metric. The JSON retains raw frame intervals and reduced per-frame work. Representative 10 MiB traces allow the reduction to be inspected.

### Heap

After visible highlighting, the runner waits one second and requests garbage collection. It collects V8 heap usage for the renderer and dedicated workers, with separate raw observations and a summed `usedSize`. It also records `backingStorageSize`.

This is JavaScript heap after open. It is not process RSS or total editor memory. The values do not establish the cost of WASM linear memory, DOM nodes or GPU resources. Parsing and background work may still be active at the observation point. A low V8 heap value alone cannot establish a low total-memory editor.

### Bundle size

Separate production entry points exclude the measurement code. Singapore core imports `@singapore-editor/core/editor` and `@singapore-editor/core/style.css`; the TypeScript entry adds `typeScript()`. CodeMirror core mounts `EditorView` and `EditorState`; its TypeScript entry adds `basicSetup` and the language mode. Monaco mounts its editor API and declares an editor worker; the TypeScript entry adds the lexical language registration.

The Singapore build resolves public package exports to checkout source. It needs no prebuilt workspace output. Vite builds ES2023 production code, emits workers and assets, and writes no source maps or inline assets.

The core rows compare minimal mounting entry points, with unequal built-in features. CodeMirror core has no `basicSetup`. Singapore and Monaco keep the features their core editor imports include. These rows measure import cost, not feature parity.

The compressed deployment total sums every emitted file, compressed independently with gzip level 9 and Brotli quality 11. JavaScript, CSS, fonts, workers, lazy chunks and grammar WASM count. This measures the complete emitted deployment. It can exceed the bytes fetched for the first viewport. The manifest records each file's kind, size and hash so JavaScript and lazy assets can be separated.

## Failure accounting and limits

A 30-second visible-highlighting deadline and a 300-second whole-sample deadline for the measured matrix bound each attempt. The whole deadline includes heap collection, typing and scroll. A stuck sample closes Chromium and starts a new browser. Failures stay in the output. Resume keeps completed identities, including failures, and rejects a changed machine, browser, source or configuration.

A returned failure can retain completed open and heap observations. The outer whole-sample timeout records the deadline and discards in-progress metrics; a saved screenshot alone cannot turn that timeout into a completed measurement.

A successful size means this complete protocol passed at that size. An open can succeed while later input or scroll fails. The largest passing size is a tested bound under these deadlines and resource limits, not an editor's absolute file-size limit. A pass at 200 MiB leaves larger files unmeasured.

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
