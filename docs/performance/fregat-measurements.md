# Fregat timing experiments, 2026-10-08

These are noisy experiments on one Linux machine, with synthetic files and
headless Chromium. Other jobs overlapped this run. They establish reproducible
observations for this commit, with uncontrolled host contention. They do not
establish comparisons with other products, physical-display latency, or Plan
201's one-frame typing target.

## Source and machine

Measured commit: a632b0d321cd5c9cb098ed067b6c775d6f1efa46
Build source: the same clean commit; the driver verifies source stability through
its production Vite build and records a fingerprint in measurement-source.json.
Run began: 2026-10-08T07:48:09.782Z
Machine: omarchy; Intel(R) Core(TM) i7-14700K; 28 logical CPUs;
31.08 GiB RAM; linux 7.2.8-arch1-2.
Bun: 1.4.2. Chromium: 153.0.8010.12. Viewport: 1440 × 1000.
Page rasterization: disabled_software.
Page compositing: disabled_software.
GL renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver-5.0.0).
Rendering is software/SwiftShader; these are not hardware-accelerated browser results.

Production web assets were served by fixture-only isolated API servers on free
loopback ports, with fresh state homes. The API runs directly from the same committed
source, so this is a production web build with a source API, not an installed release
bundle. No model-provider account was used. The
host's ordinary heavy runner used its suite class, with a 6,656 MiB memory
ceiling for the 200 MiB case and language-server processes. Quiet admission was
cancelled to finish this first experiment. Each file case had a fresh server and
browser. Workspace reloads reused one browser context.

Host overlap observed after the build, as measurement started:

```text
2026-10-08T07:48:13Z
machine: 15040 MiB available, memory pressure 2.55%, CPU load 0.05 per core
drain: none requested
quiet hold: none
slot locks: free for heavy jobs
running: 2
  p336-noisy-production-experiments-v2 (suite, 6656 MiB) 9s using 1083 MiB
  p336-singapore-private-preview-restarted (light, 1536 MiB, server) 1246s using 177 MiB
```

This snapshot is not continuous CPU or memory accounting. Overlapping work may
change during the run. A quiet repeated run is required before headline use.

## Workspace and terminal observations

Warm workspace reload to useful paint opportunity:
n=5, p50=145.20 ms, p95=192.50 ms
Editor tab switch, alternating two already-open files:
n=10, p50=83.90 ms, p95=182.70 ms
Reload to first terminal frame paint opportunity:
n=5, p50=145.20 ms, p95=192.50 ms
Server observed healthy to replayed terminal paint opportunity:
949.99 ms, one restart.
Fresh terminal socket connections after restart: 2.

The workspace is a disposable Git repository containing two 100-line text files.
A useful workspace paint requires visible text from the selected file and the
other file's accessible tree label. Reload timers use the new document's
performance.timeOrigin. A sampler checks readiness in rAF and records its next
rAF callback, giving a paint opportunity between the two callbacks.

The first terminal frame may be the synchronously painted saved viewport. A live
frame qualifies only after the native frame and replay-complete gate remove the
host's inert attribute. The restart measurement additionally requires the latest
fresh socket to receive the unique output marker and ready message, and the new
post-update document to reach the live-frame gate. The same terminal identity is
asserted across every reload and restart. The printf marker is split between its
format string and argument so command echo cannot satisfy the replay check.

Restart uses the isolated supervisor and a staged fixture release, with a 1,000 ms
supervisor delay. It changes the fixture release descriptor while serving the same
committed production assets before and after restart. GET /release is polled every
10 ms until an offline interval is
followed by a successful response. The reported interval starts at that observed
response and includes the app's automatic document reload, UI readiness polling
and two subsequent frame callbacks. It excludes the server's offline interval.
Health polling introduces observation lag; this is an observed interval, not a
measurement of the exact instant the server begins accepting requests.

Tab timing starts at pointerdown.timeStamp, waits for visible target content and
two frame callbacks, and uses the same page clock for the endpoints. Playwright
readiness waits add observation overhead. These are upper-bound readiness timings,
not GPU presentation timestamps. Workspace/terminal runs use ordinary Chromium
frame scheduling, without the file experiment's unthrottling flags.

## File observations

All times are milliseconds. Each typing distribution contains 30 x keystrokes
after 10 seconds of settling. Inputs have a minimum 80 ms pause, and the next key
waits for the current key's second frame marker. Playwright sends each x as an
automated key press. p50 is the sorted sample at floor(n/2);
p95 is nearest rank ceil(0.95*n). For five reloads, p95 is simply the largest sample.

```text
ext size MiB analysis   open       busy p50   busy p95   rAF p95    save      bytes
txt        1 default     336.79      4.590      7.032      5.600      62.15  exact
txt      200 default    1356.39      3.623      4.901      3.300    9603.14  exact
ts    0.0625 off         325.88      3.592      5.213      3.800      33.07  exact
ts    0.0625 on          369.74      8.699     18.854      9.700      67.85  exact
ts         1 off         346.19      4.397      6.232      4.700      62.88  exact
ts         1 on          372.00     17.264     46.164     13.900      53.82  exact
ts        10 off         390.89      5.362      9.244      7.600     288.08  exact
ts        10 on          453.32     67.198    239.596     63.800     556.79  exact
```

Size is the target saved size, following the committed Plan 112 harness. The open
fixture has target bytes minus 30, and typing prepends 30 ASCII x characters.
Thus the 200 MiB case opens 209,715,170 bytes and saves exactly
209,715,200 bytes. Its UTF-8 corpus contains non-Latin-1
characters and is generated by scripts/large-file/fixture.ts. The small TypeScript
case is a 64 KiB target (65,506 bytes before typing). TypeScript uses the scoped
function corpus; plain text uses the folded function corpus.

Every save checks HTTP success and hashes the actual disk bytes against a streaming
SHA-256 of the original file prefixed with the expected x characters. The raw
results retain both hashes, each sample, heap measurements and process-tree peaks.
The 200 MiB hashes are:
expected: 89a66d3c689e35e55048ef794cabb1eb87bfc11b5329a8b6c44ac4dc625733ec
saved: 89a66d3c689e35e55048ef794cabb1eb87bfc11b5329a8b6c44ac4dc625733ec

Open time runs from initiating the tree click to observing the first visible
marker row. It includes Playwright actionability and readiness waits, and is not a
physical first-paint timestamp. Save time runs from triggering the platform save
shortcut to observing the /fs/write response; byte-exact verification follows.

Analysis off sets editor.largeFile.analysisLimitMiCodeUnits to 0 and requires the
large-file notice. Analysis on sets it to 20, selects Tree-sitter themes, and
requires painted token colors and the Tree-sitter worker. Other analysis settings
keep fixture defaults. This compares the document analysis tier as a whole;
it does not isolate language-server, spellcheck or highlighter costs. Host contention
varies between cases, so on/off differences are not a causal estimate of analysis
cost. Plain-text cases use the default tier. Initial size is below the configured code-unit budget
for every TypeScript analysis-on case. The repeated synthetic corpus produces many
language-service diagnostics: the reviewed 10 MiB analysis-on screenshot shows
60,966 problems. It is a stress corpus, not a representative project file.

The file browser is unthrottled with --disable-frame-rate-limit and
--disable-gpu-vsync. Chrome tracing runs during the open/type/save exercise, with
timeline and V8 sampling categories. The legacy rAF number is still retained;
these scheduling flags make it unsuitable for comparison with the earlier 60 Hz
Plan 112 numbers. Tracing itself adds overhead. Each case is a single run; this
is not a repeated-run confidence estimate, an analysis-tier ceiling search, or a
proof of every file's behavior at these sizes.

## The better typing meter and Plan 201

The experimental task-time meter sums the union of renderer-main-thread RunTask
wall-time intervals from the task containing the keydown marker through the task
containing the second animation-frame callback marker. It measures task wall time,
which can include operating-system scheduling delays, rather than CPU time. It includes input handling and frame
work present in those tasks, and any unrelated main-thread work in that window.
It excludes idle gaps, worker execution and work scheduled after the window.
The results retain the sum of EventDispatch durations and elapsed window length
per key. EventDispatch records can nest: this diagnostic sum can double count and
exceed task time. Only the union of RunTask intervals supplies the typing table.
Windows are completed before the next sampled key is sent; missing or unenclosed
markers fail the measurement. Arithmetic tests cover idle exclusion, other threads,
duplicate tasks and missing markers.

This is an upper bound on causal main-thread work inside each sampled window.
It is not a complete attribution of asynchronous work to a key. Delayed analysis
can land after the sampled window or overlap a later key; worker cost is not in
this number. The 1 MiB plain-text known-good case reads busy p50
4.590 ms and p95 7.032 ms, showing the meter's sub-frame
resolution on this workload.

Plan 201 still says "Implementation has not started" in the measured checkout.
This change implements an experimental task-window meter and the requested
small/1 MiB/10 MiB tier matrix.
Full step 0 remains incomplete: exact causal Event Timing/frame attribution and
controlled language-server/spellcheck ablations for both Shiki and Tree-sitter
remain. Estimate: one working day for those remaining measurement-only switches,
repeat runs and attribution review. Plan 201's performance fixes are outside
this experiment. These rows alone cannot certify its 120 Hz or 60 Hz targets.

## Reproduce

Use a clean checkout of the measured commit and the prerequisites described in
docs/development.md. Install a Chromium browser through Playwright if absent.
Choose a new evidence directory on a data drive with room for the web build,
synthetic fixtures and traces. Run on a quiet machine through its own scheduler.

bun install --frozen-lockfile
bun run build:workspaces
export PLAYWRIGHT_BROWSERS_PATH=/absolute/path/on/data-drive/browser-cache
bun x playwright install chromium
out=/absolute/path/to/new/evidence-directory
bun scripts/performance/fregat-measure.ts --out "$out" --web-root "$out/web" --build

--phase workbench or --phase files selects one half. Reusing --web-root without
--build requires its measurement-source.json to match the current clean commit.
Use fresh output directories for file runs. The driver refuses dirty source,
records the build/source/machine/date, checks all eight cases and saves screenshots,
structured logs, per-key trace samples and raw trace.json files.

For scenario/trace verification against a private Vite server on a free loopback
port, use the existing agent harness with its isolated state:

WEB_PORT=<private-port> bun run agent:browser trace workbench-measurements

The scenario also writes replayed-after-server-restart.png before cleanup. The
harness's final page screenshot is blank because cleanup navigates away from the
app before releasing its shell. Expected disconnect warnings during the deliberate
restart remain in raw logs; page execution errors fail the production driver.
The reviewed workbench logs also contain six HTTP 500 responses from
GET /fs/workspace-edit/recovery: discovery tried to lstat a missing, unrelated
fregat-undo-barrier temporary directory (apps/server/src/fs/workspace-edit.ts:349).
Fresh state homes therefore did not isolate this filesystem-wide discovery.
These requests did not fail the timing assertions, but the workspace rows include
this background failure and must be read with that limitation. Provider-registry
warnings also occur with disabled fixture providers. No absence-of-server-errors
claim is made. The discovery failure is an off-lane finding, not fixed here.

Committed evidence: docs/performance/fregat-measurements-20261008.json.
Method source: scripts/performance/fregat-measure.ts,
scripts/agent/scenarios/workbench-measurements.ts, scripts/large-file/run.ts,
scripts/large-file/typing-cost.ts and scripts/large-file/fixture.ts.
Earlier method: docs/large-file-ceiling/README.md and
plans/201-cheap-overlay-marks.md.
