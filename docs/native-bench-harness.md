# Native Bench Harness — Plan 1

**Status:** done. `swift run -c release EditorBench` prints the baseline table with an empty native column, and the `os_signpost` → `xctrace` → `analyze_trace.py` pipeline is verified end to end on this machine.

This is the instrument that gates every later native editor plan. The doctrine it enforces: **no native editor decision is defended with a claim, only with a row in this table**. The native column is empty today and that is the correct output — it fills in as each plan lands the path it owns, and the gate is passed when every row it fills reads `pass`.

The harness lives in `apps/mac/Sources/EditorBench`; the keystroke instrument it defines lives in `apps/mac/Sources/EditorCore/LatencySignpost.swift` because the editor surface is what will emit it.

---

## 1. The rule

A native path ships when it meets or beats the web editor's number **for the same work on the same machine**. Three things make that checkable rather than rhetorical, and all three are the point of this document:

1. Every baseline names the corpus, the statistic, and the code that produced it (§2, §4).
2. Every baseline carries a **provenance tier** — a number nobody can re-run is a memory, not a baseline (§3).
3. The native measurement is defined precisely enough to be wrong (§6), including where its clock starts and stops.

---

## 2. The web harness, as it actually works

Two harnesses of different shapes, and they answer different questions. Conflating them is how "5.8 ms typing" turns into folklore.

### 2.1 Bun microbenches — `editor/packages/*/bench/*.ts`

Plain scripts, run by name (`bun run bench:piece-table`). Conventions worth porting, and ported:

- `performance.now()` around a batch; explicit `WARMUP_BATCHES` / `WARMUP_ITERATIONS` discarded, never averaged in.
- Deterministic corpora from a seeded LCG (`state = state * 1664525 + 1013904223`), so two runs benchmark the identical document. `Corpus.swift` uses the same constants.
- Self-asserting: `pieceTable-insertions.ts` throws if the growth ratio exceeds 4x, `foldMap.ts` if the average round trip exceeds 0.5 ms. A bench that only prints is a bench nobody notices regressing.
- Output is a labelled block of `%.4f ms` lines, not a chart.

They measure **storage and projection paths**, not what a user feels. `performance-baseline.md` says so itself: the typing row is "covered by the insertion bench as a storage-path proxy; a DOM typing harness is still needed."

### 2.2 Playwright interaction benches — `apps/web/scripts/editor-{typing,scroll}-benchmark.mjs`

These measure what a user feels, in a real browser, against the real app.

**A "typing iteration" is defined exactly as:**

- Setup: seed the v19 workspace cache with one open editor tab, load the app at `?editorPerfTrace=1`, wait for `.editor-virtualized-row`, a non-empty CSS highlight, `document.fonts.ready`, and two rAFs. The gate corpus is the default `apps/web/src/features/editor/components/editor.tsx` (232 lines, 7,289 bytes). Click row 20 at x=40, then press `End`.
- Input: `page.keyboard.type('abcdefghijklmnopqrstuvwxyz0123456789abcd')` — 40 keys. `steady` uses `delay: 40` ms; `burst` uses `delay: 0`.
- **Clock start:** the `keydown` event's `event.timeStamp`, captured in a capture-phase listener on `window`.
- **Clock stop:** the timestamp of the **first `requestAnimationFrame` callback that runs after that keydown**.
- Latency = stop − start, per key. Reported as p50 / p95 / max over 40 keys, averaged across 3 trials.
- A second, independent number comes from the in-page diagnostics sink: `editor.view.applyEdit` mean/max, from `window.__editorPerfTrace.report().topDiagnostics`.
- Guards: a missing mounted row throws a cache-schema error, and fewer than 40 applied edits throws a focus error. Neither failure can become a fast, meaningless number.

**This is not keystroke-to-photon.** It ends at the rAF callback — before style, layout, paint, composite, and scanout. It is the cheapest honest proxy the web platform offers, and it systematically _under_-reports by roughly one frame of pipeline. §6.1 says what the native equivalent measures instead, and why the two are still comparable.

**A "scroll iteration"** is: `scroller.scrollTop += 36`, dispatch a synthetic `scroll` event, await one rAF — 80 times. Frame durations come from a free-running rAF loop inside `performance-trace.ts` (`frameStats.meanMs/maxMs`, `slowFrames` ≥ 16.7 ms, `longFrames` ≥ 50 ms). Note this drives the _scroll handler and render path_, not the compositor — a real wheel gesture behaves differently, which is why the 7 fps wheel trace of 2026-08-15 found problems this bench did not.

### 2.3 Chromium launch contract

`launchOptions()` uses `channel: 'chromium'` with `--disable-frame-rate-limit --disable-gpu-vsync`. Both flags are part of the checked-in command:

- The default Playwright **headless shell** stalls its frame pipeline under sustained editor repaint. That historical comparison had no CPU calibration; the `chromium` channel remains the reproducible launch target.
- The free-running scroll loop is uncapped: the repaired gate measured a 4.05 ms median on this 60 Hz machine at 81.33 ms CPU calibration. Typing still measures the first callback after each keydown, so browser scheduling remains part of that user-facing number. The independent `editor.view.applyEdit` guard keeps slow editor work visible.

### 2.4 Calibration and drift

Every trial reports `meanCpuCalibrationMs` — a fixed 20M-iteration integer loop timed in-page immediately before sampling (81–83 ms in the final repaired interaction pair). It exists because **this machine's tail latencies inflate roughly 2x after an hour of heavy benching**. The rules that follow from that are in §8, and they are not optional.

`--cpu-throttle=N` applies CDP `Emulation.setCPUThrottlingRate` _after_ the editor is ready, so only the measured interaction runs degraded. Measured June 2026: degradation is uniform scaling, no queueing or GC pathology.

---

## 3. Provenance — three tiers

`EditorBench` tags every row. The tier is the honest part of the table.

| Tier                   | Means                                                                                                   | Worth                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **[1] re-runnable**    | Checked-in command, corpus, statistic, and a dated result with CPU calibration.                         | Strongest evidence. A later run can reproduce the work and explain a changed result.    |
| **[2] live gate only** | A checked-in threshold and command without a current calibrated result.                                 | Enforces a ceiling, but does not establish what the current implementation costs.       |
| **[3] session record** | Measured and dated in a working session; methodology known; no checked-in command reproduces the value. | Real, provisional. Never quote one as settled without saying which session produced it. |

**The 5.8 ms figure remains tier 3.** It comes from the June 12 2026 typing-latency work: typing on a 1M-line file in Chromium went from ~90 ms to **4.4–5.7 ms p50, 6–9 ms p95** after three fixes. Its CPU calibration was not recorded. The related viewport-highlight and wheel-scroll figures also lack calibration and remain historical context, not §8 results.

Tier 3 numbers are in the table because they are the real bar. They are marked tier 3 so nobody mistakes them for something they can re-run.

---

## 4. The baseline table

`EditorBench` is the authority; this is the same data with the methodology attached. The repaired interaction rows were measured on **2026-08-28, Apple M1 (4P+4E), 16 GiB, macOS 26.4, Bun 1.4.0, Playwright 1.60.0 / Chromium 148.0.7778.96**, against the current linked `../Editor` working tree (base `b091996`). The B2/B3 rows use a clean `b091996` checkout. Values that satisfy §8 carry their CPU calibration in the table; inherited values without one are labelled historical.

### 4.1 Interaction — what the user feels

| metric                   | corpus                                          | stat                    | web                 | CPU calibration | tier | how                                 |
| ------------------------ | ----------------------------------------------- | ----------------------- | ------------------- | --------------- | ---- | ----------------------------------- |
| `typing.steady.p50`      | default 232-line TSX, Chromium, 40 ms key delay | mean of 3 trial p50s    | **20.47 ms**        | 82.73 ms        | 1    | keydown → next rAF (§2.2)           |
| `typing.steady.p95`      | same                                            | mean of 3 trial p95s    | **23.90 ms**        | 82.73 ms        | 1    | max trial p95 25.50 ms; gate 30 ms  |
| `typing.burst.p95`       | same, no inter-key delay                        | mean of 3 trial p95s    | **21.90 ms**        | 82.73 ms        | 1    | max trial p95 27.80 ms; gate 30 ms  |
| `typing.applyEdit.mean`  | `editor.view.applyEdit` diagnostic              | mean, steady / burst    | **0.51 / 0.42 ms**  | 82.73 ms        | 1    | independent edit-work gate ≤ 3 ms   |
| `scroll.frame.mean`      | default 232-line TSX, 80 steps × 36 px          | median of 3 trial means | **4.05 ms**         | 81.33 ms        | 1    | gate ≤ 10 ms                        |
| `scroll.frame.max`       | same                                            | mean of 3 trial maxima  | **17.90 ms**        | 81.33 ms        | 1    | no long frames                      |
| `highlight.viewport.p50` | tree-sitter viewport query, ~960 tokens         | p50                     | 0.2 ms (historical) | not recorded    | 3    | Aug 22 2026 worker-boundary session |
| `highlight.viewport.p95` | tree-sitter viewport query, 50K-line doc        | p95                     | 6 ms (historical)   | not recorded    | 3    | same                                |

### 4.2 Document — the paths the port reimplements

| metric                          | corpus                                   | web (2026-05-24; no calibration) | web (paired repair run)   | CPU calibration | reproduce                                                |
| ------------------------------- | ---------------------------------------- | -------------------------------- | ------------------------- | --------------- | -------------------------------------------------------- |
| `piecetable.insert.append`      | 2,000 × 1 KiB appends                    | 0.0048 ms/ins                    | **0.0038 ms/ins**         | 85.99 ms        | `cd editor/packages/editor && bun run bench:piece-table` |
| `piecetable.insert.growth`      | last 3 / first 3 batches                 | 0.64x                            | 0.55x                     | 85.99 ms        | same                                                     |
| `piecetable.walk.sequential`    | 30.7K chars, 3,856 pieces                | —                                | 0.2587 ms (historical)    | not recorded    | `bun run bench:walker`                                   |
| `piecetable.seek.random`        | 5,000 seeks + 64-char reads              | —                                | 3.2545 ms (historical)    | not recorded    | same                                                     |
| `piecetable.snapshot.build`     | 100K lines, incremental index            | —                                | 72.0484 ms (historical)   | not recorded    | `bun run bench:anchors`                                  |
| `piecetable.anchor.resolve`     | 100K lines, 1,089 anchors                | —                                | 0.0003 ms (historical)    | not recorded    | same                                                     |
| `foldmap.create`                | 100K lines, 100 folds                    | 6.8320 ms                        | 6.6460 ms (historical)    | not recorded    | `bun run bench:fold-map`                                 |
| `foldmap.roundtrip.p95`         | 100 points, 1,000 iterations             | 0.1229 ms                        | 0.0556 ms (historical)    | not recorded    | same                                                     |
| `virtualization.mount.large`    | 100K lines, 44 mounted rows              | 45.2990 ms                       | **53.476 ms**             | 85.99 ms        | `bun run bench:virtualization`                           |
| `virtualization.mount.longline` | 50K-char line                            | 2.9140 ms                        | **2.016 ms**              | 85.99 ms        | same                                                     |
| `syntax.edit.total.10k`         | TypeScript 10K lines, parse + query      | 145.3300 ms                      | 115.6800 ms (historical)  | not recorded    | `cd editor/packages/tree-sitter && bun run bench:syntax` |
| `syntax.edit.parse.100k`        | TypeScript 100K lines, incremental parse | —                                | 8.7200 ms (historical)    | not recorded    | same                                                     |
| `syntax.edit.total.100k`        | TypeScript 100K lines, parse + query     | 1732.8900 ms                     | 1183.6000 ms (historical) | not recorded    | same                                                     |
| `minimap.update.mean`           | 100K lines, 50 renderer patches          | 0.7487 ms                        | **0.6178 ms**             | 85.71 ms        | `cd editor/packages/minimap && bun run bench:update`     |
| `minimap.update.p95`            | same                                     | —                                | **1.1431 ms**             | 85.71 ms        | same                                                     |

The repaired rows establish three different causes:

- **B2 was a machine-session outlier, not a Bun or code regression.** On the same clean checkout, interleaved Bun 1.3.10 and 1.4.0 runs both had a 0.0038 ms/insertion median, at mean CPU calibrations 84.18 and 85.99 ms. At Bun 1.3.10, the baseline and current commits measured 0.0041 ms/insertion at 84.26 ms calibration and 0.0042 ms/insertion at 83.99 ms calibration. The earlier uncalibrated 0.0098 ms sample is discarded.
- **B3 is a code regression.** Bun 1.3.10 and 1.4.0 produced 53.707 and 53.476 ms medians on the same checkout, at 84.18 and 85.99 ms calibration. The recorded bisect range was good `dc564ab463629e8e0326157613afb13941f74d51` and bad `b09199679c680255aa07c0c2c70ae77895023ad5`. It names `cca9a0b3da3a70162edf62ddd9e606cb2afd7aa3` (`feat(editor): anchor-backed inline replacements, markdown and decode packages`) as first bad: its parent measured 33.525 ms against a 30.890 ms control at 83.695/83.745 ms calibration; the commit measured 56.195 ms against a 33.118 ms control at 83.555/83.900 ms calibration. Long-line mount improved across the same boundary, from 2.120 ms at 83.695 ms calibration to 1.529 ms at 83.555 ms calibration, confirming a path-specific regression rather than uniform slowdown. This session does not fix it; the plan-of-plans carries a separate repair entry.
- **B4 was fixture drift after a renderer-contract change.** The direct parent `597a86fedd48469d8bb8e4cc089e7835b015a05b` passes; `470bf3c7b37989b02c83f9c42cc9e9f127aa0cdd` is first bad. That commit stopped sending full document text and moved summary construction outside the renderer. The repaired bench supplies current line summaries and incremental patches, and its directory is now type-checked. Its 0.6178 ms mean and 1.1431 ms p95 at 85.71 ms calibration start a new series; they are not comparable to the old 0.7487 ms full-text mutation result.

The syntax rows remain useful historical clues, but their calibration was not recorded. Re-run them with calibration before using them as a gate.

---

## 5. Interaction harness status — repaired

`bench-workspace.mjs` now imports `WORKSPACE_CACHE_STORAGE_KEYS` and `workspaceSliceStorageKey` from the v19 cache module. It seeds the root folder, workspace index, workbench layout, and per-project slice in their owned locations. A missing mounted editor throws an explicit schema-drift error before any measurement.

Both Chromium gates pass with the required `--disable-frame-rate-limit --disable-gpu-vsync` launch contract. The old 12 ms typing ceiling had never run against a mounted editor; the real gate produced a 27.80 ms maximum trial p95 with a 0.51 ms steady edit mean at 82.73 ms calibration. Its frame-completion ceiling is now 30 ms, while the independent edit-work ceiling remains 3 ms. Scroll remains below its existing 10 ms ceiling at a 4.05 ms median with 81.33 ms calibration.

```bash
cd apps/web
bun scripts/editor-typing-benchmark.mjs --gate --browsers=chromium \
  --app-url=http://127.0.0.1:3000/ --server-url=http://127.0.0.1:3001
bun scripts/editor-scroll-benchmark.mjs --gate --browsers=chromium \
  --app-url=http://127.0.0.1:3000/ --server-url=http://127.0.0.1:3001
```

The checked-in gate corpus is the 232-line TSX file named in §2.2. The historical 1M-line typing session remains tier 3 and is not relabelled as the gate corpus. With that distinction explicit, the B1 blocker is gone and plan 2 can start.

---

## 6. Native methodology

### 6.1 Keystroke work and presentation

Nothing in-process can see a photon. So the measurement is split, and both halves are named:

```
key event → ApplyEdit → Layout → Draw → transaction completion ‖ compositor → scanout
└──────────────── in-process, os_signpost ────────────────────┘ └ Instruments only ┘
```

- **Keystroke-to-transaction-completion** is the `Keystroke` signpost interval. It opens in `NSTextInputClient.insertText` or `keyDown` and closes in the `CATransaction` completion handler. The editor draws synchronously before that handler. With actions disabled, the handler does not prove that the compositor accepted or presented the frame. This CPU work interval is the number plan 2's sub-2 ms spike target refers to.
- **Transaction-completion-to-photon** is the remaining display pipeline. It comes from a correlated Animation Hitches trace or the `targetTimestamp` of `NSView.displayLink(target:selector:)` for the submitted frame. Add it only when quoting an end-to-end figure.

The native interval includes typesetting and synchronous layer drawing, which the web's keydown-to-rAF interval precedes. The endpoints still differ, and neither measurement reaches a photon. Compare them as CPU work gates, not identical presentation latencies.

### 6.2 The signpost contract

`apps/mac/Sources/EditorCore/LatencySignpost.swift`. Subsystem `dev.platform.editor`, category `Latency`. These strings are a contract with `analyze_trace.py`'s filters — renaming one silently empties every query.

| name        | kind     | opened / emitted where                      |
| ----------- | -------- | ------------------------------------------- |
| `Keystroke` | interval | input receipt → `CATransaction` completion  |
| `ApplyEdit` | event    | buffer mutation complete, before any layout |
| `Layout`    | event    | invalidated fragments typeset               |
| `Draw`      | event    | glyphs drawn for those fragments            |
| `Commit`    | event    | `CATransaction` completion observed         |

`KeystrokeTrace` is `~Copyable` so the interval cannot be accidentally duplicated or leaked past its `end()`. Disabled signposts cost an atomic load and a branch, which is cheap enough to leave in the hot path permanently — the alternative is an instrument that only exists in builds where the bug does not reproduce.

### 6.3 The xctrace recipe (verified 2026-08-28)

The instrument was calibrated before any editor exists, per the repo's debugging rule. `EditorBench --signpost-demo=N` emits N keystroke intervals with known synthetic stage costs (150 + 900 + 500 + 50 µs = 1.6 ms), so the trace can be checked against numbers we chose:

```bash
cd apps/mac && swift build -c release
xcrun xctrace record --template "Logging" --output /tmp/sig.trace \
  --launch -- "$(swift build -c release --show-bin-path)/EditorBench" --signpost-demo=60
python3 .agents/skills/swiftui-expert-skill/scripts/analyze_trace.py \
  --trace /tmp/sig.trace --list-signposts --signpost-subsystem dev.platform.editor
```

Result: 60 `Keystroke` intervals, 240 stage events (60 each of ApplyEdit/Layout/Draw/Commit), duration p50 **2.062 ms** against a 1.6 ms synthetic budget — the ~0.4 ms delta is `usleep` overshoot, which guarantees _at least_ the requested time. **The pipeline reports what we put in.**

Two traps, both hit while verifying this:

- **`--output` must precede `--launch`.** Anything after `--launch --` goes to the target process; `--output` placed last is passed to your binary, which rejects it, and the trace records a 0.8 s run of nothing.
- **Template choice decides whether signposts exist at all.** `Time Profiler` produces an empty signpost table. Use `Logging` for the in-process work interval, or `Animation Hitches` when presentation is the question. `--list-devices` first: real devices and the host Mac take `SwiftUI`; the iOS Simulator's SwiftUI lane comes back empty.

For a long interactive session, `record_trace.py --stop-file /tmp/stop-trace` runs in the background and stops on `touch`.

### 6.4 Frame budget: 60 Hz here, 120 Hz target

`EditorBench` reads the refresh rate at runtime (`CGDisplayCopyDisplayMode(CGMainDisplayID())?.refreshRate`) and prints both budgets:

|        | budget               | meaning                           |
| ------ | -------------------- | --------------------------------- |
| local  | 16.67 ms @ 60 Hz     | what this MacBook Air can falsify |
| target | **8.33 ms @ 120 Hz** | what the editor is designed for   |

**Correcting the plan-of-plans premise: this machine is not ProMotion.** Built-in display, 2880×1800, 60 Hz, confirmed by both `CGDisplayMode.refreshRate` and `NSScreen.maximumFramesPerSecond`. Gate on the 8.33 ms target anyway — designing to the dev machine's 60 Hz bakes in a budget ProMotion halves — but never _claim_ 120 Hz until it is measured on a 120 Hz display. The harness prints that caveat itself so a pasted result carries it.

Budget arithmetic for plan 2: an 8.33 ms frame that must also absorb a keystroke leaves the sub-2 ms input-to-transaction target roughly a quarter of the frame, with the rest for everything that is not the edit.

### 6.5 Microbench rules

Encoded in `Measurement.swift` and `MachineProfile.swift`, not left to discipline:

- **`ContinuousClock`.** Monotonic, does not stop across suspension, no wall-clock conversion. `Duration.components` → ms.
- **Release only.** `EditorBench` prints a loud banner on a debug build. `swift run EditorBench` without `-c release` produces numbers that are not evidence.
- **Warmup discarded, not averaged.** First iterations pay page faults and lazy bridging that never recur in a running editor.
- **Whole sample distribution kept** (min / p50 / p95 / max / mean) so each row can report the same statistic as the web row it faces. A p95 compared against a mean is not a comparison.
- **Deterministic corpora**, same LCG as the web fixtures.
- **A sink for every result.** `benchSink` is global mutable state on purpose: with a constant seed and no sink, LLVM constant-folded the whole 20M-iteration calibration loop and it reported `0.00 ms`. The loop is now seeded from the pid.
- **CPU calibration every run**, same 20M-iteration shape as the web harness. Compare it only to other `EditorBench` runs — Swift and V8 do not produce comparable absolute times (69 ms here vs ~97 ms in-page). Its job is to tell you the machine was in a different state, and by how much.
- **Right-aligned fixed-decimal columns.** Same reason `tabular-nums` is the repo default for updating numbers: a column of latencies with wandering decimal points cannot be scanned.

### 6.6 Lesson zero — never iterate a String by Character

Measured by `EditorBench`, 9 MiB ASCII corpus, counting line breaks, min of 7 iterations, release:

| variant                     | min        | vs floor | why                                        |
| --------------------------- | ---------- | -------- | ------------------------------------------ |
| `String` (Character)        | 82.8 ms    | 46x      | grapheme-breaks every element              |
| `String.unicodeScalars`     | 10.0 ms    | 6x       | decodes, no grapheme breaking              |
| `String.utf16`              | 23.1 ms    | 13x      | what CoreText and the piece table index by |
| `String.utf8`               | 14.2 ms    | 8x       | native storage, still an iterator          |
| `utf8` contiguous buffer    | 4.2 ms     | 2x       | one bounds check, not one per byte         |
| `memchr` over `utf8` buffer | **1.8 ms** | 1x       | libc SIMD; the floor for byte search       |
| `EditorCore.Document`       | 131.6 ms   | 73x      | the placeholder, on the Character path     |

The corpus is pure ASCII — there are no graphemes to break. The 46x is paid entirely for the _possibility_ of one. Two consequences for plan 2:

- **Every buffer scan goes through `utf8` or `utf16`, and byte search goes through a contiguous buffer.** Not "prefer"; the 9 MiB scan is a real operation (open a file, build line starts) and 82 ms of it is a visible stall.
- **`utf16` is 5x the cost of a contiguous `utf8` buffer**, which is awkward because UTF-16 offsets are what the ported piece table and CoreText both speak. Resolve it in the line/layout layer: scan bytes, store UTF-16 offsets. Do not let the index type dictate the scan type.

`Document` is left on the Character path deliberately, as the control. Its comment says so — do not "fix" it without moving the control somewhere else, or the table loses its worst case.

---

## 7. Running it

```bash
cd apps/mac && swift run -c release EditorBench
```

```
--section=machine|baselines|scan   run one section (repeatable; default all)
--scan-mib=N                       string-scan corpus size (default 9)
--scan-iterations=N                string-scan iterations (default 7)
--no-calibration                   skip the CPU calibration loop (~1s)
--signpost-demo[=N]                emit N synthetic keystroke signposts and exit
--coretext-spike[=N]               run N source-backed painted edits in a 10 MiB document
--coretext-snapshot=PATH           export one inserted CoreText frame as a PNG
```

Output sections: **Machine** (profile, both frame budgets, calibration), **Baselines** (the two tables above with an empty native column and the provenance legend), **String views** (§6.6). `--coretext-spike` runs the plan-2 timing spike and exits. `--coretext-snapshot` exports the exact hosted-layer contents for separate visual QA; it is not a timing result.

---

## 8. Hygiene

Non-negotiable, and all three are lessons this machine has already taught:

- **Never compare runs across sessions.** After roughly an hour of heavy benching, tail latencies on this machine inflate about 2x — a typing gate that reads 12 ms cold reads 13–14 ms warm, with no code change. Always pair a candidate with a control **in the same session, interleaved**.
- **Always read a result relative to its calibration line.** A number without its `cpu calibration` is not a result.
- **Absolute ceilings do not survive days.** The ghostty renderer's unchanged baseline failed its own ceiling two days after it was set. Gate on a **ratio to a same-day control**, not on a constant, whenever the metric is machine-state sensitive.
- **No scratch benchmark files in the repo.** Throwaway probes get deleted; the recipe goes in this doc.

---

## 9. How the native column fills

Each row's `nativeMs` is registered by the plan that owns the path. The verdict cell scores it against the stricter of the two web columns.

| plan                  | rows it must fill                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| 2 — editor core       | `piecetable.*`, `virtualization.mount.*`, `typing.applyEdit.mean`, `typing.steady.*`, `scroll.frame.*` |
| 4 — tree-sitter + LSP | `syntax.edit.*`, `highlight.viewport.*`                                                                |
| after the gate        | `foldmap.*`, `minimap.update.*` (parity features, not gate features)                                   |

Plan 2's own exit criterion — sub-2 ms keystroke-to-paint on a 10 MiB file — is measured by §6.1's `Keystroke` interval via §6.3's recipe, not by a stopwatch.

**Plan 2 is unblocked.** The interaction rows now have a re-runnable command, an exact corpus, same-machine results, and calibration. B3 remains a known web optimization task, not a measurement ambiguity.

---

## 10. Dated result records

B2, B3, and B4 settle plan 6's open question: check in dated JSON for the web benches and `EditorBench`. One record per harness under `bench-results/YYYY-MM-DD/` is enough. The smallest useful schema is:

```json
{
  "schemaVersion": 1,
  "recordedAt": "2026-08-28T16:00:00+03:00",
  "repository": {
    "name": "Editor",
    "commit": "b09199679c680255aa07c0c2c70ae77895023ad5",
    "dirty": false
  },
  "runtime": {
    "bun": "1.4.0",
    "browser": null,
    "flags": []
  },
  "machine": "apple-m1-16gb-macos-26.4",
  "harness": {
    "name": "piece-table",
    "command": "bun bench/pieceTable-insertions.ts",
    "corpus": "2000x1024-byte-appends"
  },
  "calibration": {
    "name": "integer-loop-20m",
    "ms": 85.99
  },
  "status": "passed",
  "metrics": [
    {
      "name": "piecetable.insert.append",
      "stat": "median",
      "unit": "ms/ins",
      "value": 0.0038,
      "samples": 4
    }
  ]
}
```

Browser records fill `browser` and `flags`; native records replace the runtime fields with the Swift/Xcode versions. A failed harness writes `"status": "error"` plus `"error": { "phase": "run", "message": "…" }` and omits `metrics`.

This would have exposed all three failures immediately: B2 would have lacked a matching calibration or repeated sample, B3 would have changed in the first record after `cca9a0b3`, and B4 would have produced an error record the week its payload contract changed.
