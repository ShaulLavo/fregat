# LIFE-08 search delivery

The shared rail queries each represented connected environment through its own QueryClient. Results use scoped session keys, owner failures remain visible beside successful matches, and a new query clears old matches immediately. Generation checks reject late responses. The search observer lifetime does not subscribe the rail to streaming session objects.

## Evidence

- Focused query, observer, hook, rail filtering and streaming regression batch: 26 tests passed. Two real in-process servers share a session ID but hold different message text; tests verify owner routing, disconnect partial results and delayed old-response rejection.
- Live `session-search` on mesh web release `20260920T135934Z-b915d3e0-plan126-row-navigation`, server release `20260920T135727Z-b915d3e0-plan126-lifecycle-search`: passed. Evidence: `/work/tmp/fregat-evidence/20260920T140044Z-scenario-session-search/`. All three screenshots were inspected: message-only match with snippet, stale match removed after new query, and cached query returning the correct owner.
- The disposable fixture `4445e2a0-dcf3-491e-8ad4-27ecd8e6bd62` was deleted in the completed scenario's `finally`. No application warn/error logs occurred; headless graphics adapter/readback warnings remained.
- The preceding live attempt exposed a shared row bug: drag-disabled attributes marked selectable rows disabled. The root fixed it and deployed the successful follow-up above. Its fixture was also deleted; failure evidence is `/work/tmp/fregat-evidence/20260920T135811Z-scenario-session-search/`.

## Remaining proof

The mesh has one represented connected owner. `session-search-environments` stopped at its two-owner prerequisite before creating fixtures: `/work/tmp/fregat-evidence/20260920T133846Z-scenario-session-search-environments/`. The two-owner live matrix remains open; the real two-server tests do not substitute for it. No pinned-upstream runtime comparison has been performed for the complete search flow. LIFE-08 must not be promoted to full verified parity from this delivery.
