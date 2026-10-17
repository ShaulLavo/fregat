# Experimental WebGPU pixel compositors

`WebGpuTerminalRenderer.create` accepts `experimentalCompositor: 'compute'` or
`'fullscreen-fragment'`. The default remains the instanced renderer. These options test
whether calculating each output pixel in one shader improves the existing WebGPU path.
Neither option carries a performance claim.

```ts
const renderer = await WebGpuTerminalRenderer.create({
  canvas,
  columns,
  rows,
  font,
  renderState,
  experimentalCompositor: 'compute',
})
```

Both experiments use the existing native frame builder, cell and glyph records, atlas,
dirty uploads, row ring, scheduler, device lease, and submission coordinator. A shared
WGSL function calculates cell effects and blends every glyph that covers the pixel in
logical row order. Changed glyph records widen a conservative search envelope. The
exact glyph rectangle decides coverage, so ink can cross several cells or rows.

Compute uses 8×8 workgroups and writes an owned `rgba8unorm` texture. A fullscreen
triangle presents that texture with `textureLoad`. The fragment control calls the same
composition function directly for a fullscreen triangle. Both compose the entire
viewport on each submitted frame. Idle updates still schedule no draw.

The intermediate texture requires standard WebGPU capabilities. The canvas keeps its
render-attachment configuration. Experimental grids must fit their glyph records into
one storage binding, and targets must use `rgba8unorm` or `bgra8unorm`. The default path
retains its existing batching for larger grids. Resize and device replacement recreate
the chosen compositor and its owned resources.

## Why this shape

Keeping the records and GPU resource owner shared isolates the final composition work.
A separate renderer would duplicate scheduling, atlas recovery, and device lifetime.
A CPU tile index could reduce glyph searches after a very large overhang, but adds an
index build and uploads to every comparison. The conservative envelope needs four
numbers and a scan of changed records. Its accepted cost is extra shader work after a
large glyph disappears, until the text pass is recreated.

[Zutty's author description](https://tomscii.sig7.se/2020/11/How-Zutty-works) demonstrates
compute rendering from a compact grid. It assigns independent fixed rectangles to
cells. This library's cropped glyphs can overlap, so final pixels gather contributions
from neighboring owners in order.

Ferrum's [compute-to-fragment change](https://github.com/itsserbin/ferrum/commit/922d04e458f07d3ac7198781aec4932a87dd5db8)
and [later sRGB correction](https://github.com/itsserbin/ferrum/commit/653686660b42c880430183ad4bf50b369ac5d111)
show why the fragment control and color checks matter. These experiments preserve the
current renderer's color model. They quantize source-over results for the unorm target
after each glyph contribution, matching the existing attachment's storage behavior.
Pixel tests compare against the instanced path within one channel step.

## Reproduce the comparison

Run the same benchmark workload across the GPU paths and the existing CPU pixel path:

```sh
BENCH_BACKENDS=webgpu,webgpu-compute,webgpu-fullscreen-fragment,canvas2d-pixels \
  bun run bench:renderer
```

The runner records the actual compositor, adapter, draw and dispatch counts, CPU samples,
output hashes, and screenshots. It now forwards native frame-builder creation through
its measured render-state wrapper. Draw errors stop the sample, and requested pixel
paths must report the corresponding work.

Headed Chromium on a hardware adapter is required for performance evidence. Headless
software results prove correctness only. JavaScript callback timing and GPU-process CPU
do not measure GPU execution or physical input-to-display latency. A comparison needs
separate evidence for those claims and for multiple terminals.
