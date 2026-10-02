# Plan 294: Replicate jobs and fail over safe scheduled runs

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/mesh`.
- Reported in: [Mesh #106](https://github.com/ShaulLavo/mesh/issues/106).
- Prerequisites: [Plan 290](290-mesh-device-authorization.md) for authenticated control and [Plan 293](293-mesh-durable-job-state.md) for the job/run contract.
- First consumer: [Plan 295](295-cross-repository-issue-collection.md).

## Outcome and availability boundary

An acknowledged job registration survives loss of its registering device. Eligible surviving devices can run future occurrences and retain pause/cancel decisions. No permanent coordinator host or Pi proxy owns the scheduler. Each terminal worker remains authoritative on its own host.

Choose majority coordination for automatic dispatch. The default failover group has three explicitly enrolled voting Mesh daemons, and two form a quorum. Voters store replicated job state; executor eligibility is separate. One remaining voter retains the last committed job definitions and history, but cannot safely authorize new runs or claim a newly requested cancellation committed. Two-device groups cannot survive either voter loss while retaining this majority rule.

This is the concrete tradeoff behind the owner's durable-job idea. A surviving replica keeps the job recorded. Automatic dispatch during partitions needs quorum to prevent conflicting decisions. If all copies are lost, Mesh has no durable record to recover. Ordinary backups remain necessary. Do not advertise that any online device can run any workload.

## Coordination design

Use `go.etcd.io/raft/v3` for one small, owner-configured job group. Its upstream [license is Apache-2.0](https://raw.githubusercontent.com/etcd-io/raft/main/LICENSE), checked on 2026-10-03. Its [current module file](https://raw.githubusercontent.com/etcd-io/raft/main/go.mod) declares Go 1.26, below Mesh's Go 1.27 baseline. The first execution step still probes the selected pinned release. Its dependency justification is established leader election, replicated decisions, and safe membership changes across daemon failures. Retain required license/notice files. Do not implement elections, majority commit, or log conflict resolution from scratch.

Keep the consensus dependency behind a scheduler-owned interface. Mesh supplies authenticated peer transport and durable log/snapshot storage, rather than embedding an etcd server. Follow the library's documented `Ready` persistence ordering before sending messages or acknowledging applied state. Reuse the authenticated direct peer channel from Plan 290.

Raft persistence and snapshots live under the configured state directory with synchronous write guarantees. Its finite-state machine owns definition revisions, pause/cancel tombstones, due-run keys, executor assignments, transition acknowledgements, and bounded workload checkpoint manifests/shards from Plan 293. Publish a checkpoint manifest only after every referenced shard is durably committed. Compare-and-commit checks the expected revision. SQLite may materialize local queries, but a local cache must never overwrite committed decisions. A group-enrolled job or checkpoint cannot fall back to local-only state when quorum disappears. Treat the cluster as trusted and subject to crashes/partitions. Approved devices already hold powerful account access; this is not Byzantine consensus.

Admit voters by exact approved device keys and explicit group enrollment. Join a new member through a committed membership change and a current snapshot. Removed or stale peers cannot submit old local definitions as newer state. Never automatically shrink quorum because a host disappeared. Recovery from permanent quorum loss requires an explicit owner recovery operation that forms a new group from a selected committed snapshot and isolates the old group.

## Dispatch, fencing, and cancellation

Commit a unique `RunKey` before assignment. Include definition revision, group identity, committed assignment sequence, executor identity, and attempt in the launch permit. The executor durably deduplicates that permit and checks current quorum-authorized admission immediately before reserving a launch. A returning old leader cannot create new committed permits.

An assignment that may have reached a worker remains unresolved. Default behavior does not reassign that same occurrence until the exact worker/run record proves it never started or has a terminal outcome. This favors truthful execution over an accidental second shell command. An opted-in idempotent workload can retry with the same application idempotency key after reconciliation. A fencing number helps only when the destination effect checks it. Arbitrary shell commands and external APIs do not become exactly-once because Mesh stores permits.

Pause/cancel is effective after quorum commit. Reject new authorizations against that lifecycle revision. An offline peer first catches up with the current state before scheduling. A command whose launch authorization already committed may still run or finish after pause. Cancel-active persists a termination request, but an unreachable executor cannot acknowledge termination until it returns. Display this distinction and keep the run uncertain/pending. Cancellation never resurrects a schedule on rejoin.

Future scheduled-run failover does not migrate an active process. Reconcile the original worker after connectivity returns. For the default no-overlap policy, uncertain earlier work blocks subsequent dispatch. The issue collector can use its explicit idempotent retry policy to recover availability without pretending arbitrary effects are safe.

## Execution checklist

- [ ] Probe a pinned `go.etcd.io/raft/v3` release with the project's Go version, durable storage, snapshots, and current transport. Recheck that release's Apache-2.0 license and notices. Record its version, resource baseline, and the exact `Ready`, persistence, application, and fsync contract before adopting it.
- [ ] Define group enrollment and membership APIs with approved-key checks. Document the three-voter default, quorum loss, and separate voter/executor eligibility.
- [ ] Implement the scheduler state machine over Plan 293's types. Commit registration and lifecycle changes before acknowledging success. Keep application clocks out of consensus election/commit correctness.
- [ ] Replicate snapshots and durable logs. Add catch-up and removed-peer behavior before automatic scheduling. Verify local query reconstruction from committed state.
- [ ] Replicate workload checkpoint shards and atomic manifests with explicit ownership, version/size bounds, and revision conflicts. Retain shards referenced by current observations, acknowledgements, or pending outboxes. Reject acknowledgements without quorum commit.
- [ ] Implement leader scheduling, canonical due-run keys, eligible executor selection, committed assignments, and start admission. Prefer a ready executor deterministically; never enroll or provision credentials automatically.
- [ ] Implement executor permit deduplication and durable worker reconciliation. Reject superseded assignments and keep ambiguous effects unresolved. Add retry only for explicitly declared idempotent workloads.
- [ ] Expose quorum, leader, replica freshness, executor readiness, pending cancellation, and run uncertainty in CLI/JSON inspection. Bound retries and report give-up without a continuous error loop.
- [ ] Implement explicit group recovery and backup/restore procedures. Require the owner to isolate old voters before forming a replacement group after permanent quorum loss.
- [ ] Update overview and decisions without changing the host-authoritative session contract or routing terminal traffic through the Pi.

## Verification and delivery

Use isolated generated three-daemon groups, temporary state, explicit free ports, and a disposable idempotent workload. Register a job on A, confirm replication, take A offline, and observe a due run on B or C with a committed run record. Restart all peers and retain definitions, pause/cancel state, and history.

Partition one voter from two. Only the majority can commit new runs or lifecycle changes. Pause/cancel on the majority, restore the stale voter, and prove it never recreates the job. Remove quorum and confirm recorded jobs remain inspectable while dispatch and mutation acknowledgements report unavailable. Restore quorum and apply the documented missed-fire policy once.

Crash the leader before/after assignment commit, lose an executor after launch but before completion acknowledgement, and rejoin it. Confirm the default policy reports uncertainty without a second arbitrary command. Verify the collector's idempotent retry separately. Test missing runtime/credentials, exhausted retries, timeout, no-overlap blocking, DST behavior inherited from Plan 293, membership change, stale snapshots, and isolated recovery of permanent quorum loss.

Compare idle CPU/memory, replicated write costs, and scheduling behavior against the measured baseline. Run narrow consensus/store tests followed by Mesh's required integration gates through the heavy runner. Use a decision log and obtain independent review of partition and effect guarantees. Commit, push, release with a patch version, and prove the three-host failover scenario on the installed fleet. Return reachable inspection commands and recorded evidence.
