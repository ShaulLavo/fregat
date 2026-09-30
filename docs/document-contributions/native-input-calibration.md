# Plan 099 unit 0: native input calibration over consumer configurations

Status: in progress, 2026-09-30. Unit 0 stays partial. The supported matrix is running, two first
calibrations were rejected (holdout failed) and get one serialized fresh set, and the long-line
fixture cannot be measured with Shiki in either package set (see [Outstanding](#outstanding)).

Raw results, calibrations and logs: `/work/tmp/fregat-evidence/foundations-documents/native-input/`.
Checklist and driver: `/work/tmp/foundations-documents-calibration/` (`progress.md`,
`matrix.sh`, `summarize.mjs`, `matrix.log`).

## Identity

| Item                 | Value                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument           | Platform `dbdaa7ced`, `editor/examples/stress`, instrument hash `32deadee…6014`. Every run uses a detached runner worktree at that commit, so no run mixes instruments           |
| Baseline packages    | `native-input/packages-baseline`: all 20 Editor packages (`src`, `dist`, `package.json`, exports, dependency resolution) from `2ac20743c`, source `05360bd7…`, build `5f36421c…` |
| Candidate packages   | `native-input/packages-candidate`: the same 20 packages from main `3a0f097d` (unit 1 merged), 23/23 workspace builds, source `918a7605…`, build `818af4a7…`                      |
| Package resolution   | The runner aliases every `@singapore-editor/*` export to the frozen `dist` entry; `loadPackageSet` rehashes membership, source, build and manifests before each run              |
| Fixtures             | `native-input/fixtures`, seed 60061, files hashed on read: ordinary `cf222f56…`, short-lines `2bacff11…` (12,834,064 units), long-line `467fa816…` (1,048,594 bytes)             |
| Browser and hardware | Chromium 153.0.8010.12 headless, Node 26.7.0, i7-14700K, 28 logical CPUs, 31 GiB, viewport 1000×1000; runs share the machine through the 3-slot heavy wrapper                    |
| Workload             | The E002 input suite: six native input scenarios, single view and two-visible-plus-one-hidden, 3 repetitions and 1 warmup per group, one closed context per group                |

## Configurations

`input-configurations.mjs` names ten configurations. `native` is E002's original workload:
Tree-sitter on the ordinary fixture only, plus Find. The others build their plugins from the
frozen package exports in `src/inputConsumers.ts`:

| Id                                                          | Consumers                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`                                                  | No plugins                                                                                                                                                                                                                                |
| `tree-sitter`, `shiki`, `minimap`                           | One consumer. Tree-sitter uses one shared worker backend with every bundled grammar; Shiki one shared worker owner, `github-dark`                                                                                                         |
| `tree-sitter-shiki`, `tree-sitter-minimap`, `shiki-minimap` | Supported pairs                                                                                                                                                                                                                           |
| `all`                                                       | Tree-sitter, Shiki and minimap                                                                                                                                                                                                            |
| `platform`                                                  | Platform's default editor composition: Tree-sitter plus Shiki (the default theme `dark-plus` is a VS Code theme), minimap, Find, line and fold gutters, merge conflicts, bracket match, occurrence highlight, document links, scope lines |

Every configuration applies Platform's large-file tiers (`editor.largeFile.*` defaults): analysis
consumers, folding and scope lines pause above 10 Mi UTF-16 units and the minimap above 50 Mi.
The short-lines fixture is above the analysis limit, so it measures the paused set, as Platform
would show it. `native` keeps E002's workload unchanged.

### Readiness and output proof

Before input and again after it, each sample settles the consumers and asserts the result
(`assertConsumerReadiness`):

- Each owner that should exist is `ready`, has no pending requests and no error; an owner that
  should not exist is absent, and its worker was never created.
- Every view has one minimap worker that received source and accepted its latest render. After
  an input that edits, the minimap received more source than at open.
- With syntax active, live `editor-shared-token-*` ranges exist and every view is `painted`;
  without it there are no token highlights and views are `plain`.
- The minimap and gutter DOM exists exactly when configured, in every visible view.
- After disposal no instrumented worker is left running (`cleanup.liveWorkers`).

Settling waits for lazily started syntax sessions to leave `loading`, then repeats the idle
fences until both owners are quiet and tokens are live, bounded at 30 s (`settleMs` recorded).
The unit test `test/input-configurations.test.mjs` proves the assertions reject a missing, extra,
stalled or silent consumer.

## Comparison policy

Unchanged from E002 (`input-results.mjs`): per configuration, three unchanged baseline controls
form the envelope (limit = highest control p95 plus a noise margin), saved as
`runs/<config>/calibration.json` with the raw control runs before any candidate run. An
independent unchanged holdout must pass. A real 20 ms delayed control must fail every dispatch
group. The candidate is compared with the same instrument, fixtures and configuration. Workload
identity includes `consumers` and `unsupportedFixtures`, so no two configurations are compared.
Input-to-applied, dispatch and input-to-frame are blocking; screenshot completion is advisory.
With all three fixtures that is E002's 108 blocking and 36 advisory comparisons; a configuration
without long-line has 72 and 24.

The archived E002 proof (`results/input-latency`) still verifies at this instrument.

## Results

Filled from `summarize.mjs` when the matrix and the serialized recalibration finish. Rows
whose holdout failed or whose delayed control passed are reported as failed calibrations, and
their candidate checks are not results.

No latency claim for the refactor follows from these rows: unit 1 changed publication only, and
this matrix shows it stays inside each configuration's control envelope. Headless Chromium
input timing is not UI performance evidence.

## Outstanding

- **Long-line with Shiki.** Shiki has no line-length cap. On the 1 MB line its worker runs at
  100% CPU with no sample in 400 s. `ShikiWorkerOwner.dispose` awaits that busy worker's reply
  before `terminate()`, so disposal stalls and the worker leaks. The repair owner reports the same
  pattern in Tree-sitter's owner. The Shiki configurations (`shiki`, `tree-sitter-shiki`, `shiki-minimap`, `all`,
  `platform`) therefore record `unsupportedFixtures: ['long-line']`: 12 view/scenario groups per
  configuration, 60 in all, are not measured, and nothing here shows long-line syntax output or cleanup for them. A separate
  worker-cleanup repair is in progress. Once it has landed in both a new baseline and a new
  candidate package set, the long-line groups can run with bounded disposal. Shiki may still
  never finish the line, so syntax output there needs its own policy.
- **Tree-sitter above the analysis limit.** Before tiering, Tree-sitter-only on short-lines with
  three views had no live token ranges 30 s after undo. Platform pauses analysis at that size, so
  the tiered matrix does not exercise it.
- **Not observable here:** worker and WASM memory, per-consumer message payloads (see
  [baseline and inventory](baseline-and-inventory.md)), and pixel comparison of every token.
  External language-server admission needs its own service-contract proof; this browser matrix
  has no LSP.
