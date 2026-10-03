# Plan 293: Persist recurring jobs and truthful run records

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/mesh`.
- Reported in: [Mesh #106](https://github.com/ShaulLavo/mesh/issues/106).
- Order: Job data and local execution first. [Plan 294](294-mesh-job-coordination.md) adds replication and failover. [Plan 295](295-cross-repository-issue-collection.md) supplies the first workload.

## Outcome and current state

An explicitly registered command schedule survives Mesh restarts. The owner can inspect its definition, next due time, pause/cancel state, and run history. Each run names its executor and actual outcome. A host reboot records interruption rather than implying a process moved to another machine.

At committed Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, the overview lists scheduling as later work. There is no user-facing job subsystem. [`internal/storage/store.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/storage/store.go) owns the daemon's local SQLite metadata. [`internal/worker/launch.go`](https://github.com/ShaulLavo/mesh/blob/cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed/internal/worker/launch.go) launches detached workers and distinguishes a failed launch that may already have started. `internal/worker/meta.go` persists authoritative process state and boot identity.

This plan adds a narrow Mesh job subsystem rather than a model-agent framework. [Plan 144](144-unattended-agent-work.md) continues to own harness-native unattended agent work in Fregat.

## Durable data and local execution

Define these types before wiring CLI or timers:

| Type                 | Required ownership and fields                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JobDefinition`      | Stable job ID, owner identity, revision, command argv, executor requirements, schedule/timezone, lifecycle state, timeout, overlap policy, retry policy, and missed-fire policy. |
| `RunKey`             | Job ID, definition revision, and the enumerator's canonical scheduled UTC occurrence. Manual runs use a separate explicit request ID.                                            |
| `JobRun`             | Run key, attempt, executor identity, authorization record, reserved worker ID, phase, timestamps, exit status, and uncertainty reason.                                           |
| `ExecutorReadiness`  | Registered workload identity/version, local command/runtime/workspace availability, secret references, and permission to execute that workload as this daemon account.           |
| `WorkloadCheckpoint` | Workload and scope identity, schema version, committed revision, bounded state shards and their digests. It records restart/failover state independently of a worker's process.  |

Store job definitions and run records in a separate durable job database under Mesh's configured state directory. Keep session metadata host-authoritative. Require synchronous durable transactions for job acknowledgements. The existing session database's `synchronous=NORMAL` setting does not prove a scheduler commit survived power loss.

Command argv and non-secret input form the replicated definition. Credential references, local executable paths, and workspace mappings resolve on each executor. Never replicate token values, arbitrary environment secrets, or repository contents. A peer can store a job without qualifying to run it. An online phone lacking a daemon/runtime cannot serve as an executor or durable voter.

The issue collector needs its review acknowledgement and report outbox to survive an executor loss. Define a narrow authenticated read/compare-and-commit checkpoint operation, with workload ownership, expected revision, schema and size limits, and atomic manifest publication. Manual local checkpoints use this same logical contract. Group-enrolled checkpoints become authoritative through Plan 294's replicated group; they cannot silently revert to a local copy.

Launch scheduled work through a reserved worker identity. Persist the launch intent before spawning. On recovery, reconcile the exact worker ID and boot identity before deciding whether an attempt started. Repeated requests with the same run key and attempt reuse that identity. A launch error that may have started becomes uncertain, rather than an automatic second launch.

## Chosen scheduling defaults

- Support five-field minute-resolution cron with an explicit IANA timezone. Default to UTC. Validate the expression and zone at registration. Pin and justify a cron parser dependency if existing dependencies cannot supply these semantics.
- Skip nonexistent local times at a DST transition. During a repeated local time, execute its first occurrence once. Display the next occurrence in both local time and UTC.
- Coalesce missed occurrences into one catch-up run for the latest due slot. Record the missed count. Do not replay an unbounded backlog after every executor returns.
- Forbid overlap by default. A running or uncertain earlier attempt blocks later dispatch until it settles or the owner resolves it. Explicit safe-overlap workloads may opt in.
- Require an execution timeout in the job definition. The executor's worker/run owner enforces it even if the scheduling daemon restarts. A timeout reports failure and applies normal process-group termination.
- Use one attempt by default. Retrying a definitely failed or interrupted attempt requires an explicit idempotent-workload policy with a finite attempt limit and finite backoff schedule. Uncertain effects require reconciliation before retry.
- `pause` prevents new run authorization and retains history. `resume` advances from the committed schedule revision and applies the missed-fire policy. `cancel` is terminal for that job ID. Keep its tombstone so stale state cannot recreate it.
- Schedule cancellation preserves an already running command by default. An explicit cancel-active action durably requests process termination. Offline executors show cancellation pending until they acknowledge it.
- Retain all unresolved runs. Keep the latest 100 terminal run records per job, with durable summary counts for older results. Preserve lifecycle and deduplication metadata independently of history retention.

These are Approved product decisions awaiting implementation. Replication and partition rules belong to Plan 294.

## Execution checklist

- [ ] Recheck current main for scheduling work and record the selected baseline. Update the overview to mark this specific capability Approved while keeping general agent orchestration separate.
- [ ] Define the job/run state machine and deterministic schedule enumerator. Review timezone, revision changes, manual request IDs, and run retention before wiring storage.
- [ ] Implement durable definition and run storage under caller-supplied state paths. Make registration, pause, resume, cancel, and run transitions idempotent by request ID and revision.
- [ ] Add bounded workload checkpoint reads and compare-and-commit writes. Keep complete checkpoint manifests separate from staged shards, preserve revisions across restart, and reject credentials or arbitrary filesystem replication at this boundary.
- [ ] Add workload readiness registration and secret-reference resolution. Report why a host cannot execute without leaking local credentials or private file contents.
- [ ] Implement local scheduling and reserved worker launch/reconciliation. Define the commit-before-spawn crash window explicitly. Preserve workers across daemon replacement.
- [ ] Add timeout ownership, bounded retry, overlap enforcement, missed-fire coalescing, and truthful uncertain/interrupted results.
- [ ] Add `mesh job` registration, list/inspect, history, run-now, pause/resume, and cancel controls with structured JSON results. Treat remote mutation as unavailable until Plan 290 authorizes it.
- [ ] Add run-history retention without deleting unresolved state or cancel tombstones. Document local-only operation separately from replicated operation.

## Verification and delivery

Use portable temporary state directories, generated identities, and disposable commands. Verify duplicate registration and run-now requests, crash before and after the launch intent, a command exiting before readiness, daemon restart with a live worker, host reboot interruption, timeout ownership, and retained cancellation after restart.

Test UTC and named zones across DST gaps/folds, clock jumps, edited schedule revisions, coalesced missed runs, overlap blocking, finite retries, malformed cron/timezone, absent workload credentials, and terminal-history pruning. Start with deterministic unit/storage tests, then real worker integration checks. No test can infer an external side effect succeeded merely from the absence of a process.

Apply Foundational Thinking by landing job/run types before timer logic. Apply Make Operations Idempotent to each transition and crash boundary. Use `how` for worker recovery, `unslop` for CLI copy, and a decision log for persistence choices. Run Mesh's required lifecycle gates through the heavy runner. Commit, push, release with a patch version, and verify local scheduled work on an installed host. #106 remains owned by all three linked plans after issue closure.
