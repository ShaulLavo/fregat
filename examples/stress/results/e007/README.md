# E007 evidence

The [implementation report](../../../../docs/performance/e007-consumer-copies.md) describes
the copy inventory, measurement boundaries, checks, and deployment.

- `verified-control-copies.json` and `verified-candidate-copies.json` use the final runner,
  ten iterations per size, precise main-renderer heap readings, and fresh-token comparison.
- `before-copies-diagnostic.json` and `after-copies-diagnostic.json` isolate snapshot read
  counts from the uninstrumented timings. They precede the added token-reference check.
- `before-consumers.json` and `verified-consumers.json` mount Shiki, find, and minimap,
  and encode LSP changes from the real buffer. Screenshots remain beside the original
  files in `/work/tmp/editor-e007/`.
- `control-stress.json` and `candidate-stress.json` retain E001's 72 samples per build,
  including all raw typing latency values. These are local observations, not a new CI gate.

Snapshot read lengths and wire payload lengths count UTF-16 code units. Heap values count
bytes. Heap excludes workers and is sampled at request submission and after forced GC.
Cold/warm E001 samples and the dedicated catch-up samples use different workloads; do not
compare their latency numbers directly.
