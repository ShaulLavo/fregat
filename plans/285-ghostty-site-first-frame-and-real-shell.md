# Plan 285: The ghostty-webgpu site paints before the wasm and runs a real shell

## Status and authorization

- Status: APPROVED 2026-10-01 by the owner, answering two site reviews in one pass. The owner's own
  gripe is speed: "we should make it faster … servo render the first frame of the terminal."
- Site: <https://shaullavo.github.io/ghostty-webgpu/>, built from `ghostty-webgpu/site/` by
  `.github/workflows/site.yml` on every push to `main` that touches `ghostty-webgpu/**`.
- Package changes (Phases 1 and 4) land in `ghostty-webgpu/src/` and bump the package version as
  the change warrants; the site consumes `../dist`.

## Owner decisions

Accepted, from the reviews:

- Faster first paint. The terminal's first frame is server-rendered into the HTML; the live
  renderer takes over in place.
- A DOM renderer as the last fallback. It replaces the "could not start" error box and is what
  makes the server-rendered frame the same output as the live one. This is the part the owner
  called the most interesting.
- Code before the fold ends: the README's six-line example under the install command.
- A benchmarks section with placeholders now; real numbers land when Plans 281 and 283 finish
  ("make them a bit better than they are before we post them").
- Version in the masthead, a browser support line, self-hosted fonts, a shorter terminal box on
  phones, the resize bug fixed.
- Demos may come back as tabs if they stay as clean as today's page. The old fake shell was "not
  fun"; a shell demo is a real shell, lazily loaded, or nothing. Matrix and throughput demos are
  welcome. A damage overlay toggle that tints the cells redrawn each frame is wanted.

Rejected:

- Docs on the site: there are no real docs yet; a docs plan is separate work.
- Open Graph and social preview tags: no social presence, none planned.
- A renderer switch: "if it's same output, it's same output."
- A PNG fallback: "a site with no canvas"; the DOM renderer is the answer.

## Outcome

A visitor sees the ghost on the first paint of the HTML, before any wasm or font arrives, and the
live WebGPU terminal replaces it without a visible change. A browser with no WebGPU, WebGL2 or
Canvas2D still shows a terminal, drawn by the DOM renderer. The page shows how to use the library,
which version it is, where it runs, and what it measures. A visitor who wants a terminal types into
a real bash.

## What exists today

- `site/src/main.ts` boots serially: fonts from Google (`loadFonts`), then `Terminal.create` fetches
  `ghostty-vt.wasm` (255 KB) and `bridge.wasm`, then `open`, then `GhostDemo.layout` starts the
  `ghost-frames.txt.gz` (60 KB) fetch. The window shows "loading" until the first frame; a browser
  that cannot start the renderer gets the `#fatal` error box.
- `src/render/selector.ts` tries WebGPU, then WebGL2, then Canvas2D; `FallbackTerminalRenderer`
  handles WebGL2 context loss. Every backend consumes `RendererFrameSnapshot` rows
  (`src/render/renderer.ts:37`) from a `RenderStateSource`. The core (`src/core/`) runs under Node;
  core tests have no DOM.
- `site/src/demos/types.ts` keeps the `Demo`/`AnimatedDemo` abstraction (`id`, `label`, `caption`,
  `fit`, `input?`) from the tabbed site. The tabs and the Colors, Cube, Donut and Shell demos were
  removed in the mirror's `0efdf5f` ("Simplify the website to the ghost demo"); the sources are in
  `/work/projects/ghostty-webgpu` at `0efdf5f^` under `site/src/demos/`. `shell.ts` (250 lines) has
  a line editor worth keeping; its command table is the part that was not fun.
- `astro.config.ts` defines `__SITE_VERSION__` from `package.json`; nothing renders it.
- `docs/benchmarks.md` and `docs/benchmarks/mac-m1/comparison.json` hold the M1 comparison (Plan
  281); Plan 283 is changing the write and input numbers.
- Measured 2026-10-01 at 1280 px: 396 KB transferred, load event at 188 ms on this machine; the
  ghost appears only after wasm, fonts and frames all land. At 390 px the screen is 710 px tall
  (80 % of the viewport) for a ghost at the 5 px minimum font.

## Phase 0: measure the first frame

Execution checklist (DOM/first-frame lane):

- [x] Capture the instrumented serial boot on the built site, cold Fast 4G / 4× CPU.
- [x] Implement and test the DOM backend and pure HTML output; bump the package minor.
- [x] Inline the real-core first frame, self-host fonts, parallelize boot, paint-gated hand-off.
- [x] Repeat the timeline and read desktop, phone and hand-off screenshots.
- [x] Commit by path, push and open the lane PR.

Before touching the boot path, record when the ghost first appears, on a cold cache, throttled to
"Fast 4G" and to a slow desktop CPU, in Chromium: HTML paint, font ready, wasm fetched, `create`
resolved, `open` resolved, frames fetched, first ghost frame. `bun run agent:browser trace` against
the built site (`astro preview`) gives the timeline; save it to
`/work/tmp/fregat-evidence/<run>/` and copy the numbers into this plan. Every later phase cites
this baseline.

Measured locally on the built Astro preview at 1280 × 1000, Chromium headless (WebGL2),
cold cache, 1.6 Mbps download / 750 Kbps upload / 150 ms RTT, 4× CPU slowdown. Milestones
are milliseconds from navigation start; raw CDP traces and every emitted screencast frame are retained.
The baseline retains the serial boot and the unfixed sizing; the compatible-renderer package is already
present because that lane ran in parallel. This isolates the site boot change, not package bundle size.

| Milestone                      | Serial boot | First-frame boot |
| ------------------------------ | ----------: | ---------------: |
| HTML first contentful paint    |       580.0 |            368.0 |
| Terminal fonts ready           |     1,274.9 |          2,411.3 |
| Wasm response complete         |     5,359.7 |          5,681.8 |
| `Terminal.create` resolved     |     5,395.4 |          5,714.7 |
| `open` resolved                |     5,579.5 |          5,747.0 |
| Ghost frames response complete |     6,042.3 |          1,751.9 |
| Ghost frames decoded           |     6,064.0 |          2,418.5 |
| First ghost frame              |     6,115.5 |     368.0 (HTML) |

Baseline evidence: `/work/tmp/fregat-evidence/p285-before/` (`trace.json`, `timeline.json`,
`loaded.png`, `frame-0000.jpg` onward). The screenshot was read back: the initial ghost waits for
wasm and frames, and the old font sizing places it toward the right side of the window. The current
checked-in wasm transfers 773,277 bytes in this preview, larger than the older estimate above.

### Verified first-frame implementation (2026-10-01)

The after column is `/work/tmp/fregat-evidence/p285-main-after-2/`, built after the content and
fractional-DPR fitting integration. `ghost:first-frame` marks the live swap at 5,935.9 ms;
first visible ghost is now the HTML paint, 368.0 ms. Three cold alternating pairs under the same
throttle yielded FCP 588 → 364, 508 → 368, and 492 → 360 ms: medians 508 → 364 ms.
The serial median first visible ghost was 5,938.2 ms, compared with 364 ms for HTML.
Evidence is `/work/tmp/fregat-evidence/p285-main-before-{1,2,3}/` and
`/work/tmp/fregat-evidence/p285-main-after-{1,2,3}/`; every run recorded zero page errors.

The initial div-per-row static frame regressed FCP and was replaced with one preformatted grid.
Shared serializer runs retain only paint classes; geometry lives on the parent. Typed inherited
cell properties prevent repeated CSS expression expansion, and first-paint CSS is inline.
The final content-integrated document transfers 6,264 bytes (5,964 compressed body, 28,213 decoded),
versus 1,778 / 1,478 / 3,733 for the serial baseline. The baseline is the older page, so the total
includes content added by Phase 3. Earlier unchanged-content paired runs also improved median FCP
484 → 352 ms after compaction and CSS inlining. Self-hosted fonts add bandwidth contention: wasm
and live hand-off remain around six seconds under this throttle; this is an HTML-paint improvement,
not a claim that the runtime download became faster.

Read-back screencast frames `p285-main-after-2/frame-0001.jpg` (first content), `frame-0006.jpg`
(before hand-off), and `frame-0007.jpg` / `frame-0008.jpg` (live hand-off) show the retained ghost.
The frozen suite `/work/tmp/fregat-evidence/p285-main-handoff/` checks desktop and phone at DPR 1
and 2 plus phone DPR 1.3: static 40 rows, live exactly 40 rows and at least 78 columns, identical
screen coordinates and dimensions, retained HTML until paint, and no page errors. It also passes
DOM-only, no-WebAssembly, and JavaScript-disabled cases. Desktop and fractional-phone static/live
screen screenshots were read back. DOM/GPU antialiasing differs; late font loading changes page
text layout before the live swap. No all-page pixel identity is claimed.

Formal looks were healthy and read back in `/work/tmp/fregat-evidence/p285-main-looks/`:
`20261001T194511Z-look-ghostty-webgpu-1280x1000/` and
`20261001T194513Z-look-ghostty-webgpu-390x844/`. These use Chromium WebGL2/SwiftShader, not a
hardware GPU; Firefox and WebKit first-frame geometry remain unconfirmed.

Phase 1 PR: <https://github.com/ShaulLavo/fregat/pull/285>, package 0.3.0. The merge resolution
preserves packed GPU/WebGL row reads; immutable styled cells decode only when serialization
requests them. Verification after integration: 11 Node serializer/snapshot tests, 39 DOM/Canvas/
fallback browser tests, 25 GPU/WebGL tests with two existing Linux SwiftShader skips; build,
typecheck, lint, formatting and full commit gates pass. The static compaction and fitting checks
add 12 passing Node tests. Phase 2 includes the merged damage-overlay integration.

After merging demo PR #278, paired FCP was 504 → 364, 480 → 368, and 488 → 364 ms
(medians 488 → 364). Evidence is `/work/tmp/fregat-evidence/p285-final-before-{1,2,3}/`
and `/work/tmp/fregat-evidence/p285-final-after-{1,2,3}/`; the document transfers 6,462 bytes
(6,162 compressed body; 29,204 decoded). First-paint and swap frames were read back.
The final demo hand-off matrix `/work/tmp/fregat-evidence/p285-final-demo-handoff/` also checks
static tabs, runs real Shell arithmetic (42) and a three-iteration loop, and returns to the Ghost
under reduced motion. That return exposed a retained redraw-sampling countdown; resetting the
sample on layout restores the paused stat. Matrix and Shell screen screenshots were read back.
Build-time Node gzip is preserved with a browser-only zlib resolver; a global browser stub would
break the real-core prerender. Fifteen targeted Node tests and the full commit gates pass.
Desktop and phone looks were healthy and read back at `/work/tmp/fregat-evidence/p285-final-looks/`
(`20261001T211929Z-look-ghostty-webgpu-1280x1000/` and
`20261001T211931Z-look-ghostty-webgpu-390x844/`).

### Final overlay integration (2026-10-02)

Phase 2 PR: <https://github.com/ShaulLavo/fregat/pull/304>. Committed by path and pushed;
full commit gates and repository typecheck pass. Phase 1 is merged in #285.

The static chrome retains #302's Redraws toggle, initially off, alongside the three demo tabs
and lowercase `html` backend. Mobile chrome hides the decorative dots. Canvas2D capability
is checked for the optional overlay: unsupported browsers retain their DOM terminal and get a
disabled Redraws control. Build and site typecheck pass. The complete frozen hand-off matrix
passes at `/work/tmp/fregat-evidence/p285-overlay-handoff/`, including overlay on/off in every
GPU viewport, DOM-only disabled overlay, real Shell arithmetic/loop, no WebAssembly and no
JavaScript. The no-JavaScript screenshot was read back.

Three final cold alternating traces yielded FCP 520 → 388, 484 → 368, and 484 → 388 ms:
medians 484 → 388 ms. Median first visible Ghost is 5,950.1 → 388 ms. The final document
transfers 6,597 bytes (6,297 compressed body; 29,954 decoded). Every run recorded zero page
errors. Evidence is `/work/tmp/fregat-evidence/p285-overlay-before-{1,2,3}/` and
`/work/tmp/fregat-evidence/p285-overlay-after-{1,2,3}/`. First-content frame 0001 and pre/live
handoff frames 0006/0007/0008 from after-2 were read back; the live swap marks 5,930.2 ms.
The final trace build preceded only a null-safe overlay transform-call adjustment; static HTML,
CSS and boot scheduling were unchanged. Runtime transfer remains around six seconds.

Final desktop and phone looks are healthy and read back at
`/work/tmp/fregat-evidence/p285-overlay-looks/20261001T213838Z-look-ghostty-webgpu-1280x1000/`
and `/work/tmp/fregat-evidence/p285-overlay-looks/20261001T213839Z-look-ghostty-webgpu-390x844/`.
Chromium software WebGL2 is confirmed; hardware GPU and Firefox/WebKit geometry remain
unconfirmed. No deployment or GitHub PR merge is performed by this lane.

### Independent-review follow-up (2026-10-02)

The built site reproduced both reviewed boot bugs: a frames 404 kept the terminal unopened
behind the HTML Ghost, and selecting Shell while wasm was held started Shell with no
accessibility mirror/live region or terminal focus. Before evidence and read-back screenshots
are at `/work/tmp/fregat-evidence/p285-review-boot-before/`.

Ghost now owns its parallel asset promise and paints load failures locally, including while
paused. Terminal opening awaits core and fonts independently of Ghost assets. A shared
`startActive` path applies accessibility, fitting, pause policy and input focus during both boot
and tab selection. The browser regression covers 404, truncated gzip, and Shell selected before
wasm is released; it checks live hand-off, failure output, accessibility, focus and actual typed
Shell arithmetic. All three boot regressions pass at
`/work/tmp/fregat-evidence/p285-review-boot-after/`; failure and working-Shell screenshots were
read back. The full frozen hand-off/demo matrix passes again at
`/work/tmp/fregat-evidence/p285-review-handoff/`. Site build and typecheck pass. Formal desktop
and phone looks are healthy and read back under `/work/tmp/fregat-evidence/p285-review-looks/`
(`20261001T215604Z-look-ghostty-webgpu-1280x1000/` and
`20261001T215606Z-look-ghostty-webgpu-390x844/`). The cold trace numbers above predate these
boot repairs and the still-frame fallback below; no updated first-paint or runtime hand-off timing
is claimed.

The original malformed-frame fixture also exposed accepted invalid header dimensions. The
parser now rejects missing, non-integer and non-positive dimensions before they reach a
renderer, so that failure stays in Ghost too. A valid frame test and six invalid-header tests
reproduced the validation gap and pass after the guard; with the real-core compaction test,
eight targeted Node tests pass. All four expanded boot regressions pass at
`/work/tmp/fregat-evidence/p285-review-asset-header/`, including malformed header failure followed
by working Shell input. The failure screenshot was read back. Build and site typecheck pass.

### Runtime-start failure follow-up (2026-10-02)

Held `ghostty-vt.wasm` (desktop) and `bridge.wasm` (phone) requests returned 404 after static
paint. Both reproduced the missing visible failure state at
`/work/tmp/fregat-evidence/p285-runtime-failure-before/`; the other four boot cases passed.

Create/open failure now retains the static Ghost, resets the selected demo to Ghost, keeps both
backend labels `html`, and natively disables tabs and Redraws. Disabled controls have no hover
styling and a default pointer. The caption says: “The live terminal did not start in this browser,
so this is a still frame.” The no-WebAssembly path uses the same state; its redundant hidden
paragraph is removed. No fatal/details element is retained.

All six boot regressions pass at `/work/tmp/fregat-evidence/p285-runtime-failure-after/`.
The runtime faults also select Shell before rejection and check that Ghost labels are restored,
40 static rows remain, the caption is visible, controls are disabled, and hover/keyboard input
cannot change the fallback. Desktop and phone full-page fallback screenshots were read back.
The complete frozen hand-off/demo matrix passes at
`/work/tmp/fregat-evidence/p285-runtime-failure-handoff/`, including no-WebAssembly and no-JS.
Site build and typecheck pass. Healthy desktop and phone looks were read back at
`/work/tmp/fregat-evidence/p285-runtime-failure-looks/20261001T221919Z-look-ghostty-webgpu-1280x1000/`
and `/work/tmp/fregat-evidence/p285-runtime-failure-looks/20261001T221920Z-look-ghostty-webgpu-390x844/`.
This repair changes HTML/CSS; earlier cold-trace numbers describe the earlier build. No new
first-paint or runtime timing claim is made. Software Chromium WebGL2 is confirmed; hardware
GPU and Firefox/WebKit remain unconfirmed. No deployment or GitHub PR merge is performed.

## Phase 1: a DOM renderer, in the package

`src/render/dom/renderer.ts`: a fourth backend that draws `RendererFrameSnapshot` rows as one
`<div>` per row and one `<span>` per run of equal style, inside the terminal host, with the same
theme, padding, cursor and selection as the other backends. It joins `createCompatibleTerminalRenderer`
after Canvas2D and reports `rendererBackend: 'dom'`. It is correct first and cheap second: a row is
rebuilt only when its damage says so, which the snapshot already carries.

The same module exposes a pure function, `renderFrameToHtml(snapshot, options): string`, that
produces the identical markup as a string with no `document`. This is what Phase 2 runs at build
time. The live DOM renderer and the string renderer share one row-building path so they cannot
drift.

Tests: a browser test that mounts the DOM renderer on a probe terminal and checks viewport text,
cursor cell and SGR colors against the Canvas2D result on the same input (the comparison probes
from `bench/` already exist); a Node test that `renderFrameToHtml` matches the DOM renderer's
`innerHTML` for the same snapshot.

Done when the `#fatal` box is gone from the site: a browser with WebGPU, WebGL2 and Canvas2D
disabled shows the ghost, drawn by the DOM renderer.

## Phase 2: the first frame is in the HTML

At `astro build`, a script runs the real core under Node: load `ghostty-vt.wasm`, create a terminal
at the ghost's grid (`fit = 78 × 40`, the font the page uses), write the first ghost frame through
the same `GhostDemo` drawing path, read the snapshot, and emit `renderFrameToHtml`. `index.astro`
inlines that markup inside `#terminal`, with the cell size written as CSS custom properties so the
rows lay out without measurement. The ghost is on screen with the first paint of the HTML.

Then the live terminal takes over in place:

- Fonts are self-hosted (`public/fonts/`, woff2 subsets of JetBrains Mono 400/600/italic and
  Bricolage Grotesque) and preloaded. `ghostty-vt.wasm` and `ghost-frames.txt.gz` get
  `<link rel="preload">`. `main.ts` starts the wasm fetch, the frames fetch and the font load at
  once instead of in sequence.
- The live renderer mounts behind the pre-rendered frame and the swap happens when its first frame
  is painted (the renderer's frame callback), in one step, with no "loading" label in between. The
  pre-rendered markup is removed, not hidden.
- The ghost animation starts from the frame the HTML showed, so the hand-off is a continuation,
  not a restart.

Evidence: the Phase 0 trace repeated on the built site. Done when the ghost is visible at HTML
paint and the swap shows no flash or shift in a frame-by-frame screenshot sequence.

Pre-rendering is cheap enough to run on every build (one terminal, one frame). If running the wasm
under Node at build time turns out to be the slow or fragile part, the fallback is to render the
ghost's cell runs to HTML directly; record that choice here if it is made.

## Phase 3: the page says what it is

Content, in page order, each one a small change to `index.astro` and `styles.css`:

- Masthead: the wordmark links to the page itself; a `v0.2.0` chip (`__SITE_VERSION__`) links to
  `CHANGELOG.md`. The `webgpu` backend label stays visible on phones.
- Under the install command: the README's example (`Terminal.create` → `open` → `write`), with a
  second, collapsed-by-default snippet for the WebSocket PTY wiring from `docs/integration.md`.
- The lede's "behind a native API" becomes what it means: its own API, bytes in and bytes out.
- Facts gain one line on where it runs: WebGPU where browsers ship it on by default, WebGL2 or
  Canvas2D everywhere else, DOM as the last resort, same output in each.
- "Still a preview, so expect gaps" becomes a short list of what is missing, linked to the roadmap.
- A "Measured" section built from `docs/benchmarks/mac-m1/comparison.json` at build time: parse
  throughput, idle CPU, history memory per 10k rows, write and input latency, against xterm.js
  WebGL, with the environment line and a link to `docs/benchmarks.md`. It renders a "measurements
  in progress" state until the owner flips a flag in the build script, after Plan 283's numbers
  land; the page keeps the losing rows when it ships.
- Phone layout: the fitted screen height is the ghost's rows at the fitted font plus padding, with
  `MAX_SCREEN_VIEWPORT_SHARE` lowered under 480 px, so the box is as tall as the ghost.
- Resize bug: `fitTo` measures cell size from the existing canvas (`cellPerPixel`) and reads stale
  values after a large window change (ghost cropped at the top, a stray column of `=` on the
  right). Measure from the renderer's reported cell metrics after the font change settles, or
  refit once more on the next `onResize`.

Done when `look` at 1280 px and 390 px shows each change and the resize sequence
(1280 → 390 → 1280) ends with the ghost whole.

## Phase 4: demos that prove the claims

Tabs return as a quiet row in the window chrome beside the backend label; the page stays as
spare as today. The Ghost tab is the default and the only one pre-rendered.

Three tabs: Ghost, Matrix, Shell. Owner ruling 2026-10-01: only the good demos; Cube, Donut and
Colors stay deleted.

- **Shell**: a real bash. [`just-bash`](https://github.com/vercel-labs/just-bash) 3.6.0
  (Apache-2.0, TypeScript, in-memory filesystem, 70+ commands) loads on first selection of the
  tab, never on page load: 354 KB gzipped. Its browser bundle imports `node:zlib` for gzip only;
  `astro.config.ts` aliases it to a stub. The line editor from the old `shell.ts` (`0efdf5f^`)
  drives it, carrying `result.env` between `exec` calls so `cd` and exports persist. Files:
  `README.md`, `colors.sh` (24-bit ramps, styles, wide text, emoji), `logs/build.log`.
  [`almostnode`](https://github.com/macaly/almostnode) stays an option for a Node tab later.
- **Throughput** is the shell's `bench [MB]` command: it streams generated colored log lines
  straight into the terminal in 64 KiB chunks and prints MB/s. `seq 1 50000` shows the same
  through bash's own output.
- **Matrix**: full-grid rain in the site palette; the stat line reports cells redrawn per frame,
  the opposite end of the ghost's.

Damage overlay: a toggle in the chrome tints the cells redrawn in the current frame over the live
terminal. The package exposes the rows it rebuilt in each painted frame through
`terminal.onFrame(({ rows }) => …)` on every backend, free with no listener, and the site draws the
tint on an overlay. The overlay is off by default and remembers nothing.

Done when each tab has `look` evidence, the Shell tab runs `ls | head`, `echo $((6*7))` and a
`for` loop, and the page's initial transfer size has not grown beyond Phase 2's.

## Order and gates

0 → 1 → 2 → 3 → 4. Phase 3 can run beside 1 and 2; Phase 4 waits for 2 so the tabs are built on
the hand-off, not before it. Each phase is its own PR, verified with `look` and committed by path;
the site workflow deploys on merge. Package versions: Phase 1 is a minor bump (new backend and a
public string renderer), Phase 4's `diagnostics.onFrame` another.

## Done when

- The ghost is visible at HTML paint on a cold cache and the live renderer replaces it with no
  visible change (Phase 0 and Phase 2 traces side by side in this plan).
- A browser with no GPU and no Canvas2D shows the terminal through the DOM renderer.
- The page shows the example code, the version, where it runs, what is missing and (once flipped)
  what it measures.
- The Shell tab runs real bash, loaded only when asked for.
- The owner has looked at it on the phone and the MacBook.
