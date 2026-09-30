# Minimap browser measurement

Run from the Editor repository:

```sh
node packages/minimap/bench/browser-runner.mjs --label=after
```

The runner builds the current Editor and minimap sources with Vite, launches the installed
Playwright Chromium, and serves the output through `BrowserContext.route` on the existing
`http://127.0.0.1:3300` origin. It starts no server and leaves the running preview untouched.
Builds, JSON results, and PNG frames go to `/work/tmp/minimap-benchmark` by default.

Options:

- `--label=before` selects artifact names.
- `--minimap-root=/path/to/package` measures a preserved minimap source tree against the same Editor.
- `--origin=http://127.0.0.1:3300` sets the browser origin.
- `--output-dir=/work/tmp/another-run` changes the artifact directory.
- `--steps=120` changes each timing sample's scroll count.
- `--trials=3` repeats each timing configuration.
- `--all-motions` also measures 2px steps, reverse scrolling, and jumps beyond the cached bitmap.
- `--scenario=large-jumps` selects one scenario for a focused repeat.
- `--build-root=/path/to/saved-build` replays the exact saved bundle without rebuilding sources.
- `--visual-step=2 --visual-tokens=0` captures slow scrolling without token updates.
- `--visual-only` skips timing samples.
- `--timing-only` skips screenshot capture and the real-wheel smoke check.
- `--pixels-only` runs the renderer's exact-pixel oracle in real Chromium. It requires a current build.
- `--uncapped --timing-only` removes Chromium's frame-rate and GPU-vsync caps to measure throughput.

Three timing samples use a real editor over 20,000 deterministic patterned lines: minimap disabled,
plain scrolling, and scrolling with a token update every frame. The last case deliberately
exercises contention between viewport and token refresh. It does not claim to reproduce the exact
token cadence of a particular syntax provider. Every requested scroll must reach the real editor.

The main-thread probe records scroll calls, minimap update calls, worker sends, and worker replies.
The worker probe records actual request handling, `putImageData` uploads, and `drawImage` copies. Both clocks use
`performance.timeOrigin + performance.now()`. `postToWorker` includes transport and worker queue
wait; it is not a measurement of structured cloning alone. Twenty initial ping round trips estimate
the worker clock offset. Results retain an uncertainty bound because timer rounding can exceed
the transport cost. A `rendered` reply only confirms that
the worker returned from drawing. It does not confirm visible presentation.

A separate visual run captures Chromium frame-swap PNGs while the editor scrolls. The slider is
hidden in this run so its immediate movement cannot be mistaken for bitmap movement. The pixel
comparison also skips the colored line-number column. It counts changed code pixels in the
composed page, then reports how many captured frames moved and the longest interval without code
motion while scrolling. The main editor's pixels provide a same-frame motion control. Raw
grayscale differences retain fractional-position antialiasing. PNG recording does not run during
the timing samples. A separate trusted wheel input verifies native scrolling reaches the minimap.

The screenshot result proves visible bitmap movement, including movement caused by translating
cached pixels. It does not require one worker repaint per scroll. Frame capture is a sampled
observation and can miss intermediate presentation; compare its cadence before interpreting a
short freeze. These measurements use the browser's ordinary frame pacing, so a 60 Hz average
does not establish spare capacity for 120 Hz. Keep the main-thread and worker timings alongside it.
Uncapped runs measure throughput; they do not verify presentation on an actual 120 Hz display.
