# E031 display projection measurements

The 500,000-line E001 fixture retains 52 display rows and 2,152 bytes of row text in its first
40-row viewport with overscan. The eager control retains 500,000 rows and 24,668,130 bytes of row
text. The projection stores plain lines in one sequence entry. A top-of-file newline changes one
entry and reads only the new viewport's text, with no unchanged suffix row replacements.

[`DisplayProjection`](../../packages/editor/src/virtualization/displayProjection.ts) owns each
view's immutable snapshot and layout revision. Source-relative plain runs and compact wrap blocks
provide indexed geometry. Edits splice affected source ranges through the `{ before, after, edits }`
transition. Rendering materializes bounded row windows from that same revision. The
[display transform contract](../display/transforms.md) describes coordinates, transform summaries,
cache ownership, and explicit full-text export boundaries.

These measurements ran on an Intel Core i7-14700K with Bun 1.4.0, Node 26.7.0, and Chromium
148.0.7778.96. The eager source is commit `ff1dfeda9e52b308f57915da7372f7ac6e5f04f9`.
Browser results record the source hash and frozen package path used by each run. The final input
gate uses source hash `75c50664ed249aac317237d1172e5993974d57766d416e69fb1757e31dd133e3`.
First-paint and E001 use the earlier built source hash
`b9dea046e7b96362e71a88277f64fcaf202b1439fdb54ab78203ec8628008dc7`. Subsequent changes fix
inline caret mapping, folded decorations after edits, distant inline widget widths, and suggestion
selection synchronization. Focused browser and DOM checks cover those paths on the final source.
The first-paint and E001 fixtures do not exercise those inline and fold cases, so their earlier
measurements are retained separately from the final input gate.

The happy-dom table measures real view operations with numeric diagnostics enabled. Each cell
is one local sample, so the values show the scale of the change and do not establish a timing
budget. Fixture generation, piece snapshot construction, and inspection of retained eager rows
happen outside the timed operation. Cold open includes layout construction and the first window.

| Source lines | Operation              | Eager ms | Projection ms |
| ------------ | ---------------------- | -------: | ------------: |
| 100,000      | cold-open-first-window |    53.60 |          4.89 |
| 100,000      | top-newline-edit       |     6.27 |          1.32 |
| 100,000      | wrap-enable            |    53.50 |          9.77 |
| 100,000      | wrap-resize            |   138.64 |         11.88 |
| 500,000      | cold-open-first-window |   158.95 |          7.98 |
| 500,000      | top-newline-edit       |    50.08 |          0.79 |
| 500,000      | wrap-enable            |   232.58 |         38.21 |
| 500,000      | wrap-resize            |   714.36 |         35.33 |

Text byte counters use two bytes per UTF-16 code unit. They count requested range payloads,
including repeated reads. Retained text counters describe payload size, excluding engine object
headers, string deduplication, and immutable source storage. `summaryBytes` estimates index
metadata and typed array storage; it is not a measured heap size. The E001 browser artifacts
record actual renderer heap measurements separately.

In these E031 measurements, a cold plain view built the source buffer's newline index. The 500,000-line fixture scans
25,668,128 UTF-16 bytes once and retains a 2,097,152-byte newline array capacity. New layouts and
distant windows reuse that source index. Inserting `x\n` needs four bytes of new-buffer indexing.
The row text read is 2,152 bytes for the first viewport and 2,112 bytes after the top edit.

[E034](e034-snapshot-indentation-folds.md) now builds the original index during buffer creation,
using its count instead of scanning newlines separately. Initial painting reuses that index;
headless buffers retain its offset storage earlier. The E031 measurements above remain historical.

The eager control's full-read counter stays at zero while it reads and retains every line.
That control demonstrates why full-read counts alone cannot establish bounded work. The capture
also observes 499,999 replaced suffix row identities after the top newline. Production projection
counters report one touched sequence entry for the same edit.

Exact wrapping still inspects document text. Wrap summaries use blocks of up to 256 source lines,
with typed row prefixes and tab checkpoints. The 500,000-line E001 fixture retains about 2.3 MB
of summaries. The separate tabbed, folded 500,000-line transform fixture retains about 6.8 MB.
These scans use bounded text reads and preserve exact projected row counts. Width changes repeat
summary work; cold metric work is reported independently from row and string retention.

The row cache has a 256-row and 1 MiB text-payload ceiling. Viewport changes evict the previous
window. A sweep through 100 distant windows finishes with 52 cached rows. Plain geometry lookups
read no row text. Long-line rendering retains range-backed text. The
[long-line browser tests](../../packages/editor/test/longLineMeasurements.browser.test.ts)
assert source reads of at most 4,096 UTF-16 code units and fewer than 2,048 mounted code units.
They also cover graphemes and ranged inline content, including distant widget geometry. The
separate [BiDi browser tests](../../packages/editor/test/bidiGeometry.browser.test.ts) pass all
108 cases.

The first-paint and E001 browser runs use built package exports through Playwright request
routing. They open no listening server. Each uses one measured repetition after a warmup.
First-paint checks include direct and prepared attachment, plain rendering and Tree-sitter,
and cold and warm contexts. All 16 first-paint samples pass their correctness checks. E001 checks
open, jump, input, search, scroll, and edit churn across all five fixtures, with all 60 samples
correct. Screenshot completion remains an upper bound on paint latency.

The paired one-repetition input files retain all 36 fixture, view, and input groups. The separate
three-repetition input gate compares against the existing unchanged controls and calibration,
with the same browser, hardware, runtime, and workload. No calibrated limit is changed.
The gate passes all 108 blocking metric comparisons without changing any limit. It contains
108 measured samples across 36 fixture, view, and input groups. Two of the 36 advisory screenshot
upper-bound comparisons exceed their calibrated limits for the ordinary fixture with multiple
views. Typing has a 151.0 ms p95 against 138.5 ms, and composition commit has 134.3 ms against
120.2 ms. These measurements include screenshot completion and remain advisory under the existing
gate policy. They are retained in the comparison artifact; no limit was adjusted.

The final checks also cover actual DOM caret and pointer geometry, selection, IME, undo and redo,
folds, inline replacements, visible snapshots, hidden views, and shared views. A mouse-selection
test now waits for mounted rows before dragging. The old eager source reproduces its previous
ResizeObserver race when the test sends input with a zero-width viewport.

Raw measurements accompany this report:

- [Original transform and virtualization benches](e031-legacy-benches-before.json)
- [Eager row and source counters](e031-eager-baseline.json)
- [Projection view counters](e031-virtualization-after.json)
- [Projection transform counters](e031-transforms-after.jsonl)
- [First-paint before](e031-first-paint-before.json) and [after](e031-first-paint-after.json)
- [E001 before](e031-stress-before.json.gz) and [after](e031-stress-after.json.gz)
- [Paired input before](e031-input-before.json.gz) and [after](e031-input-after.json.gz)
- [Final input gate](e031-input-gate-after.json.gz) and [comparison](e031-input-gate-comparison.json)

The updated source benchmarks run from `packages/editor`:

```sh
bun run bench:transforms
bun run bench:virtualization
```

`bench:transforms` separates cold source indexing, summary construction, first-window
materialization, 100 distant windows, and a top newline transition. `bench:virtualization`
exercises the actual view and disposal. Both enforce cache limits. The transform benchmark also
rejects source text reads and unbounded sequence work during a local plain edit.

The eager control is reproducible from a frozen source copy. From the repository root:

```sh
mkdir -p /work/tmp/e031-control
git archive ff1dfeda9e52b308f57915da7372f7ac6e5f04f9 packages/editor/src packages/editor/package.json | tar -x -C /work/tmp/e031-control
ln -s /work/projects/Editor/packages/editor/node_modules /work/tmp/e031-control/node_modules
bun packages/editor/bench/captureEagerProjection.mjs --core-directory /work/tmp/e031-control/packages/editor --output /work/tmp/e031-eager.json
```

The browser runners accept `--core-directory` for frozen packages with matching `src` and `dist`.
The recorded runs used these commands from `examples/stress`:

```sh
node first-paint.mjs --core-directory /work/tmp/e031-accepted/packages/editor --repetitions 1 --output /work/tmp/e031-first-paint.json
node run.mjs --core-directory /work/tmp/e031-accepted/packages/editor --repetitions 1 --warmups 1 --output /work/tmp/e031-stress.json.gz
node run.mjs --suite input-latency --core-directory /work/tmp/e031-final-gate/packages/editor --repetitions 3 --warmups 1 --output /work/tmp/e031-input.json.gz
node input-compare.mjs check results/input-latency/control-1.json.gz /work/tmp/e031-input.json.gz results/input-latency/calibration.json.gz
```
