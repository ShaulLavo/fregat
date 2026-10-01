# Plan 283: ghostty-webgpu output CPU and input latency

## Status and authorization

- Status: APPROVED 2026-10-01 by the owner after the comparison benchmark (PR #235,
  `ghostty-webgpu/docs/benchmarks.md`): "it's probably a sign we're doing something too much."
- Gate and evidence: `bun run bench:compare` from Plan 281, run on the owner's MacBook (Apple M1,
  headed Chromium, hardware GPU) over mesh host `mac`, on AC power only.

## Outcome

ghostty-webgpu spends no more CPU than xterm.js WebGL while output streams and answers keystrokes at
least as fast, without giving up any of its current wins.

| Measure (Mac M1, bytes path)    | ghostty-webgpu | xterm WebGL | Target        |
| ------------------------------- | -------------- | ----------- | ------------- |
| Output CPU, 17 terminals        | 103.2 % core   | 84.9 % core | ≤ xterm WebGL |
| Output CPU, 1 terminal          | 37.6 % core    | 36.0 % core | ≤ xterm WebGL |
| Input latency p95, 1 terminal   | 46.4 ms        | 32.2 ms     | ≤ xterm WebGL |
| Input latency p95, 17 terminals | 47.6 ms        | 31.4 ms     | ≤ xterm WebGL |
| Write latency p50, 1 terminal   | 14.2 ms        | 12.2 ms     | ≤ xterm WebGL |

Keep: parse throughput (2.4–5.2× xterm), idle CPU (8.8 vs 23.1 % core at 17 terminals), memory
(0.39 vs 7.17 MiB per 10k history rows), zero dropped frames.

## What the numbers suggest

Idle CPU is low and flat (8.8 % at 1 and at 17 terminals), so the idle scheduler is fine. Output CPU
grows faster than xterm's as terminals are added, so the cost is per terminal per frame while
content changes. Input p50 ties at about 30 ms but p95 is about 15 ms worse, which points to
occasional extra frames of delay, not a slow common path. These are hypotheses until Phase 1
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

One reviewed PR per cause, largest measured share first. Each PR shows before/after on the Mac with
`bench:compare` (the affected measures, three repetitions, order-alternated) plus a trace that
shows the removed work. Stop when every target is met or when the remaining gap is explained and
the owner decides it is acceptable.

Rules: no design significantly more complex than today's for a small gain (owner's complexity
bar); no regressions on the wins listed above; correctness tests and screenshots stay green.

## How to run it

Phase 1: one Opus or Sol worker, investigation only. Phase 2: one worker per cause, Sol by default,
each with an independent reviewer. Mac runs only on AC power and only when the owner is not using
the Mac heavily; keep each measurement window under 30 minutes.

## Done when

- `docs/perf-attribution.md` explains where output CPU and the input p95 tail go, with traces.
- The targets in the table are met on the Mac, or the remaining gap is documented and accepted by
  the owner.
- `docs/benchmarks.md` is regenerated from a fresh run, with no lost wins.
