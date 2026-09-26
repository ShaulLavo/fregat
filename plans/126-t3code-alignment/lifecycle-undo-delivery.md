# LIFE-13 lifecycle Undo/Redo delivery

PR #38 finding 4 and the owner correction at `ceaa27d4` are implemented on `wave/L5-undo`. No deployment or lane push was performed.

## Behavior

Settle, snooze, unpin, and archive record separate history steps. A bulk action records its successful rows together. The notice lasts five seconds; the bounded 50-step history remains until reset. Mod+Z undoes and Mod+Shift+Z redoes outside text entry and panes with their own Undo. TUI rail uses U and Shift+U, with palette commands for both. Restoring a viewed archived session reopens it on its original surface; redoing archive reconciles navigation again.

`packages/client-core/src/history/undo-stack.ts` contains the generic stack. Both hosts use the same lifecycle history controller. Successful restores rebase the adjacent history entry to the new server revision, allowing repeated steps on the same session. New actions clear redo. Conflicting rows are removed from both directions while successful bulk rows remain redoable.

## Server boundary

The accepted command receipt stores the authoritative prior lifecycle state, prior revision, session id, and command id. `session.lifecycle.restore` accepts only the original receipt id and expected revision. The server resolves the snapshot from that receipt, checks session ownership and lifecycle policy, and commits one `session.lifecycle-restored` event. The SQL update also compares the revision inside the command transaction. A stale decision cache cannot bypass it.

Restoration covers archive, settle override and anchors, snooze, pin and ordering, and the acknowledged failure sequence. Expired snoozes remain awake. Lifecycle events and attention-changing activity advance the revision. The revision survives restart and projection replay. Restoring settlement runs the existing runtime-release reactor.

Migration **28 `session_lifecycle_revision`** adds exactly:

```sql
ALTER TABLE projection_sessions ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0;
```

The other L5 fix owner owns `push_devices` 25 → 27. This branch leaves that migration unchanged. L6 must include the new column in its final schema.

## Evidence

- Negative control `/work/tmp/L5-undo-race-before.log`: A snoozes, B changes the wake time, old Undo sends unconditional `session.unsnooze`. The assertion fails with `null` instead of B's `2099-01-02T00:00:00.000Z`.
- Server lifecycle regressions cover the conflict, atomic state restoration, repeated receipt delivery, redo, persisted revision after restart, concurrent inverses, stale decision cache, expired snooze, pending work, foreign receipts, and rejection of client-provided snapshots.
- Shared stack tests cover repeated actions on one row, bounds, branching, partial failures, and original receipt revision capture.
- Web integration tests exercise real in-process commands, keyboard Undo/Redo, focus exclusions, bulk failures, drag actions, remote conflicts, and reopening on both main and side-chat surfaces.
- TUI rail integration verifies archive Undo, Redo, and reopening, plus deletion invalidation. The demo implements the same receipt contract.
- Browser evidence: `/work/tmp/fregat-evidence/20260925T151858Z-scenario-session-undo/`, 17 completed steps. Screenshots 15–17 show two Undo steps, two Redo steps, and reopening again. No failed HTTP responses, application errors, or warning/error server logs. Browser GPU and startup socket warnings remain. The first cold Vite run completed but reported outdated-dependency 504s; the warm run is the clean evidence.
- Verified totals: 112 server tests in the broad run plus 65 lifecycle tests after the ordinary-tool case, 82 web tests, 13 TUI tests, 5 shared stack tests, and 35 contract tests; server/web/TUI/client-core typechecks and gates passed.
- Verification logs: `/work/tmp/L5-undo-{server-final,web-final,tui-tests,types-final,gates}.log`.

A drag into Active can also rearrange neighbouring active keys. Its history restores the dragged session's lifecycle. History is local to each client; remote writes are protected by server revision checks.
