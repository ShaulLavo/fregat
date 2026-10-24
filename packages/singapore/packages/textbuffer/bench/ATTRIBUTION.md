# Initial textbuffer cost attribution

## Evidence and scope

Recorded 2026-09-16 from the [successful hosted diagnostic run](https://github.com/ShaulLavo/singapore/actions/runs/35103149296).
The [raw artifact](https://github.com/ShaulLavo/singapore/actions/runs/35103149296/artifacts/10449316899)
contains clean timings, `report.json`, raw CPU/heap profiles, probe manifests, source and formatting patch.
The checked-out revision was `71f31c492a826567b8f2ec1e9515d5594c6a1747`; seven benchmark files
were formatted before execution. The exact executed source/build/harness hashes are recorded.
Commit `0224f392fee2b1648b2ab5e7c3b0a6b16086b0d0` subsequently commits that formatting and
removes the completed helper. This report does not claim the initial working tree was clean.

Runtime: Node 24.20.0, V8 13.6.233.17-node.53, TypeScript 6.0.3, Linux x64, AMD EPYC 7763.
Control: `microsoft/vscode-textbuffer` at `fdca8848ba80c9421cce1894bc32851e1730bc88`.
Fixture profile `standard`, seed `20260916`: 12 fresh-state replays per CPU/heap/GC mode,
one structural-counter replay per engine/workload. All 16 workloads completed their checks.
No production buffer source, persistence, tombstone, anchor or LF behavior changed.

These are observed hotspots and executed work, not a causal decomposition of a speed ratio.
CPU shares count samples, not exact elapsed time. Allocation figures are average sampled
JS-heap estimates per replay, including objects later collected, not retained memory or total
allocations including native/typed-array backing storage. See [the contract](PROFILING.md).

## Small edits: two persistent structures and backing-store copies

For 1,500 random insertions, the Singapore counter pass records:

- 50,845 piece-tree node copies, about 33.9 per insertion.
- 91,651 reverse-index node copies, about 61.1 per insertion.
- 640,302 logical array slots copied by the paged buffer store, about 426.9 per insertion.
- 3,000 surrogate-boundary checks and corresponding tiny range reads.

Singapore's 1,419 in-workload CPU samples split into piece tree 40.9%, reverse index 20.6%,
edit preparation/boundary policy 19.7%, buffer store/line index 14.9%, and other 3.8%.
Sampled JS-heap allocation is 38.30 MiB per replay versus 3.46 MiB for the control.
The separate GC pass records a median 1.276 ms per replay for Singapore and no overlapping
GC events for the control. Zero observed events does not mean allocation was free.

Replacing 1,500 ranges raises those copy counts to 105,907 tree nodes and 187,587 reverse-index
nodes. Estimated JS-heap allocations rise to 62.30 MiB versus 2.66 MiB. The measured adapter
implements each replacement as delete followed by insert, so both maintenance paths run.

The final insertion trees contain the same 2,996 visible pieces and no tombstones; depths are
25 for Singapore and 14 for the control. Thus tombstone accumulation cannot explain this
insertion-only gap. Replacements do retain 1,520 invisible Singapore pieces, alongside 2,917
visible pieces, so their traversal/retention costs are a separate factor worth measuring.

Interpretation: repeated structural copying, buffer-store copying and edit preparation are
concrete sources of extra work. The measurements do not establish that all of this work is
unavoidable, or that removing persistent versions or anchors is an acceptable optimization.

## Sequential typing: tiny boundary reads are an allocation hotspot

Coalescing works: both final trees contain only three pieces. Singapore still executes two
surrogate checks per insertion, each using the generic range-read path. That path allocates a
chunk array, traverses the tree, slices text and joins the result for a two-code-unit probe.

`collectTextInRange` accounts for 53.6% of Singapore's sampled self-allocation estimate in this
workload. Total estimated JS-heap allocations are 9.24 MiB versus 1.66 MiB for the control.
This is allocation attribution, not a claim that the function consumes 53.6% of typing time.

First optimization candidate: a specialized code-unit/boundary lookup that avoids constructing
a tiny string, and avoiding duplicate checks where the semantics allow it. Keep surrogate
safety, snapshot immutability and the existing repair behavior; prove equivalence with tests.

## Loading and bulk paste: different scanning paths

The short-line load contains 1,520,000 code units and 40,000 newlines. Both engines index the
whole input. Singapore's newline-search loop iterates 40,000 times; the control's JavaScript
line-start scanner iterates 1,520,000 times. Native string searches still scan input, so these
are not equivalent instruction counts and do not mean Singapore reads fewer characters.

The control places 99.4% of its 545 workload CPU samples in its buffer/index category.
Singapore spends 66.7% of its 234 samples in line-ending detection/normalization and 32.1% in
buffer/index work. This supports investigating scanning implementation, not tree balancing,
as the source of the load difference. Both final trees have a single piece.

Estimated JS-heap allocations are about 0.02 MiB for Singapore versus 1.17 MiB for the control.
However, Singapore requests 524,032 bytes of typed-array capacity across geometric growth,
versus 160,004 bytes for the control. These capacities are not included in the JS-heap figures;
the apparently smaller JS allocation number must not be presented as total memory usage.

In the 32-operation large paste/delete replay, estimated JS-heap allocations are 1.53 MiB
versus 14.94 MiB. Buffer/index work holds 86.4% of Singapore's CPU samples and 99.4% of the
control's. This is another scanning/allocation hotspot, not evidence of a universal edit win.

## Reads: API work and traversal explain different directions

For 3,000 random line reads after churn, Singapore performs 6,000 line-start lookups plus
3,000 range reads. The control uses its dedicated `getLineContent` 3,000 times, with just one
cached-line hit. Repeated identical-line cache hits therefore do not explain that random-line
result. Singapore's position-lookup CPU category accounts for 46.4% of its 336 samples.
A dedicated line-read traversal is a candidate; the current adapter does more boundary work.

For 3,000 offset-range reads, the control adapter executes 6,000 `getPositionAt` calls before
its range reads. Singapore reads offset ranges directly. This is a real API-level conversion
cost in the measured task, not proof that the control's internal substring primitive is slower.
Add a native-coordinate control before making claims about substring extraction alone.

The diagnostic JSON also records same-buffer query counters after validation, separately from
the first pass. This reveals warmed-cache differences without hiding setup in a timing table.

## Next experiments, not runtime changes in this PR

Start with nonallocating surrogate probes, then inspect per-edit reverse-index path copying
and buffer-store page copying, and finally dedicated line reads. Run one semantics-preserving
change at a time against the same clean fixtures, with historical snapshots and deleted-anchor
bias tests intact. Retain raw profiles and compare multiple seeds and document sizes.

GC is measured separately from CPU and allocation sampling. Observed GC duration alone does
not account for allocator work, copying, cache locality or the whole latency gap. Structural
counters are exact events in the instrumented copy, not timings or unique-node counts.
No optimization, new performance guarantee, or relaxed correctness gate is implied here.
