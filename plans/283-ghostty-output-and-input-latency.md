# Plan 283: ghostty-webgpu output CPU and input latency

## Status and authorization

- Status: APPROVED 2026-10-01 by the owner after the comparison benchmark (PR #235): "it's probably a sign we're doing something too much."
- Gate and evidence: `ghostty-webgpu/docs/benchmarks.md` (PR #235) and `bun run bench:compare` from Plan 281, run on the owner's MacBook (Apple M1,
  headed Chromium, hardware GPU) over mesh host `mac`, on AC power only.

## Outcome

ghostty-webgpu spends no more CPU than xterm.js WebGL while output streams and answers keystrokes at
least as fast, without giving up any of its current wins.

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
