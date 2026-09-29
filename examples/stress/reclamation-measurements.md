# Measurement-page comparison

From the repository root, build textbuffer, then compare page sizes:

```sh
bun run --cwd packages/textbuffer build
bun examples/stress/reclamation-measurements.mjs --output /work/tmp/reclamation-measurements.json
```

The probe bundles the actual measurement code three times, changing only `SOURCE_PAGE_LENGTH` to 256, 4096 and 16384 code units. It does not edit source files. Each candidate runs in three fresh Node processes, warms a one-million-character ASCII line and 20 edits, then measures 100 more edits. Each edit inserts a character inside the line and creates a fresh snapshot wrapper.

The timed operation constructs full-line measurements, checks simple-text and RTL classification, and asks for the final display column. It excludes the edit itself. Page indexes can be reused, but the measurement range array and combined summary belong to the new snapshot. Output records range counts, median and p95 milliseconds for each process. Private range counts are observed only by this diagnostic script.

Use `--pages`, `--edits` and `--repetitions` to change the comparison. Temporary bundles go under `--scratch`, which defaults to `/work/tmp`, and are removed afterward. Bun builds the bundles; Node executes them so the timing uses V8. These isolated measurements identify allocation cost; the browser input suite remains the end-to-end latency check.
