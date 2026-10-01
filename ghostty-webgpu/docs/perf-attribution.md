# Output and input latency attribution

Status: Phase 1 is blocked on Mac display qualification. The tracing tooling is available; the measured attribution is incomplete. No product fixes were made.

## Targets

The corrected Apple M1 comparison in [benchmarks.md](benchmarks.md), merged in Fregat PR #235, remains the baseline.

| Target                        |     ghostty-webgpu | xterm WebGL | Ranked measured causes               |
| ----------------------------- | -----------------: | ----------: | ------------------------------------ |
| Output CPU, 17 terminals      | 100.1% of one core |       89.9% | Unavailable pending qualified traces |
| Input echo p95, 1 terminal    |            46.2 ms |     32.1 ms | Unavailable pending qualified traces |
| Write latency p50, 1 terminal |            14.0 ms |      8.2 ms | Unavailable pending qualified traces |

These latency endpoints are the first compositor screencast PNG containing the intended glyph. They include capture cadence and overhead. Optical display latency requires a separate measurement.

## Qualification outcome

On 2026-10-01, the owner's Apple M1 MacBook ran headed Chromium using its hardware GPU, on AC power, under `caffeinate -d -u -t 1800`. The full matrix selected 1, 8, and 17 terminals, ASCII output, SGR output, and loopback-WebSocket input echo, with three repetitions and alternating traced/control ordering. It stopped during the second repetition when a pre-phase idle rAF probe failed the required 60 Hz qualification, reporting **Mac display unavailable**.

The entire window's timing data, traces, screenshots, and transferred archive were discarded on both hosts. An earlier rejected rehearsal was also discarded. There is no authoritative refresh period or timing artifact from either window to publish. The failed probe establishes unavailable qualification; it does not establish whether display occlusion, refresh configuration, or another condition caused that failure.

Linux headless SwiftShader smoke runs established that the pinned native and xterm adapters expose the wrapped boundaries and counters. They supply correctness evidence only. Their timings cannot rank the Mac target causes.

Accordingly, CPU shares, renderer/GPU CPU ratios, input/write frame-boundary timelines, profiler overhead, and proposed-fix rankings remain unconfirmed. Source observations below are investigation leads, not measured conclusions.

## Opt-in tracing

`bench:compare` builds the same hash-verified portable bundle used by the comparison runner. Its runner accepts:

| Flag                              | Effect                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| `--trace`                         | Native WebGPU and pinned xterm WebGL, bytes path, latency/ASCII/SGR phases |
| `--trace-count 1\|8\|17`          | Restrict a window to one terminal count                                    |
| `--trace-frames N`                | Paced output frames, default 180                                           |
| `--trace-latency-samples N`       | Samples per write/input phase, default 48                                  |
| `--display-awake`                 | Caller declares the documented `caffeinate` invocation                     |
| `--smoke --smoke-instrumentation` | Exercise wrappers and counters without timing qualification                |

All measurements use a **new output directory**. An existing directory is rejected, allowing a failed display check to discard every file belonging to its window, including the in-progress case. The runner retains only a failure-status JSON with no runs. AC power is checked at startup and between cases. A ticking, near-60-Hz rAF probe is required before each trace/control phase: 20 positive intervals below one second, median 15–18.5 ms, and a five-second probe deadline. The probe intervals and caller-declared display-awake command enter qualified artifacts. A failed display probe stops the window.

The benchmark page installs wrappers only when opened with `?trace`. Library source, normal consumer behavior, and the default comparison report are unchanged. Recording activates only between `traceBegin` and `traceEnd`. UserTiming measures are emitted after the CPU snapshot so serialization is outside the sampled CPU phase. Method wrapping, span allocation, counters, and Chrome profiling still have overhead: traced/control measurements are mandatory before interpreting shares.

Each trace phase writes a gzip-compressed Chrome trace and a `comparison.json` phase record containing:

- Exclusive nested method timings, with terminal index, start/end, and category.
- Raw timestamped counters, per-terminal totals, and per-render-frame counts.
- Object identities and unique ownership counts for schedulers, devices, queues, pipelines, WebGL contexts, and programs.
- Keydown, echo-send, echo-receive, marker-write, and paced-rAF markers.
- Captured glyph timestamps and individual write/input samples, including partial samples when capture qualification fails.
- Chromium process CPU deltas grouped by process type, preserving renderer and GPU attribution separately. Process birth/exit rejects the CPU sample.

Category shares in `summary.shares` use **instrumented exclusive milliseconds** as their denominator. They are not whole-main-thread CPU shares. A completed attribution must align the `compare/begin` Chrome timestamp with its `performance.now` start time, clip renderer-main task intervals to the recording window, and report task time outside the wrapped functions separately.

### Boundaries and observable counts

| Category      | Native boundary                                                    | Pinned xterm WebGL boundary                              |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Parse         | Exact `ghostty_terminal_vt_write` WASM call                        | Input handler `parse`                                    |
| Snapshot/copy | Render state `update` and `readRows`                               | `_updateModel`, including model/instance work            |
| Damage        | `rowsToRebuild` and state `acknowledge`                            | Render service `refreshRows`                             |
| Instances     | `rebuildRows`, excluding nested snapshot calls                     | Included in `_updateModel`; requires profiler drill-down |
| Upload        | Text pass `upload`, atlas `sync`                                   | `bufferData`, `texImage2D`                               |
| Commands      | Text pass `submit`                                                 | `drawElementsInstanced`, explicit `flush`                |
| JS            | Exclusive residual of core/DOM `write`, `notifyWrite`, `drawFrame` | Exclusive residual of `write`, `renderRows`              |

Native counts cover state updates, copied rows/cells, instance buffer writes/bytes, atlas uploads/bytes, two draws per submitted render, and one queue submission per submitted render. xterm counts cover model updates/rows, GL buffer writes/bytes, atlas uploads/bytes, draws, and explicit flushes. WebGL exposes no queue-submission API; explicit flushes cannot be reported as equivalent WebGPU submissions. GPU-process command-buffer trace events provide the complementary observable.

The native parse wrapper uses a benchmark-local mutable view of the WASM export object. Terminal handles identify the correct terminal while all terminals share one runtime. Private xterm boundaries fail immediately when the pinned version no longer exposes the expected method. xterm model work and native snapshot work have different boundaries; their percentages require that qualification in any comparison.

## Source leads awaiting measurement

| Lead                    | Observation                                                                                                                 | Candidate follow-up and complexity                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot extraction     | Native row extraction builds JS cell objects through several WASM ABI getters per cell.                                     | Measure cell-read share; consider a simpler bulk snapshot boundary if it dominates. Medium: ABI, cell semantics, tests.                                                       |
| Per-terminal rendering  | Each native benchmark terminal owns a scheduler, device, queue, and two pipelines. Native renders submit once per terminal. | Measure renderer/GPU share and submissions before considering shared device ownership or batching. Medium to high: resource lifecycle and scheduling.                         |
| Instance uploads        | Native output rebuilds selected rows and writes separate cell/glyph buffers. xterm exposes different model/upload layout.   | Normalize actual uploaded bytes and writes per render; reduce redundant work only if observed. Medium: row/instance representation.                                           |
| Frame phase and capture | Input crosses WebSocket echo and scheduled rendering, then the compositor capture endpoint.                                 | Join actual echo, render, submission, presentation, and capture timestamps. Any scheduler fix remains conditional. Low to medium instrumentation; product complexity unknown. |

No measured share or rank is assigned to these leads. The corrected baseline gaps alone cannot distinguish terminal CPU work from scheduling/capture phase differences.

## Reproduction

Build from the repository package directory on Linux, using the task's required resource limits:

```sh
export PATH=$HOME/.local/share/mise/shims:$PATH
nice -n 19 taskset -c 0-7 bun run bench:compare -- \
  --build-only --bundle /work/tmp/plan-283/bundle
```

Ship that portable bundle to `~/tmp/gw-bench/attribution-bundle` on the Mac using the comparison runner's established transfer procedure. Its `node_modules` points at the runner's already-installed pinned dependencies in `~/tmp/gw-bench/node_modules`. Use one fresh output directory per bounded window. On the Mac:

```sh
export PATH=$HOME/.local/share/mise/shims:$PATH
pmset -g batt | command grep 'AC Power' || { echo 'waiting for AC'; exit 1; }
cd ~/tmp/gw-bench/attribution-bundle
caffeinate -d -u -t 1800 node comparison-runner.mjs \
  --trace --trace-count 1 --trace-latency-samples 24 --display-awake \
  --output ../attribution-mac-m1-1
```

After display qualification is available, repeat in separate windows for counts 8 and 17. Stop and discard the window on `Mac display unavailable`; do not relax the refresh check to manufacture a completed matrix.

Narrow checks in the package directory:

```sh
export PATH=$HOME/.local/share/mise/shims:$PATH
nice -n 19 taskset -c 0-7 node --test \
  scripts/comparison-report.test.mjs scripts/comparison-trace.test.mjs
nice -n 19 taskset -c 0-7 bun run typecheck
```

The trace tests cover display rejection, exclusive category aggregation, terminal/frame isolation, object-identity ownership, fresh-output rejection, whole-window cleanup including an in-progress case, and trace-stream closure after CPU qualification failure.

## Phase 1 completion criteria still open

1. Qualified headed M1 traces at all three counts for ASCII, SGR, and input echo.
2. Whole-main-thread exclusive attribution and renderer/GPU process CPU, with measured profiler overhead.
3. Slow input and median write timelines joined to the correct renderer frame's presentation feedback and glyph capture, naming each missed boundary and its cause.
4. Steady-state per-terminal/per-frame counts and normalized pinned-xterm comparisons.
5. Ranked causes with measured shares, proposed fixes, and complexity for each of the three baseline targets.

Phase 2 product changes remain outside this work.
