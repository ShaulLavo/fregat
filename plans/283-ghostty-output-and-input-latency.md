# Plan 283: ghostty-webgpu output CPU and input latency

## Status and authorization

- Status: APPROVED 2026-10-01 by the owner after the comparison benchmark (PR #235): "it's probably a sign we're doing something too much."
- Gate and evidence: `bun run bench:compare` from Plan 281 on omarchy (i7-14700K, RTX 3060 Ti,
  headless Chromium on Vulkan with a hardware WebGPU adapter), comparing native and xterm in the same session. The
  owner's Mac is in daily use and is not part of the loop; an M1 run is optional, only when the owner offers the time.
- Original evidence: `ghostty-webgpu/docs/benchmarks.md` (PR #235, Apple M1).

## Progress

- [x] Phase 1 attribution: `ghostty-webgpu/docs/perf-attribution.md` (#242).
- [x] Fix 1, reuse WASM memory views (#245).
- [x] Fix 2, packed damaged-row snapshot plus direct-packed DOM frame text (#255).
- [x] Benchmark repair on omarchy (#343): hardware WebGPU on Linux headless-shell, GPU-idle gate,
      latency at the presentation of the submitting frame, paired native/xterm ratios, CPU rows
      unresolved below the 10 ms tick. Sustained-output CPU is ASCII-only until #352.
      Result at 17 terminals: output CPU native/xterm 2.10 renderer, 2.29 total.
- [x] Frame built in Zig, spike: ASCII and SGR colors, measured against main and xterm (#429).
- [x] Native Unicode, graphemes, wide cells, cursor, selection and color glyphs (#462).
- [x] GPU full move: delete the JavaScript frame/instance builder, opt-out and fallback. WebGL and
      WebGPU require native frames; bounded atlas exhaustion reports `frame_builder`, retains the
      submitted frame and unacknowledged damage, and requires a full rebuild on the next request.
      Shared styled/text row readers remain for Canvas 2D, DOM, accessibility and frame callbacks.
- [x] Native-only deletion control: one rolling-logs WebGL before/after matrix at 17 terminals,
      four balanced pairs per quiet window against `b991384e0`. Renderer/total paired xterm ratios
      remain below one (0.6674/0.8165 after); all 16 cases qualify. Cross-session native total CPU
      is 40.444 → 40.719% core, a descriptive observation. No CPU benefit or proven no-regression
      claim. Compact records and source verification: `ghostty-webgpu/docs/benchmarks/linux-native-only-2026-10-03/`.
- [ ] Input: render on the frame that parses the echo (native starts drawing ~15 ms after parse at
      1 terminal; xterm ~0.5 ms).
- [ ] Full omarchy run of every measure; regenerate `docs/benchmarks.md`; unblock Plan 285's measurements section.

Superseded by the Zig frame: the JS-side fixes for changed-row uploads, instance building and the JS
residual. The Zig frame writes only changed ranges and removes those JS stages.

## Every renderer gets the same treatment

Owner, 2026-10-02: WebGPU is the main path, but every renderer ghostty-webgpu ships (WebGPU, WebGL,
canvas 2D, DOM) gets the same tuning and passes the same suites. Shared work such as the Zig frame
serves all of them. Comparisons are like for like: ghostty WebGL against xterm WebGL, ghostty DOM
against xterm DOM. xterm has no WebGPU renderer, and xterm 6 dropped its canvas renderer, so
ghostty WebGPU and canvas 2D are measured against xterm WebGL (and DOM, for canvas 2D) and labelled
that way.

- [ ] Renderer matrix: benchmark variants for ghostty WebGL, canvas 2D and DOM; paired runs on
      omarchy; attribution for every pair where ghostty is slower.

## Phase 2 design: the frame is built in Zig

Approved by the owner 2026-10-02 as a re-architecture of the render pipeline. Ghostty's wasm only
parses and keeps terminal state (1.3 % of main-thread time at 17 terminals); copying cells out (49 %)
and building instances in JS (27 %) were our glue. WebAssembly cannot call WebGPU, so the split is:

- Zig (`bridge.wasm`): walk Ghostty's render state for dirty rows, look up glyphs in an atlas index
  it owns, write instance records into a persistent buffer in wasm memory, and return the changed
  byte ranges and the glyphs missing from the atlas. One call per frame.
- JS: rasterize missing glyphs with canvas (rare; zero atlas uploads in steady output), register
  them back, `queue.writeBuffer` only the changed ranges straight from wasm memory, encode one
  pass, submit. Fonts stay in the browser for system fonts, emoji and fallback.
- Gate: the spike must bring 17-terminal total CPU clearly below xterm and GPU-process CPU toward
  xterm's, or the full move stops for review.

Later option, not in this plan's scope: run the terminal in a worker (shared wasm memory or the
whole renderer on an `OffscreenCanvas`) so huge output never blocks the page. It moves work to
another core without reducing it, needs cross-origin isolation and a threads build of Ghostty, and
can add a hop to input; consider it only if a huge-output scenario shows the main thread blocked.

## Every renderer gets the same treatment

Owner, 2026-10-02: ghostty-webgpu is on a performance mission, and every renderer it ships is tuned
like the main WebGPU path: WebGPU, WebGL, Canvas 2D and DOM (`src/render/`). Each is measured
against its closest counterpart in the same session:

| Ours      | Counterpart            | Note                                 |
| --------- | ---------------------- | ------------------------------------ |
| WebGPU    | xterm WebGL            | xterm.js has no WebGPU renderer      |
| WebGL     | xterm WebGL            | like with like                       |
| Canvas 2D | ghostty-web (canvas2d) | xterm.js removed its canvas renderer |
| DOM       | xterm DOM              | like with like                       |

Target: each of ours at or below its counterpart. The controlled Linux browser reports ANGLE
Vulkan and Skia GaneshVulkan. Its disabled Vulkan-via-GL-interop feature does not establish a
Vulkan-to-GL presentation path. The remaining WebGPU GPU-process gap needs separate Dawn/API
and presentation attribution; native WebGL versus xterm WebGL isolates our WebGL renderer work.

## Why the M1 targets changed

The Apple M1 numbers below are history. Two measured defects made them unreliable:

- Latency p95 came from 12 samples, so it was the slowest keystroke: one missed 60 Hz frame
  (+16.7 ms) decided it, and the native-vs-xterm gap reversed between runs (46.2/32.1 → 28.8/39.8 ms).
- Latency ended at the first CDP screencast PNG with the glyph. Its capture cadence added about
  10 ms after a 0.5 ms render, which explains the write-p50 gap and its reversed runs.
- Absolute CPU drifted between sessions on the same bundle (107.8 % → 70.8 % renderer CPU), so
  only comparisons inside one session count.

## Outcome

ghostty-webgpu spends no more CPU than xterm.js WebGL while output streams and answers keystrokes at
least as fast, without giving up any of its current wins.

Targets are paired ratios measured in one session: native/xterm ≤ 1 for output CPU at 17 terminals,
input p95 and write p50 at 1 terminal, with no regression on the wins below. The original M1 run:

| Measure (Mac M1, bytes path, corrected run at 6ef17840) | ghostty-webgpu | xterm WebGL | Target        |
| ------------------------------------------------------- | -------------- | ----------- | ------------- |
| Output CPU, 17 terminals                                | 100.1 % core   | 89.9 % core | ≤ xterm WebGL |
| Input latency p95, 1 terminal                           | 46.2 ms        | 32.1 ms     | ≤ xterm WebGL |
| Write latency p50, 1 terminal                           | 14.0 ms        | 8.2 ms      | ≤ xterm WebGL |

Already level or ahead in the corrected run: output CPU at 1 terminal (30.4 vs 31.5 % core) and input
p95 at 17 terminals (47.4 vs 47.5 ms).

Keep: parse throughput (164 vs 64 MB/s ASCII, 360 vs 70 MB/s logs), idle CPU (9.0 vs 20.0 % core at
17 terminals), memory (0.40 vs 7.30 MiB per 10k history rows), zero dropped frames (xterm WebGL drops
4 at 17 terminals).

## What the numbers suggest

Idle CPU is low and flat (7.3 % at 1 terminal, 9.0 % at 17), so the idle scheduler is fine. Output CPU
grows faster than xterm's as terminals are added, so the cost is per terminal per frame while
content changes. Input p50 is close (32.1 vs 30.5 ms) but p95 is about 14 ms worse at 1 terminal, which points to
occasional extra frames of delay, not a slow common path. Write p50 is the largest relative gap
(14.0 vs 8.2 ms). These are hypotheses until Phase 1
attributes the time.

## Phase 1: attribute the cost

No fixes in this phase. Produce `ghostty-webgpu/docs/perf-attribution.md` with evidence:

1. Chrome traces (`bun run agent:browser trace` or the bench runner with tracing on) for 1, 8 and 17
   terminals under ASCII and SGR output, and for the input echo case: main-thread time split into
   wasm parse, render-state snapshot and copy, damage computation, instance/atlas upload, command
   encoding and submission, and JS overhead; renderer vs GPU-process CPU from the benchmark's
   per-process CPU snapshots.
2. Per-terminal per-frame counts: render-state updates, buffers written, bytes uploaded, draw calls
   and queue submissions, atlas uploads, and whether each terminal runs its own animation-frame
   loop, device, queue or pipeline.
3. For the input p95 tail: a timeline from keydown to presented frame for the slow samples,
   showing which frame boundary they missed and why (work scheduled after rAF, a frame waiting on
   output, a deferred damage flush).
4. The same counts for xterm WebGL where its source makes them observable, as a reference.

Rank the causes by measured share. Candidate areas to confirm or rule out: one scheduler and one
GPU submission per frame for all terminals, damage-limited uploads (rows actually changed), avoiding
full render-state copies out of wasm, atlas churn, and input-to-render ordering inside the frame.

## Phase 2: Zig/WebAssembly frame spike

Status: Completed spike; the checks below record its measured revisions. The original spike built
supported frames directly from Ghostty's render state and retained a selectable JavaScript producer.
The GPU full move now requires native frames for both WebGL and WebGPU. JavaScript retains browser
font rasterization and GPU calls; shared row readers serve non-GPU consumers.

- [x] Add persistent WASM cell/glyph records, an atlas index, missing glyph keys and changed ranges.
- [x] Add the opt-in WebGPU path and direct WASM-memory buffer uploads.
- [x] Prove instance-byte parity, dirty ranges, memory growth and fallback recovery with focused tests.
      Full unit suite: 405 passed. WebGPU browser coverage: 16 passed, two existing Linux skips.
- [x] Run existing unit and browser coverage plus supported-subset option-on coverage.
      Full browser suite: 183 passed, two existing Linux device-loss skips. Focused native frame: 12 passed.
- [x] Pull the reviewed Linux benchmark repair before hardware measurement; merge safeguards and
      JS/Zig identity reviewed against both parents, 100 portable comparison tests passed.
- [x] Push the spike and open [draft PR #357](https://github.com/ShaulLavo/fregat/pull/357).
- [x] Add native WebGL, Canvas 2D and DOM comparison variants with portable counterpart tests.
      117 portable comparison tests, package typecheck and full commit gates passed at `37441317b`.
- [x] Measure WebGPU/Zig, native WebGL and xterm WebGL at 17 terminals, ASCII, four balanced
      repetitions in one session; retain CPU process splits and presentation latency.
- [x] Attribute GPU/Viz/Dawn/WebGPU work and per-frame API counts in a separate one-off wrapper.
      Positive copy/readback control verified contents; native copy/map trace coverage is unobservable.
- [x] Measure native Canvas/ghostty-web and native DOM/xterm DOM at 17 terminals with the same gates.
- [x] Capture separate DOM HTML/style/layout/paint/library-work attribution.
      The successful capture qualifies the marked render window before transferring large records.
- [x] Attribute the remaining WebGPU/Zig renderer-main gap against xterm from preserved traces.
      Builder, retained callback row reads, warm atlas, uploads and commands are measured wrapper
      intervals; native bridge and scheduler ancestry are sample estimates. Trace totals are perturbed.
- [x] Repair negative-delta CPU sample overlap; regress reordered samples, nested tasks and unsampled edges.
- [x] Assess Zig frame compatibility with WebGL without implementing renderer changes.
- [x] Complete independent review and push the measurement evidence; leave merge to the owner.
      194 portable comparison tests and 15 focused attribution regressions pass; independent
      interval checks cover 1,000 reordered-sample cases. Reanalysis preserves all reported case
      numbers and records the repaired implementation hash. Raw traces remain outside timing code.

Compact controlled evidence lives in `ghostty-webgpu/docs/benchmarks/linux-zig-frame-2026-10-02/`.
All three timing sessions completed their four balanced repetitions; CPU and latency ratios retain
qualification. The WebGPU/Zig total-CPU gate failed (paired median 2.019× xterm WebGL); the full
move remains open for review. Native WebGL renderer CPU is 1.837× xterm WebGL, Canvas CPU is
0.889× ghostty-web, and DOM CPU is 1.574× xterm DOM. No renderer performance fixes landed in
this measurement pass. The legacy Unicode diagnostic smoke crashes in its old WASM; ASCII
hardware timing avoids that diagnostic. Atlas residency and ZWJ width observations are tracked
in #358 and #360; an empty NVIDIA sample invalidated separate DOM attribution attempts (#362).

### Consistent grapheme policy

Status: Approved. Issue #360's exact ZWJ sequences follow the configured Unicode provider and
grapheme mode. [Matched cell and browser controls](../docs/terminal/zwj-cell-controls-2026-10-03.md)
show native mode 2027 off equals xterm Unicode 11, and native mode 2027 on equals xterm
Unicode 15-graphemes. The benchmark's default xterm Unicode 6 assigns each emoji component one
cell, and its DOM renderer can shape across those cells. Native raw ABI and packed row ownership
agree. Keep the current packaged default while implementing this configuration prerequisite.

- [ ] Define one `legacy`/`unicode` grapheme-width contract for terminal creation, consistent with
      Ghostty's `grapheme-width-method`. Wire the package API and Fregat's application-scoped
      settings entry in the same pass; document standalone defaults and legacy program cursor
      compatibility. Read native config through its existing resolver when that integration is
      selected. Set the policy before any terminal output and before JS or Zig frames consume it.
- [ ] Apply that contract through pinned upstream `GHOSTTY_TERMINAL_OPT_MODE_DEFAULT` for mode
      2027, which sets both current and RIS reset values. Explicit application mode changes remain
      authoritative. No renderer infers or overrides cell widths.
- [ ] Record the benchmark's Unicode provider and mode in qualification. Compare legacy native
      to xterm Unicode 11 and clustered native to xterm Unicode 15-graphemes. Keep Unicode 6 as a
      labelled compatibility control, with its narrow component widths and DOM cross-cell shaping.
- [ ] Prove `ZWJ 👩‍💻 👨‍👩‍👧‍👦|` has cursor columns 18 under legacy and 10 under Unicode
      clustering; both Unicode-matched xterm controls agree. Check ASCII, CJK and combining text,
      codepoint/chunk-split writes, wrap/overwrite, selection/history and JS/Zig frames in every
      shipped renderer. After explicit mode changes and RIS, prove the selected creation policy
      returns. Capture the same loaded font and DPR, raw ABI and packed rows, cursor reports and
      actual screenshot geometry separately. Runtime defaults change only in this policy pass.

The earlier three-repetition JS/Zig/xterm measurements are preliminary. This pass measures and
attributes every renderer; it introduces no renderer performance fixes.

The decision gate is 17-terminal total CPU clearly below xterm (ratio well under 1), with GPU-process
CPU moving toward xterm. Retain write latency and explain any remaining gap before expanding the
spike to the full terminal feature set. Measurements use GPU-idle, `--quiet` heavy slots.

### WebGL consumes the Zig frame

Status: Completed milestone (#399). This revision reused the existing 64-byte cell and 96-byte
glyph records directly in WebGL with changed-range uploads and a whole-frame JavaScript fallback.
The GPU full move removes that fallback; shader and native record layouts remain unchanged.
The checks and measurements below describe the historical milestone.

- [x] Make WebGL's supported-subset native producer the default, preserving omitted host options.
- [x] Upload nonempty changed ranges from fresh WASM views with byte-correct destination offsets.
- [x] Rebuild fully on producer changes, grid/context changes and atlas invalidation.
- [x] Share missing-glyph registration and retain atlas residency independently of viewport row 0.
- [x] Pass real-WebGL JS/native pixel parity, host-default and lifecycle regressions.
- [x] Measure baseline `2c185da78` and treatment against xterm in separate frozen-bundle sessions at
      17 terminals (1,200 output frames) and one terminal (2,700), four balanced pairs and 96 samples.
- [x] Keep scroll rebuilds differential; measure identical rows, distinct lines and blank tails.
- [x] Decompose initial and final write latency through parse, build, upload, submit and presentation;
      independently reconcile all 3,072 final sample ledgers and retain the one-terminal p50 increase.
- [x] Push fixture-only commit `23add5884`; prove 2,700 advancing viewport changes and UTF-8 identity.
- [x] Repair archived JS-only recorder setup, pass 137 focused driver tests and untimed baseline smoke;
      independently audit shared-driver builds, assets and byte-identical repeated baseline.
- [x] Commit a hashed rolling real-Git-history fixture, prove advancing frames and viewport changes,
      and measure before/final at 17 and one terminal. All final CPU pairs pass; paired total ratios
      are 0.934160 and 0.899272. Repeating ASCII remains fixture-flattered secondary evidence.
- [x] Preserve compact CPU/latency evidence and attribute remaining build, listener-copy, upload and
      UI callback costs with a separate qualified rolling trace; preserve exact original JSON outside
      Git with original/formatted hashes and semantic equality in provenance.
- [x] Obtain independent Sol review, commit by path and push [PR #399](https://github.com/ShaulLavo/fregat/pull/399);
      measured runtime/evidence are tied to `078645300`. Main integration preserves runtime source;
      the coordinator owns merge, and default-on WebGPU follows in its own PR.

### Unicode, grapheme, selection and color frames

Status: Completed milestone (#462). This revision extended the Zig producer to shell content that
previously selected whole-frame JavaScript fallback: Unicode prompts, wide cells, grapheme clusters,
selection and color glyphs. The checks and measurements below describe that historical revision.
Fonts and missing-glyph rasterization remain browser-owned; cell and glyph record layouts stay
unchanged. That measured revision retained the explicit JavaScript producer. The GPU full move
removes that producer and preserves bounded native atlas-resource recovery.

- [x] Merge the listener-copy update before freezing the baseline runtime at `4a0adeb1c`.
- [x] Replace ASCII-only keys with owned full-text keys, width spans, style and resolved brush colors.
- [x] Build continuation cells, selection colors and color-atlas records directly in Zig.
- [x] Share grayscale shapes, bound color history and retry recycled atlas pages in Zig.
- [x] Prove descriptor memory plateaus, record rebuild frequency, and preserve clean rows through
      cap retries; check fragmented-atlas recovery and large missing-glyph batches.
- [x] Pass differential records and real WebGPU/WebGL pixel parity, including cold glyph retries.
- [x] Preserve cold brush insertion order in a fitting small atlas and keep warmed grayscale sharing.
- [x] Read back isolated `look` evidence with native counters and zero JavaScript fallback.
- [x] Measure four balanced pairs on both GPU backends at 17 terminals, before and after, for
      rolling Git history and a synthetic Unicode-prompt fixture modeled on the live shell.
- [x] Measure the Unicode-prompt fixture at one terminal on WebGL with 2,700 output frames.
- [x] Retain Zig/fallback counters, CPU process splits, latency and exact baseline-WASM provenance.
- [x] Obtain independent implementation review, commit by path, push and open
      [PR #462](https://github.com/ShaulLavo/fregat/pull/462); leave merge separate.
- [x] Correct stale native Unicode expectations and font-dependent screen-row isolation; seven
      focused cases pass, preserving exact native/JavaScript compositor parity and upload bounds.
- [x] Independently review final source/test repairs and raw measurement evidence: 665 numerical
      checks, 143 archived source hashes and both frozen asset bundles pass.

Delivery gate: corrected full-browser CI and final committed-head review must pass before the PR
is marked ready. Merge and deployment remain separate.

All ten approved windows qualify: 80 runs and 674,400 measured native submissions. Synthetic
Unicode fallback falls from 166,748 frames to zero. At 17 terminals, native WebGL renderer/total
CPU falls 46.12%/23.93%; paired native/xterm WebGL ratios are 0.6444/0.8269 and pass. WebGPU
renderer/total falls 42.06%/15.18%, but total remains 1.5919× xterm WebGL. One-terminal WebGL
renderer/total ratios are 0.8902/0.9381 and pass. Before/after sessions are separate; historical
WebGL renderer CPU rises 2.17% descriptively, and no statistically proven no-regression or latency
improvement is claimed. Every after-window still fails the write-p50 comparator.

Evidence is retained in `ghostty-webgpu/docs/benchmarks/linux-zig-unicode-2026-10-03/`.
Original correctness proof remains byte-identical in `correctness.json`; measurement verification
is `verification.json`. `ci-portability.json` records the independently reproduced one-pixel emoji
ink overhang at the exact CI failure location. Clean logical-row records remain unchanged while
native/JavaScript whole-frame pixels match exactly. The actual CI-selected glyph bitmap was not
measured; no production clipping or WASM change was made.
Timing uses the frozen 7,405-byte bridge; the later 7,408-byte cold-order guard is untimed.
Their compiled browser JavaScript is identical. Unicode-one-terminal WebGPU, historical-one-terminal
windows and an additional attribution trace were omitted from the approved matrix.

### Upload-call coalescing

Status: Approved experiment. Not merging: no CPU gain, so the coalescer does not clear the owner's
complexity bar. It coalesces cell and glyph records independently across individual gaps of at most
4 KiB. Persistent records keep those gaps valid; distant edits retain narrow uploads. Unchanged
native frames settle damage and callbacks without submitting GPU work. Renderer and benchmark
byte counters record the bytes actually written, including copied gaps.

- [x] Add bounded range coalescing and exact real-WebGPU/WASM record upload regressions.
- [x] Prove unchanged frames skip submission while settling damage and callbacks.
- [x] Pass focused Zig/frame-range, renderer, WebGPU and tracing tests; independent review passes.
- [x] Measure before/after at 17 terminals, four paired repetitions, 1,200 output frames and 96 latency samples.
- [x] Complete one-terminal timing: four paired repetitions, 2,700 output frames and 96 latency samples.
- [x] Complete optimized API/Dawn attribution and retain before/after evidence.
- [x] Collect fresh same-session WebGPU/Zig, native WebGL/JS and xterm GPU seam attribution.
- [x] Publish [draft experiment PR #374](https://github.com/ShaulLavo/fregat/pull/374); keep the coalescer unmerged and undeployed.

The 17-terminal total-CPU gate remains failed: the optimized paired median is 1.922× xterm WebGL.
Absolute native renderer/GPU-process/total medians are 18.344/59.906/78.653 % of one core; the
unchanged baseline is 18.293/60.168/78.263 %. This run shows no material CPU improvement. Keep
upload-call reduction separate from CPU claims; the full move still waits for the owner’s review.
Fresh same-session GPU-process trace intervals put the largest observed gap in command handling:
WebGPU's `CrGpuMain` task union is about 2.45× native WebGL's, while native WebGL and xterm are
close. Measure Linux WebGL-default treatment next; a shared WebGPU canvas remains untested.
Per-canvas attribution and exact texture-acquisition implementation time are unobservable.
The one-terminal input p95 regression (20.4 → 29.7 ms) belongs to the unmerged coalescer; its cause
was not confirmed.
Evidence is retained in `ghostty-webgpu/docs/benchmarks/linux-one-write-2026-10-02/`.

### Follow-up causes

One reviewed PR per cause, largest measured share first. Each PR shows before/after on omarchy with
`bench:compare` (the affected measures, four balanced repetitions, inside a `--quiet` heavy slot with the GPU idle) plus a trace that
shows the removed work. Stop when every target is met or when the remaining gap is explained and
the owner decides it is acceptable.

Rules: no design significantly more complex than today's for a small gain (owner's complexity
bar); no regressions on the wins listed above; correctness tests and screenshots stay green.

## How to run it

Phase 1: one Opus or Sol worker, investigation only. Phase 2: one worker per cause, Sol by default,
each with an independent reviewer. Measurements run on omarchy through the heavy-job queue with
`--quiet` and wait for an idle GPU; keep each window under 10 minutes.

## Done when

- `docs/perf-attribution.md` explains where output CPU and the input p95 tail go, with traces.
- The paired-ratio targets are met on omarchy, or the remaining gap is documented and accepted by
  the owner.
- `docs/benchmarks.md` is regenerated from a fresh run, with no lost wins. If ghostty-webgpu now
  beats xterm.js on these measures, raise putting numbers in the main README with the owner.

## Linux comparison qualification

Status: Approved. This benchmark-only pass removes the Mac dependency for native/xterm comparisons;
product performance work remains separate.

- [x] Add Linux headless hardware launch and bounded harness adapter acquisition.
- [x] Qualify GPU idleness before windows and repetitions, sample during windows, retain give-up evidence.
- [x] Use terminal-frame presentation feedback for latency; retain PNG glyph checks and increase samples to 240.
- [x] Alternate adjacent native/xterm cases with explicit pair identities; evaluate median paired ratios ≤ 1.
- [x] Add portable option, gate, recorded-endpoint, and paired-ratio tests.
- [x] Prove hardware canvas presentation, then run 1/17-terminal ASCII, bytes, three paired repetitions.
- [x] Retain compact Linux evidence, per-pair latency/CPU attribution, delayed-rAF sensitivity and endpoint limits.
- [x] Complete independent benchmark review.
- [x] Commit by path, push, and open [benchmark PR #343](https://github.com/ShaulLavo/fregat/pull/343); leave merge and product performance work separate.

### PR #343 review repairs

- [x] Record Linux CPU tick size; require at least 100 ticks per side and a difference exceeding one tick.
- [x] Preserve skipped GPU qualification in run/paired output and reject newly appearing foreign compute PIDs.
- [x] Commit portable evidence compaction that retains between-repetition qualifications and null/reason ratios.
- [x] Balance four pairs, guard presentation-after-submission, add a recorded Linux fixture, slow measured-window GPU sampling and retry idle timeouts.
- [x] Rerun counts 1 and 17 in separate idle-GPU quiet windows: 2700/1800 output frames respectively, four pairs and 96 latency samples per operation.
- [x] Refresh compact evidence, attribution and PR numbers; commit by path, push and reply without merging.
