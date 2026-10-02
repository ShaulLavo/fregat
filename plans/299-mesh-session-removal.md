# Plan 299: Remove a remote session immediately after kill

Status: APPROVED.

Implementation owner: [ShaulLavo/mesh](https://github.com/ShaulLavo/mesh). Reported in [Mesh #92](https://github.com/ShaulLavo/mesh/issues/92).

## Outcome

After `mesh kill ID` confirms completion, an immediately following `mesh rm ID` removes the finished session. The destination host makes the removal decision using authoritative state. A stale viewer cannot delete an active session or falsely refuse a finished one.

## Evidence and existing behavior

#92 reproduced `kill` followed by `rm` twice on a remote Pi. The CLI printed `killed`, then refused removal because the session was still reported detached. Waiting three seconds succeeded. The same-host case was not tried.

At Mesh `cc64b29be5e79f4a8f3fe5fd36674ac17827c0ed`, `internal/cli/command.go`'s `removeSession` rejects a remote running/detached catalog row before sending `session.remove`. The destination's `internal/daemon/lifecycle.go` already reconciles its catalog before removal and refuses active sessions. `internal/worker/kill_acknowledgment_test.go` tests shutdown acknowledgement ordering. Determine whether the remaining defect is the client veto, host publication, or worker acknowledgement before changing ownership.

Preserve [D6's kill escalation](https://github.com/ShaulLavo/mesh/blob/main/docs/plan/01-decisions.md#d6--mesh-kill-means-hangup-then-insist), host-authoritative session state, and the existing separation between killing a process and forgetting finished metadata.

## Chosen ownership

Catalog state locates the target and supplies presentation. It does not authorize destructive cleanup. Send the requested remote removal to the selected authenticated host and let that host perform a fresh lifecycle check. Do not turn `rm` into an implicit kill.

Kill success means the worker recorded command termination and delivered its acknowledgement. The destination settles the corresponding catalog state before exposing a successful result when that is necessary for immediate subsequent controls. Preserve exact session/request matching and bounded acknowledgement writes. A timeout or uncertain kill reports an error, not success followed by an arbitrary delay.

Removal remains scoped to the requested finished session directory and catalog row. Recheck identity and state at the point that retires the row. Protect an active or concurrently restarted session. Repeated removal must give a consistent already-removed result and cannot resurrect a retired directory through reconciliation.

## Execution checklist

- [ ] Reproduce immediate remote `kill; rm` in disposable Linux and Darwin state. Include a stale running/detached client catalog and a known-good exited session. Record whether the client sent `session.remove` and whether the host had recorded exit.
- [ ] Inspect `removeSession`, `forwardOneShot`, kill acknowledgement, catalog reconciliation, and retirement ordering. Keep the smallest fix at the boundary that owns the proven defect.
- [ ] Remove the stale remote-state veto if it is the demonstrated blocker. Preserve host-side active-session refusal and authentication. Update direct CLI and picker removal callers together where they share the same wrong assumption.
- [ ] If host state publication remains a race, settle the exact killed session before acknowledgement or make removal recheck the recorded worker exit atomically. Do not add polling sleeps to hide the race.
- [ ] Add a regression driving real worker and daemon state through immediate kill/remove. Cover active removal refusal, mismatched acknowledgement, interrupted kill, and a restart racing retirement using the relevant existing lifecycle fixtures.
- [ ] Prove immediate removal leaves no row or directory to re-adopt. Repeat the sequence without sleep and verify other live sessions keep their PIDs and terminal input/output.
- [ ] Run the affected tests and all required Mesh lifecycle integration gates. Commit, push, pass CI, publish a patch release, and verify the installed command sequence on one disposable remote session.

## Acceptance and verification

Run focused cases in `internal/cli`, `internal/daemon`, and `internal/worker` first. Prefer the real process/socket lifecycle integration infrastructure under separate temporary state homes. Committed tests run in fresh clones with paths derived from the checkout and OS temporary directory.

Because session lifecycle and kill change, run `go mod tidy -diff`, `go vet ./...`, `go test -race ./...`, and the complete `./scripts/verify.sh`. Record the immediate command transcript and retained-session proof with the executing version.

A successful kill followed immediately by removal succeeds locally and remotely. A stale catalog cannot prevent the destination from checking a finished session. `rm` still refuses an active session and never terminates it. Kill uncertainty stays visible, and unrelated sessions survive every check.

Apply `how` to lifecycle settlement, `principle-make-operations-idempotent` to cleanup, and `unslop` to command results.
