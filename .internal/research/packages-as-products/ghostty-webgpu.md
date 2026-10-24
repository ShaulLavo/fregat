# ghostty-webgpu: what to sell, what to prove, what to build

Research for [Plan 336](../../../plans/336-packages-as-products.md), Track A. Written 2026-10-08 against
Fregat `0df5eb872` (package version 0.3.20 in `ghostty-webgpu/package.json`). Sources: the package
source, `ghostty-webgpu/docs/`, `CHANGELOG.md`, root plans 281, 283, 285, 286, 287 and 246, the
terminal research wave at `/work/reports/terminal-performance-2026-10-04/wave-20261008/README.md`,
local reference clones (`references/xterm.js` at c58ea36, `references/ghostty-web` at 1858a59,
`references/ghostty` at befcdfd2c), npm, and the web pages linked at the end.

The owner's target pitch is "faster and more correct than any other option in every rendering
scenario". Today's evidence supports most of that, and refutes it in a few named scenarios. Section 6
lists the claims that cannot be made yet. Those losses are also the performance work queue.

## 1. One-liner candidates

Every candidate is true today. The ones that use numbers need the benchmark link beside them.

1. **Ghostty's terminal, in the browser.** The real libghostty-vt core, unpatched, compiled to
   WebAssembly, with GPU renderers that draw only what changed.
2. **The terminal core from Ghostty, the renderer built for the web.** WebGPU, WebGL2, Canvas 2D
   and DOM, one API.
3. **A browser terminal that parses 2.6 to 5 times faster than xterm.js.** (Needs a re-run on the
   current release first; the published table is from 0.2.0.)
4. **Ghostty for the web: as correct as Ghostty, built to run dozens of terminals on one page.**
5. **Bytes in, pixels out, off the main thread.** Ghostty's emulator and GPU renderer in a worker.

Recommendation: lead with (1) as the tagline and (4) as the subhead. (3) belongs in the benchmark
section, not the tagline, until the losses in section 6 close.

## 2. Top 10 differentiators

Ranked by how much each one moves a reader who uses xterm.js today. "Status" says whether it ships
in the package now.

### 1. The real Ghostty core, unpatched and reproducible

- **Pitch:** Same parser, same terminal state, same Unicode widths as the Ghostty app. No fork, no
  patch, a build anyone can reproduce byte for byte.
- **Evidence:** `ghostty-webgpu/ghostty-vt.provenance.json` records the official repository,
  revision `7b11f3dca034d8d24369ad3856afe57946d7902a`, archive SHA-256s, the Zig 0.16.0 compiler
  hash and `"patched": false`. `AGENTS.md`: "The checked-in wasm must come from `bun run build:wasm`,
  at the pinned official upstream repository and revision, without build-time patches or a
  maintained fork." `GHOSTTY_SOURCE_REVISION` is exported at runtime (`src/index.ts`).
  ghostty-web builds from upstream plus a hand-written WASM API patch
  (`references/ghostty-web/patches/ghostty-wasm-api.patch`, about 1,620 lines per Plan 281);
  its README says it relies on patches "until a native Ghostty WASM distribution exists".
- **Status:** shipped. The site build also proves it: `site/src/first-frame.ts` runs the same WASM
  under Node.

### 2. Parser throughput: 2.6x to 5.2x xterm.js

- **Pitch:** libghostty-vt's SIMD-optimized parser takes PTY bytes straight into WASM with no JS
  string decoding.
- **Evidence:** `docs/benchmarks.md`, Apple M1, headed Chromium, 1 Oct 2026, isolated parser,
  4 KiB chunks, three order-alternated repetitions, every sample checked against expected viewport,
  cursor and SGR afterwards. Byte path, MB/s: ASCII 164.4 vs xterm 63.6 vs ghostty-web 65.6;
  real git log 360.4 vs 69.7 vs 65.7; SGR 85.6 vs 63.3 vs 35.9; Unicode 93.1 vs 71.8 vs 55.4;
  cursor motion 166.2 vs 67.9 vs 57.0. Wins every corpus against both. xterm.js's own maintainer
  wrote that its JS parser is near the practical ceiling for JavaScript
  ([xterm.js #5686](https://github.com/xtermjs/xterm.js/issues/5686)).
- **Status:** measured, but on package 0.2.0. Re-run on the current release before publishing
  numbers on the site (the site has `SHOW_MEASUREMENTS = false` in `site/src/measurements.ts`).

### 3. Four renderers, all damage-aware, one API

- **Pitch:** WebGPU where the browser has it, then WebGL2, then Canvas 2D, then plain DOM. Each
  draws the same cells, and each redraws only what changed. No addon to install for GPU rendering.
- **Evidence:** `src/render/selector.ts` (automatic chain), `src/render/webgl`, `src/render/canvas`,
  `src/render/dom`. Damage comes from libghostty-vt's per-row dirty state
  (`src/core/render-state.ts`). WebGL and WebGPU build frames in Zig (`scripts/bridge.zig`,
  `src/core/zig-frame.ts`): persistent 64-byte cell and 96-byte glyph records, dirty byte-range
  detection, one bounded upload span per changed buffer (changesets 771dbbe, 74ce1a5). Canvas
  reuses unchanged rows and scrolls by blit (0df200c, cb6efff). DOM retains unchanged rows
  (ef362cb, 039d66a). GPU device loss is recovered (518168b). xterm.js 6 ships DOM in core and
  WebGL as an addon and removed its Canvas addon; ghostty-web 0.4.0 draws with Canvas 2D only
  (`references/ghostty-web/lib/renderer.ts:143`).
- **Status:** shipped. Canvas has an experimental pixel mode with a Zig compositor
  (`canvas-compose.wasm`); it is slower than fillText today, so do not market it.

### 4. Off the main thread: the whole terminal in a worker

- **Pitch:** Import `ghostty-webgpu/worker` and the emulator, the Zig frame builder, glyph
  rasterization and the GPU renderer run in a dedicated worker on an `OffscreenCanvas`. A PTY
  producer can hand its `MessagePort` to the terminal, so output never touches the page's main
  thread.
- **Evidence:** `docs/api.md` "packaged worker checkpoint"; `attachOutputPort(port)` and
  `fenceOutput(sequence)`; `src/worker/`; Plan 287. Fregat itself uses the worker entry (18 import
  sites in `apps/web/src`). xterm.js and ghostty-web run on the main thread only.
- **Status:** shipped as a checkpoint. Known gaps listed in section 6 (Canvas modes, some link and
  extension paths).

### 5. Built for many terminals on one page

- **Pitch:** One shared WebGPU device and one coordinated submission per frame across all terminals
  on the page; an idle terminal costs no frames.
- **Evidence:** changeset f45f31d (shared device leases, one render turn for all canvases);
  `docs/benchmarks/webgpu-ownership.md`. Idle CPU, M1, 0.2.0: 7.3% vs xterm WebGL 14.4% of a core
  at one terminal, 9.0% vs 20.0% at 17 (`docs/benchmarks.md`). Raspberry Pi 4 capacity
  observation, 8 Oct: ghostty WebGL kept 4 rolling terminals at 60 Hz, xterm WebGL kept 1
  (wave README "Round 1 result"; labelled there as unequal conditions, so not a headline).
- **Status:** shipped. The Pi number needs the equal-work run that lane r2-pi is doing now.

### 6. Less energy on streaming output, in the scenarios that matter most

- **Pitch:** Log streams, builds and `cat` cost less battery than xterm.js on the same renderer
  class.
- **Evidence:** terminal wave round 1, Apple M1, 17 terminals, all-Chrome CPU energy ratio
  (ghostty / counterpart, lower is better), each reviewed "qualified with limits":
  - WebGL vs xterm.js 6 WebGL, bounded rolling logs: 0.751 (instructions 0.690); bounded
    rolling Unicode logs: 0.730.
  - DOM vs xterm.js 6 DOM: rolling 0.375, Unicode 0.392, line scroll 0.735.
  - Canvas 2D vs xterm.js 5.5 Canvas: Unicode 0.283, line scroll 0.197; vs ghostty-web: Unicode
    0.401, line scroll 0.289, edits 0.650.
    Earlier Linux NVIDIA run (`docs/perf-attribution.md`, "Headline rolling real-history output"):
    native WebGL total CPU 0.934 of xterm WebGL at 17 terminals, 0.899 at one.
- **Status:** measured on current main, losses alongside (section 6). Energy and instruction
  counts replaced CPU seconds after the wave showed CPU seconds are clock-confounded on the M1.

### 7. Server-side rendering and a headless core

- **Pitch:** Render a terminal frame to HTML in Node, so the page paints the terminal before any
  WASM loads, then the live renderer takes over in place. The same core runs headless for tests,
  replay and servers.
- **Evidence:** `renderFrameToHtml` and `snapshotRenderState` exported from `src/index.ts`;
  `GhosttyRuntime`/`GhosttyTerminal` run in plain Node (core tests run without DOM globals per
  `AGENTS.md`). The live site does it: `site/src/first-frame.ts` writes the first ghost frame
  through libghostty-vt at build time and inlines it into `index.html` (Plan 285, #304).
  `captureViewport()` and `paintTerminalViewport()` restore a saved screen instantly on reload
  without starting WASM (`docs/saved-viewport.md`).
- **Status:** shipped. No other browser terminal we found renders its first frame on the server.

### 8. Modern protocols on by default

- **Pitch:** What Ghostty parses, you get: no Unicode addon, no opt-in flags.
- **Evidence:**
  - Kitty keyboard protocol with press, repeat and release: `src/core/tests/input.test.ts:352`,
    `src/dom/tests/terminal-input.browser.test.ts:533`, manual checker
    `demo/kitty-keyboard-check.py` (CONTROL PASS in `docs/phase-3-acceptance.md`). xterm.js has
    it behind `vtExtensions.kittyKeyboard` on its unreleased main branch
    (`references/xterm.js/typings/xterm.d.ts:474`).
  - Grapheme clustering, mode 2027, with native cell widths (`docs/integration.md`); xterm.js
    needs the experimental `@xterm/addon-unicode-graphemes`.
  - OSC 8 hyperlinks plus URL detection and keyboard link discovery (`focusNextLink`).
  - OSC 52 clipboard writes behind a host policy, denied by default, reads never answered
    (Plan 286, native OSC section).
  - Focus events (1004), bracketed paste (2004), color-scheme reports (2031), SGR mouse, XTVERSION,
    device attributes (`src/core/abi.ts`).
  - Minimum-contrast color adjustment (`RendererTheme.minimumContrast`), COLR emoji that follow
    SGR and selection colors (`docs/integration.md`, "ZWJ emoji").
- **Status:** shipped for the listed items. Images are not (section 6).

### 9. Reads your Ghostty config

- **Pitch:** A Node or Bun server can resolve the user's own Ghostty appearance (theme, palette,
  font, light and dark profiles) with Ghostty's own config loader, so the web terminal looks like
  their desktop terminal.
- **Evidence:** `ghostty-webgpu/config-resolver` subpath, `docs/config-resolver.md`,
  `docs/config-resolver-feasibility.md` (PASS, four-platform native matrix, read-only, no paths or
  config text leak in failures). Static native helpers for macOS arm64/x64 and Linux arm64/x64.
- **Status:** shipped in source as a host-only entry. The native binaries are not in the checkout
  (`native/config-resolver/` holds only `bootstrap.json`) and need `bun run build:host`; verify
  what the npm tarball contains before advertising it.

### 10. Honest, reproducible benchmarks

- **Pitch:** Every number is reproducible from one command, with losses published next to wins.
- **Evidence:** `bun run bench:compare` builds a portable bundle (`docs/benchmarks.md`, "Run it");
  JSON artifacts record commit, source hash, browser, GPU, font, DPR and fixture hashes
  (`docs/comparison-provenance.md`); every parse sample is checked for correct output; failed
  cases are retained, not dropped. The "Wins and losses" table already prints losses.
- **Status:** shipped. This is a selling point in its own right: few libraries in this space publish
  losses. Use it on the benchmark page.

Also worth a line on the site, below the top 10: Zed-style hotkeys with platform packs
(`attachTerminalHotkeys`, `docs/hotkeys.md`); native text measurement and prompt geometry for line
editors (`measure`, `measureTexts`, `writeAndReadGeometry`); a coherent `submittedFrame` for
observers; page-granular scrollback with a byte budget (`docs/api.md`); production use inside
Fregat.

## 3. The correctness story

Use these, in this order:

1. **Same emulator as Ghostty.** Parsing, modes, wrapping, reflow, scrollback eviction, selection
   text and grapheme widths come from libghostty-vt, unpatched. Ghostty describes the core as
   SIMD-optimized, fuzzed and Valgrind-tested
   ([libghostty post](https://mitchellh.com/writing/libghostty-is-coming)); cite it as their claim.
2. **One owner for terminal state.** Selection, history reads, copy (`plain`, `vt`, `html`),
   accessibility rows and rendered text all read the same native data
   (`docs/history-api.md`). Nothing re-parses output in JavaScript.
3. **Unicode that matches the terminal.** Widths are native; mode 2027 makes ZWJ sequences two
   cells, matching Ghostty. Text measurement for line editors uses the same native widths
   (`docs/api.md`, "live geometry and text width").
4. **Measured against the others.** The comparison runner found real defects in the alternatives
   on the same fixtures (`docs/benchmarks.md`, "Qualification notes"):
   - ghostty-web 0.4.0 trapped with `RuntimeError: memory access out of bounds` on every rendered
     Unicode burst case, at 1, 8 and 17 terminals, and `Terminal.write('')` throws `RangeError`.
   - xterm.js 6.0.0 lost ZWJ code points when UTF-8 bytes arrived one byte at a time.
     These are dated, version-pinned observations. State them as such, with the artifact link; do
     not generalize them.
5. **Tested in real browsers.** GPU renderer tests run in real Chromium (`vitest.browser.config.ts`
   supports Firefox and WebKit engines too); the packed tarball is installed and rendered in a
   clean project by `bun run test:package`.

Verified answers to the questions in the brief:

| Question                                                              | Answer                                                                                  | Source                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Kitty keyboard protocol                                               | Yes, with press/repeat/release                                                          | tests above, `demo/kitty-keyboard-check.py`                            |
| Kitty graphics protocol                                               | No. Upstream disables it on `wasm32-freestanding` because it needs OS timestamps        | `references/ghostty/src/terminal/build_options.zig:155-166`; Plan 286  |
| Sixel                                                                 | No. Not implemented upstream                                                            | Plan 286 "What native Ghostty brings"                                  |
| Unicode / graphemes                                                   | Yes, native, mode 2027                                                                  | `docs/integration.md`                                                  |
| Ligatures                                                             | No. Cells are drawn one by one; DOM sets `font-variant-ligatures:none`                  | `src/render/dom/html.ts:54`                                            |
| Synchronized output (2026)                                            | Not found in the renderer (no reference to mode 2026 in `src/`); xterm.js 6 supports it | grep of `src/`; xterm.js 6.0.0 notes                                   |
| OSC 133 prompts, OSC 7 cwd, OSC 9/777 notifications, OSC 9;4 progress | Parsed natively, not exposed in the public API                                          | Plan 286; `src/core/abi.ts` options 25, 29, 30 unused outside `abi.ts` |
| tmux control mode, search                                             | Exist upstream (`src/terminal/tmux`, `search.zig`), not bound                           | `references/ghostty/src/terminal/`                                     |

## 4. xterm.js addon parity

xterm.js today ships 13 official addons (`references/xterm.js/addons/`, npm `@xterm/*` 6.0.0 line,
betas at 6.1.0-beta.304): attach, clipboard, fit, image, ligatures, progress, search, serialize,
unicode11, unicode-graphemes, web-fonts, web-links, webgl. Canvas was removed in 6.0.0. ghostty-web
0.4.0 ships one addon, fit (`references/ghostty-web/lib/addons/fit.ts`). restty exposes a plugin
API and search (see its docs), not a separate addon set.

Plan 286 owns the extension model: `Terminal.create({ extensions })` and `terminal.use(extension)`
are public now (`docs/api.md`, "extensions and original input"); the line editor is the first
extension, in progress at `ghostty-webgpu-line-editor/`.

Priority: P0 blocks most xterm.js migrations; P1 is expected by a large share of users; P2 is
nice to have.

| xterm.js addon                                                   | ghostty-webgpu                                                                                                      | State         | Priority | Notes                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addon-fit`                                                      | Automatic fit, built in                                                                                             | Have (better) | —        | Fits on mount and resize with atomic geometry commit. Plan 286 splits observers out into an extension; keep the zero-config default.                                                                             |
| `addon-webgl`                                                    | WebGL2 and WebGPU renderers, built in                                                                               | Have (better) | —        | WebGPU has no xterm.js equivalent.                                                                                                                                                                               |
| Canvas (removed in xterm 6)                                      | Canvas 2D renderer, built in                                                                                        | Have          | —        | Also a DOM renderer as the last fallback.                                                                                                                                                                        |
| `addon-unicode11`                                                | Native Ghostty widths                                                                                               | Have (better) | —        | No addon needed.                                                                                                                                                                                                 |
| `addon-unicode-graphemes`                                        | Mode 2027, native                                                                                                   | Have (better) | —        | xterm's is experimental.                                                                                                                                                                                         |
| `addon-web-links`                                                | URL detection, OSC 8, `registerLinkProvider`, `focusNextLink`                                                       | Have          | —        | Worker entry: provider registration and keyboard discovery report capability errors (`docs/api.md`).                                                                                                             |
| `addon-clipboard` (OSC 52)                                       | `clipboardWrite` policy, default deny, write-only                                                                   | Have          | —        | No clipboard reads by design; say so. Copy/paste hotkeys come from `attachTerminalHotkeys`.                                                                                                                      |
| `addon-attach`                                                   | Eight-line WebSocket recipe; `attachOutputPort` in the worker                                                       | Partial       | P2       | Ship a tiny `attach(socket)` extension for copy-paste parity; the worker port is the better story.                                                                                                               |
| `addon-web-fonts`                                                | Worker `fonts: [{ family, source }]`; glyph refresh on font load (324667b)                                          | Partial       | P2       | Main entry relies on the page's CSS fonts. Document the pattern.                                                                                                                                                 |
| `addon-serialize`                                                | `renderFrameToHtml`, `getSelection({ format: 'vt' \| 'html' })` after `selectAll()`, `readLines`, `captureViewport` | Partial       | P1       | No single "serialize full state including modes" call. A `serialize()` extension over native formatting would close it.                                                                                          |
| `addon-search`                                                   | None                                                                                                                | Missing       | P0       | Most-used addon after fit. Upstream has `search.zig`; Plan 246 plans retained-cell search with stable match coordinates. Needs decorations for highlights.                                                       |
| `addon-image` (Sixel, iTerm IIP)                                 | None                                                                                                                | Missing       | P1       | Kitty graphics needs an upstream change for freestanding WASM (timestamps) or a different target; Sixel does not exist upstream. restty's v0.3.0 notes claim Kitty image playback; find out how before planning. |
| `addon-ligatures`                                                | None                                                                                                                | Missing       | P2       | Cell-at-a-time glyph atlas; ligatures need run shaping. Ghostty native supports ligatures, so users will ask.                                                                                                    |
| `addon-progress` (OSC 9;4)                                       | Parsed natively, no event                                                                                           | Missing       | P1       | Cheap: wire `ProgressReport` (`abi.ts` option 30) to an event; also OSC 7 cwd, OSC 9/777 notifications and OSC 133 prompt marks. Each is small and Ghostty-native, so it is a differentiator once shipped.       |
| Core API, not addons                                             |                                                                                                                     |               |          |                                                                                                                                                                                                                  |
| `@xterm/headless`                                                | `GhosttyRuntime` / `GhosttyTerminal` in Node                                                                        | Have          | —        |                                                                                                                                                                                                                  |
| `registerMarker` / `registerDecoration`                          | None                                                                                                                | Missing       | P1       | Needed for search highlights, shell-integration gutters and command decorations.                                                                                                                                 |
| `parser.register{Csi,Osc,Dcs,Esc}Handler`                        | Custom OSC observation at session level only; extension OSC contributions are rejected today                        | Partial       | P1       | Plan 286 Phase 0 open items.                                                                                                                                                                                     |
| `attachCustomKeyEventHandler`, `onKey`                           | Extension `input` hook (claim/pass before encoding), `connectInput`                                                 | Have          | —        | Different shape; map it in the migration guide.                                                                                                                                                                  |
| `screenReaderMode`                                               | Accessibility mirror rows, live region, cursor status (`dom/accessibility.ts`)                                      | Partial       | P1       | xterm.js's accessibility is proven in VS Code; ours has no recorded screen-reader audit.                                                                                                                         |
| `options.ligatures`, `rescaleOverlappingGlyphs`, `overviewRuler` | None                                                                                                                | Missing       | P2       |                                                                                                                                                                                                                  |

Build order this suggests, after the performance round: search (with decorations) and the
Ghostty-native events (progress, cwd, notifications, prompt marks), then serialize, then images
once the upstream question is answered, then ligatures.

## 5. Migrating from xterm.js

The 0.2.0 release removed the xterm.js facade on purpose (`CHANGELOG.md`, 0.2.0). The migration
guide is therefore a mapping table, not a drop-in import swap. That is a positioning choice to state
plainly: ghostty-web promises the xterm.js API; this library offers its own API with Ghostty's
semantics.

Key differences to lead the guide with:

- Creation is async: `await Terminal.create(options)`, then `await terminal.open(host)`. WASM loads
  inside `create`; there is no separate `init()`.
- `onData` delivers `Uint8Array` bytes, not strings. Send them to the PTY as they are.
- There is no `write(data, callback)`. Main-entry writes are synchronous and return a result;
  worker-entry operations return promises (`TerminalApi<'sync' | 'async'>`).
- Fit is automatic. Give the mount a real size.
- Scrollback is page-granular: `scrollbackLimit` can retain somewhat fewer or more rows than asked,
  and `scrollbackByteLimit` is a second budget. Use `lineCount()` for the real count.

| xterm.js                                                                                              | ghostty-webgpu                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `new Terminal(opts)`; `term.open(el)`                                                                 | `await Terminal.create(opts)`; `await terminal.open(el)`                                               |
| `term.write(str \| bytes, cb)`; `writeln`                                                             | `write(str \| bytes)`; `writeln` (returns a result; Promise in the worker)                             |
| `term.onData(str => …)`, `onBinary`                                                                   | `onData(bytes => …)`                                                                                   |
| `term.input(data)`, `term.paste(text)`                                                                | `sendInput(data)`, `paste(data)`; `key(input)` for synthesized keys                                    |
| `term.onResize`, `onTitleChange`, `onBell`, `onSelectionChange`, `onScroll`, `onRender`               | `onResize`, `on('title')`, `on('bell')`, `on('selection')`, `on('scroll')`, `onFrame(({ rows }) => …)` |
| `term.resize(cols, rows)` / `FitAddon.fit()`                                                          | automatic; `setAppearance({ grid })` for fixed grids                                                   |
| `term.options.theme`, `fontSize`, `fontFamily`, `cursorStyle`, `cursorBlink`                          | `setTheme`, `setFont`, `setCursor`, or one `setAppearance({ theme, font, cursor })`                    |
| `options.scrollback`                                                                                  | `appearance.scrollbackLimit`, `appearance.scrollbackByteLimit`                                         |
| `options.minimumContrastRatio`                                                                        | theme `minimumContrast`                                                                                |
| `buffer.active.length`; `getLine(i).translateToString()`                                              | `lineCount()`; `readLines(start, end, { trimRight })` (1,024 rows per call)                            |
| `getSelection()`, `select`, `selectLines`, `selectAll`, `clearSelection`                              | `getSelection({ format, trim, unwrap })`, `selectRange`, `selectLines`, `selectAll`, `clearSelection`  |
| `scrollLines`, `scrollToTop`, `scrollToBottom`, `scrollToLine`                                        | `scrollBy`, `scrollToTop`, `scrollToBottom`, `scrollToRow`                                             |
| `reset()`, `clear()`                                                                                  | `reset()`; clear via the `terminal.clear` hotkeys command                                              |
| `refresh`, `clearTextureAtlas`, `focus`, `blur`, `dispose`                                            | same names                                                                                             |
| `loadAddon(addon)`                                                                                    | `use(extension)` or `Terminal.create({ extensions })`                                                  |
| `registerLinkProvider`, `WebLinksAddon`                                                               | `registerLinkProvider`; URL and OSC 8 detection built in                                               |
| `attachCustomKeyEventHandler`                                                                         | extension `input` hook returning `'claim'` or `'pass'`                                                 |
| `options.screenReaderMode`                                                                            | `accessibility` option, `setAccessibilityEnabled()`                                                    |
| `options.macOptionIsMeta`                                                                             | `inputHooks.macOptionIsMeta` (session-level path only today)                                           |
| `term.textarea`, `term.element`, `term.modes`                                                         | `textarea`, `element`, `inputModes` (alternate screen and mouse reporting only)                        |
| `@xterm/headless`                                                                                     | `GhosttyRuntime.create()` + `runtime.createTerminal()`                                                 |
| `SerializeAddon.serializeAsHTML()`                                                                    | `renderFrameToHtml(snapshotRenderState(...), …)`                                                       |
| `registerMarker`, `registerDecoration`, `parser.register*Handler`, `options.convertEol`, `windowsPty` | not available                                                                                          |

Plan 336 Track F asks for this table to live in the docs as "Migrating from xterm.js". Every row
above was read from `src/dom/terminal-api.ts`, `src/dom/types.ts` and `src/term/types.ts`; the
docs version should be generated or type-checked so it cannot drift.

## 6. Honest gaps, and claims not to make

### Do not claim (yet)

1. **"Faster in every rendering scenario."** Current losses, from the 8 Oct wave (M1, 17 terminals,
   all-Chrome energy ratio, ghostty / counterpart):
   - WebGL vs xterm.js WebGL: Unicode/emoji 1.320, line scroll 1.361 (reviewed: "real losses").
     Cause found: about 99% of rows rebuilt per one-line scroll, plus per-frame copied-text
     publication. Lanes r2-frame and r2-publish are working on both now; a diagnostic skipping
     publication already shows Unicode energy 0.820.
   - DOM vs xterm.js DOM: interactive edits 1.147, cause unknown (lane r2-dom-edits).
   - WebGPU: strict presentation write-p95 still fails (1.0107).
   - Write latency p50 on one terminal lost in both the 1 Oct baseline (14.0 vs 8.2 ms) and the
     attribution rerun (17.0 vs 12.2 ms) on 0.2.x; not re-measured since the Zig frame builder.
   - Canvas 2D (fillText) beats xterm's Canvas but costs more than xterm.js WebGL. Fine as a
     fallback, never as "fast Canvas beats xterm".
     Say "faster than xterm.js on streaming output and parsing" with links, until the losses close.
2. **"18x less memory per 10k rows."** The 0.40 vs 7.30 MiB figure is JS heap only; WASM linear
   memory is reported separately (5.06 MiB for one terminal with history). Whole-Chromium RSS
   delta is 43.6 vs 52.4 MiB. Claim "less memory" only with the full breakdown.
3. **Current numbers from the README table.** The README parse table is from package 0.2.0 on
   1 Oct. Re-run on the release being published, and put date, machine and version beside it.
4. **Firefox, Safari or Windows performance.** Only headed Chromium on Apple M1 and Linux was
   measured (`docs/benchmarks.md`, "Correctness and limits").
5. **WebGPU as the fastest backend.** Cross-API rolling energy was 0.256 of xterm WebGL under a
   full-stream history policy that the reviewer did not qualify as a headline, and the 4 Oct
   CPU-seconds matrix had WebGPU at parity. WebGL is currently the strongest measured backend.
6. **"Only libghostty WebGPU terminal."** restty (wiedymi/restty, about 410 stars) uses
   libghostty-vt with WebGPU and a WebGL2 fallback, plus search, plugins and an xterm-style
   wrapper. Differentiate on the unpatched pin, four renderers, the worker entry, SSR first frame
   and published benchmarks; benchmark restty before any comparison claim.
7. **Images, ligatures, search, synchronized output.** Not there (section 3 table).
8. **Accessibility parity with xterm.js.** No screen-reader audit is recorded.
9. **Zero-dependency or small bundle.** `ghostty-vt.wasm` is 821 KB (278 KB gzip, 221 KB brotli),
   larger than ghostty-web's stated ~400 KB. The core needs `@fregat/hotkeys` from a GitHub
   tarball (`package.json` catalog). No measured comparison of total shipped bytes exists.

### Product gaps a visitor will hit

- **npm is stale.** `npm view ghostty-webgpu` shows `latest` 0.1.2 (28 Sep); the repository is at
  0.3.20. The publish job in `.github/workflows/release.yml` runs only when the
  `NPM_TRUSTED_PUBLISHING` repository variable is `true`; recent release runs succeed without
  publishing. Everything in the README after 0.1.2 is not installable from npm. Fix before any
  launch copy goes out. (Cause inferred from the workflow condition; not confirmed in repository
  settings.)
- **The README calls it "still a preview"** and keeps the lowercase voice Plan 336 retires. Plan
  281's owner rule (keep numbers out of the README until the losses close) conflicts with the
  README's current parse table; Plan 336 decision 2 (numbers only beside a linked benchmark)
  should settle it.
- **Changelog entries are engineering notes** ("Measure WebGPU through production default device
  ownership and coordinated submission…"). Track G applies.
- **The worker entry is a checkpoint.** Canvas modes, link providers, keyboard link discovery and
  some extension hooks report capability errors there (`docs/api.md`).
- **Extension model is half public.** Custom OSC contributions are rejected; named commands and
  contributed links are internal (Plan 286 Phase 0 unchecked items).
- **`package.json` homepage points to the GitHub README**, not the site; keywords omit `xterm`,
  `webgl`, `canvas`, `pty`, `ghostty-web`.

### Ideas worth checking (unverified leads, not claims)

- The WASM is built with `-Doptimize=ReleaseSmall` (`ghostty-vt.provenance.json` recipe). A
  `ReleaseFast` build may raise parse throughput at a size cost. One bounded benchmark decides it.
- Upstream Ghostty at `befcdfd2c` exposes a glyph protocol for custom PUA glyphs and a native
  search module. Both are newer than our pin `7b11f3d` (glyph protocol option 24 already appears in
  `abi.ts`, unrendered). Bumping the pin is the cheapest path to search.
- Kitty graphics is gated on OS timestamps for freestanding targets. A host-supplied clock import
  might be an acceptable upstream change; ask upstream before forking anything (the no-patch rule
  is part of the pitch).

## The live site and demo

`https://shaullavo.github.io/ghostty-webgpu/`, built from `ghostty-webgpu/site/` (Astro):

- **Ghost tab:** the ghostty.org ghost animation (MIT, credited) played as terminal output. Its first
  frame is written through libghostty-vt in Node at build time and inlined as HTML, so the terminal
  is visible before fonts or WASM load; the live renderer then replaces it in place.
- **Matrix tab:** a throughput animation.
- **Shell tab:** a real bash compiled to JavaScript by `just-bash`, lazily loaded, with a
  `bench N` command that streams N lines of colored log output.
- The masthead shows the version; a badge shows which renderer this device picked.
- The "Measured" section is switched off (`SHOW_MEASUREMENTS = false`) and reads "Measurements in
  progress".
- Plan 285 recorded the owner's earlier rejection of Open Graph tags and site docs; Plan 336 now
  asks for both (Track D3, D5).

## Checklist for Tracks B, C, D and F

- [ ] Fix npm publishing so `latest` matches the repository before any copy ships.
- [ ] Re-run `bench:compare` on the release being published (M1 and Linux), WebGL vs xterm WebGL and
      DOM vs xterm DOM like for like, energy and instructions, and regenerate `docs/benchmarks.md`.
- [ ] Publish wins with links: parse throughput, idle CPU, streaming-output energy per renderer.
      Publish the losses table beside them.
- [ ] Tagline from section 1 (1) and (4); no "every scenario" wording until WebGL Unicode/scroll and
      DOM edits close.
- [ ] Add a "Why not ghostty-web / restty / xterm.js" section: facts only, version-pinned, each with
      its source.
- [ ] Docs: getting started, PTY over WebSocket, renderers and fallback, worker entry, fonts, themes,
      hotkeys, config resolver, saved viewport and SSR first frame, extensions, the xterm.js
      migration table (type-checked).
- [ ] Addon roadmap page labelled "planned" per Plan 336 decision 3: search, decorations,
      progress/cwd/notifications/prompt marks, serialize, images, ligatures.
- [ ] `package.json`: homepage to the docs site, keywords `xterm`, `xterm.js`, `webgl`, `webgpu`,
      `terminal`, `pty`, `wasm`, `ghostty`.
- [ ] Verify what the npm tarball ships for the config resolver before advertising it.

## Sources

- [coder/ghostty-web](https://github.com/coder/ghostty-web) (npm 0.4.0, last published 2026-06-28)
- [xterm.js releases](https://github.com/xtermjs/xterm.js/releases) (6.0.0; Canvas addon removed,
  progress addon added, synchronized output and OSC 52 added)
- [xterm.js #5686, Explore adopting libghostty](https://github.com/xtermjs/xterm.js/issues/5686)
- [wiedymi/restty](https://github.com/wiedymi/restty) and its
  [v0.3.0 release](https://github.com/wiedymi/restty/releases/tag/v0.3.0)
- [awesome-libghostty](https://github.com/lawrencecchen/awesome-libghostty)
- [Mitchell Hashimoto, libghostty is coming](https://mitchellh.com/writing/libghostty-is-coming)
