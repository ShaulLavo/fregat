# Plan 310: Show remaining allowance and open manually chosen backlog work

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/fregat`, chat usage and project backlog UI.
- Source: [Fregat #348](https://github.com/ShaulLavo/fregat/issues/348).
- Scope decision: The owner approved allowance/reset visibility and manually started work. Automatic quota-driven agent launches are excluded, including the issue's suggested opt-in mode.
- Dependencies: [308](308-account-usage-feed.md) provides account identity and observation freshness. Existing normal draft/session commands provide manual execution. [144](144-unattended-agent-work.md) documents harness schedules but supplies no new scheduling authority here.

## Outcome

The owner can see how much allowance remained at the last observation and when that window resets. They can select an approved project backlog item, inspect its prompt and destination in a normal draft, and send it themselves. Merely opening the meter, reaching a reset deadline, or changing machine capacity starts no agent.

## Current evidence and the limits of prediction

Source inspection used Fregat `46e47cb71`.

- `usage-window-row.tsx` shows used percentage, reset countdown, and the pace marker computed in `utils/usage-meter.ts`.
- `usagePace()` assumes even use from window start to the current observation. It already emits a runs-out estimate. That is not a measured recent burn rate.
- `provider/usage-history.ts` aggregates local recorded token/cost data. Those quantities do not establish provider subscription utilization or complete account activity.
- Plan 308's feed preserves the account/window observation time and duration. Old readings may survive a reset without evidence of the new allowance.
- `chat-draft-view.tsx` uses normal draft dispatch with a stable command/session identity for retry. Existing machine selection and attachment ownership rules still apply.
- Plan 141's reset-credit feature is a separately confirmed resource-spending command. This plan neither invokes it nor spends credits automatically.

Use a direct, defensible readout first. For a valid percentage, remaining allowance is `100 - usedPercent` at that observation. Show that time alongside the reset countdown. A row can say `40% left when observed · resets in 14h`. This is not a claim about future unused allowance.

Keep a reset forecast unknown when there is no comparable account/window observation series. Do not convert token history, API-equivalent cost, other accounts' readings, or ten-minute request buckets into subscription burn rate. If a later increment adds a forecast, require at least two valid observations from the same account and unchanged window reset. Derive the rate solely from utilization change over their observation times. Label the result as an estimate and show its interval. Stale, reset-crossing, status-only, or decreasing readings invalidate the estimate. A clock tick cannot manufacture new observations.

The approved first delivery includes the direct remaining readout and honest unknown prediction. It does not depend on a forecasting service or background sampler. Preserve the useful elapsed-window guide where its observation is fresh and its duration is known. Recheck existing pace copy so it distinguishes that guide from measured recent use.

## Keep backlog execution under owner control

Add a small per-project list of approved manual prompts. Each item has a stable ID, title, prompt, project identity, optional source issue/plan links, and state such as queued or explicitly started. Store these as project work records in Fregat's data store. Do not put executable prompts in cloned workspace settings, logs, or metrics.

The owner chooses an item and opens its normal draft. Show the prompt, project, provider/model, and destination machine before Send. A linked plan can be the prompt's source without turning the entire GitHub backlog into automatically executable text. Populate only owner-approved items. Ordinary API/script collection may refresh a review list, but collection cannot send a prompt.

Use the existing Send path. Only explicit sending starts a session. Correlate the backlog item with its accepted command/session ID. Preserve it on failed dispatch. Retry the same command rather than create a second session. Disable overlapping Start actions through the feature's TanStack mutation scope. Clear or mark the item started only after canonical acceptance. Opening a draft alone does not consume an item.

Do not add a cron, allowance threshold that triggers execution, auto-start opt-in, auto-continue loop, provider polling, credit redemption, or host wake. Any new display preference belongs in the settings registry. No new preference is needed for the first readout and manual queue.

## Execute in small increments

- [ ] Capture the current meter using a fresh, stale, unknown, and reset-passed fixture. Record which existing pace labels overstate available evidence.
- [ ] Add a pure remaining-allowance view model keyed by account/window identity and observation time. Test valid percentages, null percentage, expired reset, stale data, and unknown duration.
- [ ] Render remaining allowance and observation age using Plan 308's account rows. Keep unknown data visible and avoid forecast copy without a measured series.
- [ ] Correct existing pace copy and freshness gates where required. Test that local token history never affects provider allowance or prediction.
- [ ] Add project work records and validated list/edit/start associations. Keep prompt contents out of structured logs. Test normal project ownership and unavailable/deleted source links.
- [ ] Add the manual list and Open draft action using shared UI primitives and the existing draft owner. Preserve an occupied draft or use the app's existing explicit new-draft flow.
- [ ] Correlate Send acceptance with the selected work item. Verify failed/retried dispatch, repeated clicks, draft switching, and abandoned drafts without duplicate sessions or lost entries.
- [ ] Extend `chat-usage-meter` and the relevant project/draft scenario. Open the list and advance the clock through reset without any start command. Then send one selected item and observe exactly one accepted session.
- [ ] Read back normal/narrow `look` screenshots for current remaining allowance, stale/unknown observations, and the manual preview.
- [ ] Run the narrow meaningful fixtures and required gates through the heavy runner. Commit and push owned paths, deploy affected server/web code, and verify the served manual flow.
- [ ] Update this checklist and the root roadmap with shipped evidence. Record forecasting as unavailable unless the optional observation-series increment has its own bounded verification.

## Acceptance and verification

Portable fixtures use injected time and synthetic account readings. Verify that percentages from separate accounts or resets never merge. An old reading retains its age across clock ticks. Unknown values remain unknown. No UI read, timer, reset event, or backlog refresh emits an agent-start or credit-redemption command.

Use real app state and normal draft dispatch in UI fixtures. Assert exactly one command/session identity through failed-send retry and repeated clicks. Model/provider calls come only from the owner's explicit Send in the ad hoc live proof. Automated scenarios use the existing cheap test adapter, never a live agent loop.

The owner gets truthful allowance/reset information and a list of work they can inspect and start. The first delivery does not claim to predict subscription waste from incomplete token history.

Use `typescript-best-practices`, `tanstack-query-best-practices`, `verify-fregat`, `technical-writing`, and `unslop`. Boundary Discipline separates observed data from estimates. Make Operations Idempotent keeps manual retries attached to one session. The approved work remains in this checklist after the source issue closes.
