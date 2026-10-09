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

The `r9-canvas-gc` follow-up is reproduced and its accounting-boundary fix is complete.
The original Canvas research windows and rejection decisions keep their source and workload labels.
Host-side evidence is in the terminal wave's `lanes/r10-fixture-boundary/`; set `$wave` to
that wave artifact directory and `$lane` to its owned lane before running the commands below.

- [x] Reproduce the original allocation finding without writing into another lane's evidence:

  ```sh
  python3 "$lane/reproduce-r9.py" pi-batch-buffer-interactive-edits-r01 pi-frame-buffer-interactive-edits-r01
  ```

  The frozen edit fixture allocates chunks through `Array.from(...matchAll(...), match =>
new TextEncoder().encode(match[0]))`. Its recorded allocation site is
  `batch-buffer-devices/packet/browser.js:455:824` and the matching candidate site. Both arms
  prepare inside the outer native window. The reproduction retains dominant fixture-generation
  allocation stacks; it establishes no product-only GC cause.

- [x] Establish the native boundary for every burst workload. Repository output and traced/control
      output call `measureCpu` around `__compare.burst`; native-before precedes the operation and
      native-after follows it. Both rolling chunk generation and repeated-corpus encoding were
      inside those brackets despite sitting outside the inner elapsed timer. Frozen R07, its
      Unicode11 sibling and its Canvas sibling likewise bracket `__direct.measured`, which calls
      `burst` after its observer snapshot. All five research workloads use that rolling path.
      Parser corpus/chunk/expected-screen setup already precedes its inner parse timer; the
      repository parser's GPU qualification has no native CPU bracket. Live echo encoding belongs
      to the transport workload and stays unchanged.
- [x] Measure preparation separately on Linux using trace marks, native endpoints, thread names,
      GC wall intervals and collected-object heap sampling. Twenty count-1 windows cover all five
      workloads, ghostty DOM and xterm 6 DOM; four more edits windows use the comparison's count17.
      At count1, edits preparation is 51.6%/54.1% of renderer instructions and 82.9%/91.1% of sampled
      JS allocation. At count17, those shares are 8.68%/12.17% and 27.1%/52.6%; all-Chrome instruction
      shares are 4.94%/6.84%. Empty-boundary calibration is about 0.91–0.96 million instructions,
      versus 635–739 million preparation instructions. Sampling is statistical, includes collector
      setup/teardown, and excludes native/WASM allocation. See `preparation-analysis.json` and
      `preparation-analysis-edits17.json` for every workload and per-thread GC evidence.
- [x] Prebuild burst inputs in `initialize`, retain their bytes/strings and reset inputs across
      warmup and measurement, and clear them at disposal. The measured span still contains reset,
      pacing, terminal writes, rendering, observer work and logical settlement. All fixture inputs
      are retained, including unused fixtures; this changes persistent heap lifetime and prevents
      interpreting the result as an isolated renderer improvement. The failing-first regression
      executes the actual entry functions for both write paths, refuses preparation inside the
      measured span, and checks every fixture's tick bytes through a corpus wrap. Run from the
      package with `bun run bench:compare:test`: 423 tests pass.
- [x] Freeze R08, R08-u11 and R08-canvas at their R07 ancestors' runtime/dependency bytes with the
      fixed harness pin `3dd6362a0613709b0b5f778c9b0879700ade51c4`. Preferred capsule directories
      end in `-r02`; the wave README's Shared bundles section records all pins and hashes.
      `bundle-byte-proof.json` verifies 66 complete byte/string fixture comparisons, including
      every tick, wrap and reset. The first R08 overlay's nonrolling reset discrepancy was caught
      and fixed in fresh R02 siblings; its completed Mac rolling-edits windows stay labelled R01.
      No completed acquisition or old generation is relabelled or rescored.
- [x] Acquire fresh descriptive edits comparisons. Sixteen accepted non-quiet Linux windows show
      median ghostty/xterm renderer instruction ratios DOM 1.226 → 1.348 and WebGL 1.144 → 1.239;
      all-Chrome ratios are 1.200 → 1.252 and 2.746 → 2.922. Both losses widen. SwiftShader all-Chrome
      is descriptive, with no GPU-efficiency or timing verdict. Four valid R07 DOM windows are
      retained from the original acquisition; only GL setup rejected before counters is replaced
      under a new identity with the 32-context launch flag. Output/work and same-renderer pixels match.
      One bounded 117.9-second Mac R08-u11-R01 turn supplies two balanced pairs per cell and clean
      custody. All-Chrome estimated CPU energy/instruction medians are DOM 1.024/1.077 and WebGL
      1.036/1.052: both remain losses. Against the brief's approximate cells, DOM energy is slightly
      smaller, DOM instructions larger, and WebGL losses larger. These intentionally older frozen
      runtime observations cannot update the current-runtime scoreboard. See `measurement-analysis.json`.
- [ ] Establish whether setup-boundary GC explains the old Canvas guard variation. The frame-scoped
      candidate recorded major-GC finalization in control0 and candidates1/2, while control3 had
      scavenges only; paired all-Chrome instruction ratios were 0.878729 and 1.467704. Its forced
      end-of-frame heap retained zero private scratch cells. Persistent scratch retention alone
      therefore does not explain that loss. Neither a product-only GC cause nor a deopt/reopt storm
      is established. Validate affected trace CPU clocks before assigning helper CPU time; preserve
      native counters and unioned trace wall intervals. The new count17 diagnostic has one prep
      scavenge per window, total renderer pause times 29.2–38.3 ms, and background marking/sweeping
      wall work on named threads. It does not isolate the original candidate's cause.
- [ ] Rebuild both Canvas arms from current main with the same prepared-input harness, driver and
      assets before another screen. The acquired sources predate Canvas capture changes in
      `97fa72ffc`; record that applicability difference and fresh protocol identities, and preserve
      output/work/retention checks. Preparation moving outside a future window cannot qualify or
      rescore old acquisitions. Reproduce the native and trace analysis with:

  ```sh
  python3 "$lane/analyze-preparation.py" linux-attribution-edits17-r01
  node "$lane/analyze-results.mjs"
  ```

## Done when

- `docs/benchmarks.md` and its JSON artifacts are published in `ghostty-webgpu/`, losses included.
- Every README claim names its evidence (source path, link, or a benchmark artifact).
- Each part lands as its own reviewed PR, and the mirror is updated.
