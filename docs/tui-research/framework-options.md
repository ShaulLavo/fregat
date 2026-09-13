# TUI framework options for a Bun + TypeScript terminal client

Key: `framework-options`. Date: 2026-09-05. Machine: Linux x64, Bun 1.4.0.

Paths used below:

- `OTUI` = `/tmp/claude-1000/-work-projects-platform/9d7da5f6-430a-400d-bf73-3d5f4e1abcbf/scratchpad/otui/node_modules/@opentui` (a fresh install of `@opentui/*@0.5.10`, made for this report because neither reference repo ships `node_modules`).
- `OC` = `/work/projects/platform/references/opencode`
- `T1` = `/work/projects/platform/references/t1code`
- `P` = `/work/projects/platform`

## 1. Recommendation (TL;DR)

**Use `@opentui/core` 0.5.x with `@opentui/react`.** Pin exact versions through the workspace catalog, ship as a `bun build --compile` binary, test headlessly with `@opentui/core/testing` under `bun --bun vitest`.

Why, in one paragraph: OpenTUI is the only TypeScript option whose terminal layer (cell buffer, Yoga flexbox, grapheme-aware width, kitty keyboard, SGR/pixel mouse, kitty/sixel images, synchronized output, OSC 8/52/99, capability probing, scrollbox, markdown, code, diff, textarea, embedded VT) is already built, native, and in production at scale (OpenCode). Between its two bindings, React is the one that lets `apps/web` code cross over: the web app is React 19.2 with 135 files on `@tanstack/react-query` and 33 on `zustand`, and every DOM-free hook, store, context and query definition runs unchanged under `@opentui/react` (same React, same reconciler contract). Solid would share none of that, needs a Babel preload/build plugin, pins `solid-js` exactly, and fails _silently_ (stale UI, no error) when the plugin is missing. The one thing Solid has over React is that it is the binding OpenCode dogfoods; that is a real risk and is mitigated below rather than decisive.

## 2. Evidence base

Read (not guessed):

- `@opentui/core|react|solid|keymap@0.5.10` type surfaces, READMEs, bundled JS, and the native `libopentui.so` (`strings`), installed under `OTUI`.
- npm registry metadata (`npm view`) for OpenTUI, Ink, blessed, neo-blessed, terminal-kit and supporting libs.
- opentui.com docs pages (`/docs`, `/docs/getting-started/runtime-support`, `/docs/bindings/react`, `/docs/bindings/solid`) and GitHub (`anomalyco/opentui`, releases).
- `OC/packages/tui` (Solid TUI, 185 source files), `OC/packages/opencode/script/build.ts` (single-binary build), `OC/script/upgrade-opentui.ts`.
- `T1/apps/tui` (React TUI, one 17,407-line `ui.tsx`), `T1/packages/client-core` (framework-free shared logic).
- `P/apps/web` dependency and feature layout, `P/packages/contracts`, `P/docs/product-vision.md`, `P/docs/environments-and-remote-plan.md`.
- crush `go.mod` (Go only; used for the "chroma equivalent" question).

Ran (Bun 1.4.0): headless core render, React `testRender`, Solid `testRender` with and without preload, `bun --bun vitest` over OpenTUI, `bun build --compile` single binary, Ink 7 under Bun, markdown/tree-sitter paint timing. Results are in section 9.

## 3. OpenTUI core (`@opentui/core` 0.5.10)

### 3.1 Architecture and rendering model

- TypeScript facade over a Zig native library, called through `bun:ffi` (Bun) or `--experimental-ffi` (Node 26.4+). `OTUI/core/platform/ffi.d.ts:56-67` defines a Bun backend and a Node backend; `OTUI/core/README.md` states "runs on Bun 1.3.0 or later, or on Node.js 26.4.0 or later with ECMAScript modules (ESM) and `--experimental-ffi`".
- Native library per platform: `@opentui/core-{darwin,linux,win32}-{x64,arm64}` plus `linux-*-musl` (8 packages, `OTUI/core/package.json` optionalDependencies). Linux x64 `libopentui.so` is 6.27 MB and bundles Ghostty (`LICENSE-GHOSTTY`), libwebp, lcms2, stb, wuffs (`OTUI/core-linux-x64/`).
- Loader: `OTUI/core-linux-x64/index.bun.js` is literally `await import("./libopentui.so", { with: { type: "file" } })`, which is what makes `bun build --compile` embed it.
- Rendering: double-buffered cell grid in native memory. `OTUI/core/renderer.d.ts:237-238` (`nextRenderBuffer`, `currentRenderBuffer: OptimizedBuffer`); `OTUI/core/buffer.d.ts:23-28` exposes the raw `char: Uint32Array, fg: Uint16Array, bg: Uint16Array, attributes: Uint32Array` planes. Docs: "renders a component tree, lays it out with Flexbox, handles terminal input, and updates the cells that changed."
- Scheduling: `requestRender()`, `requestLive()/dropLive()` (animation mode), `targetFps`/`maxFps`, `useThread` (native render thread, `renderer.d.ts:40,433,505`), `setFrameCallback`, `idle()`, `getSchedulerState()`. Post-process hooks over the buffer (`postProcessFns`, `post/effects.d.ts`).
- Screen modes: `"alternate-screen" | "main-screen" | "split-footer"` (`renderer.d.ts:60`) plus `writeToScrollback()` / `createScrollbackSurface()` (`renderer.d.ts:468-469`, `OTUI/solid/src/scrollback.d.ts`). This is the Claude-Code-style "transcript in scrollback, sticky footer UI" mode, relevant to the agent-view-first root in `P/docs/product-vision.md:27`.
- Synchronized output: the `.so` contains `[?2026$p`, `[?2026h`, `[?2026l` and the DECRPM replies `2026;1$y` / `2026;2$y`; exposed as `capabilities.sync` (`OTUI/core/types.d.ts:75`).

### 3.2 Layout engine

Yoga flexbox semantics, implemented natively. Evidence: `OTUI/core/yoga.d.ts:218-244` declares `class Node { readonly ptr: Pointer; calculateLayout(); getComputedLayout() }` over an FFI pointer; every renderable owns a `yogaNode` (`OTUI/core/Renderable.d.ts:146`); the full Yoga enum set (Align, Display incl. `Contents`, Errata, Gutter, PositionType static/relative/absolute) is present; there is a `tests/yoga-upstream` folder. Version history confirms the move: `@opentui/core@0.2.7` depended on `yoga-layout@3.2.1` (`T1/bun.lock:669`), `0.4.5` and `0.5.10` do not (`OC/bun.lock:2042`, `OTUI/core/package.json`). Percent units, gap, min/max, `overflow: hidden|scroll` are all in `OTUI/core/lib/yoga.options.d.ts`.

### 3.3 Text, wrapping, unicode

- Text lives in native text buffers: `OTUI/core/text-buffer-view.d.ts:27-28` `setWrapWidth()`, `setWrapMode("none"|"char"|"word")`; `TextBufferRenderable.d.ts:17,80-81` exposes `wrapMode`; `Code`, `Diff`, `Markdown` tables all take `wrapMode`.
- Width: `WidthMethod = "wcwidth" | "unicode" | "unicode-wide"` (`types.d.ts:54`), detected per terminal (`capabilities.unicode`), overridable with `OPENTUI_FORCE_WCWIDTH` (string in `.so`). Grapheme handling is Ghostty's (`libghostty`, `GraphemeTracker`, `GraphemePool` strings in the `.so`; release v0.5.8 "Matched Ghostty wide grapheme widths", v0.5.8 "Thai spacing mark width"). Mode 2027 (grapheme clustering) is probed (`[?2027$p`). My headless test rendered `Hello 你好 🚀 wide` with correct cell advance (section 9).
- Styled text: `t\`...\``template,`bold/fg/bg/link(url)` chunk helpers (`OTUI/core/lib/styled-text.d.ts`), `StyledText`=`TextChunk[]`. Selection (mouse drag, `getSelection()`, `renderer.d.ts:604-618`) and per-renderable `selectable`.

### 3.4 Built-in renderables (all also JSX intrinsics in both bindings)

`OTUI/core/renderables/`: `Box` (border styles, title, focus ring), `Text`/`TextNode`, `ScrollBox`, `ScrollBar`, `Input`, `Textarea` (undo/redo, word motions, select-all, submit; `Textarea.d.ts:8`), `Select`, `TabSelect`, `Slider`, `Code`, `LineNumberRenderable`, `Diff`, `Markdown`, `TextTable`, `Image`, `EmbeddedTerminal`, `FrameBuffer`, `ASCIIFont`, `EditBufferRenderable` (a real edit buffer/editor view in native: `edit-buffer.d.ts`, `editor-view.d.ts`, `lib/extmarks.d.ts`).

- **ScrollBox** (`ScrollBox.d.ts:18-31,65-74`): `stickyScroll`, `stickyStart: "bottom"|"top"|...`, `scrollAcceleration`, `viewportCulling`, `scrollTop/scrollHeight`, `scrollBy/scrollTo`, separate viewport/content/scrollbar option bags. Culling uses a binary search over children sorted by screen position (`lib/objects-in-viewport.d.ts`). Note: culling skips _painting_ off-screen children; layout is still computed for all children, so very long threads still want list windowing (OpenCode slices `messages()` at `OC/packages/tui/src/routes/session/index.tsx:217` and relies on `stickyScroll` at `:1193-1194`).
- **Markdown** (`Markdown.d.ts:68-118`): `marked` 17 tokens rendered as renderables; `streaming` mode; `conceal`; tables (`grid|columns`); `renderNode` override and `createMarkdownCodeBlockRenderer` for custom fenced blocks; `internalBlockMode: "coalesced"|"top-level"`. OpenCode uses `<markdown streaming internalBlockMode="top-level" conceal tableOptions={{style:"grid"}}>` (`OC/packages/tui/src/routes/session/index.tsx:1692-1700`).
- **Code** (`Code.d.ts:19-30`): tree-sitter highlighting with `onHighlight`/`onChunks` hooks, `streaming`, `drawUnstyledText`, `baseHighlight`, `wrapMode`.
- **Diff** (`Diff.d.ts:8-32`): takes a unified diff string, `view: "unified"|"split"`, `syncScroll`, syntax highlighting by `filetype`, line numbers, all color slots. Used by OpenCode at `session/index.tsx:2411,2459` and `feature-plugins/system/diff-viewer.tsx:843`.
- **Image** (`Image.d.ts:5-14`, `renderer.d.ts:15-22`): kitty graphics (transports `raw|zlib|file`, probed with `_Gi=31337...`), sixel, `fit: fit|cover|fill`, `resolveImageRenderProtocol()` from capabilities + pixel resolution (`[14t`). Release v0.5.4 fixed "Sixel placement fallbacks on Kitty".
- **EmbeddedTerminal** (`EmbeddedTerminal.d.ts:7-27`): a VT emulator inside the renderable (Ghostty's terminal core; `(terminal) ... deleteLines trackPin` strings in the `.so`), you feed it PTY bytes via `onData`. Same Ghostty lineage as `ghostty-webgpu` in `P/apps/web/package.json:70`, so both front ends would parse terminals identically. PTY spawning is still ours (node-pty).

### 3.5 Input

- Key parsing in JS: `lib/parse.keypress.d.ts:5-24` (`ParsedKey`: `ctrl/meta/shift/option/super/hyper`, `eventType: press|repeat|release`, `source: raw|kitty`, `baseCode` for layout-independent bindings, `capsLock/numLock`), `lib/parse.keypress-kitty.d.ts`. Kitty protocol flags configurable: `KittyKeyboardOptions { disambiguate, alternateKeys, events, allKeysAsEscapes, reportText }` (`renderer.d.ts:135-146`), toggled at runtime (`renderer.d.ts:466-467,503-504`). Terminal support is probed (`[?u` response handled natively, `capabilities.kitty_keyboard`).
- Event model: `KeyEvent`/`PasteEvent` with `preventDefault()`/`stopPropagation()`, `keypress`/`keyrelease`/`paste` (`lib/KeyHandler.d.ts`); focus routing (`focusRenderable`, `currentFocusedRenderable`, `focused_renderable` event). Bracketed paste with binary/mime metadata (`lib/paste.d.ts`), OSC subscription for custom sequences (`renderer.d.ts:512 subscribeOsc`), `prependInputHandlers` for raw intercepts.
- Mouse: SGR (`[?1006h`) and pixel (`[?1016`) modes; events `down|up|move|drag|drag-end|drop|over|out|scroll` with modifiers (`lib/parse.mouse.d.ts:1-15`), hit grid with scissor rects (`renderer.d.ts:405-408`), pointer styles (`setMousePointer`), double/triple click (release v0.5.7). Focus tracking `[?1004`.
- Terminal probes handled natively or in `lib/terminal-capability-detection.d.ts:1-14`: DECRPM, CPR, XTVERSION (`[>0q`), DA1, kitty graphics, kitty keyboard, pixel resolution, OSC 99 (notifications), iTerm2 OSC 1337 capabilities; palette via OSC 10/11 (`lib/terminal-palette.d.ts`), dark/light via mode 2031 (`themeMode`, `waitForThemeMode`, `renderer.d.ts:460-461`). Result object: `TerminalCapabilities` (`types.d.ts:63-86`) with `rgb, ansi256, unicode, sync, hyperlinks, osc52 + osc52_support, notifications, kitty_keyboard, kitty_graphics, sixel, bracketed_paste, focus_tracking, color_scheme_updates, explicit_width, scaled_text, remote, multiplexer, terminal {name, version, from_xtversion}`.

### 3.6 Clipboard, links, notifications

- OSC 52 write/clear with remote awareness (`lib/clipboard.d.ts` `Clipboard.copyToClipboardOSC52`, `osc52_support` state) **and** a native host clipboard backend (`createNativeHostClipboardBackend`, wayland seat option, byte/time limits, image reads with `maxImagePixels`). Policy knob `ClipboardWriteDestination: terminal-only|host-only|best-available|all-available`. Release v0.5.4: "GNU Screen OSC 52 passthrough".
- OSC 8 hyperlinks: `link(url)` chunk helper, `detectLinks()` (`lib/detect-links.d.ts`), `capabilities.hyperlinks`, `]8;;` in the `.so`. OpenCode wraps it in `OC/packages/tui/src/ui/link.tsx`.
- OSC 99 notifications: `renderer.triggerNotification(message, title)` (`renderer.d.ts:459`). Terminal title: `setTerminalTitle`.

### 3.7 Testing / headless

`@opentui/core/testing` (`OTUI/core/testing/test-renderer.d.ts:40-58`): `createTestRenderer({width,height,kittyKeyboard})` returns `renderer, mockInput, mockMouse, renderOnce, flush, waitFor, waitForFrame, waitForVisualIdle, captureCharFrame, captureSpans, resize, externalOutput`. Also `createMockKeys` (typing, bracketed paste, kitty mode), `setRendererCapabilities` (fake terminal caps), `TestRecorder` (frame + color-plane recording), `ManualClock`, `MockTreeSitterClient`. Both bindings wrap it as `testRender` (`OTUI/react/src/test-utils.d.ts`, `OTUI/solid/index.d.ts:5`). OpenCode tests this way (`OC/packages/tui/test/app-lifecycle.test.tsx:11-13` with `useThread: false`; `OC/packages/tui/test/cli/tui/data.test.tsx:66`). t1code has a `T1CODE_HEADLESS=1` mode that renders one frame to a file (`T1/apps/tui/src/index.tsx:52-79`).

### 3.8 Maturity and cadence

- npm: first publish 2025-08-13, latest 0.5.10 on 2026-09-01; 0.4.5 (2026-07-17) to 0.5.10 is 11 stable releases in six weeks, plus nightly `0.0.0-<date>-<sha>` snapshots. GitHub: 13.2k stars, 714 forks, MIT. Packages: core, react, solid, keymap, qrcode, three (WebGPU), ssh (SSH server integration).
- Production: "OpenCode uses OpenTUI in production for millions of users" (`OTUI/core/README.md`). OpenCode pins `0.4.5` in its catalog (`OC/package.json:43-45`), i.e. six weeks behind, and maintains a dedicated `script/upgrade-opentui.ts` that rewrites every manifest and scrubs stale lockfile entries; it also patches `solid-js` (`OC/package.json:152`). Read that as: upgrades are frequent enough to need tooling, and 0.x semver is real.
- Release notes are meaningful: v0.5.2 "Migrated to Zig 0.16; added embedded terminal runtime and native image rendering", v0.5.7 "Node.js 26.4+ compatibility", v0.5.8 unicode width fixes, v0.5.10 image streaming and markdown streaming fixes.
- Runtime docs: "Current Bun Core tests run on macOS arm64, Linux x64, and Windows x64", Node acceptance on Linux x64 only; "Use Bun 1.4.0 or later on native Windows arm64".

## 4. The two bindings

|                            | `@opentui/react` 0.5.10                                                                                                                                                                                                   | `@opentui/solid` 0.5.10                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peer deps                  | `react >=19.2.0`, `react-devtools-core ^7`, `ws ^8` (`OTUI/react/package.json`)                                                                                                                                           | `solid-js` **exactly** `1.9.12`; ships `@babel/core`, `babel-preset-solid`, `s-js` as deps (`OTUI/solid/package.json`)                                                                                                                |
| Reconciler                 | `react-reconciler ^0.33`, `ConcurrentRoot`, `supportsMutation: true` (`OTUI/react/chunk-ekvsg4nw.js`)                                                                                                                     | Solid universal renderer over `BaseRenderable` (`OTUI/solid/src/reconciler.d.ts`)                                                                                                                                                     |
| JSX setup                  | tsconfig `jsx: react-jsx`, `jsxImportSource: "@opentui/react"`; Bun's own transpiler handles it, no plugin                                                                                                                | tsconfig `jsx: preserve` + `bunfig.toml preload = ["@opentui/solid/preload"]` (Babel at load time) + `createSolidTransformPlugin()` in `Bun.build` (`OC/packages/opencode/script/build.ts:5,25,158`) + `vite-plugin-solid` for Vitest |
| Failure mode without setup | Type error / obvious crash                                                                                                                                                                                                | **Silent**: renders once and never updates (my test printed `solid count 0` with no error, section 9)                                                                                                                                 |
| Hooks                      | `useRenderer, useKeyboard(+release), usePaste, useFocus, useBlur, useSelectionHandler, useOnResize, useTerminalDimensions, useTimeline` (`OTUI/react/src/hooks/`)                                                         | same set, `onResize/onFocus/onBlur` naming; plus `Portal`, `Dynamic`, `createScrollbackWriter`                                                                                                                                        |
| Intrinsics                 | `text, box, scrollbox, ascii-font, input, textarea, select, tab-select, code, line-number, diff, span/strong/em/u/b/i/br` (kebab-case)                                                                                    | same, snake_case (`ascii_font`, `tab_select`), plus `a`                                                                                                                                                                               |
| Test wrapper               | `testRender` wraps with `act()`; emits "not wrapped in act(...)" warnings on async state (section 9)                                                                                                                      | `testRender`                                                                                                                                                                                                                          |
| Extending                  | `extend({ name: Renderable })`                                                                                                                                                                                            | `extend({...})`, `getComponentCatalogue()`                                                                                                                                                                                            |
| Keymap adapter             | `@opentui/keymap/react` (`KeymapProvider, useKeymap, useBindings, useActiveKeys, usePendingSequence`)                                                                                                                     | `@opentui/keymap/solid`                                                                                                                                                                                                               |
| DevTools                   | React DevTools via `react-devtools-core@7` + `DEV=true`                                                                                                                                                                   | none                                                                                                                                                                                                                                  |
| Who ships on it            | t1code (`@opentui/react ^0.2.7`, `T1/apps/tui/package.json`), one 17,407-line `ui.tsx` with 75 `useEffect`, 57 `useState`, 42 `useMemo`, 29 `useCallback`, 66 mouse handlers, 7 `<scrollbox>`, 2 `<markdown>`, 1 `<diff>` | OpenCode (`@opentui/solid` catalog 0.4.5), 185 files, `@opentui/keymap` addons (`OC/packages/tui/src/keymap.tsx:1-16`)                                                                                                                |

Performance framing: in both bindings the framework only maintains the renderable tree; layout, wrapping, diffing and painting happen in Zig. React's per-update cost is re-running component functions and reconciling props; Solid's is fine-grained signal writes. For a chat UI updated by streaming tokens the difference is visible only if components are huge (t1code's single 17k-line component is the anti-pattern to avoid; its `useRef<ScrollBoxRenderable>` escapes at `T1/apps/tui/src/ui.tsx:4147-4206` show the imperative escape hatch works when needed).

## 5. Other candidates

### Ink 7.1.1 (React, yoga-layout wasm)

- Facts: `yoga-layout ~3.2.1`, `react-reconciler ^0.33`, `string-width`, `wrap-ansi`, `ws` (`OTUI/../ink/package.json:49-74`). Last publish 2026-07-16. Runs under Bun (section 9).
- Render model: builds the whole frame as a string and erases/rewrites lines (`ink/build/log-update.js:49,60,150,167,201 eraseLines`), throttled to `maxFps` default 30 (`ink/build/ink.js:194-198`). Ink 7 did add `alternateScreen`, synchronized output and kitty keyboard (`readme.md:2706,2724-2756`).
- Gaps for our product: no mouse (`readme.md` has zero `useMouse`/`onClick`), no images, no built-in scroll container (community `ink-scroll-view` linked at `readme.md:3140`), no scrollbox/markdown/code/diff/textarea primitives, percentages unsupported for `minWidth`/`maxWidth` (`readme.md:481,495`), `<Static>` is the only answer to scrollback. Known large-output behaviour: discussion #621 "Option not to clear terminal when output height larger than the screen" and the flicker analysis at atxtechbro/test-ink-flickering (full erase + rewrite on every state change). Layout runs in JS/wasm and text measurement is JS `string-width`, so wide/grapheme correctness lags a Ghostty-backed core.
- Verdict: fine for CLIs and progress UIs; not a fit for a full-screen, mouse-aware, image-capable client.

### blessed / neo-blessed

`blessed@0.1.81` last published 2015-09-03; `neo-blessed@0.2.0` 2018-06-13 (npm `time`). CommonJS, curses-style widget model, no flexbox, no kitty protocol, no images beyond w3m hacks. Dead upstream. Not viable.

### terminal-kit 3.1.4

Published 2026-07-19, `engines node>=16.13`, CJS (`main: lib/termkit.js`), deps `chroma-js, ndarray, nextgen-events, string-kit, seventh` (`terminal-kit/package.json`). Own `ScreenBuffer`/`TextBuffer`/`document` widget model, no flexbox, no TypeScript, no React/Solid, no test renderer, no kitty keyboard. Maintained but a different generation of design; no code sharing with a React web app.

### Hand-rolled cell buffer

What you would have to build to reach OpenTUI-core parity: cell grid + damage diff + ANSI emitter with sync output; flexbox layout (could reuse `yoga-layout@3.2.1` wasm); grapheme-cluster width tables kept in sync with terminals (Ghostty/kitty/wezterm differ, see OpenTUI v0.5.8 notes); key parser incl. kitty progressive enhancement and legacy fallbacks; SGR/pixel mouse parser and hit testing; bracketed paste; capability probing with timeouts and tmux/screen passthrough; scrollbox with culling and sticky bottom; word/char wrapping in the layout pass; markdown to styled blocks with streaming; tree-sitter or shiki highlighting; unified/split diff renderer; kitty/sixel image placement; OSC 52 + host clipboard; headless test renderer. OpenTUI's JS side alone is ~1.5 MB of bundled code (`index.bun.js` 516K + chunks 684K + 336K + worker 172K) on top of a 6 MB native library. Hand-rolling only makes sense if OpenTUI's abstractions were fundamentally wrong for us; they are not. The realistic "thin" option is `@opentui/core` imperative API without either binding, which is a valid fallback if the React reconciler ever becomes the bottleneck.

## 6. Comparison table

| Criterion                               | OpenTUI core + React                                                | OpenTUI core + Solid                                                           | Ink 7                                                    | terminal-kit 3        | blessed/neo-blessed | Hand-rolled |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------- | ------------------- | ----------- |
| Rendering                               | native double buffer, changed cells only, optional render thread    | same                                                                           | JS string frame, erase+rewrite, 30 fps throttle          | JS ScreenBuffer delta | JS, curses-like     | ours        |
| Layout                                  | Yoga semantics in Zig (`yoga.d.ts:218`)                             | same                                                                           | yoga-layout wasm                                         | manual/document       | manual              | yoga wasm   |
| Wrapping                                | native `none/char/word` per text buffer                             | same                                                                           | `wrap-ansi` in JS                                        | TextBuffer            | basic               | ours        |
| Unicode width                           | Ghostty graphemes, `wcwidth/unicode/unicode-wide`, mode 2027        | same                                                                           | `string-width`                                           | string-kit            | poor                | ours        |
| Scrollbox                               | built in, sticky, culling, mouse wheel                              | same                                                                           | community pkg                                            | manual                | ScrollableBox       | ours        |
| Kitty keyboard                          | full flags, runtime toggle, `baseCode`                              | same                                                                           | yes (auto)                                               | no                    | no                  | ours        |
| Mouse                                   | SGR + pixel, drag/drop/over/out, hit grid                           | same                                                                           | none                                                     | yes                   | yes                 | ours        |
| Images                                  | kitty (raw/zlib/file), sixel, native decode (webp/png/...)          | same                                                                           | none                                                     | yes (pixel/ANSI)      | w3m hack            | ours        |
| Markdown / code / diff                  | built-in renderables, streaming                                     | same                                                                           | none                                                     | none                  | none                | ours        |
| Sync output / OSC 8 / OSC 52 / OSC 99   | all, probed                                                         | same                                                                           | sync yes; OSC 8 via chalk-like escapes; OSC 52 no        | partial               | no                  | ours        |
| Capability detection                    | native probes + `TerminalCapabilities`                              | same                                                                           | env + a few probes                                       | detectTerminal.js     | env                 | ours        |
| Headless testing                        | `createTestRenderer`, frames + spans, mock keys/mouse, `testRender` | same                                                                           | `ink-testing-library`                                    | none                  | none                | ours        |
| Bun support                             | first-class (`bun:ffi`), verified                                   | verified                                                                       | works (section 9)                                        | untested here         | untested            | n/a         |
| Single binary                           | verified 99.5 MB, assets auto-embedded                              | same + build plugin                                                            | should work                                              | unknown               | unknown             | n/a         |
| Code sharing with `apps/web` (React 19) | hooks/stores/contexts/query defs port as-is                         | none of the React layer                                                        | hooks/stores port, but no primitives to render them into | none                  | none                | none        |
| Tooling friction                        | none beyond `jsxImportSource`                                       | Babel preload + build plugin + Vitest plugin + exact solid pin; silent failure | none                                                     | CJS                   | CJS                 | large       |
| Maturity                                | 13.2k stars, releases every few days, 0.x                           | same; the binding OpenCode ships                                               | mature, stable                                           | maintained, niche     | abandoned           | n/a         |

## 7. Supporting libraries survey

**Markdown to terminal**

- `MarkdownRenderable` (core): `marked` 17 tokens, streaming, tables, conceal, custom block renderers. The obvious choice; verified in section 9 with one caveat about paint timing.
- `marked-terminal@7.3.0`: string output only (ANSI), no layout integration, no streaming. Not needed.
- `streamdown@2.5.0` (used by `apps/web`) is DOM/React; not portable to the terminal. The web app's `@streamdown/*` plugins likewise.
- Go equivalents for orientation only: crush uses `glamour/v2` for markdown and `chroma/v2` for highlighting (`references/crush/go.mod:11,19`).

**Syntax highlighting**

- Tree-sitter via OpenTUI: `web-tree-sitter@0.25.10` peer, worker-based `TreeSitterClient` (`lib/tree-sitter/client.d.ts`), bundled grammars for javascript, typescript, markdown, markdown_inline, zig (3.3 MB in `OTUI/core/assets`). Additional languages are declared with URLs and downloaded to a data dir at runtime (`OC/packages/tui/src/parsers-config.ts:1-12`, note the comment about nvim-treesitter query incompatibilities) or pre-bundled with `@opentui/core/tree-sitter/update-assets`.
- Shiki bridge: `hastToStyledText(hast, syntaxStyle)` (`OTUI/core/lib/hast-styled-text.d.ts`) accepts shiki's `codeToHast` output directly. `apps/web` already depends on `@shikijs/langs` and `@shikijs/themes` 4.2.0 (`P/apps/web/package.json:41-42`), so the TUI can reuse the same grammar/theme bundles.
- Theme sharing: `SyntaxStyle.fromTheme(ThemeTokenStyle[])` takes `{ scope: string[], style: { foreground, background, bold, italic, underline, dim } }` (`OTUI/core/syntax-style.d.ts:23-33`), i.e. VS Code/TextMate `tokenColors`, so one theme file can drive both the web editor and the TUI.
- `cli-highlight@2.1.11` (highlight.js to ANSI) is the legacy alternative; unnecessary.

**Diff rendering**

- `DiffRenderable` (core) consumes unified diff text and renders unified or split with highlighting. Core depends on `diff@9.0.0` for parsing; OpenCode also uses `diff` 8.0.2 for revert computations (`OC/package.json:62`). The web app's `@singapore-editor/diff` is editor-bound; the contract between the two is "a unified diff string", which the server can produce once.

**Terminal capability detection**

- Everything needed is inside OpenTUI (section 3.5). Standalone alternatives if ever hand-rolling: `supports-color@11` (env-only truecolor), `@xterm/headless@6` (VT emulation), `ansis@4`/`chalk@6` (SGR). None needed.

**Clipboard, links, notifications**: covered by core (section 3.6). OpenCode additionally uses `clipboardy@4.0.0` (`OC/packages/tui/package.json`) for legacy host clipboards.

**Keymaps**: `@opentui/keymap@0.5.10` is host-agnostic with `html` and `opentui` adapters and both `react` and `solid` entrypoints (`OTUI/keymap/README.md`): layered, focus-scoped bindings, multi-key sequences, leader keys, command catalog, cheat-sheet formatting. It could in principle replace `@tanstack/react-hotkeys` in `apps/web` so both front ends share one binding language; that is a separate decision, not a prerequisite.

**Misc**: `opentui-spinner@0.0.7` (OpenCode), `fuzzysort` (OpenCode palette; `packages/contracts/src/fuzzy-rank.ts` already exists for us), `@tanstack/react-virtual` (web) has no terminal equivalent, use `ScrollBox` culling plus explicit list windowing.

## 8. Code sharing with `apps/web` (React 19)

What crosses over unchanged under `@opentui/react`:

- `packages/contracts` (valibot, framework-free), e.g. the WS protocol at `P/packages/contracts/src/orchestration-ws.ts:32`.
- The treaty client (`P/apps/web/src/lib/client.ts:1-13`, typed from `server/client-contract`) and `unwrapEdenResponse`/SSE parsing (`P/apps/web/src/lib/eden-events.ts`), modulo `import.meta.env.VITE_SERVER_URL`.
- The `ChatTransport` interface and implementation (`P/apps/web/src/features/chat/transport/chat-transport.ts:16-35`), which is fetch + WS only.
- Zustand stores: 26 files use React-bound `create` and 6 use `createStore` from `zustand/vanilla`; both work under any React renderer. `chat-projection-store.ts:24` uses `create`.
- TanStack Query: `QueryClientProvider` and `useQuery` depend only on React, not the DOM (135 files import `@tanstack/react-query`).
- DOM-free hooks such as `use-chat-shell-subscription.ts` (only `useState`/`useEffect` at line 1) and contexts/providers whose value is domain actions.

What does not cross over under either binding: components (Tailwind/DOM), hooks touching `document`/`window`/`HTMLElement`, `@tanstack/react-hotkeys` (DOM key events), Lexical composer, dnd-kit, `react-virtual`.

Under `@opentui/solid` the first list shrinks to contracts + transport + vanilla stores; every hook, provider and query definition gets a Solid twin (`@tanstack/solid-query`, `solid-js/store`), and the team maintains two reactivity models. t1code's answer was to extract a framework-free `packages/client-core` (`T1/packages/client-core/src`: `wsTransport`, `sessionLogic`, `slashCommands`, `sidebarSort`...) consumed by both `apps/web` and `apps/tui`; that extraction is worth copying regardless of binding, and CLAUDE.md's rule that `lib/` stays inside `apps/web` means the shared layer would be a new `packages/*` entry point, not a cross-app import.

## 9. Empirical results (this session)

All scripts live in `/tmp/claude-1000/-work-projects-platform/9d7da5f6-430a-400d-bf73-3d5f4e1abcbf/scratchpad/otui/`.

1. `smoke-core.ts`: `createTestRenderer` + `Box/Text/Markdown`; first frame in 8.2 ms; `Hello 你好 🚀 wide` laid out with correct wide-cell advance; `widthMethod: unicode`; `capabilities` is `null` in headless mode (use `setRendererCapabilities` to fake).
2. `smoke-react.tsx`: `@opentui/react/test-utils testRender`, `useState`+`useEffect` update rendered (`react count 1`); React printed "An update to Root inside a test was not wrapped in act(...)". Expected; wrap async updates in `act` or use `flushSync`.
3. `solid/smoke-solid.tsx`: with `preload = ["@opentui/solid/preload"]` renders `solid count 1`; with an empty `bunfig.toml` renders `solid count 0` and exits 0. No error, no warning.
4. `bun --bun vitest run` (vitest 4.1.11) over core + React headless tests: 2/2 pass, 148 ms, using oxc `jsx: automatic` + `jsxImportSource`. So the repo's `bun --bun vitest` convention holds for a React TUI package.
5. `bun build --compile --target=bun-linux-x64 --minify smoke-core.ts`: 99,456,200-byte binary; runs from `/`; contains `libopentui.so`, `parser.worker.js`, grammar `.wasm` (embedded through the `type: "file"` imports). Tree-sitter worker initialised inside the compiled binary in 15 ms without an `OTUI_TREE_SITTER_WORKER_PATH` define; OpenCode still defines it (`OC/packages/opencode/script/build.ts:181-186`) because it uses `splitting: true` with extra worker entrypoints.
6. Markdown paint timing (`smoke-md-fix.ts`): a non-streaming `MarkdownRenderable` shows blank rows until each child `CodeRenderable.highlightingDone` resolves **and** a further render pass runs; `waitForVisualIdle` did not cover it. With `streaming: true` (OpenCode's setting) the text is present on the first pass. `conceal` hides `#`/`**` markers as expected.
7. Ink 7.1.1 renders under Bun 1.4.0 (`smoke-ink.tsx`).

## 10. Bun-specific gotchas

- FFI: core loads the `.so` through `bun:ffi`; Bun >= 1.3.0 required, 1.4.0 on Windows arm64. Node needs 26.4+ with `--experimental-ffi`; irrelevant for us but it means no Node fallback for tests.
- Cross-compiling: run `bun install --os="*" --cpu="*" @opentui/core@<v>` so every platform package is present before `Bun.build({ compile })` (`OC/packages/opencode/script/build.ts:141`). For musl targets set `process.env.OPENTUI_LIBC` via `define` (`:197`); the docs say the value must be set "before Core imports".
- Workers and assets: the tree-sitter worker and grammars are embedded through `import(..., { with: { type: "file" } })`; if you enable `splitting` or custom entrypoints, add the worker as an entrypoint and define `OTUI_TREE_SITTER_WORKER_PATH` as OpenCode does (`bunfsRoot + "opentui-tree-sitter-worker.js"`, `B:/~BUN/root/` on Windows). Non-compiled dists must copy `parser.worker.js` next to the bundle (`T1/apps/tui/scripts/build-runtime.mjs`).
- Extra grammars are downloaded at runtime into a data path (`TreeSitterClient.setDataPath`); decide whether the binary bundles them (`update-assets`) or fetches them, and where that lives relative to the settings registry.
- Binary size: ~100 MB per target because the Bun runtime is embedded; 12 targets in OpenCode's matrix (`build.ts:52-109`, including `baseline` non-AVX2 builds).
- `import.meta.dir` / `import.meta.path` are Bun-only and `undefined` under Vitest (already in CLAUDE.md); OpenTUI itself uses `import.meta.url` + `fileURLToPath` fallbacks (`resolveBundledFilePath`, `OTUI/core/chunk-bun-9gqvxy8c.js:953-972`) so it is safe on both paths.
- `bun --bun` prepends a Bun-backed `node` shim to `PATH`; the existing `resolveNodeBinary()` rule for node-pty applies to the TUI's PTY spawns too.
- Solid only: Babel preload in dev, `createSolidTransformPlugin()` in `Bun.build`, `vite-plugin-solid` in Vitest, `solid-js` pinned to 1.9.12 (OpenCode carries a patch for 1.9.10). Missing any of these fails silently.
- React only: `react-devtools-core@7` and `ws@8` are declared peers; `testRender` wants `act()`.
- Lifecycle: "The code that creates the renderer must call `renderer.destroy()` on every other shutdown path" (`OTUI/core/README.md`); OpenCode tests SIGHUP explicitly (`OC/packages/tui/test/app-lifecycle.test.tsx:41-53`). `exitOnCtrlC` and `exitSignals` exist for the common cases.
- Headless renderer in tests: pass `useThread: false` (OpenCode) and prefer `streaming: true` markdown or await `highlightingDone` before asserting frames.

## 11. Recommendation with rationale

1. **Framework: `@opentui/core` + `@opentui/react`**, exact-pinned in the workspace catalog, upgraded deliberately (copy the spirit of `OC/script/upgrade-opentui.ts`). Rationale: full terminal feature set already native and production-proven; React keeps `apps/web`'s hooks, stores, contexts and query layer reusable; zero-plugin JSX; `bun --bun vitest` works today; single-binary compile verified.
2. **Structure**: `apps/tui` as a Bun package with its own tsconfig (`jsxImportSource: "@opentui/react"`), plus a new framework-free shared package (t1code's `client-core` pattern) for transport, projection stores, command logic and query keys that both `apps/web` and `apps/tui` import through `@workspace/*`.
3. **Highlighting and theme**: reuse the web's shiki grammars/themes through `hastToStyledText` and `SyntaxStyle.fromTheme` so both front ends look the same; keep OpenTUI's tree-sitter path for streaming code blocks and diffs where it is the default.
4. **Terminal blocks**: use `EmbeddedTerminalRenderable` fed by the server's PTY stream; the web already uses Ghostty (`ghostty-webgpu`), so parsing parity is free.
5. **Screen mode**: prototype both `alternate-screen` (IDE mode) and `split-footer` + `writeToScrollback` (agent-view root) early; the product vision's inline-first root maps onto the latter.
6. **Mitigating the "Solid is the dogfooded binding" risk**: keep components small (no 17k-line files), use `ref` to `ScrollBoxRenderable`/`TextareaRenderable` for hot paths, wrap the render loop so the binding could be swapped for the imperative core API if profiling ever demands it, and run `bun --bun vitest` frame tests that would catch reconciler regressions on every OpenTUI bump.

## 12. Risks

- 0.x churn: releases every few days, breaking changes possible; OpenCode sits six weeks behind latest and needs an upgrade script.
- React binding has fewer production users than Solid; act() warnings in tests; reconciler overhead if components are oversized.
- Native code: crashes take the whole process (docs have a "Native crashes" section); 8 platform binaries to trust; ~100 MB binaries.
- Markdown headless paint timing (needs `streaming` or `highlightingDone` handling) can produce flaky snapshot tests if ignored.
- Grammars beyond JS/TS/MD/Zig require download or bundling; nvim-treesitter queries do not always work with web-tree-sitter (OpenCode's own comment).
- Remote/SSH usage: OSC 52 and image transport behave differently through tmux/screen/SSH; OpenTUI exposes `remote`/`multiplexer` flags but policy is ours.
- `@opentui/solid` would be the wrong choice if the team later decides the web app should move to Solid; nothing suggests that.

## 13. Open questions

- Which screen mode is the agent-view root: alternate screen, or inline scrollback with a sticky footer (`split-footer`)?
- Do we adopt `@opentui/keymap` on both front ends (replacing `@tanstack/react-hotkeys`), or keep the web `keymap/` registry and write a thin OpenTUI adapter for it?
- Where does the shared client layer live (`packages/client-core`-style) and how does it satisfy the `lib/` two-consumer rule?
- Windows support target (native Windows vs WSL) and whether we build all 12 of OpenCode's targets.
- Grammar strategy: bundle a curated set with `update-assets` or download on demand, and which settings key governs it.
- Highlighting: tree-sitter (OpenTUI default) vs shiki (web parity) per surface.
