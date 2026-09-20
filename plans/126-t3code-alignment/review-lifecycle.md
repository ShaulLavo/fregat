# Independent review of lifecycle.md

Reviewer scope: archive/UI/API policy, provider activity after archive, snooze wake semantics, bulk failure, grouping/defaults, settled ordering, and provider release. Compared pinned upstream `7445aa733ada33e45289e5aa5055f79142556513` using Git objects with current Platform baseline `3c9b88c35784e571e706600b0cee8e95a2656f77`. This is a bounded source review, not executed behavior. No app edits, tests, or deployment. Only this review file was written.

## Result

The core archive diagnosis is correct, and LIFE-02 correctly retracts the earlier suggestion to preserve local automatic unarchive. The lifecycle plan needs several precise corrections/additions before it can support a hard parity claim. No finding below overturns the need for LIFE-01/02.

## Corrections and additions

### REVIEW-LIFE-01 — Include the third grouping mode and resolve the easy default questions

**Confirmed plan omission; HIGH confidence; P1 completeness.**

`lifecycle.md` LIFE-09 describes repository/separate grouping, but upstream `packages/contracts/src/settings.ts:61–67` defines **repository, repository_path, separate**, default **repository**. The distinction is real: `packages/client-runtime/src/state/projectGrouping.ts:108–119` adds the repository-relative project path outside repository-wide mode; `:131–139` uses physical identity for separate mode. Its `:89–96` applies per-project overrides.

Use this matrix in LIFE-09 acceptance: two subprojects of the same repository on two environments merge all in repository mode, group by matching relative project path in repository_path mode, and remain physical in separate mode. Missing repository identity falls back to physical ownership. Preserve per-project overrides and deterministic representative selection.

Defaults left open at the end of lifecycle.md are available now in pinned contracts:

| Setting                         | Upstream default / shape                  | Evidence                                        |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| sidebarProjectGroupingMode      | repository                                | `packages/contracts/src/settings.ts:67,448–454` |
| sidebarProjectGroupingOverrides | empty object                              | same `:451–454`                                 |
| sidebarAutoSettleAfterDays      | 3; nullable to disable                    | same `:87,1132–1134`                            |
| sidebarAutoSettleOnMerge        | true                                      | same `:1135`                                    |
| confirmThreadDelete             | true                                      | same `:354`                                     |
| worktreeCleanup                 | null; modes off/custom and explicit rules | same `:975–989,1051`                            |

The final cleanup behavior of null still needs its policy resolver; do not equate null with off from the type alone. Initial values above no longer need to be deferred to implementation research.

### REVIEW-LIFE-02 — Add capability-unknown/unsupported shelf classification

**Confirmed omitted negative path; HIGH confidence; P1.**

Upstream `apps/web/src/components/Sidebar.tsx:2562–2574` reads each owning environment's capabilities. At `:2593–2601`, effective snooze requires `threadSnooze === true`, explicit settlement requires `threadSettlement === true`, and otherwise the row falls back through pin/active classification. Descriptor-not-loaded is intentionally treated like unsupported so users are not stranded in a shelf they cannot undo. At `:2604–2608`, pin sort is expressly independent of capability even though drag is gated.

LIFE-03's unconditional four-shelf phrasing should be qualified by those owner capabilities. Add fixtures with two owners, one missing descriptor, one supporting settlement but lacking active reorder, plus descriptor arrival/removal. Verify rows remain reachable, impossible actions are disabled, pin ordering stays stable, and changes to one owner never enable another owner's mutation. This matters even if old-release compatibility remains out of scope: a temporarily unavailable descriptor exists on a greenfield connection too.

### REVIEW-LIFE-03 — Make wake state derived, not a new persisted event

**Confirmed wording hazard; HIGH confidence; P1.**

LIFE-03 asks for “persisted wake signal.” Upstream `packages/client-runtime/src/state/threadSettled.ts:68–69` explicitly retains snooze fields after a raised hand; `:115–118` explicitly emits **no server event** at the timer boundary. `effectiveSnoozed` derives visibility, and `threadWokeAt` derives the indication from retained snooze and activity times (`:144–167`). Persist the upstream source state and visit acknowledgment, not a newly invented wake lifecycle flag/event.

Add these negative cases to LIFE-03/07:

- Running/waiting or ordinary tool activity after snooze does not wake it just because an event arrived. Local broad reset at `apps/server/src/orchestration/decider.ts:673–677` is precisely the divergence.
- Approval/user input raises its hand immediately, but leaves `snoozedUntil` stored. Follow the same derived policy when the request resolves; do not make every early wake permanently erase snooze.
- Fresh failure means `session.updatedAt > snoozedAt`; failure at/before the snooze remains snoozed (`threadSettled.ts:77–80`).
- Successful completed turn wakes only when completion is strictly newer (`:83–89`); an interruption is not automatically a successful-completion wake.
- An early wake timestamp remains authoritative after the scheduled deadline, preventing an already-acknowledged wake indicator from reappearing (`:151–164`).
- Custom local time in a daylight-saving gap is rejected; tomorrow/next-week are calendar increments, not fixed 24-hour arithmetic (`:196–202,286–302`).

### REVIEW-LIFE-04 — Scope the confirmed failed-selection behavior to bulk delete

**Confirmed boundary of evidence; MED confidence for broader proposed behavior.**

Bulk-delete retention is proven by upstream `apps/web/src/components/Sidebar.tsx:4005–4029`: collect deleted keys and remove only confirmed-gone selections. Local `apps/web/src/features/chat-mode/hooks/use-session-actions.ts:79–90` clears the full selection after all results, confirming LIFE-10.

Do not treat that as an upstream rule for _every_ bulk action. Pinned upstream clears selection before snooze outcomes (`Sidebar.tsx:3887`), after unpin (`:3944`), and after settle (`:3981`). Its snooze result instead summarizes successful/failed counts and supplies Undo only for successful targets (`:3895–3922`). The review did not establish a corresponding upstream bulk-archive retention path. Keep any extension to local archive failure retention explicitly labeled a local UX requirement, rather than citing bulk delete as proof of parity.

Add the actual upstream bulk-snooze partial-success/Undo behavior to LIFE-03/04 acceptance. Current report mentions bulk failures principally under delete and could miss this user path.

### REVIEW-LIFE-05 — Correct test paths and replace vague nonexistent-suite references

**Confirmed plan execution defects; HIGH confidence; P2.**

- LIFE-01 says `--project dom src/features/chat-mode/components/tests/session-rail.test.ts`; actual file is **`session-rail.test.tsx`**. Correct command from `apps/web`: `bun --bun vitest run --project dom src/features/chat-mode/components/tests/session-rail.test.tsx`.
- LIFE-10 asks to extend “session-neighbour tests”; bounded file/text search found no existing session-neighbour test. Specify a new test or the existing removal/navigation consumer test instead of implying that file exists.
- LIFE-04 asks to select existing “provider-command-reactor focused tests”; `rg --files apps/server/src/orchestration/tests` and `rg -l 'ProviderCommandReactor|createProviderCommandReactor|provider-command-reactor' apps/server --glob '*test*'` found no directly named/importing suite. State that a real orchestration integration test must be added to existing lifecycle tests or identify an actual indirect integration owner before issuing the command.
- Existing paths for `session-lifecycle.test.ts`, `session-attention-state.test.ts`, `provider-runtime-epoch.test.ts`, `decider-invariants.test.ts`, `session-rail-drag.test.tsx`, project-menu and cleanup-eligibility tests were located successfully.

No test was executed during review. These checks concern command executability, not passing results.

### REVIEW-LIFE-06 — Add archive edge cases that distinguish UI from API

**Confirmed missing matrix detail; HIGH confidence; P1.**

LIFE-02 correctly distinguishes upstream UI from server policy. Make its acceptance matrix explicit:

- UI blocks exactly running runtime with a non-null active turn (`apps/web/src/hooks/useThreadActions.ts:258`), so starting, waiting, running-without-active-ID, and terminal latest-turn states need individual comparisons. Local `apps/web/src/features/chat-mode/utils/running-turn.ts:6–9` uses both latest-turn running and waiting runtime, so replacing only the server guard leaves UI divergence.
- The upstream archive command permits live/pending states once existence/nonarchive is satisfied (`apps/server/src/orchestration/decider.ts:435–455`), but duplicate fresh archive commands still fail the nonarchived requirement. Do not describe archive as unconditionally idempotent independent of command-receipt deduplication.
- Archive must not clear outstanding request state, stop the provider implicitly, or rewrite settled/snooze fields. Keep archived detail restoration and explicit restore tests.
- Add archived session with later successful completion, failed completion, pending question, and startup/recovery replay. Strict active visibility must persist across both snapshot and event paths.

## Independently confirmed major claims

| Claim                                                              | Rechecked source / result                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict archive precedes shelf classification upstream              | `apps/web/src/components/Sidebar.tsx:2549–2554`; confirmed                                                                                                                                                                                                                                                                                                                                                                    |
| Only explicit orchestration unarchive emits upstream unarchive     | Pinned Git grep over `apps/server/src/orchestration` found sole production emission in `decider.ts:472`; other matches are projector/consumers/tests. Confirmed in this bounded ownership layer                                                                                                                                                                                                                               |
| Local activity resets archive/snooze                               | `apps/server/src/orchestration/lifecycle-events.ts:14–34`, `decider.ts:673–677,700–705`; confirmed                                                                                                                                                                                                                                                                                                                            |
| Snooze may run concurrently with a provider                        | Upstream `decider.ts:652–674` blocks pending requests/queued adoption, not running state; local `command-invariants.ts:126–131` delegates to settle and `:121–122` rejects live state. Confirmed                                                                                                                                                                                                                              |
| Settle clears pin and snooze, dismisses message-mode requests only | Upstream `decider.ts:500–512,544–601`; confirmed                                                                                                                                                                                                                                                                                                                                                                              |
| Settle triggers guarded provider release                           | Upstream `Layers/ProviderCommandReactor.ts:1824–1839` dispatches `onlyIfSettled`; `decider.ts:1833–1846` rechecks settled state, live status, and queued starts. Local reactor has no `session.settled` branch. Confirmed                                                                                                                                                                                                     |
| Settled ordering differs                                           | Upstream `components/Sidebar.logic.ts:974–985` uses shared timestamp resolution; `packages/client-runtime/src/state/threadSort.ts:27–47` prefers valid settledAt, then latest valid activity/turn timestamp, then updatedAt. Local `packages/client-core/src/chat/rail/session-order.ts:19–22` always uses pin key then creation. Confirmed; test malformed timestamps and deterministic ID ties as well as normal chronology |
| Displayed multi-owner group uses one owner for local archive-all   | Local `rail/model.ts:171–193` keeps first scoped project representative, `use-project-actions.ts:48–53` enumerates only that owner. Confirmed; membership/action correction remains necessary                                                                                                                                                                                                                                 |
| Current archive navigates to project draft upstream                | `apps/web/src/hooks/useThreadActions.ts:269–295`; confirmed                                                                                                                                                                                                                                                                                                                                                                   |

## Remaining open checks

- The upstream settle guard is checked when the stop command is **decided**, not a proven immutable runtime epoch bound to every later external stop call. `ProviderCommandReactor.ts:1700–1718` resolves the then-current shell and stops by thread. The report's acceptance race “start between settle and queued stop” is appropriate; avoid promising complete arbitrary scheduling safety solely from `onlyIfSettled` without tracing provider intent ordering. Test actual command/event/provider timing during implementation.
- Archive-navigation “do not override a route change during pending mutation” is a sensible safety acceptance but is not proven upstream behavior by the cited function: `useThreadActions.ts:269–272` captures the decision before awaiting archive and `:287` acts on that captured flag. Label the requirement as preserving local navigation safety unless a downstream new-thread handler supplies the guard.
- Default `worktreeCleanup: null` requires the shared resolver to determine effective rules. Type/default evidence alone does not establish delete cleanup eligibility.
- This review did not verify every title/native/mobile/search finding; those remain covered by the author's source audit and declared open scope, not newly independently validated here.
