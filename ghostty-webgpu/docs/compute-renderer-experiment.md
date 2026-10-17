# Compute renderer experiment

**Decision: keep the instanced WebGPU renderer.** The experimental compute compositor passed pixel checks but did not show a clear CPU gain on the measured Mac. Its offscreen GPU work took about five times as long as the instanced path. The compute and fullscreen fragment implementations remain on the [research branch](https://github.com/ShaulLavo/fregat/tree/experiment/webgpu-compute-20261017/ghostty-webgpu), outside the shipped package.

The experiment reused native frame records, atlas textures, row mapping, and frame ownership. Each output pixel gathered its cell effects and overlapping glyphs in logical order. Compute wrote an owned texture and presented it with a fullscreen draw. The fullscreen fragment control used the same composition function directly. A 200-column, 50-row benchmark at device pixel ratio 2 ran on an Apple M1 Metal adapter in headed Chromium. The run completed three repetitions of five scenarios for each of four arms, 60 samples in total. Its protocol marked the run performance qualified, with no process churn or fallback adapter.

The table shows the median of three samples for total Chrome CPU, as a percentage of one core. Lower is better. The settled-idle scenario submitted no frames in any arm.

| Scenario         | Instanced WebGPU | Fullscreen fragment | Compute | Canvas2D pixels |
| ---------------- | ---------------: | ------------------: | ------: | --------------: |
| Cursor movement  |           37.12% |              37.94% |  37.67% |          37.13% |
| Burst output     |           39.87% |              39.03% |  40.43% |          46.78% |
| Sustained scroll |           38.48% |              37.93% |  37.93% |          45.97% |
| Glyph churn      |           73.39% |              74.43% |  75.36% |          92.65% |

A separate GPU timestamp fixture used an 80-column, 24-row dense text frame. It measured every offscreen composition pass, including the compute presentation draw. The median of the three repetition medians was 0.362 ms for instanced rendering, 0.809 ms for fullscreen fragment, and 1.787 ms for compute. Each mode had 72 retained samples. The maximum pixel-channel difference from the instanced output was one for both experimental modes. The fixture excludes the canvas context, browser compositor handoff, CPU uploads, and physical display latency, so these timings describe GPU work in that fixture only.

[Zutty's compute renderer](https://tomscii.sig7.se/2020/11/How-Zutty-works) assigns independent rectangles to cells. Ghostty's cropped glyphs can overlap neighboring cells and rows, which makes this compositor gather several ordered glyph contributions for a pixel. Ferrum's [change from compute to fragment](https://github.com/itsserbin/ferrum/commit/922d04e458f07d3ac7198781aec4932a87dd5db8) motivated the fragment control. Its [later sRGB correction](https://github.com/itsserbin/ferrum/commit/653686660b42c880430183ad4bf50b369ac5d111) also made pixel and color checks a hard gate. These references explain the comparison design; the measured decision comes from this library's own run.

The benchmark repairs ship separately. Its measured render-state wrapper now forwards native frame-builder creation and snapshot version, so WebGPU and WebGL2 paint real frames. The runner serves the existing Canvas2D pixel WASM asset, records its hash, reports draw errors promptly, and checks the selected Canvas2D paint mode. The default benchmark arms and workloads stay unchanged.

Raw Mac evidence is retained under `/work/reports/ghostty-compute-20261017/hardware-mac/`, including `renderer.json`, `timestamp.json`, and `timestamp-summary.json`. The local `reproducer/protocol.md` records host admission, workload order, and timing limits.
