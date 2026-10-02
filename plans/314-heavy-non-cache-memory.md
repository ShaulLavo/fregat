# Plan 314: measure memory comparable to admission estimates

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #337](https://github.com/ShaulLavo/fregat/issues/337). Fregat `scripts/heavy/` owns implementation. This follows [Plan 284](284-resource-aware-heavy-jobs.md) and preserves the shipped #271, #301, and #307 behavior. [Plan 312](312-heavy-slice-ownership.md) owns namespace safety.

## Outcome

Heavy-job records distinguish raw cgroup peak from sampled non-cache peak. Class-estimate decisions use measured, comparable non-cache samples. MemoryMax, OOM accounting, and whole-cgroup diagnostics retain their current meaning.

## Current evidence

At Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`, [admission.ts](../scripts/heavy/admission.ts)'s `chargeOf` subtracts active file LRU, inactive file LRU, and reclaimable slab from `memory.current`. Admission reserves the estimate minus this already-used memory. [scope.sh](../scripts/heavy/scope.sh) reads final `memory.peak`; [job.ts](../scripts/heavy/job.ts), [record.ts](../scripts/heavy/record.ts), and [report.ts](../scripts/heavy/report.ts) pass that raw peak through as `memoryPeakBytes`.

Class budgets live in `developer.heavyJobClasses` in [the settings registry](../packages/contracts/src/settings/keys.ts). The inspected runner reads those configured estimates; it has no automatic p90 training loop. The report currently groups raw peaks with maxima and medians. The issue's p90 estimate method is an execution requirement to make explicit, not evidence of existing automation. No OOM or measured throughput regression is claimed by this issue.

## Measurement contract

Extract one shared non-cache usage calculation from `chargeOf`. Use `memory.current - active_file - inactive_file - slab_reclaimable`, clamped at zero, after validating readable finite counters. Do not separately add anonymous memory or shmem. The current total already includes them, and shmem must not be subtracted as reclaimable file LRU.

The local job owner samples the whole job slice, including nested scopes, while the slice exists. Reuse the runner's existing polling cadence. Capture an initial sample when available and a final sample before cleanup. Keep the maximum observed value. A sampled peak is a lower bound on the true non-cache peak and can miss short spikes.

Add a distinct `nonCachePeakBytes` measurement with coverage metadata for sample count, observed interval, cadence, and unavailable or interrupted observation. Raw `memoryPeakBytes` stays raw. Unknown counters, disappearing cgroups, an OOM-killed scope, or a suspended sampler do not become a zero or an exact peak. Pi results remain unavailable for this quantity until the remote accounting owner implements the same definition; do not relabel its existing metrics.

The estimate report computes p90 by class from measured non-cache samples whose OOM result is known and zero. Report comparable sample counts and coverage limits beside the result. Exclude unknown and interrupted coverage from estimate recommendations by default. Preserve the configured class estimate when only legacy raw records or insufficient comparable samples exist. Updating an estimate remains a reviewed settings-default change. Do not add autonomous tuning or a second ceiling.

## Execution checklist

- [ ] Capture bounded baseline records for one cache-heavy and one anonymous-heavy owned job. Record raw peak, current admission charge, configured estimate, queue time, and sampling overhead.
- [ ] Extract and test the shared non-cache calculation. Verify shmem and reclaimable slab accounting with realistic stat fixtures and missing-counter cases.
- [ ] Add the sampler to local job lifetime and record its coverage separately from final cgroup accounting. Keep exit status and cleanup independent of measurement failures.
- [ ] Extend record validation and report output with explicit raw and sampled quantities. Keep legacy rows visible as unknown for the new measurement without rewriting old logs.
- [ ] Add p90 estimate recommendations using comparable non-OOM samples. Show cold-start and excluded-sample reasons. Update class defaults only when the bounded baseline supports the change.
- [ ] Repeat the same jobs and admission workload. Publish raw peak, sampled peak, queue-time comparison, overhead, and OOM result. Make any performance claim from those numbers.

## Verification and acceptance

Run focused cases in `scripts/heavy/admission.test.ts`, `record.test.ts`, `report.test.ts`, and the cgroup accounting cases in `run.test.ts`. Add lifecycle coverage for nested scopes, disappearing cgroups, unsupported counters, and interrupted sampling. Use temporary state, settings, logs, and owned slice roots. Systemd-dependent cases skip with a stated reason when unavailable.

Acceptance requires raw peak to remain separately reported, a cache-heavy job to yield a comparable sampled non-cache record, and an anonymous-heavy job to preserve its meaningful estimate. All comparisons use the same command and resource limits. The MemoryMax ceiling and OOM response must remain unchanged. A lower recommended estimate alone is not throughput evidence.

## Delivery

Use `typescript-best-practices` and structured script errors. Run the narrow checks and required gates through the installed wrapper. Commit by path and push. Install the runner from a clean worktree at that commit, verify the installed commit, and collect one bounded installed-runner receipt. Regenerate settings reference for any registry copy or default change. Record measurements and completion in this plan and root roadmap.
