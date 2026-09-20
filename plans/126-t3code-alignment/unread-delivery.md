# Unread and wake delivery

LIFE-07 implementation shipped in `20260920T132650Z-b915d3e0-plan126-live-delivery`.

Never-visited completed history is read. Normal visits advance monotonically using server
stamps; a visit before the first completion is recorded. Hidden documents do not acknowledge
completion until visible. Single-session and bulk mark-unread actions set the visit one
millisecond before completion, preserving environment ownership and existing persistence.

Wake timestamps preserve the early triggering event after the scheduled deadline. Timer
wakes survive ordinary visits; the row shows Woke and its menu offers Acknowledge wake.
The deadline has its own timer, independent of the minute-resolution relative-time clock.
Archive acknowledges the existing wake, settlement suppresses it, and send clears server
snooze. No new deadline event is written to the server.

## Verification

53 focused node and DOM tests pass across unread policy, scoped read storage, menu actions,
rail behavior, hidden-document completion, and actual server snooze with menu acknowledgment.
Client-core, web and scripts typechecks pass. Changed production files pass lint.

`scripts/parity/wake.ts` executes the pinned upstream `threadWokeAt` and local `sessionWokeAt`
on 189 shared timestamp cases. All match; a timer-first negative control is rejected. This
is a bounded paired comparison of wake timestamps, not complete lifecycle parity.

The mesh `session-unread` scenario passed on 2026-09-20. It used two disposable sessions and
one real-provider response, then deleted both sessions. All five screenshots were inspected:

- Completion after leaving produces an unread dot.
- Returning clears the dot.
- Manual unread survives reload while another session is open.
- Timer wake survives returning to the session.
- Explicit acknowledgment clears Woke while server snoozedUntil stays unchanged.

Evidence: `/work/tmp/fregat-evidence/20260920T132724Z-scenario-session-unread/`.

No warn/error application log events were recorded. Browser warnings included unavailable GPU
adapters, screenshot readback stalls, and two terminal sockets closed before opening during
session switching. The scenario completed without application errors.

## Remaining comparison scope

Background-tab visibility is covered by the real-provider-stack DOM hook test, not a live
background-tab browser drive. Native/mobile unread controls and complete upstream UI parity
remain unverified. LIFE-03 shelf presentation and LIFE-04 settlement actions remain separate
work; new settlement UI should acknowledge an existing wake when it explicitly parks a session.
