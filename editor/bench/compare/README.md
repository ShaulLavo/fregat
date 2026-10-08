# Browser editor comparison

A Linux Chromium experiment for Singapore, Monaco and CodeMirror 6. It records
large-file open, isolated keystrokes, scroll work and post-GC JavaScript heap.
A separate build measures small core and TypeScript editor imports.

## Reproduce

Use a fresh Fregat checkout, Bun 1.4.2 and Node 26.7.0. Install the root workspace
first, then this standalone benchmark. Its lockfile pins the competitors.

```sh
bun install --frozen-lockfile
cd editor/bench/compare
bun install --frozen-lockfile
bunx playwright install chromium
bun run test
bun run build
bun run bench --output ./results
node summarize.mjs ./results/experiment.json
```

The Singapore build resolves its package export map to checkout source. This
avoids a dependency on prebuilt workspace output and lets Vite bundle module
workers with the application. It uses the same public entry points a consumer
imports. The standalone directory is deliberately outside the root workspace.

On a host with a heavy-job scheduler, run the build as a build job and the
experiment as a browser job. The scheduler is optional and has no dependency
inside the committed scripts. Use its quiet-measurement mode when available.
Set `PLAYWRIGHT_BROWSERS_PATH` only if your host uses a shared browser cache.
Record the operator-observed measurement condition with `--condition quiet` or
`--condition noisy`. The default is `unspecified`; the script does not infer
machine quietness. Retain the scheduler receipt when one is available.

The server binds an OS-assigned free port on `127.0.0.1` and stops in `finally`.
No account, provider or external network service participates in a run.

## Options

```sh
# A bounded smoke check.
bun run bench --sizes 1 --repetitions 1 --keys 5 --scroll-frames 30 --output ./results/smoke

# A positive control with 120 ms of extra work before the editor handles each key.
bun run bench --sizes 1 --repetitions 1 --keys 10 --delay-ms 120 --output ./results/control

# Supply an installed Chromium instead of Playwright's cached build.
bun run bench --executable-path /path/to/chromium --output ./results/custom
```

The default scan is 1, 10, 50, 100 and 200 MiB, three repetitions, 40 keys per
location and 120 scroll frames. `--timeout` bounds each complete sample in
milliseconds, including open, heap collection, typing and scroll. The default
is 60,000 ms. A timeout closes the browser and starts a new one for the next
sample. Failures remain in the JSON. If a host stops the overall process, rerun
with `--resume` and the same options to continue missing sample identities. The
runner rejects changed source, browser, machine, configuration or served-build hashes.
It hashes every file in all six served editor builds, including HTML, CSS, workers
and lazy assets, and also compares the minimal-bundle manifest. This detects rebuilt
product code even when Git HEAD, package versions and lockfiles stay unchanged.
Earlier runs without recorded served-build hashes cannot resume. Completed
failures remain recorded and are never silently replaced. The largest successful size is a bound on
this scan, not an absolute limit for an editor.

Three rotating editor orders give each editor each run position once. Use
repetitions in multiples of three for balanced order. Each sample gets a fresh
browser context. Module loading and fixture generation finish before the open
clock starts. The browser uses the same pure fixture module as the Node-side
identity calculation. Only the size crosses Playwright's channel, keeping large
files below Chromium's DevTools message-size limit.

## Profile highlighted open

```sh
bun run build
bun run bench --profile-open --open-only --sizes 1,10,200 --repetitions 3 \
  --condition noisy --timeout 180000 --output ./results/open-profile
node summarize-open.mjs ./results/open-profile/experiment.json
# Compare a repeated diagnostic matrix against its baseline.
node summarize-open.mjs ./results/open-profile-after/experiment.json \
  --compare ./results/open-profile/experiment.json
```

This diagnostic run uses the same mount code, fixture, geometry checks and
30-second visible-highlighting deadline as the comparison. It skips typing,
scroll and post-open heap observations. Every attempt saves an open trace,
including visible-highlighting deadline failures. A whole-sample timeout can
still interrupt trace collection and fails profile verification.

The trace includes main-thread work, frame markers and V8 CPU samples. An
opt-in page probe records Singapore's existing worker phase timings, request
round trips, initial source chunk size and synchronous `postMessage` time.
It also enables the existing editor performance diagnostics. The probe keeps
message metadata and preserves worker send arguments. Document text stays out
of the message records.

Open markers delimit mount, the first frame opportunity, the first detected
syntax and the settled frame opportunity. `mainWorkMs` unions nested script,
event, style, layout and paint spans on the marked renderer thread.
`mainRenderingMs` is the rendering subset. These named spans are a subtotal;
the DevTools-evaluated constructor is not covered by a script span in these
traces. Its wall time is recorded separately by the mount marker.
`structuralApplyMs` measures the first main-thread application of structural
syntax, including mounted token-range painting. Worker phase durations are nested
inside request round trips, so adding both would count work twice. A round trip
includes queueing, serialization, worker execution and delivery. It cannot
isolate transfer latency.

These are instrumented experiments. The comparison summarizer rejects them;
use `summarize-open.mjs`. They do not replace the uninstrumented comparison
matrix or establish a performance improvement. `--compare` checks identical fixture,
configuration, browser, machine, package versions and competitor bundle identities
before reporting diagnostic median differences. Failed groups retain null timings.

## Measurements and differences

- Every browser page uses the same ASCII TypeScript fixture, viewport, DPR,
  14 px monospace font, 20 px line height and wrapping off. The runner verifies
  computed visible-text font metrics, host dimensions, the actual scroll viewport
  and a bounded rendered-row pool. The flex-column host gives Singapore's flex
  child a definite height. Singapore imports its
  public base stylesheet. Singapore uses its default dark palette; Monaco and
  CodeMirror use their default light palettes. The fixture repeats
  short TypeScript declarations. Its exact byte count, line count and SHA-256
  are in the output. Sizes mean MiB, or 1,048,576 bytes.
- Singapore uses its `typeScript()` Tree-sitter plugin and CSS Custom
  Highlights. Monaco uses its TypeScript Monarch tokenizer. CodeMirror uses
  `basicSetup` and its Lezer TypeScript language mode. Language servers,
  diagnostic UI and semantic tokens are absent in all three. Singapore's worker
  still computes structural errors, brackets and folds.
- Monaco's `largeFileOptimizations` is explicitly off to preserve lexical
  highlighting. Its minimap, gutter, folding and current-line tint are off.
  CodeMirror's `basicSetup` retains its other default features, with the
  gutters hidden by CSS. Singapore keeps its core defaults and has no gutter
  plugin. The editors therefore have different supporting feature sets.
- Open records constructor/model creation to two animation-frame callbacks,
  then visible syntax readiness to another two callbacks. The first number
  is a frame opportunity after mount. The second includes visible syntax
  startup. Readiness checks one nonempty token CSS Highlight collection in
  Singapore, one colored token span in Monaco and one classed line span in
  CodeMirror. This fixture uses language spans for the CodeMirror check.
  Whole-viewport coverage and token correctness require separate checks.
  Monaco and CodeMirror can satisfy the detector before whole-document
  analysis. Singapore's current range-query path first awaits a full root
  parse and injection discovery.
  Parser throughput and whole-document completion need separate measurements.
- Typing sends trusted Playwright `q` presses at the end and `z` presses in the middle. A capture
  listener reads the key event timestamp for the clock; a MutationObserver waits for document length
  to grow; two subsequent animation-frame callbacks end it. Each sample
  checks the full growing letter sequence in rendered text and the exact inserted text. This is an
  input-to-frame opportunity proxy that includes observer scheduling and
  frame quantization. Headless Chrome cannot prove physical presentation.
  Event Timing entries with the browser's minimum 16 ms threshold remain in
  the raw samples, including processing timestamps. Keys below that
  threshold have no Event Timing record.
- Highlight readiness is checked at initial open. Later typing and scrolling
  keep TypeScript enabled but do not wait for completed highlighting in newly
  visited viewports or after each edit.
- Scroll advances 200 px per frame for 120 frames, about 1,200 text lines.
  CDP captures main-thread script, microtask, event, layout, style and paint
  spans. The reducer clips them to each measured frame and unions overlaps
  so nested events count once. Compositor, raster-thread and worker CPU are
  outside this frame-work metric. Frame intervals are reported separately.
- Heap collection runs after a one-second settling interval and forced GC.
  It sums the renderer and dedicated-worker V8 `usedSize` values and reports
  them separately in the raw data. `backingStorageSize` is also retained.
  This is JavaScript heap, not process RSS or total memory. WASM linear
  memory and DOM/GPU allocations must not be inferred from this number.
- Bundle measurements use separate minimal entries with no observation code.
  Singapore core imports `core/editor`; TypeScript adds `typeScript()`.
  CodeMirror core mounts `EditorView` with `EditorState`; TypeScript adds
  `basicSetup` and `javascript({ typescript: true })`. Monaco mounts
  `editor.api`, an editor worker and, for TypeScript, its lexical tokenizer.
  Vite emits production ES2023 code with no source maps or inline assets.
  The totals sum each emitted asset compressed independently with gzip
  level 9 or Brotli's default quality 11. CSS, workers, fonts, grammar WASM
  and lazy chunks all count. This is the complete emitted deployment, which
  can exceed the bytes fetched for the first viewport. File sizes and hashes
  are retained, so lazy assets can be inspected separately.

The fixture does not cover a one-megabyte line, mixed languages, many unique
identifiers, diagnostics, completions, search or multiple cursors. A win here
is a win on this fixture and setup. It is not an editor-wide ranking.

## Evidence

The runner writes raw samples, screenshots and representative 1 and 10 MiB scroll
traces. `summarize.mjs` verifies complete sample accounting and requires usable
1 MiB baseline rows for every editor. Larger failures require a retained error
and remain measured outcomes. It pools
keystrokes across usable repetitions and uses nearest-rank p50/p95. Open and
heap columns use the median of repetitions. Failures remain separate.

The committed experiment and its interpretation are in
[the performance document](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08.md).
