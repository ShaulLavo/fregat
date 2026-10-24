# Performance records

Reports and raw data from benchmark runs. This folder is a record, not a guide. For the editor's performance posture, read the [performance concept page](https://singapore.shaulavo.dev/docs/concepts/performance/).

Most file names start with a short code (`e040-balanced-tree.md`, `e034-*.json.gz`). A report names its method and the run it describes, usually with machine and date. Its numbers describe that run only.

Tests and checks read some of the data here, and other documents link to these paths. Do not rename or move files without updating them:

- `bench/compare/*.test.mjs` read `browser-compare-2026-10-08/` and `singapore-open-2026-10-08/`.
- `examples/stress` tests and the `turbo.json` inputs read `e034-*.json.gz`.

## Reports worth reading

| Report                                                     | What it settles                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Browser editor comparison](browser-compare-2026-10-08.md) | Singapore against Monaco and CodeMirror 6 on one fixture, with raw samples |
| [AVL sequence tree](e040-balanced-tree.md)                 | Why the sequence tree is an AVL tree edited in one descent                 |
| [Heap cost per piece](piece-heap-cost.md)                  | What a piece costs the garbage collector                                   |
| [SAB transport](sab-transport-2026-09-12.md)               | Why workers get strings instead of shared document storage                 |
| [Input latency](input-latency.md)                          | The paired input-latency gate and its limits                               |
| [File-open first paint](first-paint.md)                    | How unprepared opens publish text before scanning for folds                |

The other reports each cover one finished piece of work. The folders `singapore-full-parse-2026-10-08/`, `singapore-viewport-first-2026-10-08/` and `singapore-open-2026-10-08/` hold run output and traces. Reproduce the browser comparison with the commands in its report.
