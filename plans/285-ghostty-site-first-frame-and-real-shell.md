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

Before touching the boot path, record when the ghost first appears, on a cold cache, throttled to
"Fast 4G" and to a slow desktop CPU, in Chromium: HTML paint, font ready, wasm fetched, `create`
resolved, `open` resolved, frames fetched, first ghost frame. `bun run agent:browser trace` against
the built site (`astro preview`) gives the timeline; save it to
`/work/tmp/fregat-evidence/<run>/` and copy the numbers into this plan. Every later phase cites
this baseline.

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

Tabs return as a quiet row in the window chrome beside the backend label, not a control bar; the
page stays as spare as today. The Ghost tab is the default and the only one pre-rendered.

- **Shell**: a real bash. [`just-bash`](https://github.com/vercel-labs/just-bash) (Apache-2.0,
  TypeScript, in-memory filesystem, 70+ commands) loads on first selection of the tab, never on
  page load. The line editor from the old `shell.ts` (`0efdf5f^`) drives it: echo, backspace,
  history, and `bash.exec` on Enter, output written as bytes. The filesystem starts with a few
  files worth exploring (the README, a `colors.sh`, a `logs/` directory). Measure its bundle size
  before committing to it; if it is unreasonable, the tab waits for a lighter runtime.
  [`almostnode`](https://github.com/macaly/almostnode) stays an option for a Node tab later.
- **Matrix**: new, animated; a full-grid stream whose redrawn-cells figure sits near the whole
  grid, the opposite end of the ghost's. The stat line under the window makes the contrast.
- **Throughput**: writes N MB of a corpus from `bench/` and reports MB/s and frames dropped, the
  same measures as `docs/benchmarks.md`, so the visitor's machine joins the table.
- Colors, Cube and Donut come back from history only if they still fit the row; the owner decides
  per demo when the row exists.

Damage overlay: a toggle in the chrome tints the cells redrawn in the current frame over the live
terminal. The package exposes the per-frame damage it already computes (`rebuiltRows` and the
dirty rows from `readRows`) through `diagnostics.onFrame`, and the site draws the tint on an
overlay canvas. The overlay is off by default and remembers nothing.

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
