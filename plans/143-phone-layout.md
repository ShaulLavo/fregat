# Plan 143: Platform on a phone

## Status and authorization

- Status: DIRECTION APPROVED (owner, 2026-09-25); see "Direction" below. Research phase is next.
- Priority: P2. Large product question; Plan 142 (Web Push) delivers the first away-from-desk
  value without it.
- Effort: XL overall, unknown until the direction is set. The discussion itself is S.
- Risk: HIGH. The wrong scope turns a workbench into two half-products.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (Paseo,
  Orca, T3 Code).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless
  separately requested.

## Outcome

A written, owner-approved answer to "what is Platform for on a phone", and the executable plans
that follow from it. The owner's framing: a companion mobile app is a future thing; a phone
layout in the meantime, or both, sounds good; fitting the editor on a phone is currently
unimaginable. This plan does not design screens.

## What exists today

- The production build is already reachable from the owner's phone: the mesh serves it over
  Tailscale at `https://omarchy.mesh.shaulavo.dev/platform` (AGENTS.md, Deployment).
- `apps/web/index.html:6` has a standard viewport meta. There is no web app manifest and no
  service worker (the only `serviceWorker` is MSW in `apps/web/src/demo/start.ts:54`).
- No layout breakpoints. Responsive classes appear only inside dialogs, pickers and cards
  (`components/machine-form.tsx`, `features/settings/components/dialog.tsx`,
  `components/file-picker-dialog.tsx`, `sm:px-5` in `chat/components/timeline-viewport.tsx`).
  The workbench and chat-mode shells have none.
- Hover-only affordances already fall back for touch in places:
  `chat/components/message-bubble.tsx:149` gates on `[@media(hover:hover)]`.
- Notifications exist only inside an open tab: `chat-mode/state/notification-host.ts`,
  setting `chat.notificationMode`.
- Plan 126 tracks this as EXT-09 (`plans/126-t3code-alignment/adjacent.md:182`), P3, and says a
  mobile app needs its own delivery plan.
- `composer-mobile-enter-newline` was rejected in `docs/t3code-chat-parity-gap-analysis.md:423`
  because "there is no mobile target". That reason is stale once this plan picks a target.
- `docs/product-vision.md` does not mention phones.

## What the references do

| Reference | Phone client                                                                                          | Shape                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Paseo     | `packages/app`, one Expo codebase for iOS, Android **and web** (`"web"` script in its `package.json`) | Same client everywhere; pairing via Settings → host → Pair Device; relay in `packages/relay`    |
| Orca      | `mobile/`, React Native companion (`mobile/README.md`)                                                | Monitor worktrees, read terminal output, send commands; WebSocket RPC on port 6768 over the LAN |
| T3 Code   | `apps/mobile`, Expo dev-client app, not distributed yet (`apps/mobile/README.md`)                     | Feature folders include threads, diffs, review, terminal, usage, voice-input, connection        |

None of the three puts a code editor on the phone. All three treat the phone as a control
surface for agents running on a desk machine.

## Scope

In: deciding what the phone does, the order of web layout versus native app, and how they share
contracts. Out until approved: screens, components, breakpoints, a native app scaffold.

## Direction (owner-approved 2026-09-25)

- **Q1, scope.** Two clients with different jobs:
  - Native app (later): chat UI plus light review (per-file diffs, a turn's checkpoints, commit and PR state).
  - Phone web app (now): the same, plus viewing code. Editing is allowed but not optimized: the editor is the same component, so it
    works, just not comfortably.
- **Q2, order.** Responsive web now; the native app later, against the same server contracts.
- **Q3, shell.** One URL, two shells. The app root picks a phone shell or the workbench at boot from one synchronous check
  (viewport width plus `pointer: coarse`) and imports only that shell as a lazy chunk. The typed boot script in `index.html` adds a
  `modulepreload` for the chosen chunk so the choice costs no extra round trip. The phone shell is its own composition, not a
  collapsed workbench. It reuses the real features and stores (chat stage, session list, diff view, the editor as a leaf screen)
  inside stack navigation: sessions → session → turn → diff or file. That navigation is also the spec for the native app.
  Desktop panes get no narrow-width work. A lazy `/m` route is the fallback if the boot switch proves awkward.
- **Switching shells at runtime.** Listen for the breakpoint with `matchMedia`, not on every resize. The first time the
  breakpoint is crossed, lazy-load the other shell's chunk and keep the current shell on screen until it's ready (no blank
  frame). After that, both shells are cached and switching is instant. State lives above the shells (stores, the query cache,
  `lib/keep-alive` for terminals), so a switch loses no drafts and parks terminals instead of detaching them.
  The phone shell applies when the pointer is coarse or the viewport is narrow, so rotating a phone (~850px landscape) never flips
  to the workbench. Use different widths for entering and leaving (hysteresis) so a window near the edge doesn't flap. A narrow
  desktop window gets the phone shell, which is handy for testing. No speculative prefetch of the other shell: a phone must never
  download the workbench.
- **Q4, connecting.** Three ways, like T3 Code:
  1. Direct over the local network or Tailscale (now). Add T3's pairing URL: the desktop shows a one-time link or QR code
     that authorizes a new device.
  2. SSH (exists as SSH machines): transport plus server bootstrap for desktop-to-remote-machine setups; not a phone path.
  3. Relay (future): a hosted rendezvous for people without Tailscale, like T3 Connect (Cloudflare tunnels plus accounts).
     WebRTC was considered and rejected: it still needs signaling plus TURN relays, which Tailscale already provides.
- **Q5, input.** Revisit Enter-on-touch with the phone shell; voice dictation gets its own plan.

## Questions for the owner (answered above)

- **Q1 — What is the phone for?**
  - A: control surface — see session state, answer approvals and questions, read replies and
    diffs, send a prompt or steer.
  - B: A plus light review — per-file diffs, the turn's checkpoints, commit and PR state.
  - C: A, B and editing code.
  - Recommendation: B. Every reference stops there; C conflicts with the owner's own read.
- **Q2 — Web layout first, native app first, or both?**
  - A: responsive web layout now, companion app later against the same server contracts.
  - B: native app now, desktop web unchanged.
  - C: one cross-platform client for both, as Paseo does with Expo web.
  - Recommendation: A. The mesh already serves the web app to the phone, Plan 142 needs only a
    manifest, and a native app can come later without redoing the server.
- **Q3 — One adaptive app or a separate phone surface?**
  - A: the workbench collapses into a phone shell at narrow widths.
  - B: a separate route (for example `/m`) built from the same features and stores.
  - Recommendation: decide after Q1. If the answer is B-scope, a separate shell is likely
    simpler than teaching every pane to collapse.
- **Q4 — Reaching the server from the phone.** The mesh answers it today over Tailscale.
  Is Tailscale-only acceptable for the companion app, or does it need a relay or pairing?
  Recommendation: Tailscale only; hosted relays are on the do-not-copy list.
- **Q5 — Input on the phone.** Voice dictation (Paseo, Orca and T3 all have it), and whether
  Enter sends or inserts a newline on touch keyboards (the stale rejection above).
  Recommendation: revisit Enter behaviour with the layout; defer voice to its own plan.

## Research phase

Questions:

1. Which workbench surfaces does the chosen Q1 scope need, and which of their components already
   render at 390 px? Measure with `bun run agent:browser look` at a phone viewport against the
   dev server; record what breaks.
2. What do the reference phone clients put on their first screen, and how do they navigate
   between sessions, a turn, and its diff? Read Paseo `packages/app/src`, Orca `mobile/app`,
   T3 `apps/mobile/src/features` and summarise navigation, not visuals.
3. Which server contracts would a native app need that the web app reaches in-process or through
   browser-only APIs? Start from `packages/contracts` and the WebSocket surfaces listed in
   `docs/native-plan-of-plans.md` plan 3.
4. Which interactions are hover- or keyboard-only (tooltips, context menus, chords) and need a
   touch path?

Deliverable: the surface list and navigation model, added to this plan (the direction is already above). After the owner approves it, this plan is split into executable plans
(likely: phone shell, per-surface adaptations, touch input, and a later companion-app plan).

## Phases

Written after the research phase.

## Dependencies

- Plan 142 (Web Push) needs a minimal web app manifest and must not wait on this plan.
- A companion app would consume the same contracts as `docs/native-plan-of-plans.md` plan 3.

## Out of scope and not copied

- An editor on the phone.
- A hosted relay or third-party pairing service (Paseo relay, T3 Connect): the mesh already
  reaches the phone.
- A third-party push service (Expo push): Plan 142 uses standard Web Push.
- An offline outbox (T3 mobile) before the phone surface exists.
