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

Bound a quiet request's total admission wait using the existing `developer.heavyJobQuietHoldSeconds` value. Start that monotonic deadline when the request joins the queue. Check expiry even while earlier jobs, resource pressure, an external drain, or legacy exclusive locks block admission. On expiry, remove only this request, close its locks, emit one actionable completion, and exit 75. Do not automatically retry inside the wrapper. A new invocation receives a new FIFO ticket. The running hold remains independently measured from launch.

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

## October 2026 issue follow-ups

Status: Approved, retained by [Plan 336 closeout](issue-closeout-2026-10.md).
These are remaining execution items. Closing their tracker records does not certify a fix
or change acceptance of an earlier delivered milestone. Each original thread retains its
full reproduction, comments and historical artifacts. Source links below pin the reviewed
main revision; recheck them before implementation.

### Issue 405

Source: [#405: heavy jobs: back-to-back quiet holds starve light jobs (commit hooks time out unrun)](https://github.com/ShaulLavo/fregat/issues/405), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/405#issuecomment-5994859902).
Current owner: [scripts/heavy/run.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/heavy/run.ts).

Back-to-back quiet holds historically starved light jobs and commit hooks. PR #547 shipped configured light-job admission during wrapper quiet holds with overlap records; current admission.ts retains that behavior. PR #456 closed unmerged. The remaining evidence below concerns external exclusion and caller lifecycle, not absence of that shipped light-job policy. Completion must never wait on admission.lock. Admission-only observations cannot distinguish jobs queued before versus after quiet completion when the observer was paused; define an authoritative cutoff or an explicit cohort policy. A later admission-lock holder lasted 923 seconds. The bounded caller waited for input.paired.complete while its redirected nested driver emitted validation.complete, so its intended cleanup deadline never began. Audit that caller protocol separately from resource admission. Reproduce two-session finite-job progress and lock release without reducing memory caps or silently changing FIFO.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 627

Source: [#627: Unconfirmed flake: heavy deadline test exits 2 instead of 125 when watchdog launch returns 0](https://github.com/ShaulLavo/fregat/issues/627), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/627#issuecomment-5982952606).
Current owner: [scripts/heavy/deadline.test.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/heavy/deadline.test.ts).

The watchdog refusal control expected exit 125 but got 2 once. Five focused invocations passed both launch-return 0 and 1 controls. PR #692 attached stderr; later PR #897 also preserves watchdog query status/stderr. No runtime cause fix is established. Capture watchdog launch, wrapper/child exit, systemd result and cleanup in the original failure before changing the refusal contract or its deadline.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

### Issue 685

Source: [#685: Unconfirmed CI: expired quiet launcher successor never prints started within poll budget](https://github.com/ShaulLavo/fregat/issues/685), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/685#issuecomment-6046248800).
Current owner: [scripts/heavy/quiet.test.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/heavy/quiet.test.ts).

Distinct retained failures include a successor that missed its 5-second started poll, systemctl stop exit 5, launcher exit 1 transport failure, slice-property transport failure and an empty final watchdog query. PRs #707, #806 and #897 retain more diagnostics, without identifying one cause or changing original expectations. Capture manager transport status/stderr, launcher/child lifecycle and successor admission independently. Keep watchdog failure facts and deadlines; passing controls do not turn these different failures into one fixed lifecycle bug.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.

## Stale-claim follow-up, 2026-10-08

Status: Approved. [Plan 336's second-pass close-out](issue-closeout-2026-10.md#second-pass-stale-claims) releases the inactive #711 claim. Plan 312's private-namespace and peer-process safety rules remain binding.

### Issue 711

Source: [#711](https://github.com/ShaulLavo/fregat/issues/711). Current owners are `scripts/heavy/quiet-concurrency.test.ts`, `quiet-receipts.ts`, and the primary/shim/watchdog/owned-slice lifecycle.

Repeated Ubuntu cancellation failures expected exit 143 and received 137. The latest claimed packet is main `87ac27a147dd99e0fe13b575d3211dc4bce4b5ae` in [job 112065184051](https://github.com/ShaulLavo/fregat/actions/runs/37400110592/job/112065184051). It records SIGTERM sent=true at 2026-10-06 01:42:51.049 UTC, then exit 137 while an independent late server remains alive. The systemd 255.4-1ubuntu8.17 journal records owned-slice TERM and roughly one second later KILL/cleanup. This is observed ordering, not a proven explanation of the 137 outcome. Earlier diagnostic TERM/expiry controls passed. Private forced SIGKILL calibrated a genuine 137 receipt but does not prove the natural CI cause.

The abandoned `docwave/quiet711-main87` source head `1d05e45826b8f551ccbc26ec22991f33ff994f31`, published head `8d9cb144eabc63af136ba866f59960b653478877`, preserved a bounded failure-before-cleanup observer. PR #847 closed unmerged, but [PR #854](https://github.com/ShaulLavo/fregat/pull/854), squash `1fb0898d3f5921785716449d6d848920dfe6c306`, shipped the same three quiet test/helper files byte-for-byte. Main retains primary status, shim phase, direct signal attempts, watchdog identities and separate cleanup snapshots. The corrected IO accounting charges refused reads to the shared 64 KiB budget. The source packet reports seven observer controls and five malformed/oversized IO regressions passing. These are observer qualification, not a runner fix.

Earlier abandoned `docwave/quiet-cancel`, head `9b8fa64fae5f6e33aeb985e351c4254a1f2f7e8d`, and `fix/night-quiet-cancel-711`, head `d611711d1c571b8a85f909c059a493ee615294df`, shipped in PRs #714 and #775. Preserve their historical failures and calibration limits. All original 143, timing, overlap, slice and cleanup assertions and production runner behavior remain.

- [ ] Inspect the next bounded natural cancellation failure's immutable pre-cleanup observer packet and later cleanup separately. Compare actual primary/shim/watchdog identities, TERM return, manager record and escalation timestamps in the original private namespace. Calibrate on a known-good cancellation without touching peer leases, the installed manager or owner settings.
- [ ] Reproduce a causal lifecycle defect before changing production. Preserve exit 143, grace/hold/memory/retention budgets, independent server overlap and complete owned cleanup. Do not translate exit 137, increase grace, restart the global manager or retry the failed CI unchanged.
