# Browser highlighted open after viewport-first syntax

A quiet-scheduled, headless Chromium experiment after [PR #1021](https://github.com/ShaulLavo/fregat/pull/1021). The main comparison uses Singapore's default viewport-first syntax mode. The 10 MiB whole-document run is a separate instrumented reference. These are frame-opportunity measurements on one repeated TypeScript fixture. Physical presentation and a public editor-speed ranking remain unmeasured.

## Default highlighted open

Median milliseconds across three repetitions. All 45 attempts completed the original open, typing and scroll protocol, including all three Singapore attempts at 200 MiB.

| MiB | Singapore |  Monaco | CodeMirror |
| --: | --------: | ------: | ---------: |
|   1 |     138.5 |   114.4 |       64.8 |
|  10 |     147.9 |   152.1 |       56.4 |
|  50 |     193.3 |   325.7 |      108.6 |
| 100 |     240.5 |   555.7 |      155.1 |
| 200 |     336.1 | 1,018.0 |      271.7 |

At 10 MiB, Singapore now records 147.9 ms against the supplied earlier reference of 1,464 ms. Monaco records 152.1 ms against 169 ms, and CodeMirror records 56.4 ms against 56 ms. Singapore and Monaco are close at this size; CodeMirror has the lowest observed median. At 200 MiB, Singapore records 336.1 ms, where its earlier comparison attempts reached the 30-second visible-highlighting deadline.

The supplied historical reference combines two experiments. Singapore's 1,464 ms came from the instrumented open diagnostic; the earlier uninstrumented comparison recorded 1,517.7 ms. The 169 ms and 56 ms competitor references round the uninstrumented values of 169.4 ms and 56.1 ms. The historical runs were noisy. This rerun matches their machine, browser, fixture identities and competitor versions, but it is not a controlled before/after pair and establishes no causal speedup ratio.

The [earlier comparison](https://github.com/ShaulLavo/fregat/blob/main/editor/docs/performance/browser-compare-2026-10-08.md) and [earlier diagnostic](https://github.com/ShaulLavo/fregat/tree/main/editor/docs/performance/singapore-open-2026-10-08) retain those runs. `historical-reference.json` records the exact reference values and source commits.

## Whole-document reference at 10 MiB

Singapore's `--full-document` highlighted-open median is **5,072.6 ms**, with three completed attempts. All nine editor profiles completed. The same diagnostic recorded Monaco at 577.0 ms and CodeMirror at 1,105.1 ms.

This build makes Singapore wait for the full parse, injection discovery, highlighting, structural queries and token-store construction before accepting a highlighted frame. Monaco's reference tokenizes the entire string with Monarch; CodeMirror's reference parses and walks the full Lezer tree. Their reference work runs synchronously before the first-frame clock settles. They perform different supporting work, so these diagnostic clocks establish no ranking of equal whole-document analysis. Traces, worker phase timings and full-result coverage checks are retained in `full-document/`.

## Method and environment

- Date, UTC: 2026-10-08. Default run began at 19:18:20; whole-document run time is recorded in its raw JSON.
- Product commit: `b035dc69d20bfa9b3cddd523d958b38d7b741d9e`, the merge of PR #1021. No product source changed during these runs.
- Machine: Intel Core i7-14700K, 28 logical CPUs, 31.1 GiB usable RAM, Linux x64, kernel `7.2.8-arch1-2`.
- Browser: Playwright 1.63.0, headless Chromium `153.0.8010.12`. Node 26.7.0, Bun 1.4.2, Vite 8.3.1. No CPU affinity.
- Packages: Singapore core, textbuffer, Tree-sitter and languages 0.2.6; Monaco 0.57.0; CodeMirror 6.0.2, state 6.7.6, view 6.43.14, JavaScript language 6.2.5.
- Same ASCII TypeScript fixture, 1280 by 720 viewport, DPR 1, 14 px monospace font, 20 px line height and wrapping off. Fresh browser contexts and three rotating editor orders. Exact bytes, lines, fixture hashes and served-build hashes are in each `experiment.json.gz`.
- The open clock starts at editor construction after module loading and fixture generation. It waits for the mount's frame callbacks, visible syntax-token presence and two further animation-frame callbacks. This approximates a first highlighted frame opportunity. It does not verify full-viewport token coverage or whole-file completion in default mode.
- Both measurements took the host's quiet FIFO turn and held its admission lock through measurement and cleanup. No other finite scheduled job overlapped either run. One declared preview server remained running. Both scheduler receipts report exit 0, no OOM kills and no quiet-hold expiry; `scheduling.json` records the receipts.

The default matrix retains the earlier comparison's 20 keys per location, 60 scroll frames, 300-second sample deadline and 30-second visible-highlighting deadline. Its extra input and heap observations remain raw evidence; this report compares open time only. Headless scheduling, the repeated fixture and the different editor feature sets limit interpretation. These numbers are experiments, ready for a separate headed qualification before public performance claims.

## Reproduce

Use a fresh checkout at the recorded product commit. Install the standalone benchmark dependencies in a separate scratch directory to keep its Vite separate from the repository workspace. Set `TMPDIR` to a suitable workload volume and reuse a Playwright browser cache when available. Run the measurement commands under your host's quiet scheduler; `--condition quiet` records the operator's scheduling decision.

```sh
bun install --frozen-lockfile
deps=$(mktemp -d "${TMPDIR:-/tmp}/singapore-compare.XXXXXX")
cp editor/bench/compare/package.json editor/bench/compare/bun.lock "$deps/"
(cd "$deps" && bun install --frozen-lockfile)
ln -s "$deps/node_modules" editor/bench/compare/node_modules
cd editor/bench/compare
bun run test
bun run build
bun run bench --condition quiet --keys 20 --scroll-frames 60 \
  --timeout 300000 --output ./results/after-1021
node summarize.mjs ./results/after-1021/experiment.json
bun run build:full
bun run bench:full --condition quiet --repetitions 3 \
  --timeout 180000 --output ./results/full-after-1021
node summarize-open.mjs ./results/full-after-1021/experiment.json
```

The [benchmark method and scripts](https://github.com/ShaulLavo/fregat/tree/b035dc69d20bfa9b3cddd523d958b38d7b741d9e/editor/bench/compare) specify browser setup, readiness detectors, geometry guards, traces and measurement limits. The same summarizers accept the compressed evidence committed here. Verification passed 27 harness tests, 45/45 default samples and 9/9 whole-document profiles. Representative 10 MiB screenshots from all three editors and Singapore's 200 MiB screenshot were read back and showed syntax colours.
