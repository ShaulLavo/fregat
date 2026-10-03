# Plan 313: keep quiet jobs and dev servers making progress

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #371](https://github.com/ShaulLavo/fregat/issues/371), including the second-occurrence comment. Fregat `scripts/heavy/` owns admission. This extends [Plan 284](284-resource-aware-heavy-jobs.md). Apply [Plan 312](312-heavy-slice-ownership.md)'s namespace safety to every process proof.

## Outcome

A private server needed by a browser check cannot leave the browser check queued behind a quiet job that waits for that server to exit. A quiet request has a bounded admission wait and a separate bounded running hold. Expiry releases its queue position and reports exit 75 so other jobs can proceed.

## Current evidence

At Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`, [run.ts](../scripts/heavy/run.ts)'s `admit` loops indefinitely. `attemptAdmission` considers only the FIFO head. [admission.ts](../scripts/heavy/admission.ts)'s `decideQuiet` waits for every running owner and orphan charge. The running quiet job already has both a wrapper timer and a systemd runtime limit. Its lease includes stop grace, and expiry returns 75. External drain requests have an age bound. These safeguards do not bound an unadmitted quiet request.

The issue describes two private Vite jobs held open while dependent browser checks or quiet benchmarks waited. A long-running server and its dependent check were represented as independent FIFO jobs. Class `light` still counts as a running job, so changing class does not remove the dependency cycle.

## Lifecycle choices

Keep heavy jobs finite. For a private browser scenario, one browser job owns server startup, readiness, browser work, and teardown. Its server runs inside that job's slice and shares its ceiling and accounting. Queue the complete scenario once. Never queue a second heavy job that the first job needs to finish. Nested subprocesses use the established `nested-scope.sh` contract where a separate scope is necessary.

Persistent development servers use the existing mesh route or a separately owned service lifecycle. They do not hold an indefinite heavy-job queue lease. Private server ports remain explicit and free. A browser scenario's cleanup must stop its own server on success, failure, timeout, or cancellation. It cannot stop the shared mesh dev route.

Bound a quiet request's total admission wait using the existing `developer.heavyJobQuietHoldSeconds` value. Start that monotonic deadline when the request joins the queue. Check expiry even while earlier jobs, resource pressure, an external drain, or legacy exclusive locks block admission. On expiry, remove only this request, close its locks, emit one actionable completion, and exit 75. Do not automatically retry inside the wrapper. A new invocation receives a new FIFO ticket. The running hold remains independently measured from launch.

Keep FIFO for finite jobs and preserve orphan charging, reaping, quiet leases, stop grace, and external lock diagnostics. Do not add worktree-based queue bypasses. They would require another dependency policy and could permit benchmarks to overlap work they expected to drain. Quiet evidence describes the heavy jobs drained and any persistent services still present; it cannot promise an otherwise idle OS.

## Execution checklist

- [ ] Reproduce the dependency cycle with a bounded stand-in server and dependent check in a private namespace. Capture queue order and the distinction between admission and hold clocks.
- [ ] Inventory private server callers, starting with browser verification launch code and the documented Vite workflows. Convert the affected workflow into one finite owner job with readiness and teardown.
- [ ] Add a typed admission outcome for quiet wait expiry. Release waiting entries on expiry, exceptions, and signals. Keep the job's actual exit code and running-hold expiry separate.
- [ ] Extend status and usage output to distinguish quiet admission deadline from running hold expiry. Regenerate settings reference if the existing setting description changes.
- [ ] Add process tests for a held-open server, a quiet request, and an ordinary follow-up. Prove the ordinary job starts after quiet admission expires without an operator stopping the server.
- [ ] Exercise the converted browser workflow, then a finite quiet measurement. Confirm teardown and FIFO progress. Update the heavy instructions with the single-owner server workflow.

## Verification and acceptance

Extend `scripts/heavy/quiet.test.ts` and `lifecycle.test.ts` with isolated fixture clocks/settings. Verify expiry behind another job, expiry under pressure, queue cleanup on cancellation, and the existing running-hold lease. Existing tests for bounded external drains and suspended quiet wrappers must remain valid. Use temporary roots and existing portable skip rules for unavailable user systemd scopes.

The runtime proof starts a private server and browser check inside one admitted job. The job exits and stops the server. A competing quiet request either starts after that finite job drains or exits 75 within its configured admission bound. An ordinary job queued behind an expired quiet request then completes. Publish the queue timeline and owned unit cleanup. Do not claim a throughput improvement without a comparable before/after run.

## Delivery

Run narrow tests and required gates through the heavy wrapper. Commit by path, push, and install `scripts/heavy/` from a clean worktree at that commit. Recheck installed status and one isolated deadline case. Browser workflow changes need `verify-fregat` scenario and screenshot evidence. Deploy application changes through the mesh if any are needed. Tick the root roadmap only after installed behavior and cleanup pass.
