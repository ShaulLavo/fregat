# Heavy jobs

Run memory-intensive local work through the installed runner, from the directory the command needs:

```sh
bun /work/platform-production/heavy/current/run.js --class suite checks -- bun run test
bun /work/platform-production/heavy/current/run.js --class bench --quiet measurement -- bun run bench
```

Classes (`suite`, `browser`, `build`, `bench`, `light`) choose a memory estimate and a per-job slice ceiling from `developer.heavyJobClasses`. Admission is FIFO and accounts for available memory, running jobs' unrealized estimates, the memory reserve, memory pressure and CPU load. Every job retains its own slice, accounting, stop grace and orphan cleanup. `nested-scope.sh` puts child scopes under the job's ceiling.

## Vitest worker ceiling

The launcher supplies `VITEST_MAX_WORKERS=4` when the caller has not set it. The checkout's pinned Vitest patch intersects that ceiling with each suite's resolved worker count. `fileParallelism: false` keeps one worker, a smaller explicit `maxWorkers` keeps its limit, and otherwise parallel suites use at most the supplied count. Node and browser pools consume the same resolved policy.

Vitest owns configuration resolution. Keeping the ceiling there covers nested test commands and inline projects without teaching the heavy launcher to load suite configs or changing every serial suite. The runner's memory admission and slice ceiling remain unchanged.

The root owns the canonical `patches/vitest@5.0.2.patch`. Editor, Ghostty and hotkeys declare that dependency patch in their family manifests and carry identical patch files inside their exported subtrees. `bun run workspace:check` checks declarations and bytes; `bun run workspace:sync` refreshes them from the root. Exact standalone installs receive the same policy as monorepo installs.

## Private dev servers

Use the shared mesh dev route for normal app work. A private long-lived server needed by a browser check declares its lifecycle with `--server` and uses an explicit free port:

```sh
# Run from apps/web; select a free port before starting.
bun /work/platform-production/heavy/current/run.js --server --class light fixture-vite -- bun x vite --host 127.0.0.1 --port 5187 --strictPort

# Queue the browser check separately while that server stays running.
bun /work/platform-production/heavy/current/run.js --class browser fixture-check -- \
  env WEB_PORT=5187 bun ../../scripts/agent/browser.ts \
  scenario settings-focus --url http://127.0.0.1:5187/
```

Stop the server wrapper after the check, including on failure or cancellation. SIGINT or SIGTERM stops its whole slice with the configured grace.

A declared server enters the same FIFO queue and keeps its class estimate, memory ceiling and accounting. Once admitted, it stays outside the quiet drain and holds no shared slot locks. This breaks the cycle where a quiet measurement waits for a server whose browser check is queued behind that measurement. New server requests keep FIFO among eligible jobs. During an active wrapper quiet hold, declared light servers use the same light-admission rule as finite light jobs. The flag applies to local jobs and cannot combine with `--quiet` or `--host pi`.

A single finite browser job can also own server startup, readiness, browser work and teardown within its slice. Its child commands run directly in that job; the owning job must be able to finish without queuing another heavy job.

## Quiet measurements

`--quiet` drains finite running jobs and orphan slices before starting the measurement. Existing declared servers keep running. Their unrealized memory estimates, observed memory use and machine pressure still participate in admission. A quiet run records the server identities seen at admission in `serversAtAdmission`; status marks them `server`. Measurements requiring zero server activity need those servers stopped first.

During an active wrapper quiet hold, new finite light jobs and declared light servers may start. Suite, build, browser, bench and every `--quiet` request remain held. Light jobs pass those held classes while retaining FIFO among eligible light jobs. An earlier eligible light job waiting for resources keeps later light jobs waiting. Outside an active hold, including its initial drain and after its lease expires, admission retains the full FIFO queue. Memory estimates, slice ceilings, reserve, pressure, CPU load, external drain and slot-lock gates apply unchanged.

`developer.heavyJobQuietPolicy` owns the allowed class set and the CPU-set data shape. Its portable baseline is `{ "allowedClasses": ["light"], "measurementCpus": [], "concurrentCpus": [] }`. An empty allowed class set disables concurrent light admission. This release validates light-only class sets and empty CPU sets. It leaves CPU affinity to the host scheduler. Additional classes and inherited CPU affinity require separate validation and implementation; it sets no systemd `AllowedCPUs` property.

Each quiet measurement's single finished JSONL record includes `jobsDuringRun`. This array records every overlapping wrapper launch interval exactly once by job id, including late-entering jobs and jobs that settle before the measurement ends. Each item contains `id`, `label`, `pid`, `cwd`, `sliceRoot`, `class`, `server`, `allowedCpus`, `startedAt` and `endedAt`. A null end means settlement was not observed before the measurement settled. The baseline logs empty `allowedCpus` arrays. Intervals start at process spawn and end at whole-slice settlement, including scope startup and cleanup. A job still preparing its slice ceiling has no spawn interval yet. Commands and environment values are excluded.

Publication, process spawn and settlement serialize through a short `runtime.lock`, separate from admission's asynchronous orphan reconciliation. Manager preparation and cleanup run outside that mutex. A delayed manager call for one job lets other measurements settle and release their ownership. A refused spawn rolls back its publication before manager cleanup. Active intervals live under `runs/`; each measurement owns an id-keyed journal under `measurements/`. Atomic publication keeps interrupted writes from exposing partial JSON. Finished intervals stay in the measurement journal until its final record is assembled, then its runtime files are removed. A later launch prunes runtime entries whose queue ownership disappeared. Abrupt wrapper death can leave an unknown end; it does not invent a completion time.

Admission and execution each get an independent `developer.heavyJobQuietHoldSeconds` bound (default 600 seconds). The admission clock starts at enqueue and uses monotonic boot time. Expiry releases the request's ticket and returns exit 75, including when earlier jobs, resource pressure, a drain request or exclusive slot locks prevent admission. This also breaks a resource dependency cycle when a quiet request cannot fit beside a server waiting for its queued browser check.

The running hold starts at admission and is independently enforced by the wrapper and systemd. The promoted entry carries `quietDeadline` in monotonic boot seconds. The pinned scope shim rejects expired payloads at entry and uses the remaining budget for its whole-slice watchdog. A launcher delayed before scope activation retains fd 6 until entry and cannot execute an expired payload. Expiry returns exit 75. Invoke it again to get a fresh FIFO ticket. The runner leaves retries to the caller. Cancellation and admission exceptions also release the waiting entry. Admission mutex contention is polled, so it participates in the deadline. Expiry is evaluated between bounded reconciliation passes; manager clients exit before the wrapper releases admission.

A finite local job arms a transient `<root>-<id>_deadline.service` under `app.slice` from inside its scope before executing its command. `Type=notify` gates execution on readiness. Startup has a fixed 10-second manager budget: eight private startup measurements took 8–17 ms, leaving ample scheduling headroom while bounding a frozen pre-readiness process. After readiness, the service sends TERM to the whole owned slice at the runtime limit and KILL after the configured grace. Its native `RuntimeMaxSec` covers runtime plus grace. A 3-second native watchdog receives real heartbeats each second through runtime and grace, so a frozen post-readiness shell also triggers cleanup. The KILL stop signal and `ExecStopPost` cover startup failure, runtime expiry, watchdog failure and normal exit.

The expected service wall budget is **10 seconds startup + runtime + configured grace + 3 seconds stop/cleanup allowance**. `quietUntil` records that budget. The retained `ExecStopPost` KILL client can be canceled before it kills the owned slice, leaving sibling processes alive after this timestamp. Admission therefore checks actual bookkeeping ownership and slice cleanup before light eligibility. A live quiet owner grants the configured light exception only while its matching published interval, running wrapper, populated slice and unexpired `quietDeadline` remain active. Preparing, suspended, expired and manager-cleanup owners keep admission blocked. A dead quiet entry remains until its cgroup is drained and manager cleanup has successfully stopped its slice. Timestamp expiry alone never releases admission. `quietDeadline` constrains payload execution only; a live bookkeeping lock still blocks after that deadline and after its slice drains. Prior installed producers lack the absolute guard and retain their pinned code and ownership across atomic installation.

An ordinary request blocked by a quiet predecessor reports a failure once both its `developer.heavyJobQuietHoldSeconds` monotonic wait budget and the predecessor's recorded `quietUntil` have elapsed, checked between bounded reconciliation passes. A missing predecessor deadline counts as overdue. This preserves a healthy predecessor's startup, runtime and cleanup budget. At that limit the request releases its queue entry, prints one quiet-lease warning and a structured failure naming the predecessor slice and its observed state, and returns exit 2. The timestamp determines when the failure is reported; actual ownership and cleanup determine admission. Stop the listed slice and resume or stop its suspended wrapper before submitting a new request.

A healthy service retains the runtime budget while renewing its heartbeat. A suspended wrapper cannot suspend the service. Arming after scope entry preserves delayed-launch ownership on fd 6. Startup signals abort execution, and a monotonic runtime check rejects a delayed readiness return even while the service remains active during grace or TERM is missed. Normal completion and abortable orphan reaping stop and collect the service.

A server admitted earlier stays eligible to launch and appears in `serversAtAdmission`. Declared light servers admitted during the hold appear in `jobsDuringRun`. Other new server classes wait for the hold to end.

External tools can write `drain.request` in the state directory, then take `slot1.lock`, `slot2.lock` and `slot3.lock` exclusively. Finite jobs retain these locks until their processes drain; declared servers hold none. A drain request blocks every new admission, including light work, for at most one quiet hold. Waiting or held exclusive slot locks also block light work. An external lock holder owns its cleanup and duration; `status.js` reports its age. External holders have no wrapper measurement record, so this change adds no attribution or concurrency exception to their holds.

## Status, records and installation

```sh
bun /work/platform-production/heavy/current/status.js
bun /work/platform-production/heavy/current/report.js --since 1d --by command
```

Finished jobs append JSONL to `developer.heavyJobLogDirectory`, including queue time, admission reason, `server`, `serversAtAdmission`, `jobsDuringRun`, `allowedCpus`, class budget, checkout commit, wall time, CPU time, peak memory and exit code. Fix repeated heavy consumers at their cause.

The installed bundle stays pinned until explicitly replaced from a clean checkout with `bun scripts/heavy/install.ts`. Source changes and pulls leave the live runner unchanged. Existing running and queued wrappers keep their launch-time behavior. After installing the updated runner, restart private servers with `--server`. Cancel each existing queued quiet wrapper before invoking its request again through the updated runner, so its old FIFO ticket is released. Existing finite jobs can finish normally.

The [Pi lane](pi/README.md) runs independently under its own ceiling and wall limit.

## Tests

```sh
bun /work/platform-production/heavy/current/run.js --class light heavy-tests -- bun --bun vitest run scripts/heavy --environment node
```

Tests use private state directories and slice roots. Systemd and browser proofs skip with their platform prerequisites when unavailable. Installer tests use private install roots, leaving the production runner untouched.
