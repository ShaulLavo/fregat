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
- [ ] Frame built in Zig, spike: ASCII and SGR colors, measured against main and xterm.
- [ ] Frame built in Zig, full move: wide characters, graphemes, cursor, selection, links; delete the
      JS snapshot and instance builders.
- [ ] Input: render on the frame that parses the echo (native starts drawing ~15 ms after parse at
      1 terminal; xterm ~0.5 ms).
- [ ] Full omarchy run of every measure; regenerate `docs/benchmarks.md`; unblock Plan 285's measurements section.

Superseded by the Zig frame: the JS-side fixes for changed-row uploads, instance building and the JS
residual. The Zig frame writes only changed ranges and removes those JS stages.

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

Target: each of ours at or below its counterpart. The open question for WebGPU is whether its
remaining gap at 17 terminals (GPU-process CPU about 2.5× xterm's) is the cost of presenting a
WebGPU canvas on this Linux setup (Dawn on Vulkan, compositor on GL, no Vulkan–GL interop), or
something our renderers do. Comparing our WebGL with xterm's WebGL answers it.

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

## Phase 2: fix the top causes

One reviewed PR per cause, largest measured share first. Each PR shows before/after on omarchy with
`bench:compare` (the affected measures, three repetitions, order-alternated, inside a `--quiet` heavy slot with the GPU idle) plus a trace that
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
