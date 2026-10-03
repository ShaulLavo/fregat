# Plan 313: keep quiet jobs and dev servers making progress

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #371](https://github.com/ShaulLavo/fregat/issues/371), including the second-occurrence comment. Fregat `scripts/heavy/` owns admission. This extends [Plan 284](284-resource-aware-heavy-jobs.md). Apply [Plan 312](312-heavy-slice-ownership.md)'s namespace safety to every process proof.

## Outcome

A private server needed by a browser check cannot leave the browser check queued behind a quiet job that waits for that server to exit. A quiet request has a bounded admission wait and a separate bounded running hold. Expiry releases its queue position and reports exit 75 so other jobs can proceed.

## Current evidence

At Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`, [run.ts](../scripts/heavy/run.ts)'s `admit` loops indefinitely. `attemptAdmission` considers only the FIFO head. [admission.ts](../scripts/heavy/admission.ts)'s `decideQuiet` waits for every running owner and orphan charge. The running quiet job already has both a wrapper timer and a systemd runtime limit. Its lease includes stop grace, and expiry returns 75. External drain requests have an age bound. These safeguards do not bound an unadmitted quiet request.

The issue describes two private Vite jobs held open while dependent browser checks or quiet benchmarks waited. A long-running server and its dependent check were represented as independent FIFO jobs. Class `light` still counts as a running job, so changing class does not remove the dependency cycle.

## Lifecycle choices

Finite work keeps ordinary FIFO admission. A private long-lived dev server declares `--server` and uses its existing `light` or `build` class. It retains the class estimate, memory ceiling, accounting and orphan cleanup, but stays outside the quiet drain and holds no shared slot locks while running. Quiet measurements still admit against its resource charge and record its identity in `serversAtAdmission`. Server requests use the same FIFO queue; a previously admitted server remains eligible to launch during a later quiet hold. The flag is local and excludes `--quiet` and `--host pi`.

For a self-contained private browser scenario, one finite browser job can also own server startup, readiness, browser work and teardown inside its slice. Queue that complete scenario once and run its children directly. Never queue a second heavy job a finite job needs to finish. Nested subprocesses use the established `nested-scope.sh` contract where a separate scope is necessary.

Normal development servers use the shared mesh route. Private server ports remain explicit and free. A browser scenario's cleanup must stop its own server on success, failure, timeout or cancellation, whether it runs inside the browser slice or as a declared server. It leaves the shared mesh dev route alone.

Bound a quiet request's total admission wait using the existing `developer.heavyJobQuietHoldSeconds` value. Start that monotonic deadline when the request joins the queue. Check expiry even while earlier jobs, resource pressure, an external drain, or legacy exclusive locks block admission. On expiry, remove only this request, close its locks, emit one actionable completion, and exit 75. Do not automatically retry inside the wrapper. A new invocation receives a new FIFO ticket. The running hold starts independently at accepted admission. Launch preparation consumes its allowance; launch receives the remaining budget and is refused after the absolute deadline.

Keep FIFO for finite jobs and preserve orphan charging, reaping, quiet leases, stop grace, and external lock diagnostics. Do not add worktree-based queue bypasses. They would require another dependency policy and could permit benchmarks to overlap work they expected to drain. Quiet evidence describes the heavy jobs drained and any persistent services still present; it cannot promise an otherwise idle OS.

## Execution checklist

- [x] Reproduce the dependency cycle with a gated stand-in server and dependent check in a private namespace. The red regression holds the browser behind the quiet request after finite work ends.
- [x] Declare separate long-lived servers with `--server` and document a browser scenario targeting the private Vite port, with explicit teardown. Preserve the self-contained finite-owner alternative.
- [x] Add a typed admission outcome for quiet wait expiry. Release waiting entries on expiry, exceptions and signals. Keep the job's actual exit code and running-hold expiry separate.
- [x] Extend status and usage output to distinguish quiet admission deadline from running hold expiry. Regenerate the settings reference for the shared bound's description.
- [x] Pass process tests for the server dependency cycle, resource denial, FIFO/external-lock obstructions, cancellation and independent running holds, followed by the full heavy suite and required commit gates.
- [x] Get independent Sol review and commit by path. Push and open the issue-closing PR during delivery.
- [ ] Owner installs the merged runner, restarts private servers with `--server`, cancels old queued quiet wrappers before invoking their requests again and confirms installed FIFO progress.

## Verification and acceptance

Extend `scripts/heavy/quiet.test.ts` and `lifecycle.test.ts` with isolated fixture clocks/settings. Verify expiry behind another job, expiry under pressure, queue cleanup on cancellation, and the existing running-hold lease. Existing tests for bounded external drains and suspended quiet wrappers must remain valid. Use temporary roots and existing portable skip rules for unavailable user systemd scopes.

The runtime proof admits a declared private server, queues a quiet measurement before its dependent browser check, then releases separate finite work. The measurement runs beside the accounted server; the browser check waits for the quiet hold to finish, then releases the server. Resource-denial proofs make quiet admission expire with exit 75, release its ticket and let an ordinary check behind it proceed. Verify the private units, entry locks and slot locks are cleaned up. Do not claim a throughput improvement without a comparable before/after run.

## Delivery

Run narrow tests and required gates through the heavy wrapper. Commit by path, push and open the reviewed PR. After merge, the owner installs `scripts/heavy/` from a clean worktree at that commit and restarts private servers with `--server`. Cancel old queued quiet wrappers before invoking their requests again through the updated runner, so the old FIFO tickets are released. Recheck installed status and one isolated deadline case. App UI changes need `verify-fregat` scenario and screenshot evidence and deployment through the mesh. Tick the root roadmap only after installed behavior and cleanup pass.
