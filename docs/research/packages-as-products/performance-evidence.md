# Performance evidence for Plan 336

Research for [Plan 336](../../../plans/336-packages-as-products.md), Decision 2: every superlative
carries a linked, reproducible benchmark with date, machine and method, compared like for like.
This file lists what we can claim today, what the owner wants to claim but cannot yet prove, and
which numbers are stale, contradicted or not like for like.

Collected 2026-10-08 against Fregat `0df5eb872`. No benchmarks were run for this file. Sources read:
`ghostty-webgpu/docs/benchmarks*`, `ghostty-webgpu/bench`, `editor/docs/performance`,
`editor/packages/textbuffer/bench`, the latest `editor-textbuffer-bench.yml` CI artifact
(run 37718758421 on `1e066d38b`), `docs/large-file-ceiling`, plans 112, 177, 201, 281, 282 and 283,
`/work/reports/terminal-performance-2026-10-04/wave-20261008` and `/work/reports/ghostty-benchmarks`,
`hotkeys/packages/hotkeys/docs/performance.md`, `tree-sitter-x` history, and commit messages since
2026-09-01 (they carry almost no numbers; the evidence lives in docs and reports).

**Headline.** Today we can prove ghostty-webgpu's parser throughput (2.6 to 5.2 times xterm.js),
lower idle CPU, and some like-for-like renderer energy wins. We can prove Singapore's handler-time
typing on its own, and its text buffer beats VS Code's on loads, sequential typing and large pastes
while losing on random edits. We cannot prove any claim of the form "faster than X in every
scenario", "as fast as the browser can go", or "faster than Monaco/CodeMirror" as an editor. Several
lines in the Plan 336 pitch are contradicted by our own measurements (section 3).

A public claim also needs a public proof link. Most of the newest terminal evidence (the
2026-10-08 wave) lives only in `/work/reports/`, which is not published. Until it is copied into
`ghostty-webgpu/docs/benchmarks/`, nothing from it can be cited.

---

## 1. Claims we can make today

Each claim below is worded to match its evidence. The proof is in the repository unless marked.

### ghostty-webgpu

1. **"Parses terminal output 2.6 to 5.2 times faster than xterm.js."**
   - Numbers (1 terminal, byte path, MB/s, median of 3 order-alternated repetitions):
     ASCII 164.4 vs xterm.js 63.6 (2.6x), git logs 360.4 vs 69.7 (5.2x), cursor motion 166.2 vs
     67.9 (2.4x), SGR color 85.6 vs 63.3 (1.35x), Unicode 93.1 vs 71.8 (1.3x).
     ghostty-web 0.4.0: 65.6 / 65.7 / 57.0 / 35.9 / 55.4.
   - Like for like: yes. Parser-only, unopened terminals, synchronous boundary on both, same
     corpora in 4 KiB chunks, results checked against expected viewport, cursor and SGR afterwards.
   - Machine and date: Apple M1, headed Chromium 153, macOS 25.4, AC power, 2026-10-01, commit
     `6ef17840`.
   - Reproduce: `bun run bench:compare -- --bundle <dir>` in `ghostty-webgpu`.
   - Proof: [ghostty-webgpu/docs/benchmarks.md](../../../ghostty-webgpu/docs/benchmarks.md),
     artifact `ghostty-webgpu/docs/benchmarks/mac-m1/comparison.json`.
   - Wording limit: say "Unicode and SGR-heavy output parse 1.3x faster". "Several times" applies
     to ASCII, logs and cursor-motion only. The string path shows the same pattern (ASCII 2.5x,
     logs 4.1x, Unicode 1.04x).

2. **"Idle terminals use about half the CPU of xterm.js."**
   - 1 terminal: 7.3 vs 14.4 % of a core (xterm WebGL), 13.9 % (xterm DOM). 8 terminals: 7.3 vs
     18.0. 17 terminals: 9.0 vs 20.0. Same run and proof as claim 1.
   - Like for like: no. The ghostty column is the WebGPU renderer, xterm uses WebGL. State it as
     "ghostty-webgpu's WebGPU renderer against xterm.js WebGL".
   - CPU seconds on the M1 are skewed by clock scaling (issue #925): lighter work runs at a lower
     clock and costs more CPU seconds. That skew works against the lighter side, so it makes this
     win conservative, but re-measure with instruction and energy counters before publishing.

3. **"Uses unpatched upstream Ghostty: the same terminal core as the Ghostty app."**
   - `ghostty-webgpu/ghostty-vt.provenance.json`: official `ghostty-org/ghostty` revision
     `7b11f3dc`, archive SHA-256 recorded, `"patched": false`, Zig 0.16.0. The only patches in
     `ghostty-webgpu/patches/` are for vitest.
   - This is a correctness _inheritance_ claim. It does not prove "as correct as Ghostty" in the
     browser, because the renderer and the input path are ours (see section 2).

4. **"ghostty-web 0.4.0 crashed in every rendered benchmark; ghostty-webgpu completed all of them."**
   - Every rendered ghostty-web case (bytes and string, 1, 8 and 17 terminals, 18 failures)
     trapped with `RuntimeError: memory access out of bounds` on non-empty Unicode burst writes.
     Native WebGPU completed all 18 cases. Same run and proof as claim 1, section "Qualification
     notes", with screenshots.
   - Also recorded: ghostty-web's text serialization drops U+0301 and U+200D
     (wave tw-pixels, 2026-10-08, private report), so Unicode comparisons against it are void.

5. **Like-for-like renderer energy wins (Apple M1, 17 terminals, Chrome, all-Chrome CPU energy and
   instructions, ghostty / counterpart, independently reviewed).** From the 2026-10-08 terminal
   wave. Private today; publish before citing.
   - WebGL vs xterm.js 6 WebGL, rolling logs, both bounded to the same final history (8,841 rows):
     energy 0.751, instructions 0.690, every pair lower. Review verdict "qualified with limits"
     (intermediate retention differs). `wave-20261008/reviews/webgl-bounded-r01/`.
   - WebGL vs xterm.js WebGL, rolling Unicode logs, bounded: energy 0.730, instructions 0.689,
     qualified with limits. `reviews/webgl-bounded-unicode/`.
   - DOM vs xterm.js 6 DOM, rolling logs: energy 0.375, instructions 0.445, every pair lower,
     qualified with limits. `reviews/dom-rolling-r05/`. Unicode 0.392 / 0.497 and line scroll
     0.735 / 0.838 also qualified with limits (`reviews/dom-rest-r1/`).
   - Canvas 2D (fillText) vs ghostty-web canvas and xterm.js 5.5 canvas: wins on Unicode, line
     scroll and edits under equal history (energy vs xterm 5.5: 0.283 / 0.197 / 0.925). Unreviewed.
     Unicode against ghostty-web is void (claim 4).
   - Verbatim-ready only per workload: "On streaming logs, ghostty-webgpu's WebGL renderer uses
     25% less CPU energy than xterm.js WebGL; its DOM renderer uses 62% less than xterm.js DOM."
     Each needs date, machine, method and the losses in section 3 on the same page.

6. **"Retained history uses about half the memory of xterm.js."** Not the 18x the table suggests.
   - `memory/10k` (0.40 vs 7.30 MiB) excludes WASM linear memory, where Ghostty keeps history. Add
     the WASM growth: 1 terminal 0.40 + (5.06 − 1.50) ≈ 3.96 MiB vs 7.30; 17 terminals
     0.27 + (62.13 − 9.50) / 17 ≈ 3.37 MiB vs 6.99. So about 1.8 to 2.1x less per 10,000 rows.
     Same run and proof as claim 1. Publish the combined figure with its arithmetic.

7. **"Holds 60 Hz with no dropped frames at 17 terminals streaming logs, where xterm.js WebGL drops
   frames."** 17 terminals, burst logs: 0 dropped frames vs 13 (bytes) and 12 (string); p95 frame
   17.1 vs 33.3 ms. Same run as claim 1. Cross-API (WebGPU vs WebGL), and rAF-based dropped
   frames, not GPU presentation counters. Re-run on the current build before citing.

### Singapore

1. **"A keystroke's handler finishes in about 1 to 3 ms (p95), including on a 500,000-line file and
   on a one-megabyte line."**
   - Dispatch p95 (event capture to handler completion), typing: ordinary 1.1 / 1.6 ms (single /
     multiple views), 500,000 short lines 1.0 / 1.6 ms, one-megabyte line 1.8 / 2.7 ms. Paste
     5.4 to 8.3 ms. 10,488 measured input events, 108 blocking limits all passed, with a 20 ms
     delayed control that fails all 36 groups.
   - Machine and date: Intel i7-14700K, Linux 7.1.9, Chromium 148, 2026-09-07 (E002).
   - Reproduce: `bun run bench:input` (and `bench:input:paired`) in `editor/`.
   - Proof: [editor/docs/performance/input-latency.md](../../../editor/docs/performance/input-latency.md),
     [results](../../../editor/examples/stress/results/input-latency/README.md).
   - Wording limit: this is handler time in the standalone package, not input to pixels, and it
     has no competitor. It supports "fits in a 120 Hz frame budget (8.3 ms)" for the handler only.
     It is a month old; re-run before citing (section 3).

2. **"Its text buffer loads files 1.6 to 2.6 times faster than VS Code's, and handles sequential
   typing, large pastes and range reads faster."** Singapore / vscode-textbuffer, whole-workload
   median, below 1 is faster:
   - load short lines 0.63x, load one long line 0.39x, sequential typing 0.70x, typing with
     position lookups 0.60x, large paste/delete 0.55x, range reads after churn 0.41x,
     offset-to-position 0.69x, random line reads 0.86x.
   - Machine and date: GitHub `ubuntu-latest` (AMD EPYC 7763, 4 vCPU), Node 24.21, push to main at
     `1e066d38b`, 2026-10-08, 9 fresh-process samples per workload, alternating pair order.
   - Control: Microsoft's standalone `vscode-textbuffer` at pinned revision `fdca8848`, vendored
     and hash-checked. This is VS Code's (and Monaco's) piece tree, not full Monaco.
   - Reproduce: `bun run --cwd editor/packages/textbuffer bench -- --profile standard`; runs on
     every main push via `.github/workflows/editor-textbuffer-bench.yml` (artifact
     `textbuffer-benchmarks-<run id>`).
   - Proof link: the CI run summary. Nothing is committed; commit a dated `standard.md` snapshot
     or link the run.
   - Losses on the same run must be shown beside it (section 3).

3. **"Persistent snapshots and stable anchors that VS Code's buffer does not offer."** Measured as
   Singapore-only lanes in the same run: retaining 64 versions while editing (6.7 ms for 1,500
   edits), 64 branch edits from one root (0.9 ms), resolving 500 anchors after each of 300 edits
   (21.2 ms for 150,000 resolutions). Capability claim with cost numbers, no speed ratio.

### Fregat

No competitor comparison exists. What can be said with numbers, each from one machine and one
trial (`docs/large-file-ceiling/results/resident-20260928.md`, i7-14700K, Chromium 153,
2026-09-28, `bun run bench:large-file`):

1. "Opens and edits plain-text files up to 300 MiB" (text opens in 1.6 to 2.6 s up to 300 MiB,
   Plan 112 findings; the default open limit is 200 MiB and saving at that size is fixed).
2. "Raw-bytes file transport is 3.3 to 3.7 times faster than JSON from 100 MiB up" (200 MiB:
   292 vs 976 ms; server RSS at 300 MiB 167 vs 1,399 MiB). This is an internal before/after,
   useful as engineering proof, not a competitive claim. Proof: [Plan 112](../../../plans/112-large-file-ceiling.md).

Nothing supports "typing lands within one 120 Hz frame" in the app today (section 3).

### hotkeys

1. **"Matching a key costs under 0.2 µs; building a keymap is linear in bindings."**
   - Per keyboard event on a 255-binding table: lookup 0.03 to 0.07 µs, `dispatcher.handleKey`
     with context resolution 0.17 to 0.19 µs; `compileKeymap` 0.68 / 1.15 / 0.84 µs per binding at
     255 / 2,550 / 25,500 bindings. A linear `matchesKeyboardEvent` scan costs about 83 µs per key.
   - Machine and date: Linux, Bun 1.4, 2026-09-29 (`fd9e7f9c8`).
   - Reproduce: `bun bench/lookup.ts` in `hotkeys/packages/hotkeys`.
   - Proof: [hotkeys/packages/hotkeys/docs/performance.md](../../../hotkeys/packages/hotkeys/docs/performance.md).
   - Only compared with the Singapore editor's own trie and a naive scan. No other library.

### tree-sitter-x (out of Plan 336 scope, listed for completeness)

1. **"Reparsing a 1 MB Markdown file after a keystroke drops from 0.82 ms to 0.35 ms" (median;
   p95 1.40 to 0.70 ms).** 46 KB Markdown: 0.092 to 0.058 ms.
   - Machine and date: 4-core cloud container, Node 22.22.2, 2026-09-28, 6 alternating rounds.
   - Reproduce: `node lib/binding_web/script/bench.mjs <grammar.wasm> <file> --rounds 6`.
   - Proof: the table was in `FORK.md`, deleted when the README replaced it. Only reachable at
     commit `ca8b155f`. Restore it to a committed doc or link that commit.
   - Same table: on 156 KB JavaScript the differences are inside the stated ~20% noise; claim
     nothing there. Correctness: a differential test parses about 1,500 corpus examples from 16
     grammars with both builds and requires identical trees, changed ranges and highlight captures.

---

## 2. Claims the owner wants that lack proof

For each: what we have, and the cheapest bounded benchmark that would prove or disprove it.

### Fregat

**"As fast as the browser can go."** Not falsifiable as written. Replace it with three numbers a
reader can check, each against the browser's floor and against VS Code:

- Cheapest benchmark: Plan 201 step 0 first. Replace `scripts/large-file/run.ts`'s keydown-to-rAF
  timing (quantized to 60 Hz in headless Chromium) with main-thread time per keystroke from the
  trace (Event Timing `processingEnd` plus the frame's tasks), Chromium run with
  `--disable-frame-rate-limit --disable-gpu-vsync`. Then measure, on one machine, three runs each:
  1. Keystroke main-thread time, 1 MiB plain text and 1 MiB TypeScript, analysis on and off.
  2. Tab switch to first painted text and to first syntax colour (the Plan 177 probe scenario,
     on a production build).
  3. Opening a 10 MiB file to first paint.
- Competitor, same fixture and metric: VS Code for the Web (code-server or `vscode.dev` with a
  local folder) for 1 to 3. Bounded: Chromium only, one machine, about half a day.

**"Typing lands within one 120 Hz frame."** Contradicted today with analysis on (section 3).
Provable only for plain text after Plan 201 step 0 proves the metric on a 1 MiB plain file
(target well under 8.3 ms). Cheapest: the step 0 run above, plain text only, about two hours.

**"Terminals render faster than the tools they replace."** Depends entirely on the ghostty-webgpu
evidence below. In the app, also measure the terminal pane inside Fregat against VS Code's
integrated terminal (xterm.js WebGL) streaming the same log at the same size. The wave's R07
shared bundle and workloads can drive both if the Fregat page is added as an actor.

### Singapore

**"Faster than Monaco and CodeMirror."** No browser comparison with either exists. The buffer
benchmark compares only VS Code's piece tree, and Singapore loses 7 of 15 workloads there.

- Cheapest first step (hours, runs in existing CI): add a CodeMirror 6 adapter (`Text` from
  `@codemirror/state`, applying `ChangeSet`s) to `editor/packages/textbuffer/bench/adapters.mjs`,
  so every workload reports Singapore / VS Code / CodeMirror. Same fixtures, same oracle checks.
- Real proof (one to two days): a browser comparison built on the E002 input suite in
  `editor/examples/stress`. Mount Singapore, Monaco (`monaco-editor` current release) and
  CodeMirror 6 (`basicSetup` plus a language mode) on the same three fixtures (ordinary,
  500,000 lines, one-megabyte line) at the same font, size and DPR. Measure:
  - open to first painted viewport at 1, 10 and 50 MiB;
  - keystroke handler time and input-to-next-frame (unthrottled Chromium, Event Timing);
  - post-GC JS heap after open and after 1,000 edits;
  - scroll frame time over 10,000 lines.
    Chromium on one machine, three alternating repetitions, then Firefox and WebKit if time allows.
    Report losses beside wins.
- Likely outcome to prepare for: Monaco and CodeMirror both disable or degrade features on large
  files, so the large-file rows must state which features were on in each editor.

**"Large files and fast edits."** Large-file evidence exists only inside Fregat (Plan 112),
mixing editor, transport and language server. The standalone comparison above covers it.

### ghostty-webgpu

**"Faster than xterm.js and ghostty-web in every rendering scenario measured, often several times
faster."** False on our own data (section 3). The provable version is per renderer and per
workload, with losses listed. Cheapest path to a publishable page:

1. Copy the reviewed 2026-10-08 wave results (WebGL bounded rolling and rolling Unicode, DOM
   four workloads, WebGPU cross-API rows, Canvas rows) with their protocol, bundle hash and
   review verdicts into `ghostty-webgpu/docs/benchmarks/mac-m1-2026-10-08/`, and regenerate
   `docs/benchmarks.md` from them. No new runs needed.
2. One bounded Mac session on the R07 shared bundle (`wave-20261008/lanes/r2-frame/shared-bundle-r07`)
   at current main: all six actors (ghostty WebGL, WebGPU, Canvas, DOM; xterm WebGL, xterm DOM)
   on the five workloads, equal bounded history (10,000 rows) on every workload, energy and
   instructions as the verdict metric. About two hours of Mac time through `bin/mac-turn.sh`.
3. Re-run parse throughput on the same build (claim 1 is from 2026-10-01).

**"Faster keystroke-to-screen latency."** No valid latency evidence. Plan 283 retired the M1
latency rows: 12 samples per run, and the end point was a CDP screencast frame whose capture
cadence added about 10 ms. Cheapest benchmark: write-to-presentation and key-to-presentation
latency with at least 100 samples per case, measured on the presentation clock the wave already
qualifies (WebGPU `onSubmittedWorkDone` and rAF commit, matched against xterm's render callback),
1 and 17 terminals, WebGL vs xterm WebGL. The 2026-10-08 wave reports a strict WebGPU write-p95
presentation failure (ratio 1.0107), so expect a tie at best today.

**"More correct than xterm.js (or as correct and faster)."** Only spot checks exist:
`docs/terminal/zwj-cell-controls-2026-10-03.md` (emoji cell widths match xterm's Unicode 11 and
Unicode 15-grapheme providers by mode), emoji colour screenshots (`ghostty-webgpu/docs/emoji/`),
the xterm.js 6.0.0 byte-path ZWJ loss in one-byte chunks (benchmarks.md qualification notes), and
893 test cases in `ghostty-webgpu/src`. No conformance suite runs against both.

- Cheapest benchmark (about a day): drive [esctest2](https://github.com/ThomasDickey/esctest2)
  or a fixed subset of it through each library in headless Chromium. Wire each terminal's
  `onData` back to the test process over the existing loopback WebSocket fixture. Report
  pass/fail per test for ghostty-webgpu, xterm.js 6 and ghostty-web. Add a renderer-pixel check
  for a fixed Unicode set (CJK, combining marks, ZWJ, flags, variation selectors) across all four
  ghostty renderers against Ghostty native screenshots.
- "As correct as Ghostty" is defensible for parsing and terminal state once that suite passes
  identically to Ghostty native; renderer correctness needs the pixel check.

**"Lower CPU while many terminals stream output."** The site lists this as in progress. Mixed
evidence (section 3). Step 2 above settles it per renderer.

### hotkeys

**"Zed-style shortcuts for any app"** needs no number. If a speed claim is wanted, add
`tinykeys`, `hotkeys-js` and `@tanstack/hotkeys` to `bench/lookup.ts` on the same 255-binding
table and events. A few hours. Otherwise make no speed claim; 0.2 µs per key is already far below
anything a user can notice, and saying so is enough.

---

## 3. Stale, contradicted or not like-for-like numbers

1. **The Plan 336 ghostty-webgpu pitch line is contradicted by the file it cites.** "Faster than
   xterm.js and ghostty-web in every rendering scenario measured, often several times faster
   (`ghostty-webgpu/docs/benchmarks.md`)". That file records losses against xterm.js WebGL at
   1 terminal: write p50 14.0 vs 8.2 ms, input p50 32.1 vs 30.5 ms, input p95 46.2 vs 32.1 ms, and
   at 17 terminals output CPU 100.1 vs 89.9 % of a core. Later evidence adds more losses:
   - Plan 283 Mac matrix (2026-10-03, CPU seconds, paired ratios vs xterm WebGL, renderer / total):
     WebGL 17 terminals 0.95 / 1.16 (loses total), WebGPU 17 terminals 1.20 / 1.30 (loses both).
     Linux 2026-10-02: WebGPU/Zig total CPU 2.02x xterm WebGL, native WebGL renderer CPU 1.84x,
     DOM 1.57x xterm DOM.
   - 2026-10-08 wave (energy, reviewed): ghostty WebGL loses Unicode/emoji (energy 1.320,
     instructions 1.348) and line scroll (1.361 / 1.417); edits are level (1.010 / 1.048). Cause:
     about 99% of rows rebuilt on a one-line scroll. ghostty DOM loses interactive edits (energy
     1.147, instructions 1.151, cause unknown).
   - "Several times faster" holds only for parse throughput (ASCII, logs, cursor motion) and the
     full-stream WebGPU vs xterm WebGL rolling energy (0.256), which is cross-API and unequal
     history (below).
   - The owner's Plan 281 decision (2026-10-01) kept numbers out of the README until ghostty-webgpu
     beats xterm.js where it loses. The README now shows the parser table only (restored in #878,
     2026-10-06), which is consistent with that rule since parsing has no losses.

2. **`ghostty-webgpu/docs/benchmarks.md` is stale.** Measured 2026-10-01 at `6ef17840`, ghostty-webgpu
   0.2.0. Since then the renderer changed (Zig frame builder #357, WebGL on the Zig frame #399,
   native glyph records #933, about 7% less CPU energy). Its latency rows are invalid per Plan 283
   ("Why the M1 targets changed"): p95 from 12 samples, so one missed frame decides it, and the
   native-vs-xterm input gap reversed between runs (46.2/32.1 then 28.8/39.8 ms); latency ended at
   a screencast PNG whose cadence added about 10 ms. Absolute CPU drifted 107.8% to 70.8% between
   sessions on the same bundle. Burst p50 rows read 16.67 ms for everyone because they are vsync
   capped; they distinguish nothing.

3. **benchmarks.md's "ghostty-webgpu" column is the WebGPU renderer against xterm.js WebGL.**
   Cross-API. Plan 283 and the owner (2026-10-02, "WebGL decides the project") require WebGL vs
   xterm WebGL and DOM vs xterm DOM. The site's measurement table (`ghostty-webgpu/site/src/measurements.ts`,
   currently hidden by `SHOW_MEASUREMENTS = false`) has the same label problem and would show the
   write-p50 and input-p95 losses if switched on.

4. **`memory/10k` is not like for like.** Ghostty keeps history in WASM linear memory, reported
   separately. The headline 0.40 vs 7.30 MiB (18x) becomes about 4.0 vs 7.3 MiB (1.8x) once WASM
   growth is added (section 1, claim 6).

5. **Metric changes reverse verdicts.** Before 2026-10-07 every terminal verdict used CPU seconds,
   which the M1's clock scaling biases toward heavier implementations (issue #925). The same
   comparison moves from a loss to a win: WebGL vs xterm WebGL at 17 terminals, rolling ASCII,
   total CPU 1.16 (2026-10-03, CPU seconds) vs energy 0.751 (2026-10-08, bounded history). Treat
   all pre-10-07 CPU ratios as superseded, and publish energy plus instructions with CPU seconds
   beside them.

6. **Unequal history inflates wins.** The wave's full-stream rolling results keep 111,328 rows of
   history, where xterm's cost grows with history. ghostty WebGL vs xterm WebGL energy is 0.380 on
   full stream but 0.751 with equal bounded history; reviewers rated full stream "not qualified for
   a headline". The successor run's (2026-10-07) rolling-logs Canvas and WebGL ratios had unequal
   retained history and are void. WebGPU vs xterm WebGL 0.256 is full stream and cross-API: do not
   cite it as a headline.

7. **The Pi capacity result is an observation.** Pi 4: ghostty WebGL kept 4 rolling terminals at
   60 Hz, xterm WebGL 1. History policies and capsules differed across actors, with the owner's TV
   load present. Not an equal-work verdict; do not publish as "4x".

8. **Fregat typing misses one 120 Hz frame with analysis on.** In the app, a 1 MiB TypeScript file
   types at key p50 28 to 33 ms and p95 48 to 56 ms (Tree-sitter / Shiki); 10 MiB at 241 to 254 ms
   p95 (`docs/large-file-ceiling/results/resident-20260928.md`, 2026-09-28, 30 keys, one trial).
   Plain text's 16 to 17 ms p95 at 1 to 10 MiB is the 60 Hz frame interval of the headless metric,
   not the editor's cost (Plan 201 step 0). Plan 201, which owns the fix and the better metric, has
   not started. Plan 177's probe (dev build, headless): keyboard tab switch paints text at 41 to
   53 ms and colour about 55 ms later; chat switch 68 to 135 ms. The pitch's "typing lands within
   one 120 Hz frame" has no support in the app today.

9. **Singapore's buffer loses to VS Code's on random edits.** Same CI run as section 1:
   random replacements 1.95x slower, eight-cursor batches 1.97x, mixed churn 1.50x, sequential line
   reads after churn 1.53x, position-to-offset 1.66x, ASCII replacements 1.45x, full read 1.21x,
   random insertions 1.13x. `bench/README.md` warns: "A favorable cell is not proof that Singapore
   is globally faster." "Large files and fast edits, with benchmarks against Monaco" must wait for
   section 2's browser comparison, and the buffer table must show these rows.

10. **Singapore's input-latency proof is a month old.** E002 ran 2026-09-07 on Chromium 148. Since
    then EditContext became the default input route (E036), the token store and textbuffer changed
    (E035, E037 to E046) and the paired runner's acceptance (Plan 282) is still blocked. Re-run
    `bench:input` on current main before citing.

11. **tree-sitter-x numbers have no committed home and one is outdated.** `FORK.md` was deleted;
    the README keeps only the 0.8 to 0.35 ms line. Its bundle size row (117.2 vs 114.7 KB gzipped,
    larger than upstream) predates `wasm-opt -O3` (`1adffc0b`). The "loading is about twice as
    fast" line was correctly removed (`3473f947`): load ran first-in-process for each build.

12. **The newest proof is private.** Everything from the 2026-10-08 wave and Plan 283's Mac
    custody files sits under `/work/reports/`. Public pages need it copied into
    `ghostty-webgpu/docs/benchmarks/` with the bundle hashes, protocols and review verdicts.

13. **Fregat has no competitive measurement at all.** Plan 336's "Typing lands within one 120 Hz
    frame; terminals and editors render faster than the tools they replace. Cite measurements" has
    nothing to cite yet against VS Code, Cursor or Zed. Section 2's Fregat benchmark is the
    minimum before the Fregat site makes a speed claim.

## Checklist for Track B

- [ ] Rewrite the ghostty-webgpu pitch line as per-renderer, per-workload claims with losses beside wins.
- [ ] Publish the 2026-10-08 wave's reviewed results into `ghostty-webgpu/docs/benchmarks/` and
      regenerate `benchmarks.md`; drop or mark the retired latency rows.
- [ ] Run the bounded six-actor R07 Mac session with equal bounded history; re-run parse throughput.
- [ ] Report ghostty memory per 10k rows including WASM growth.
- [ ] Commit a dated snapshot of the textbuffer CI comparison, losses included.
- [ ] Add a CodeMirror 6 adapter to the textbuffer benchmark.
- [ ] Build the Singapore vs Monaco vs CodeMirror browser comparison on the E002 suite.
- [ ] Re-run `bench:input` on current main.
- [ ] Execute Plan 201 step 0, then measure Fregat against VS Code for the Web on keystroke,
      tab switch and large-file open.
- [ ] Run an esctest2 subset against ghostty-webgpu, xterm.js and ghostty-web before any
      correctness superlative.
- [ ] Keep "as fast as the browser can go" out of published copy; use the measured numbers.
