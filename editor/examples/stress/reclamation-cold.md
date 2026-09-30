# Cold long-line measurements

Build textbuffer, then run the isolated V8 comparison:

```sh
bun run --cwd packages/textbuffer build
bun examples/stress/reclamation-cold.mjs --output /work/tmp/reclamation-cold.json
```

The default is a fresh 32 Mi UTF-16-unit ASCII line, with three Node processes per variant.
The probe uses the real `DisplayProjection.getLineText` path and first measurement
classification/column lookup. It records acquisition time, classification time and retained
heap after forced GC at each boundary. The original string is flattened before the baseline.

The eager variant reproduces copying during page acquisition by replacing only the source-cache
constructor expression in an isolated bundle. Both variants use the current handle-based index
implementation; this comparison isolates copying rather than every change from clean HEAD.
It does not edit production files. Bun builds the bundles; Node runs them with `--expose-gc`.
Temporary bundles are removed afterward. `--units`, `--repetitions` and `--scratch` configure
this diagnostic only.

No editing or storage maintenance occurs. These phase timings are not browser first-paint
measurements: first classification still scans and indexes the full line, and row/DOM painting
is excluded. The warm [edit probe](reclamation-measurements.md) and mounted input suite cover
separate costs.
