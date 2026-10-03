# Heavy jobs

Run memory-intensive local work through the installed runner, from the directory the command needs:

```sh
bun /work/platform-production/heavy/current/run.js --class suite checks -- bun run test
bun /work/platform-production/heavy/current/run.js --class bench --quiet measurement -- bun run bench
```

Classes (`suite`, `browser`, `build`, `bench`, `light`) choose a memory estimate and a per-job slice ceiling from `developer.heavyJobClasses`. Admission is FIFO and accounts for available memory, running jobs' unrealized estimates, the memory reserve, memory pressure and CPU load. Every job retains its own slice, accounting, stop grace and orphan cleanup. `nested-scope.sh` puts child scopes under the job's ceiling.

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

A declared server enters the same admission queue and keeps its class estimate, memory ceiling and accounting. Once admitted, it stays outside the quiet drain and holds no shared slot locks. This breaks the cycle where a quiet measurement waits for a server whose browser check is queued behind that measurement. New server requests follow FIFO and wait during active quiet holds. The flag applies to local jobs and cannot combine with `--quiet` or `--host pi`.

A single finite browser job can also own server startup, readiness, browser work and teardown within its slice. Its child commands run directly in that job; the owning job must be able to finish without queuing another heavy job.

## Quiet measurements

`--quiet` drains finite running jobs and orphan slices, then holds admission while the measurement runs. Existing declared servers keep running. Their unrealized memory estimates, observed memory use and machine pressure still participate in admission. A quiet run records the server identities seen at admission in `serversAtAdmission`; status marks them `server`. Measurements requiring zero server activity need those servers stopped first.

Admission and execution each get an independent `developer.heavyJobQuietHoldSeconds` bound (default 600 seconds). The admission clock starts at enqueue and uses monotonic boot time. Expiry releases the request's ticket and returns exit 75, including when earlier jobs, resource pressure, a drain request or exclusive slot locks prevent admission. This also breaks a resource dependency cycle when a quiet request cannot fit beside a server waiting for its queued browser check.

The running budget starts at admission with an absolute monotonic deadline enforced by the wrapper and systemd. Launch preparation uses that budget; a delayed launch gets only the remaining time and cannot start after its deadline. Quiet-hold expiry stops the job and returns exit 75. Invoke it again to get a fresh queue ticket. The runner leaves retries to the caller. Cancellation and admission exceptions also release the waiting entry. Admission mutex contention is polled, so it participates in the admission deadline. Admission expiry is evaluated between reconciliation passes and at the final admission boundary; a synchronous systemd operation must return before the wrapper can check it again.

`--max-wall <seconds>` bounds running time on either host and excludes queue wait. Ordinary queue wait is unlimited. Quiet requests retain the separate admission window above. Local jobs have no default running limit; Pi jobs default to 3600 seconds. For a quiet job, the shorter of `--max-wall` and the configured quiet hold sets the running budget. An expired shorter `--max-wall` returns exit 124 and retains that reason through teardown; an expired quiet hold returns exit 75.

Requests keep FIFO order after a quiet hold. Fair turns between consecutive quiet requests remain tracked in [issue #405](https://github.com/ShaulLavo/fregat/issues/405). Job completion releases its entry and slot locks independently of the admission mutex.

The admission boundary determines which servers may coexist with a quiet measurement: a server admitted earlier stays eligible to launch and appears in `serversAtAdmission`; new server requests wait for admission during the hold.

External tools can write `drain.request` in the state directory, then take `slot1.lock`, `slot2.lock` and `slot3.lock` exclusively. Finite jobs retain these locks until their processes drain; declared servers hold none. A drain request blocks new admissions for at most one quiet hold. An external lock holder owns its cleanup and duration; `status.js` reports its age.

## Status, records and installation

```sh
bun /work/platform-production/heavy/current/status.js
bun /work/platform-production/heavy/current/report.js --since 1d --by command
```

Finished jobs append JSONL to `developer.heavyJobLogDirectory`, including queue time, admission reason, `server`, `serversAtAdmission`, class budget, checkout commit, wall time, CPU time, peak memory and exit code. Fix repeated heavy consumers at their cause.

The installed bundle stays pinned until explicitly replaced from a clean checkout with `bun scripts/heavy/install.ts`. Source changes and pulls leave the live runner unchanged. Existing running and queued wrappers keep their launch-time behavior. After installing the updated runner, restart private servers with `--server`. Cancel each existing queued quiet wrapper before invoking its request again through the updated runner, so its old FIFO ticket is released. Existing finite jobs can finish normally.

The [Pi lane](pi/README.md) runs independently under its own ceiling and wall limit.

## Tests

```sh
bun /work/platform-production/heavy/current/run.js --class light heavy-tests -- bun --bun vitest run scripts/heavy --environment node
```

Tests use private state directories and slice roots. Systemd and browser proofs skip with their platform prerequisites when unavailable. Installer tests use private install roots, leaving the production runner untouched.
