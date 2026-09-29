# Singapore vs vscode-textbuffer

A reproducible Node comparison of the extracted textbuffer and Microsoft's standalone library.
This does not benchmark full Monaco, current VS Code, a renderer, or browser input-to-paint latency.
No production tree algorithms, tombstones, anchors or line-ending policies are changed here.

## Run

From `packages/textbuffer`, after `bun install` at the workspace root:

```sh
bun run bench:check
bun run bench -- --profile smoke
bun run bench -- --profile standard
bun run bench -- --profile standard --seed 7 --samples 15 --output bench/results/seed-7.json
bun run bench -- --only random-replacements,ranges-after-churn --samples 3
```

`bench:check` builds the package, fetches/builds the pinned control and runs Vitest adapter/oracle tests.
`bench` also rebuilds both implementations, even when invoked directly as `node bench/run.mjs`.
Timing runs use native Node child processes, not Bun's JavaScript engine. Node 24 is used in CI.
The first preparation needs access to raw.githubusercontent.com; subsequent runs reuse source only
after verifying each pinned Git blob hash. Compiled output is rebuilt, never trusted from cache.
No upstream npm dependencies or lifecycle scripts are installed or executed.

The package remains independently usable outside the monorepo. Benchmark code uses its package exports,
not editor-local aliases, shims or a copied Singapore implementation. There are no new runtime dependencies.
The downloaded Microsoft source and its unchanged MIT license stay in the ignored `bench/.cache` directory.
See [upstream.json](upstream.json) for the exact repository commit and all source blob identities.
The source revision is deliberately pinned; this is not a moving claim about VS Code's latest internals.

## Measurement contract

- Inputs are decoded, LF-normalized JavaScript strings with no leading BOM. All mutation boundaries
  are valid code-point boundaries; offsets and columns count UTF-16 code units, not bytes or graphemes.
  Read queries may address any UTF-16 boundary. CRLF, lone CR, BOM and unusual terminators are covered
  by normalization/adapter tests, not silently included in one engine's edit timing.
- The same pre-generated serialized fixture and SHA-256 are handed to both engines. The independent
  plain-string model generates final text, line/position answers and historical-text hashes.
  No random generation, string oracle, sorting of results, correctness assertion, process startup,
  compilation, dependency fetching or forced GC happens inside the timer.
- A sample is one complete workload in a fresh Node process. Standard mode uses 9 samples, each with
  2 fresh-buffer warmups. Pair order alternates by sample and workload. Setup edits for read workloads
  are outside the timer; their resulting structure and retained memory remain part of the sample.
- Natural garbage collection during the operation loop is included. Forced collections before/after
  the region stabilize retained-memory measurements but are not editing latency. There is no per-edit
  stopwatch. Reported p95 is nearest-rank p95 of whole-workload times, not p95 of individual edits.
  With 9 samples it is the maximum; use larger sample counts before drawing tail-latency conclusions.
- Timed reads consume lengths and sampled characters/positions. Exact query contents are checked
  outside the timer, so a checksum collision cannot hide incorrect reads. Every sample also checks
  final text, UTF-16 length and line count. Singapore's tree invariants are checked outside timing.
- Source/build/harness hashes, compiler, Node/V8, CPU, OS, flags, seed, fixture sizes, sample order and
  raw per-sample measurements are recorded in JSON. A source/build change during a run is an error.
  A missing Git checkout is reported as unavailable rather than inventing a commit; hashes still work.

## Workloads and adapter costs

Shared workloads cover load (short lines and a long line), sequential typing, the same typing with
a caret-to-position lookup after every keystroke, random insertions, random replacements,
eight-cursor batches, mixed edit churn, large paste/delete cycles, sequential and random line reads
after churn, offset-range reads, full reads, both position conversions, and random replacements
of an ASCII-only document, which no edit checks for a cut surrogate pair.
Standard fixtures contain 10,000 Unicode-rich lines, 1,500 edits and 3,000 read queries. Load fixtures
are larger. Paste/delete repeats 16 roughly 256-Ki-code-unit pastes. Exact sizes are recorded per case.
These are synthetic traces, not captured user sessions; change seeds and repeat on target machines.

The adapters express the same user-observable operations, not necessarily identical primitive calls:

| Operation              | Singapore                                 | vscode-textbuffer                                                            |
| ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| Load                   | `createPieceTableSnapshot`                | Builder + factory, LF mode                                                   |
| Replacement            | `applyBatchToPieceTable` with one edit    | delete, then mutable insert                                                  |
| Batch                  | `applyBatchToPieceTable`                  | Descending-offset loop of delete/insert; no equivalent native batch API here |
| Line read              | `readPieceTableLine`                      | `getLineContent`                                                             |
| Offset-range/full read | Native offset-based range/materialization | Two `getPositionAt` calls + `getValueInRange`                                |
| Coordinates            | Zero-based Point API                      | One-based API translated to zero-based                                       |

Those adapter costs are included and intentional. In particular, the offset-range result cannot be
attributed exclusively to tree traversal because the VS Code API needs position conversion. Likewise,
Singapore's `readPieceTableLine` finds the row in one descent but keeps no cache of the last line. Do not present the comparison
as equal primitive counts, equal caching, or equal semantics for capabilities one side does not offer.
Original input is delivered as one string chunk to both constructors; streaming ingestion is not measured.

## Persistence, anchors and memory

`persistent-history`, `branch-edits`, `anchor-resolution-after-churn` and `anchor-density` are
Singapore-only lanes, never assigned a VS Code speed ratio. The branch lane applies one insert on each of 64 branches from the
same churned root; every branch after the first forks the shared buffer log, which is the copy the
`fork.copiedArraySlots` counter budgets. Microsoft's read snapshots are not persistent editable versions. The history lane
retains up to 64 roots while executing the churn trace, verifies every retained text hash, and checks
restoring/editing an old branch after timing. Retaining a root is included; restoration is a correctness
check, not a measured branch-edit benchmark. The anchor lane retains original anchors, applies churn,
then times indexed resolution. Its reference is Singapore's separate linear traversal, explicitly not
an independent reimplementation of all anchor semantics; fixed deletion/bias/restore cases add checks.
The density lane is what decorations do: 500 anchors, all resolved after each of 300 edits. Its edits
never delete the unit an anchor holds on to, so every anchor stays live and the plain-string model
decides every offset; the digest of all 150,000 resolutions is checked against it.

Every workload reports post-GC process memory deltas before oracle validation. The baseline is the
warmed process with parsed fixtures but before constructing the measured buffer. The result includes
initial storage, setup/churn structures, retained versions and caches. It is not allocation volume,
peak heap, GC pause attribution, nor a precise per-node size. JS string sharing and JIT/allocator noise
matter; negative deltas must remain visible. `arrayBuffers` is already part of `external` and must not
be double-counted. RSS is recorded in raw data, not treated as exact buffer ownership.

The active churn and paste/delete cases deliberately retain Singapore's current tombstone behavior.
Do not drop tombstones, disable persistence, or clear caches selectively to manufacture a faster result.
There is no overall composite score and no timing threshold in CI. Correctness failures fail the job;
performance results are artifacts for review, not a noisy merge gate. Smoke is correctness-only.

## Explain the differences

The [profiling contract](PROFILING.md) describes four independent diagnostic passes: CPU sampling,
JS-heap allocation sampling, GC events, and structural work counters. These do not enter the clean
speed-ratio tables. The [initial attribution report](ATTRIBUTION.md) records measured findings and
optimization candidates without changing buffer semantics.

```sh
bun run bench:profile:check
bun run bench:profile -- --profile standard
bun run bench:profile -- --profile standard --only random-insertions --repeats 24
```

## Counter budgets

[budgets.json](budgets.json) holds a ceiling per workload for every structural counter, for the
smoke and standard profiles at one fixed seed. `bench:check` replays each workload in the
instrumented build and fails when a count exceeds its ceiling, when a budget names a counter that
no longer exists, or when a structural counter has no budget. Counts are exact events, so the gate
is deterministic where a timing threshold is not. Lower the ceilings in the same commit as the
change that earns them; regenerate them only after a deliberate change in the measured work.

```sh
node bench/budgets.mjs
node bench/budgets.mjs --write --margin 0.02
```

## Tree shape

The [tree height replay](HEIGHT.md) samples height, depth and piece counts of both engines' trees across
edit traces and Singapore priority seeds. It is a separate structural replay with no timing.

```sh
bun run bench:height -- --profile standard
```

## Next measurements

Captured editor traces, browser-engine runs, longer sessions, native-coordinate range controls and
multiple document sizes remain follow-ups. A favorable cell is not proof that Singapore is globally
faster. Performance claims must identify the tested revision, runtime and fixture.
