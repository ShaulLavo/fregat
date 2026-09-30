# Explaining textbuffer benchmark differences

The timing suite answers how long an operation takes. The diagnostic suite identifies
which code executes, where CPU samples land, and which stacks allocate JavaScript objects.
It does not disable persistence, anchors, tombstones, normalization, or correctness checks.

## Run

From `packages/textbuffer`, after installing workspace dependencies:

```sh
bun run bench:profile:check
bun run bench:profile -- --profile standard
bun run bench:profile -- --profile standard --only random-insertions --repeats 24
bun run bench:profile -- --profile standard --only large-paste-delete --modes counters,gc
```

Results have their own unique directory under `bench/results/profile-*`. An explicit
`--output bench/results/my-investigation` must not already exist, preventing old traces
from being mistaken for a new run. `report.json` records completion status and provenance;
`report.md` is the human-readable summary. Keep the entire directory, including raw profiles.
A failed run can leave a partial JSON report with status `running`, never a complete report.

## Four independent passes

| Pass       | Build                        | What is measured                                                                                                                     | What is not claimed                                                            |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `counters` | Disposable instrumented copy | Function entries, loop iterations, path copies, buffer-array slots copied, line-index input units and typed-array capacity requested | Operation latency or total allocation bytes                                    |
| `cpu`      | Clean emitted library        | V8 CPU samples with self and inclusive stacks                                                                                        | Exact per-function time or an additive inclusive breakdown                     |
| `heap`     | Clean emitted library        | Sampled JS-heap allocation estimates, including objects subsequently collected                                                       | Exact bytes, retained memory, typed-array backing stores or native allocations |
| `gc`       | Clean emitted library        | GC performance entries overlapping each operation window                                                                             | Total allocator overhead or a causal attribution of every timing gap           |

Each engine/mode runs in a fresh process. A process performs the configured fresh-buffer
warmups, then repeats fresh workload states. CPU and heap sampling are never enabled
together. The counter collector is never imported by the normal timing worker. The
TypeScript parser used to generate probes is not loaded by the CPU, heap or GC workers.

Fixture creation, load/setup for non-load workloads, forced collections, and correctness
checks stay outside diagnostic windows. Only load workloads profile document creation.
The synchronous operation loop is shared with timing to avoid a different implementation
of edits, history retention or query consumption. Raw results still require the same exact
text/read, invariant, snapshot and anchor checks as the timing suite.

CPU capture uses a requested 100-microsecond sampling interval. Summary attribution includes
only samples with the shared `runOperations` frame. Startup, inspector protocol activity,
and GC samples without that frame are excluded and counted explicitly. A low sample-count
warning appears below 100 workload samples. Increase repetitions instead of trusting small
percentage differences. Raw `.cpuprofile` files retain all samples for inspection in DevTools.
V8 inlining can charge library work to adapter frames; that category is not a measurement
of independent adapter overhead.

Heap capture requests a 16-KiB sampling interval and includes allocations collected by both
minor and major GC. The requested flags must be accepted by the runtime; there is no silent
fallback to retained-only sampling. Summary filtering uses the same workload stack boundary.
Small allocations may receive no samples. `.heapprofile` files preserve the raw sampling tree.
Typed-array capacity/copy counters separately expose work invisible to JS-heap sampling;
they do not turn the sampled heap figure into an exact total-allocation measurement.

GC entries are delivered asynchronously. The worker flushes notifications after the workload,
then clips events to its recorded interval, excluding setup and validation collections.
GC timings come from their own clean-build pass, not from a heavily instrumented run.

## Probes and interpretation

`probes.mjs` parses emitted JavaScript and inserts counters into temporary copies under
`bench/.cache/`. It does not wrap exported functions, so internal recursion is visible too.
Production source and emitted-build hashes are checked before and after the complete run.
`probe-manifest.json` lists instrumented function locations, input hashes and output hashes.
Missing required probe targets or invalid generated JavaScript fail rather than silently
reporting zero work. Tests compare every smoke fixture against both clean and probed engines.

Singapore counters distinguish piece-tree path copies from reverse-index path copies and
replacement records. Buffer-store counters count logical array elements copied by page/tail
cloning, not V8 physical memory. Index counters record new input spans and capacity growth.
Native `indexOf` searches are not counted per scanned character: a loop iteration in that
path is a newline hit, while upstream's scan loop visits code units. Do not compare these
loop counts as equivalent low-level instructions.

The report includes final visible/invisible piece counts and depth. Read workloads also
record a second query pass on the same buffer, after validation, separately from the first
pass. This exposes fully warmed cache behavior; it is not labeled as a fresh/cold run.

Use three signals together: an unfavorable clean timing, a relevant CPU/allocation hotspot,
and the executed work that explains that hotspot. For example, many copied reverse-index
nodes establish write amplification, but do not prove all of the edit-time gap is due to
persistence. Likewise, an offset-range adapter doing two position conversions is an API
cost, not evidence that its internal substring extraction is intrinsically slower.
No ablation removes anchor or snapshot guarantees merely to improve a benchmark number.

## Reproduction and limits

The report retains fixture hashes, engine/build/harness identities, compiler, Node/V8 and
CPU metadata, the seed, modes and repetitions. Raw profiles are specific to those emitted
files; rerun after code changes. Timings printed by diagnostic workers are explicitly marked
`diagnosticOnly` and never enter the normal speed-ratio tables. Rerun clean timings under the
same runtime and fixtures before attributing a performance change to an optimization.

Node documentation: [Inspector](https://nodejs.org/api/inspector.html),
[GC performance entries](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html).
Allocation-sampling flags are part of the V8 inspector HeapProfiler protocol.
