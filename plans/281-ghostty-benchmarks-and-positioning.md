# Plan 281: Ghostty benchmarks and positioning

## Status and authorization

- Status: APPROVED 2026-10-01. Carries the unfinished parts 3 and 4 of the retired ghostty-webgpu
  Plan 017, whose parts 1 and 2 shipped as #219 (xterm facade removed, 0.2.0) and #218 (native
  history reads).
- Owner, 2026-10-01: publish the full report in `docs/benchmarks.md`, losses included, but keep
  the numbers out of the package's main README. Section 2 states the case for Ghostty without
  benchmark numbers; revisit putting numbers in the README only if Plan 283 makes ghostty-webgpu
  beat xterm.js on the measures where it now loses.
- Part 1 is in progress: a comparison runner is being built, with real measurements on the owner's
  MacBook (Apple M1) over mesh host `mac`, only on AC power.

## Outcome

ghostty-webgpu publishes reproducible benchmarks against xterm.js and ghostty-web, and its README
makes the case for Ghostty in the browser from those numbers, says how it differs from ghostty-web,
and says when xterm.js is the better choice. Breaking changes are welcome; the package has no
compatibility obligations.

## 1. Benchmarks

Measure what Ghostty in the browser buys, against `@xterm/xterm` (current release, WebGL renderer
addon, and its default DOM renderer) and ghostty-web (pinned 0.4.0), on the same machine, fixtures,
font, size and DPR. Headed Chromium on a hardware adapter (AGENTS.md: SwiftShader proves
correctness only); add Firefox and Safari where each library runs there.

| Measure                 | What it shows                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parse throughput (MB/s) | libghostty-vt's SIMD parser against xterm.js's JS parser, with rendering paused or off-screen, over corpora: plain ASCII, dense SGR color, Unicode and emoji ZWJ, cursor-motion heavy (TUI redraw), and a large `cat` of real logs |
| Write-to-frame latency  | time from `write` to the frame that shows it, p50/p95                                                                                                                                                                              |
| Burst frame time        | frame time and dropped frames while streaming the corpora                                                                                                                                                                          |
| Input latency           | key event to echoed glyph on screen, through a local echo fixture                                                                                                                                                                  |
| Memory                  | per terminal, and per 10,000 scrollback rows                                                                                                                                                                                       |
| Many terminals          | 1, 8 and 17 terminals open, CPU and memory while idle and under output                                                                                                                                                             |
| Correctness spot checks | the same Unicode and escape-sequence fixtures rendered by all three, screenshots compared by eye and recorded                                                                                                                      |

- Byte streaming is part of the story: this library takes `Uint8Array` straight from the PTY into
  wasm, with no decode into JS strings on the way. Measure the string path of the other two
  alongside their byte path where they have one.
- Reuse `bench/` and `bun run bench:renderer`. Write the new runner as `bun run bench:compare`, with
  JSON artifacts that record commit, browser, GPU, OS, font, DPR and fixture hashes, and a
  `docs/benchmarks.md` that reports medians over repeated, order-alternated runs.
- Report losses as plainly as wins. A number that was not measured does not appear in the README.

## 2. Say what we are in the README

Replace the "inspired by ghostty-web" framing with short sections, facts only, each checked against
source or a benchmark artifact before it is written:

- **Why Ghostty:** Ghostty is one of the best terminal emulators, and this is its emulator core,
  libghostty-vt, pinned upstream and unpatched, running in the browser. Say concretely what that
  buys, with sources:
  - a SIMD-optimized parser, strong Unicode and grapheme handling, optimized memory use, and a
    fuzzed, Valgrind-tested core (libghostty's own claims; link
    [Mitchell Hashimoto's libghostty post](https://mitchellh.com/writing/libghostty-is-coming));
  - the same parsing and behavior as the Ghostty app, including modern protocols it parses;
  - bytes in from the PTY, no JS string decoding;
  - the benchmark results from part 1;
  - the xterm.js team itself is exploring libghostty because its JS parser has hit hard limits
    ([xterm.js #5686](https://github.com/xtermjs/xterm.js/issues/5686)).
- **Renderer:** damage-aware drawing on WebGPU, then WebGL2, then Canvas2D, with live themes and
  recovery from lost GPU contexts.
- **Why not ghostty-web:** a few blunt bullets, each verified against the pinned ghostty-web 0.4.0
  source (`coder/ghostty-web@9e4e126d`) or our own run:
  - it builds Ghostty from a 1,620-line fork patch (`patches/ghostty-wasm-api.patch`) that
    hand-writes a wasm API, where this library uses upstream's C API;
  - it claims xterm.js API compatibility and lists no gaps;
  - it needs `await init()` before a terminal exists;
  - its renderer backends, stated exactly (canvas only, if the source confirms it);
  - reported crashes: a WASM memory corruption where `free()` after an emoji breaks every
    terminal opened afterwards ([AkaraChen/2code #145](https://github.com/AkaraChen/2code/issues/145));
    include it only if it reproduces on 0.4.0;
  - the part 1 numbers.
- **Why not xterm.js:** honest. xterm.js is mature, with a large addon ecosystem, a broader API and
  proven accessibility. Choose it when you need those; choose this when you want Ghostty's
  emulator, byte streaming and the part 1 numbers.

Keep the README's current voice (short, lowercase headings). No "rather than" or "instead of"
framing in the positioning copy.

## Approved follow-up: audit native-window input preparation

Evidence lives in the terminal wave's `lanes/r10-fixture-boundary/`; `$lane` below names that
artifact directory. Historical source labels, completed windows and Canvas rejections stay unchanged.

- [x] Reproduce the `r9-canvas-gc` finding and move burst corpus/chunk/path preparation outside the
      outer native counters. Inputs stay live across warmup/output and clear at disposal. Parser
      setup already precedes its inner timer; live echo conversion remains transport work.
- [x] Record 24 Linux attribution windows. At count17, edits preparation accounts for ghostty/xterm
      renderer instructions 8.68%/12.17% and sampled JS allocation 27.1%/52.6%. Sampling excludes
      native/WASM allocation; diagnostic overhead is disclosed. See `preparation-analysis.json`
      and `preparation-analysis-edits17.json` for all workloads and unioned per-thread GC evidence.
- [x] Freeze byte-qualified R08/R08-u11/R08-canvas R02 siblings at harness pin `3dd6362a0613709b0b5f778c9b0879700ade51c4`.
      The wave README records hashes; `bundle-byte-proof.json` passes 66 fixture/path comparisons.
      Completed Mac rolling edits stay R01 after a nonrolling reset correction in fresh R02 siblings.
- [x] Record 16 Linux edits windows and one 117.9-second Mac turn. Linux renderer instruction ratios
      widen DOM 1.226 → 1.348 and WebGL 1.144 → 1.239. Mac all-Chrome estimated energy/instruction ratios
      remain losses at DOM 1.024/1.077 and WebGL 1.036/1.052. See `measurement-analysis.json`.
      These older frozen runtimes and changed persistent input lifetime do not isolate a renderer/GC
      improvement or update the current-runtime scoreboard; SwiftShader totals are descriptive.
- [x] Exclude retained inputs from terminal memory by sampling after `initialize` and before
      `createTerminals`. Initialization runs once; every sample includes the same live inputs.
      Runner/report regressions cover both paths, counts1/8/17, preparation-only and terminal deltas.
      `bun run bench:compare:test` also checks reset/tick representation and complete corpus wraps.
      This memory correction affects the repository runner; frozen R08 acquisitions are burst-only.
- [ ] Establish the old Canvas GC cause. Its paired instruction ratios were 0.878729/1.467704;
      control0 and candidates1/2 finalized major GC while control3 had scavenges only. Zero private
      scratch cells survived its forced end-of-frame heap check. Persistent scratch retention alone
      does not explain the loss; product-only GC and deopt/reopt causes remain unconfirmed.
      Reproduce with `python3 "$lane/reproduce-r9.py" pi-batch-buffer-interactive-edits-r01 pi-frame-buffer-interactive-edits-r01`.
      Validate trace CPU clocks before attributing helper CPU time; preserve native and per-thread wall evidence.
- [ ] Rebuild both Canvas arms from current main with matching prepared inputs, driver and assets
      before another screen. Acquired sources predate `97fa72ffc`; record fresh identities and check
      output/work/retention. Use `python3 "$lane/analyze-preparation.py" linux-attribution-edits17-r01`
      and `node "$lane/analyze-results.mjs"`. A future boundary fix cannot rescore old acquisitions.
- [ ] Audit static latency preparation separately. `writeMarker` in `bench/comparison-entry.ts`
      starts its clock before `input(marker(color))`; traced latency also sets up markers, echo
      connection and input colors inside its operation. Prebuild static sequences and connect before
      those windows, keeping event-driven echo conversion measured. This pre-existing path is unchanged here.

## Done when

- `docs/benchmarks.md` and its JSON artifacts are published in `ghostty-webgpu/`, losses included.
- Every README claim names its evidence (source path, link, or a benchmark artifact).
- Each part lands as its own reviewed PR, and the mirror is updated.
