# Archive delivery

Implemented and deployed on 2026-09-20 from Platform `02885149` plus the working diff.
Release: `20260920T122641Z-02885149-archive-lifecycle`, for both server and web.

## Behavior

- Archived sessions stay out of active rail, search, sidebar selectors and normal palette entries, regardless of attention. Explicit archive browsing and opening still work.
- Direct archive requires an existing, nonarchived session. The UI blocks only a running runtime with a non-null active turn ID. Archive does not stop a provider or discard requests.
- Only explicit restore emits `session.unarchived`. Provider starting/running and approval/input requests clear settlement only. Errors, plans and recovery retain archive, settlement and snooze. User send clears settlement and snooze.

The source-derived oracle is `test/parity/t3code/archive.json`, pinned to T3 Code `7445aa733ada33e45289e5aa5055f79142556513`. The lifecycle tests consume its runtime/activity expectations.

## Verification

Before the fix, 14 server regression cases and six client cases failed on the incorrect eligibility, overlay reset, waiting-state guard and active-list behavior.

After the fix, 88 server and 53 web tests pass. These cover queued/claimed/adopted work, pending requests, duplicate commands/events, runtime transitions, proposed plans, recovery, late real mock-provider completion/failure, restart, active filtering and restore with retained history. The session-rail component test drives the real menu and in-process server with pending approval and late error activity.

Commands, from their respective app directories:

```sh
bun --bun vitest run src/orchestration/tests/session-lifecycle.test.ts src/orchestration/tests/decider-invariants.test.ts src/orchestration/tests/session-attention-state.test.ts src/orchestration/tests/provider-runtime-epoch.test.ts
bun --bun vitest run --project node src/features/chat-mode/utils/tests/session-rail-model.test.ts src/features/chat-mode/utils/tests/running-turn.test.ts src/features/chat-mode/utils/tests/archived-auto-pick.test.ts src/features/chat/state/tests/chat-projection-selectors.test.ts --project dom src/features/chat-mode/components/tests/session-rail.test.tsx
```

Web, server, client-core and scripts typechecks pass. Changed-file lint and web boundary checks pass; the boundary run reports the existing `use-symbol-revision.ts` effect warning. Deployment candidate checks and the mesh live check pass.

The dev server refused connections, so browser verification used the production mesh URL. `scenario archive-lifecycle` passed before and after deployment. It creates its own session, archives through the menu, opens from archive, reloads, restores through the menu, and deletes its fixture. Post-deploy screenshots were inspected:

`/work/tmp/fregat-evidence/20260920T122707Z-scenario-archive-lifecycle/`

The browser reported GPU adapter/readback warnings also present before deployment, with no application errors or warn/error log events during the run. `/platform/release` confirmed the server and web release above.

## Limits

The live browser scenario does not inject approval/input/plan/provider events. An attempted stale approval reply on an empty production session did not produce the required attention state, so it was not accepted as late-event evidence. Those transitions are verified through the real engine and provider ingestion in tests.

No live pinned-upstream comparison or native/mobile matrix was run. LIFE-01/02 remain `in-progress` in the broader parity ledger to preserve those acceptance gaps; their local implementation is shipped. Wave 0's full operation map and CI drift gate remain open.
