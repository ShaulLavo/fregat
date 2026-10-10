# Plan 311: Finish visible and stable Auto machine placement

- Status: APPROVED
- Date: 2026-10-03
- Implementation owner: `ShaulLavo/fregat`, draft selection and machine capacity.
- Source: [Fregat #347](https://github.com/ShaulLavo/fregat/issues/347).
- Existing owner: Plan 126 EXT-16 already delivered core balancing through [PR #272](https://github.com/ShaulLavo/fregat/pull/272). Preserve that implementation and complete only remaining acceptance gaps.
- Related later inputs: [313](313-heavy-quiet-lifecycle.md) and [314](314-heavy-non-cache-memory.md) may improve load evidence after their own work lands. This plan does not depend on a distributed scheduling framework.

## Outcome

The owner can choose Auto for an eligible new draft, see the chosen machine before Send, and override it. New independent Auto drafts reconsider connected checkouts and current load. A selected draft stays on its visible machine. Attachments, terminal captures, explicit branch/worktree choices, and manual machine picks keep their ownership.

## Preserve what already shipped

Source inspection used Fregat `46e47cb71`.

- The settings registry already contains `environments.loadBalancing`, off by default, and `environments.loadPreferences`. Preferences are `prefer`, `normal`, `less-often`, and `manual-only`, keyed by environment UUID.
- `utils/machine-balancing.ts` already filters unusable capacity and stale receipt times. It scores eligible candidates by preference, CPU count/utilization, and available memory fraction. Do not replace it with an unmeasured framework.
- `hooks/use-balance-draft.ts` considers live same-repository candidates, requires a ready checkout, excludes manual-only machines, and writes an automatic/required draft selection. Capacity failures ask the owner to choose.
- `utils/draft-workspace.ts` forbids machine changes with attachments or terminal contexts. `state/move-draft.ts` guards draft identity changes while asynchronous movement runs.
- `draft-machine-menu.tsx` shows the selected machine and manual candidates. It currently has no explicit per-draft Auto entry.
- `chat-draft-view.tsx` rejects Send while capacity selection is pending or requires choice. Its start path retains command/session IDs for retries.
- `state/advance-background-draft.ts` preserves the submitted identity when advancing. Verify whether the resulting automatic choice remains pinned for the next independent draft. The source alone does not prove a user-visible failure.
- `machines/resources.ts`, capacity query tests, selection tests, hook tests, and `scripts/agent/scenarios/machine-balancing.ts` already exist. Plan 126's status record contains shipped two-owner route/pin/reload evidence.

First reproduce the remaining acceptance matrix against current main. Mark shipped controls complete after reading fresh evidence. If consecutive independent drafts and send revalidation already satisfy the requirements, retain the implementation and record the proof. Do not reopen completed core balancing work.

## Keep the placement decision small

Use the existing draft selection states for automatic, pinned, and required. Add the explicit Auto action to the machine menu for eligible drafts. The global setting supplies the default for a new draft. Choosing Auto affects this draft, while a manual candidate pins it. Keep current settings and preferences rather than introduce a second configuration system.

Build candidates from live environments and the app's existing repository grouping. Require a ready checkout of the same proven repository origin. Exclude manual-only hosts, unavailable checkouts, stale capacity, and unknown capacity. Reuse the existing CPU/memory score as the resource model. Use current running-session count as a secondary load signal when resource scores tie, with environment UUID as the stable final tie-break. Count only actual running/starting work from canonical projections. Do not count settled sessions as load or double-count one session's child records.

If session-count data is not available to the same decision owner, extend the existing local capacity response with a cached count. Do not launch processes or wake a disconnected machine to obtain it. Within one client, include accepted starts pending projection as temporary load so rapid independent sends do not all use a stale count. Correlate these starts by command/session identity and remove them when canonical state arrives or rejection settles. This is a bounded client correction, not a global fleet reservation protocol.

Respect explicit host preferences rather than hard-code Linux precedence. The existing Prefer setting expresses the owner's coding-host choice. Manual only expresses the interactive-host exclusion. A connected Mac can still be selected if its preference and observed capacity make it the right candidate.

Keep an automatic decision stable while the owner edits its draft. Show `Auto` and the chosen machine in the strip/menu, plus a short reason such as available capacity. The full machine name remains recoverable. Manual override immediately wins over late capacity replies.

Before dispatch, revalidate the selected machine's live connection, repository/checkout identity, and draft lock against current state. Do not silently move a draft after the owner has seen its choice. If eligibility changed, retain its text and attachments and ask for a new choice. Capacity variation alone does not reroute a pinned visible draft. Reuse the existing command/session identity if dispatch acceptance is uncertain, so retry cannot create a duplicate session on another host.

After successful Send, a genuinely new independent Auto draft clears the old automatic choice and samples candidates again. A manually pinned machine, linked worktree, selected branch, or captured local content stays pinned. Distinguish a new draft from a retry and from text typed while the previous Send was in flight.

## Execute and verify the remaining gaps

- [ ] Read the merged EXT-16 implementation and current fixture scenario. Run a bounded matrix for Auto defaults, manual-only exclusion, explicit pin, attachments, branch/worktree ownership, background next draft, reload, stale capacity, and late replies.
- [ ] Record which controls already pass. Capture a baseline for selection latency and resource-read count before adding inputs.
- [ ] Add the per-draft Auto action and visible selection state using the current store/menu. Test manual override during asynchronous selection and no eligible candidate requiring choice.
- [ ] Add the smallest canonical running-count input needed for tie handling. Exercise pending accepted starts and their settlement without counting retries twice.
- [ ] Correct independent-next-draft behavior only where the reproduction shows a gap. Verify that fresh Auto drafts reconsider changed load while manually pinned drafts retain their machine.
- [ ] Add send-time eligibility revalidation at the existing dispatch boundary. Test disconnect, checkout removal, identity change, content-lock changes, uncertain acceptance, and retry on the original command identity.
- [ ] Extend `machine-balancing` with two connected fixture environments that have the same repository. Verify the visible choice before Send, a manual override, and consecutive independent starts under changed load.
- [ ] Keep existing capacity, movement, hook, and draft retry checks green. Add portable cases using injected resource snapshots and real app state. No test needs the owner's machine names or live fleet.
- [ ] Read back `look` screenshots for Auto's visible selected host, unavailable capacity, and locked drafts. Inspect the query/counter evidence that no disconnected host was connected or awakened.
- [ ] Compare selection latency and request count on the same fixture setup. Explain any extra connected-host read and remove repeated reads that add no decision value.
- [ ] Commit and push owned paths, run required gates through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill, deploy affected server/web code, and verify the served Auto flow. Update this checklist and the root roadmap.

## Acceptance and verification

Auto chooses a connected eligible checkout using fresh resource evidence and explicit preferences. The owner sees and can override its machine before sending. Manual-only hosts never enter Auto. Captured content and explicit workspace choices retain their host. A late response cannot undo a manual pick.

New independent drafts reconsider load. A selected draft stays stable through editing and capacity variation. A failed or uncertain send preserves the draft and reuses its command identity. Changed machine eligibility prevents a hidden reroute or duplicate session. Fleet reads use existing live connections and create no host wake.

Use the existing app fixture infrastructure, real draft stores, injected outside-world resources, and current browser scenario. Measure performance changes rather than assert an arbitrary timing target. Use `typescript-best-practices`, `tanstack-query-best-practices`, `verify-fregat`, `technical-writing`, and `unslop`. Foundational Thinking keeps selection ownership on the draft. Make Operations Idempotent keeps retries on one command/session. Sequence Work into Verifiable Units proves existing behavior before extending it.

Closing #347 transfers remaining acceptance and delivery work to this Approved plan. PR #272's shipped balancing remains recorded as completed work.
