# ghostty-webgpu

Development happens in the [Fregat monorepo](https://github.com/ShaulLavo/fregat/tree/main/ghostty-webgpu).
This repository mirrors its `ghostty-webgpu/` folder. Submit changes to Fregat.

an unofficial ghostty for the web, inspired by [ghostty-web](https://github.com/coder/ghostty-web) and powered by libghostty-vt

damage-aware rendering with webgpu, webgl2, canvas2d, and dom fallbacks. byte-based pty traffic, automatic fitting, and live themes

still a preview.

## try it

```sh
npm install ghostty-webgpu
```

give it somewhere to live

```html
<div id="terminal" style="height: 32rem; width: 100%"></div>
```

```ts
import { Terminal } from 'ghostty-webgpu'

const host = document.getElementById('terminal')
if (!host) throw new Error('missing terminal mount')

const terminal = await Terminal.create()
await terminal.open(host)
terminal.write('hello from ghostty\r\n')
terminal.focus()
```

call `terminal.dispose()` when you're done with it

## first frames and damage

`renderFrameToHtml(snapshot, { font, columns, rows, theme })` produces the DOM backend's
cell runs as HTML under Node or in a browser. `snapshotRenderState(renderState)` reads an
immutable styled snapshot from the core. Cell geometry can be supplied through the inherited
`--ghostty-cell-width`, `--ghostty-cell-height`, `--ghostty-font-size`, and
`--ghostty-letter-spacing` CSS properties.

`terminal.onFrame(({ rows }) => …)` reports the viewport rows painted by each frame across
all backends. It returns a subscription with `dispose()`, like `onResize`; no damage array is
allocated when there are no listeners.

Resizing inside a frame callback repaints after that frame's callbacks finish, in the same turn.

## GPU frame ownership

WebGL and WebGPU use the Zig/WASM frame builder. It walks native terminal state and writes
persistent cell and glyph records; JavaScript rasterizes missing browser-font glyphs and uploads
only changed byte ranges. GPU sources provide `createFrameBuilder`.

Atlas recovery is bounded to three registration sweeps. If a frame still cannot be built, the
renderer reports a `frame_builder` error, retains the last submitted frame, and keeps damage and
refresh requests pending. The next write, resize, font change, explicit refresh or cursor activity
requests a full native rebuild. Recovery adds no failure-specific retry loop. Canvas resizing and
context replacement still invalidate prior pixels.

Canvas 2D, DOM, accessibility, selection/copy and frame callbacks retain their shared row readers.
Styled snapshots and text-only rows describe those consumers; GPU rendering reads native records.

## Canvas paint modes

`WebGpuTerminalRendererOptions.rendererMode` selects `auto`, `canvas2d-fill-text`, or
`canvas2d-pixels`. The two Canvas modes share native cell ownership, row damage, cursor
painting and scroll history. Text shaping stays inside each native owner, including the
terminal's mode-2027 grapheme spans.

The explicit pixel mode is experimental pending headed visual calibration. It lazily loads
`canvas-compose.wasm` into independent ordinary WASM memory. Browser rasterization runs on
stamp-cache misses: the existing glyph model supplies A8 coverage or intrinsic-color RGBA,
and paths supply A8 coverage. The viewport-bounded cache retains offsets, and one straight
RGBA8 framebuffer aliases the `ImageData` submitted for coalesced dirty rows. The default
fillText mode performs no compositor download, compilation or framebuffer allocation.

Composition quantizes after each operation. Effective alpha is nearest-integer
`sourceAlpha * opacity / 65535`; A8 additionally includes `coverage / 255` in that same
rounding operation. For effective alpha `a`, destination alpha `d`, and source/destination
straight color channels `s` and `c`, the denominator is `a * 255 + d * (255 - a)`.
Output color is nearest-integer `(s * a * 255 + c * d * (255 - a)) / denominator`, and
output alpha is nearest-integer `denominator / 255`. Half ties round upward, zero effective
alpha preserves all destination bytes, and clear writes RGBA zero. Scalar and SIMD tests
compare this contract exactly; retained-f32 comparisons report quantization error separately.

Rebuild the checked-in compositor with `bun run build:canvas-compose`, using Bun and Zig
0.16.0 or newer. `--scalar --output <file>` builds the independent scalar test arm. This
Canvas-local asset changes neither the pinned native Ghostty build nor its ABI.

## comparisons

From this package, use `bun run bench:compare -- --headed --bundle /path/to/bundle`
for headed hardware Chromium measurements. A built bundle accepts
`node comparison-runner.mjs --headed --output results`.

`--headed` selects the browser window independently of `--smoke`, which selects
correctness checks. Defaults remain headless on Linux and headed on macOS for
hardware measurements; smoke runs default to headless on both.

## more

- [pty wiring and the native api](docs/integration.md)
- [font geometry and Canvas comparison](docs/font-geometry.md)
- [live demo](https://shaullavo.github.io/ghostty-webgpu/), built from [site/](site/) with `bun run site:dev`
- [optional native ghostty config](docs/config-resolver.md)
