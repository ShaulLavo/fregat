# Plan 284: resource-aware heavy jobs and a weak-machine lane

## Status and authorization

- Status: APPROVED 2026-10-01 by the owner in the scope-compat wave postmortem: admission should be "resource-based", a job that eats the machine is a job to fix, and pressure testing belongs on the Raspberry Pi.
- Evidence: `/work/reports/textmate-scope-wave/log.md` (2026-10-01 06:01–06:39): lanes waited 30+ minutes while another session held all three slots for back-to-back exclusive measurements. The machine has 28 cores and 31 GiB; at the time memory pressure (PSI) was 0 and CPU pressure averaged 55–66%.

## Outcome

Agents run heavy commands (suites, builds, browser tests, benchmarks) as fast as the machine can actually take them. Admission follows live CPU and memory pressure, not a fixed count of three. A job that hogs the machine shows up in a report and gets fixed. Quiet-machine measurements and low-resource stress runs have their own lanes, so neither starves everyone else.

## Current implementation and remaining acceptance

The original design below is a historical baseline. The tracked runner, FIFO pressure/memory
admission, class ceilings, bounded quiet holds, accounting/report tools and Pi adapter now live
in `scripts/heavy/`. [AGENTS.md](../AGENTS.md#dev-gates-verification) names the installed entry point.
[312](312-heavy-slice-ownership.md), [313](313-heavy-quiet-lifecycle.md) and
[314](314-heavy-non-cache-memory.md) own the namespace, quiet-lifecycle and measurement follow-ups.
Do not rebuild those shipped mechanisms from the old scratch-wrapper description.

The original phase checkboxes below remain acceptance-reconciliation items. Mechanism availability
alone does not prove the normal-day report, comparative 12-job burst, two-session fairness or
labeled Pi scenario receipts. Read existing evidence and run only missing bounded checks.
P4's measured consumer fixes remain ongoing work. Record phase receipts before closing this plan.

## Original baseline, October 1

`/work/tmp/wave-heavy/run.sh` is an untracked bash script from the 2026-09-25 completion wave (after `oomd` killed mesh.service). It holds one of three `flock` slots and runs the command under `systemd-run --user --scope` with `MemoryHigh=6G MemoryMax=7G`. Another session's benchmark tool takes all three locks at once ("exclusive") with no time limit or queue. The script lives in `/work/tmp`, which is scratch, so nothing about it is reviewed or documented where agents look.

## Design

1. **Move it into the repo.** `scripts/heavy/` in Platform owns the wrapper, and AGENTS.md names it once. `/work/tmp/wave-heavy/run.sh` becomes a one-line exec of the tracked script, so existing briefs keep working, then it is deleted after one wave.
2. **Admit by pressure, not count.** A job starts when the kernel's pressure-stall info (`/proc/pressure/memory`, `/proc/pressure/cpu`) and available memory are below thresholds. Each job declares a rough class (`suite`, `browser`, `build`, `bench`), which carries a default memory estimate; the wrapper admits only when available memory exceeds running estimates plus the new one. No fixed slot count. Thresholds and estimates are settings, not literals.
3. **Keep the per-job cgroup cap.** Every job still runs under `systemd-run` with a memory ceiling sized by its class, so one runaway job is killed alone. This is what prevented the 09-25 OOM, and it stays.
4. **Exclusive holds are bounded and queued.** A `--quiet` (exclusive) request waits for running jobs to drain while new non-quiet jobs queue behind it. It gets a maximum hold time (setting, default 10 minutes) and must re-queue for the next measurement, so other sessions run between measurements. The holder file records who holds it and since when.
5. **Hogs get a report, not more headroom.** The wrapper records each job's peak memory, CPU time and wall time (from its cgroup) to a JSONL log beside Platform's logs. `scripts/heavy/report.ts` lists the top consumers by command. A command that repeatedly exceeds its class gets an owner and a fix (a leaking test, an unbounded worker pool, a missing `VITEST_MAX_WORKERS`), not a bigger cap.
6. **Pressure tests go to the Raspberry Pi.** The Pi runs 24/7 and is idle. It joins the mesh as a host, reached the way the Mac reaches it today, and gets a `--host pi` lane in the wrapper for runs whose point is low CPU or low memory: large-file typing under load, slow-start paths, worker back-pressure. Measurements that need a quiet fast machine stay local under `--quiet`.

## Original phases and acceptance receipts to reconcile

- [ ] **P1 — track and observe.** Move the wrapper into `scripts/heavy/`, keep today's behaviour, add per-job cgroup accounting and the JSONL log plus `report.ts`. Run one normal day of agent work and publish the top consumers in `/work/reports/heavy-jobs/`.
- [ ] **P2 — pressure admission.** Replace the three slots with pressure and memory admission by job class, with settings for thresholds. Gate: a burst of 12 concurrent browser and suite jobs completes with no OOM kill and no job killed by its class cap that did not also exceed it alone; compare total wall time against the three-slot wrapper on the same burst.
- [ ] **P3 — bounded quiet holds.** `--quiet` with a maximum hold and a queue. Gate: two sessions, one looping quiet measurements and one running suites, both make progress; the suite session never waits longer than one hold.
- [ ] **P4 — fix the hogs** the P1 report names, each as its own unit with before/after numbers.
- [ ] **P5 — Pi lane.** Add the Pi to the mesh (through the Mac's existing connection to it), install the minimal runtime, and add `--host pi`. Gate: one low-resource scenario (large-file typing) runs there from this machine and reports back, and its numbers are labelled with the host.

## Boundaries

- No change to how CI runs on GitHub. This is local machine scheduling only.
- Coordinate P2 and P3 with whichever session runs the quiet measurements (the foundations wave as of 2026-10-01); do not land a change to exclusive holds while that wave is mid-measurement.
- The per-job memory ceiling stays; admission gets smarter, the safety net does not go away.

## October 2026 issue follow-ups

Status: Approved, retained by [Plan 336 closeout](issue-closeout-2026-10.md).
These are remaining execution items. Closing their tracker records does not certify a fix
or change acceptance of an earlier delivered milestone. Each original thread retains its
full reproduction, comments and historical artifacts. Source links below pin the reviewed
main revision; recheck them before implementation.

### Issue 565

Status: Idea. The affinity experiment keeps the source proposal's status.

Source: [#565: heavy: run CPU-only jobs on E-cores during quiet holds (affinity pinning), pending a measured A/B](https://github.com/ShaulLavo/fregat/issues/565), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/565).
Current owner: [scripts/heavy/job.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/scripts/heavy/job.ts).

The original affinity proposal remains Idea. AllowedCPUs on user scopes was not enforced without cpuset delegation; taskset is an experiment candidate. No valid measured idle-versus-E-core-load A/B exists. Prior preflight failures and a stock workload longer than the 600-second quiet hold are not comparative evidence. First choose a bounded CPU-only workload, verify actual process affinity and cleanup, and compare quiet instrumentation validity plus finite-job progress. Do not change admission policy or claim throughput until that control passes.

- [ ] Run the bounded experiment before approving an affinity policy.

### Issue 575

Source: [#575: Unconfirmed allocation source: cold Vite optimizer exceeds private light-server memory ceiling](https://github.com/ShaulLavo/fregat/issues/575), [latest reviewed evidence](https://github.com/ShaulLavo/fregat/issues/575).
Current owner: [apps/web/vite.config.ts](https://github.com/ShaulLavo/fregat/blob/a713deece883494bc3ec022f2b3ebb2bf192fcd9/apps/web/vite.config.ts).

Cold lockfile-triggered Vite reoptimization exceeded the private light-server 2 GiB ceiling and was OOM-killed with exit 137. The allocation source remains unconfirmed. Running the preview in build class is a workaround, not a measured memory fix or proof of a wrapper defect. Capture cold/warm optimizer inputs, plugin phases and peak memory under the original ceiling. Attribute the largest retained allocation, fix it and compare the same workload before changing class estimates.

- [ ] Complete the bounded reproduction or measurement above, fix only a proven cause, and retain qualified acceptance evidence.
