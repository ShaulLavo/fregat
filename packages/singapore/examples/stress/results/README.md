# Local baseline

These controls use Intel Core i7-14700K, 28 logical CPUs, 31.1 GiB of reported RAM,
Arch Linux 7.1.9-arch1-2, Node 26.7.0, and headless Chromium 148.0.7778.96.
The Playwright browser build is the one installed for the repository's locked dependency.
They are developer-machine controls, with the desktop and other applications still running.
No CI threshold is installed.

Each complete run contains 180 recorded samples: five fixtures, six scenarios, cold and warm
states, and three repetitions. Each warm group also has an unrecorded warmup. The 40-character
typing burst records each trusted key, its applied edit, and the following animation frame.

The first unchanged rerun exceeded nine of 92 latency limits and three of 250 resource limits
derived from the first three controls. Its raw data is preserved as `control-4.json`. The final
envelope includes that observed variability, and a new independent run checks the resulting limits.
The proof reproduces both the initial failure and the final comparison.
The second unchanged run still exceeds three cold long-line typing limits and one heap limit by
164 bytes. This calibration is not stable enough to claim small improvements or gate CI. The
comparison command correctly exits nonzero; the proof reports `calibrationStable: false` separately
from its fixture, cancellation, and rejection checks. No editor performance change is claimed.

The measured core commit is `9abb944f3a2b8d6516953fdec75e8df5e1a94811`. The working tree includes
the new benchmark, so results also record a source hash. Controls must have the same source hash;
the candidate may differ. Exact UTC run dates and all raw observations are in the JSON files.

The first control contains these timings in milliseconds:

| Fixture       |   Lines | Cold attach p50 | Warm key-to-edit p95 | Warm 100-cycle churn p50 |
| ------------- | ------: | --------------: | -------------------: | -----------------------: |
| ordinary      |     200 |           15.10 |                 1.40 |                    96.40 |
| short-lines   | 500,000 |          176.40 |                 0.80 |                    93.20 |
| long-line     |       1 |           46.80 |                30.30 |                 10573.40 |
| unicode       |   2,049 |           23.70 |                 2.70 |                  1712.30 |
| mixed-endings |   3,001 |           15.20 |                 1.10 |                   102.60 |

Attach measures buffer and view construction/attachment. It excludes fixture generation and
filesystem access. Screenshot completion bounds, individual key/frame samples, throughput,
main-renderer heap bytes, DOM counts, and correctness observations remain in the raw files.

Post-disposal weak references sometimes still find two objects in find-all and Unicode scenarios.
The suite reports the observed counts and calibrates resource limits separately. It does not
claim that every disposed object has been collected. Closing each scenario group's browser
context releases its remaining resources and language worker runtime.

Run the documented commands in [the runner guide](../README.md) to collect new controls.
Use `bun run --cwd examples/stress proof` to replay the checked evidence. The proof includes
an independent unchanged rerun, live cancellation, synthetic changes to actual recorded timing
and memory samples, and rejection of missing samples, changed hashes, and incompatible options.
Synthetic regression checks test the comparator; they are not measurements of a modified editor.
