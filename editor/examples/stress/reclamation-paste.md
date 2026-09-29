# Large-paste reclamation probe

From the repository root:

```sh
bun run --cwd packages/textbuffer build
node examples/stress/reclamation-paste.mjs --label candidate --output /work/tmp/reclamation-paste.json
```

The default runs three fresh Node processes for each scenario after a 16 Mi-code-unit ASCII paste:

- `tail`: keep 64 characters inside the writable tail.
- `closed-full`: keep one complete 16 Ki-code-unit closed chunk and a separate one-character tail.
- `closed-partial`: keep all but one character of that closed chunk and the separate tail.

These distinguish retained logical text from a small substring retaining an entire pasted string's backing allocation. All runs assert exact visible text. `--samples` changes the repetitions; `--units` changes the paste size and must be a multiple of 16 Ki, at least 32 Ki. The tail scenario adds 256 units to that size.

Output is JSON on stdout and, optionally, at `--output`. Heap fields are bytes; operation times are milliseconds. `retainedHeapBytes` is the increase above a forced-GC baseline after obsolete snapshot references leave the stack. `stagePeakHeapBytes` samples allocation after each operation; it is not a continuous peak measurement. `reclaimMs` drains the entire cooperative collector synchronously, so it is not an editor maintenance-slice latency. Timings are cold per-process observations, not a calibrated typing regression gate.

Build each candidate before running. Compare the same Node version and machine, without other benchmarks running. The script reads that checkout's built textbuffer directly and performs no installation.
