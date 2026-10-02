# Plan 312: bind heavy slice roots to one state directory

## Status and ownership

Status: APPROVED, 2026-10-03. Reported in [Fregat #338](https://github.com/ShaulLavo/fregat/issues/338). Implementation belongs in Fregat `scripts/heavy/`. This is the explicit-root follow-up to [Plan 284](284-resource-aware-heavy-jobs.md), #252, and #301.

## Outcome

Two different state directories cannot claim the same slice namespace or reap each other's jobs. A symlink alias of the owning directory works. A conflicting wrapper exits 2 before admission, cgroup discovery, accounting, or signals.

## Current evidence

At Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`, [run.ts](../scripts/heavy/run.ts) validates `sliceRootOption` and guards the production root against another state directory. An arbitrary valid custom root has no general ownership claim. `attemptAdmission` calls `reconcile` before deciding whether the job may start, so rejecting a collision after enqueueing is too late.

[lock.ts](../scripts/heavy/lock.ts) derives default roots from the state directory's device and inode. [queue.ts](../scripts/heavy/queue.ts) reads owners from one state directory. [admission.ts](../scripts/heavy/admission.ts) finds unnamed live slices under a root. Per-entry root attribution already exists and must remain intact. The issue records a known collision without a new live reproduction or repetition count.

## Ownership contract

Use a persistent namespace claim keyed by OS user and slice-root name. Its value contains the canonical state directory identity, `dev:ino`, and a path for diagnostics. Path spelling does not decide ownership. Keep this registry outside the claimant's state directory so two different directories encounter the same claim. The production state directory owns the small shared claim registry; existing production stand-in options must redirect it in tests.

Serialize claim creation through a shared registry lock and publish the claim atomically. Each wrapper also holds a shared namespace lease until its owned work has drained. Pass that lease into its scope alongside the existing owner locks so surviving job processes retain it. Hold an open directory descriptor while validating state identity. Recheck identity before admission so directory replacement cannot authorize a different directory. The production-root check remains an earlier, independent guard.

Before a first claim, require every live slice under that root to have a valid live owner in the claimant's state directory. An unknown slice blocks claiming before any reaper action. Verify this rule during installed-runner cutover without stopping another session's jobs. Claims survive job completion and wrapper restarts. A recreated directory at the same path has a new identity and fails closed. Missing owner directories, malformed claims, and changed identities require an explicit release operation. That operation acquires the namespace lease exclusively and proves that the root has no live cgroups before removing the claim under the registry lock. A held lease, live cgroup, or unreadable cgroup state blocks release. This also defines recovery after the old state directory disappears. Never infer a stale claim solely from a missing path or PID. Ordinary admission never steals a claim.

Keep the existing per-entry `sliceRoot` for charging and cleanup. Binding a namespace does not merge independent queues. Do not add an alternative claimant override or relax production protection.

## Execution checklist

- [ ] Add a fail-first process test with two private state directories and one private production stand-in registry. Assert exit 2 for the second claimant and no admission/reaper calls.
- [ ] Add the namespace claim owner beside the existing directory identity and locking helpers. Validate and claim before enqueueing or entering `run`'s admission path.
- [ ] Define atomic first-claim, same-identity alias, replaced-directory, invalid-record, and explicit-release behavior. Add a simultaneous-first-claim test.
- [ ] Wire the claim through local launch, status, and any cleanup entry point that can scan or signal a slice namespace. Read-only inspection may report a conflict, but cannot change the claim.
- [ ] Keep #252's production stand-in tests and #301's cross-root accounting tests green. Update `scripts/heavy/sandbox.ts` so test registries, state, and roots are private.
- [ ] Document the ownership error and safe release operation in runner usage and the heavy-job instructions.

## Verification and acceptance

Run the focused ownership cases in `scripts/heavy/lock.test.ts` and `lifecycle.test.ts`, followed by the relevant production-guard and cross-root cases. Process tests use temporary directories and randomly named owned cgroups. They skip with a reason where user systemd scopes are unavailable. No test, failing reproduction, or cleanup targets `heavy.slice`, production state, or another session's units.

For runtime proof, hold one bounded command in a private root, start the conflicting wrapper, and verify the first command remains alive. Reuse the first directory through a symlink and verify a second permitted job completes. Capture exit codes, ownership errors, and the private unit names. Clean up only the created units and scratch directories.

## Delivery

Use `typescript-best-practices`, `never-nester`, and boundary validation for the CLI changes. Run the narrow checks and required gates through the installed heavy wrapper. Commit only owned paths, push, and install the runner from a clean worktree at the pushed commit with `bun scripts/heavy/install.ts`. Verify the installed wrapper reports that commit and repeat the isolated collision proof. Record delivery evidence in this plan and the root roadmap.
