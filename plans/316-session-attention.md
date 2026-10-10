# Plan 316: let working sessions recede in the rail

## Status and ownership

Status: APPROVED, 2026-10-03. Source [Fregat #346](https://github.com/ShaulLavo/fregat/issues/346). Fregat's web session rail owns implementation. Existing server attention semantics remain authoritative.

## Outcome

With several agents running, a finished unread session or a session waiting for the owner stands out. Working rows recede until hovered, focused, selected, or marked. Keyboard navigation remains clear and all actions remain available.

## Current evidence

At Fregat `46e47cb7105da5b74dae4b76fc08033f2d6e5dfb`, [SessionRow](../apps/web/src/features/chat-mode/components/session-row.tsx) uses `ListRow`, an attention dot, unread text weight, and chips. The full row has no working-state recession. [SessionAttentionIndicator](../apps/web/src/features/chat-mode/components/session-attention-indicator.tsx) already labels approval, input, failure, working, monitoring, sleeping, and ready states.

The [rail model](../packages/client-core/src/chat/rail/model.ts) supplies `status`, `attentionReason`, `hasError`, `unread`, and `stale`. Its status comes from [sessionRailStatus](../packages/contracts/src/session-notices.ts), which already prioritizes approval and user input. [server sessionAttention](../apps/server/src/orchestration/utils/session-attention.ts) gives input and approvals priority over active runtime. Reuse that projection. Do not infer attention from snippet text, DOM activity, or whether the local socket is currently streaming.

## Presentation rule

Recede a row only when its projected status is `working`, with no unread completion, actionable attention reason, error, or stale-machine warning. Keep approval, input, failed, and unread rows at full weight. Keep monitoring, sleeping, and ready rows at their existing treatment in this bounded change.

Apply whole-row opacity consistent with the issue's proposed `opacity-50` treatment. Restore full opacity on hover, focus-visible, active selection, multi-selection marking, and drag. Selection and focus-ring visibility take precedence. Recession describes attention demand, so it must never set `disabled`, remove an accessible label, or block pointer/keyboard input. Use theme text tokens unchanged. Any design-census exception must name this intentional attention treatment.

Keep the derived presentation rule local to the session rail. The existing item model owns domain state; no extra store or persisted preference is needed. No reordering, notifications, unread semantics, lifecycle changes, or automatic agent activity belongs to this plan.

## Execution checklist

- [ ] Capture the current rail with several working sessions, one finished unread session, one approval request, and one error. Use controlled fixture providers and current rail status projections.
- [ ] Add a small pure presentation rule with a table covering working, attention, unread, error, and stale states. Keep this distinct from the server attention policy.
- [ ] Apply whole-row recession in `SessionRow` with full-weight interaction states. Preserve `ListRow` selection, listbox keyboard behavior, drag handles, snippets, and tooltips.
- [ ] Extend rail tests for projected state changes and keyboard selection. Ensure an active working row and a marked working row are clear.
- [ ] Add a `session-rail-attention` scenario and gallery example with simultaneous working and owner-needed rows. Capture hover, keyboard focus, selection, and coarse-pointer behavior.

## Verification and acceptance

Run the focused presentation tests and the relevant `apps/web/src/features/chat-mode/components/tests/session-rail.test.tsx` cases. Use actual session projections from the existing fixtures. An approval or error that arrives while a session is running immediately restores full weight. An unread completion remains prominent until the existing read action acknowledges it.

Run `bun run agent:browser scenario session-rail-attention` and `look` through host-local [heavy-runner](https://github.com/ShaulLavo/heavy-runner), configured in the local `fregat-local` skill. Read the screenshots back in light and dark themes. The finished unread row must be the clear focal point among working rows. Arrow-key navigation, selection, marking, hover, and dragging must remain readable. On touch, selecting a row restores full weight without requiring hover. Check the receded row's usable contrast and adjust the approved shared treatment if the measured theme combination fails.

## Delivery

Apply `typescript-best-practices`, the design rules, and `verify-fregat`. Run the narrow checks and required gates. Commit owned files, push, and `bun run install-release`. Record the deployed commit and read-back evidence in this plan and root roadmap. This plan makes no performance claim and requires no live-agent launch.
