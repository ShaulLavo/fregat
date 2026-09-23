# Queued follow-ups and Stop recovery

This queued-follow-up delivery shipped in mesh release `20260923T170912Z-081135ba-t3-parity-follow-ups` and passed browser verification on development and mesh, against T3 Code `7445aa733ada33e45289e5aa5055f79142556513`. INTERACTION-01 remains in progress.

## Delivered behavior

`chat.followUpBehavior` defaults to `queue`. A busy composer queues follow-ups; Ctrl/Cmd+Enter reverses the configured queue/steer intent. The setting is registered, consumed and included in the generated settings reference. The queue stays in memory, matching the pinned upstream lifetime.

Each entry retains its environment/session owner, captured draft target, prompt, ready image/file attachments and terminal selections. A completed tool boundary releases one eligible head and updates the boundary for the remaining entries. Pending questions, approvals, connection/settings readiness and provider capabilities hold delivery. Clearing a gate rechecks a due head without requiring another tool event. Send now dispatches an eligible entry explicitly; Restore returns it to the captured draft.

Stop restores unsent queued content before dispatching interruption. Existing draft text stays first. Attachments fill the remaining composer capacity; overflow stays visibly queued with an explicit Send now hold. A rejected interrupt leaves the restored payload usable.

An unconfirmed delivery may already have reached the server. It stays held with its exact command/message IDs and a Retry delivery action, including after Stop. Restore stays disabled until delivery is confirmed, so a lost reply cannot turn an accepted message into a second submission. A definitive stale-steer rejection can instead be retried as a new turn after the running turn ends. Store and row-interaction tests cover this distinction.

The browser drive also exposed missing `PUT` and `DELETE` in development CORS responses. The server now permits the real upload and cleanup methods. Focused preflight regressions cover both methods.

## Evidence

- `scripts/parity/follow-ups.ts` executes the pinned tool-boundary selector and due policy against the local helpers. All 5,396 cases agree; eight deliberately wrong controls fail. This is a paired pure-policy comparison, not a paired full-application run.
- Durable comparison records and source hashes are retained in the [turn-start comparison](evidence/follow-ups-final/turn-start/comparison.json) and [turn-interrupt comparison](evidence/follow-ups-final/turn-interrupt/comparison.json).
- Focused queue/store and composer-hook tests cover scoped FIFO ownership, overflow holds, pending-request and connection gates, uncertain receipts, stale-steer retry, two mounted composers, and restoration before failed interruption. Submit-button/editor tests cover queue/steer labels, alternate intent, IME input and delayed submission ownership.
- `bun run agent:browser scenario chat-queue` completed in 30.862 seconds on local development. Evidence is `/work/tmp/fregat-evidence/20260923T165735Z-scenario-chat-queue/`.
- All eight screenshots were inspected. The run queues A/B, releases only A at the first tool boundary, holds B behind approval, and releases B after approval without another boundary. It exercises Send now and Restore, then queues a real uploaded text file and an actual terminal selection. Stop restores these beside an existing prompt while the fixture holds interruption. Native rejection preserves them; a subsequent send delivers exact file bytes and the structured terminal context to the native provider fixture.
- `inspection.json` records the exact native inputs, both native process exits and terminal clear/kill responses of 200. The disposable session/provider were removed, the setting restored, and the uploaded blob is absent. The fixture supplies the external native protocol; the browser, transport, server, upload storage and provider adapter are real.

The successful run has no browser errors or non-abort network failures. Raw evidence retains aborted event-stream/log requests during navigation. Its shared log window includes a PR lookup warning, an older missing title-provider reaper warning and the deliberate terminal cleanup signal. A cancelled LSP completion belongs to a different browser instance than either instance recorded for this run. This is not a clean-log claim.

## Mesh verification

`OBSERVABILITY_DIR=/work/platform-production/logs bun run agent:browser scenario chat-queue --url https://omarchy.mesh.shaulavo.dev/platform/` completed in 12.166 seconds. Evidence is `/work/tmp/fregat-evidence/20260923T170958Z-scenario-chat-queue/`. The release route confirmed matching web/server release `20260923T170912Z-081135ba-t3-parity-follow-ups` immediately before the run; its application log events carry that version.

All eight mesh screenshots were inspected. They repeat the queue, gate and Stop-recovery checks above, including the restored prompt before it is cleared. Native records contain exactly the initial turn, A, B, explicit Send now, and the recovered payload. The recovered file bytes match; the terminal marker remains inside `<terminal_context>`. Cleanup records terminal clear status 200, `killed: true`, no kill error, both native process exits and removal of the disposable session/provider. The uploaded blob is absent on disk.

Mesh captured no browser errors, console errors or non-abort network failures. Graphics warnings remain. Its four application warnings concern PR lookup and the older missing title-provider session. No application error appears in this window.

A separate web deployment occurred after the completed run. Its build manifest identifies the same shared working tree and includes the queued-follow-up sources. The same browser scenario was repeated against that served pair and passed in 7.856 seconds. Evidence is `/work/tmp/fregat-evidence/20260923T171228Z-scenario-chat-queue/`, including the copied `web-build-config.json`.

The repeat's `release-before.json` and `release-after.json` both record web `20260923T171042Z-081135ba-e049-review-fixes` with server `20260923T170912Z-081135ba-t3-parity-follow-ups`. All eight screenshots were inspected again. Exact native input order, file bytes and terminal context passed; both native processes exited, terminal clear/kill succeeded, the disposable session/provider were removed and the uploaded blob is absent. There were no browser errors, console errors or non-abort network failures. Five application warnings concern PR lookup, the older missing title-provider session and deliberate terminal cleanup. No application error appears in this window.

## Repository checks

Whole-repository lint, format, typecheck, gates, generated-file checks and boundaries pass. The final web run passed 1,420 tests across 166 files; contracts passed 321 tests across 26 files; the parity Python suite passed 47 tests. The unused checker still reports the unchanged `cache-budget.ts`, `workspaceEditCategorySchema` and `normalizeWorkspaceNamespacePath` findings. Full repository verification is therefore not claimed green.

## Remaining acceptance

- A composer with unfinished attachment preparation still blocks queue admission. This delivery proves Stop recovery for admitted, ready attachments; Stop during preparation before queue admission remains open.
- Non-Codex providers can retain queued input, but mid-turn dispatch is gated by their existing correction capability. Complete provider-specific boundary delivery and the actual-provider matrix remain open.
- Attachment overflow, interrupted connections, uncertain acknowledgments, duplicate observers and alternate shortcuts have local coverage. Their complete live browser matrix, including cross-environment/session changes and gate reopening, remains unverified.
- Payload coverage here is text, current image/file attachments and terminal selections. Review comments, browser annotations and assistant citations remain INTERACTION-09 work.
- The native fixture does not prove provider-account behavior or desktop/mobile/OS-specific interaction. The broader platform checks and paired upstream full-workflow comparison remain required.

Neither the local browser pass nor the pure comparison closes the whole INTERACTION-01 group.
