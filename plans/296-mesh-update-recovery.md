# Plan 296: Recover stranded updates and explain Darwin health failures

Status: APPROVED. Execute the recovery verification first. Collect Darwin failure evidence on the next natural failure, as requested by #87.

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #89](https://github.com/ShaulLavo/mesh/issues/89) and [Mesh #87](https://github.com/ShaulLavo/mesh/issues/87). This central plan owns their remaining work.

## Outcome

A current binary can release a finished update's creation gate even when an older helper is still running. Recovery preserves the terminal failure receipt and every live session. A future Darwin execution-health failure identifies the failed probe and process incarnation sufficiently to diagnose the cause.

## Evidence and existing work

#89 recorded a Mac on v0.1.116 with a `rollback_failed` journal and a matching `activation.gate`. A downloaded v0.1.124 binary's cancellation did not release it. The installed helper predated #85. The report establishes the failure, while its dispatch explanation remains unconfirmed.

Read current committed Mesh source, rather than the dirty historical checkout. At `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, `internal/cli/update_operations.go` already calls `settleLocalTerminalInstallation` before local cancellation dispatch. `internal/updateinstall/engine.go` settles finished receipts under the installation lock. `internal/cli/update_settlement_test.go` covers `rollback_failed`. Verify this existing fix through the old-helper case before adding code.

#87 records two distinct historical failures. The v0.1.117 worker probe timed out. The v0.1.118 candidate failed identity validation, then rollback could not find the daemon socket. The signed-bundle identity change was already reverted. Neither that revert nor later daemon availability proves either socket failure resolved. Retain the distinction.

Follow [T26 update ownership](https://github.com/ShaulLavo/mesh/blob/main/docs/tasks/T26-mesh-updates.md) and [update recovery commands](https://github.com/ShaulLavo/mesh/blob/main/docs/updates.md). Workers own PTYs and survive daemon replacement. An issued activation grant may still finish after cancellation.

## Scope and ownership

The installation journal, request generation, installation lock, and matching gate determine whether settlement is legal. The invoking current binary can perform local settlement before delegating to an old helper. It must re-read the receipt under the lock and preserve a gate owned by another operation or an active incarnation. A finished failure remains a failure after its gate is released.

Health evidence belongs to the updater operation. Record phase, elapsed time, probe kind, process identity, expected and observed build digest, worker readiness, socket lifecycle, and bounded service-manager outcome. Preserve private paths and session metadata only in local evidence. Public diagnostics use sanitized summaries. Keep worker response waits separate from daemon startup and socket discovery.

This plan does not increase deadlines based on historical receipts, replace healthy workers, prune sessions, hand-delete gates, or run a repeated installed-Mac failure campaign. The transient fleet-read report in #80 needs no separate work here.

## Execution checklist

- [ ] Reconcile #89 against current source, release history, and retained recovery evidence. Record which released version contains local terminal settlement. Inspect current installed state read-only before making any recovery claim.
- [ ] Build a disposable installation fixture with a terminal journal, matching gate, and older running helper. Exercise the same current-binary `update cancel RUN` invocation that failed in #89. Include coordinator selection in the fixture so a local recovery cannot accidentally delegate elsewhere.
- [ ] If settlement already succeeds, retain the missing old-helper regression and document the supported recovery command. If it fails, fix the smallest dispatch or ownership gap in `internal/cli/update_operations.go`, `internal/updateinstall/engine.go`, or the demonstrated helper boundary.
- [ ] Prove repeated settlement converges. Preserve terminal receipt contents, an unrelated gate, an active/granted operation, and a changed generation. A release must never depend on upgrading the helper that holds the installation first.
- [ ] Check the existing instrumentation in `internal/updatebootstrap/probe.go`, `internal/updateinstall/transaction.go`, platform service adapters, and worker inspection. Add only fields needed to distinguish #87's unknown phases. Keep one bounded operation record and a give-up for each probe.
- [ ] At the next naturally occurring Darwin failure, retain the new evidence before cleanup. Establish the failing phase, then add its narrow regression and fix. If no failure occurs, mark diagnosis pending and retain the approved work in this checklist.
- [ ] Verify recovery in disposable Darwin and Linux service-manager fixtures. Confirm worker PIDs and terminal input/output persist through daemon recovery. Run the affected tests, required Mesh lifecycle gates, and release-transition checks before shipping.
- [ ] Commit and push the change in Mesh, pass CI, publish a patch release, and verify its installed executing build through the supported updater. Record recovery evidence and unresolved #87 diagnosis separately.

## Acceptance and verification

Run the focused CLI, installer-engine, and bootstrap tests first. Add an integration case only for the old-helper gap or a demonstrated socket lifecycle defect. All retained tests use temporary state and controlled processes. Run `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and `./scripts/verify.sh` before delivering lifecycle changes. Use disposable service-manager environments for activation checks.

Success means a finished matching gate clears on the first supported current-binary recovery and on repeated recovery. Active or unrelated installations remain protected. Existing sessions retain their processes and terminal traffic. Human and JSON status preserve the original rollback failure while reporting gate settlement accurately. #87's diagnosis is complete only when retained evidence identifies a cause and the matching regression passes.

Apply `how` when entering updater ownership, `principle-make-operations-idempotent` for repeated settlement, `principle-sequence-verifiable-units` for separate gate and probe changes, and `unslop` before delivery. These choices prevent a broad updater rewrite from obscuring two different bugs.
