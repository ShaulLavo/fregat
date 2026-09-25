# Plan 143: Platform on a phone

## Status and authorization

- Status: DIRECTION APPROVED (owner, 2026-09-25); research done 2026-09-25 (see "Research
  findings"). Next: owner answers the four questions there, then the split into executable plans.
  iPhone (WebKit) behaviour is unmeasured: Playwright WebKit does not start on this host.
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
  Decided 2026-09-25: owner — Enter-on-touch ships now, ahead of the phone shell, as Plan 126
  INTERACTION-11's mobile plain-Enter newline (upstream's coarse-pointer rule). Voice is unchanged.

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
5. **The pairing URL (Q4).** How does T3 Code authorize a new device? Read
   `references/t3code/docs/internals/remote.md` (hosted pairing URL: secret in the fragment,
   exchanged with the environment, stripped from history), `docs/internals/environment-auth.md`
   (scoped sessions, pairing delegates scopes and cannot widen them) and the `vp run dev --share …
pairingUrl` flow in its `AGENTS.md`. Record what we copy: the link or QR format, token lifetime
   and scopes, and where the server stores paired devices.
6. **The native app's technology.** SwiftUI (`apps/mac` is already a native Swift client) or
   Expo / React Native (Paseo, Orca and T3 all use React Native). Decided later; recorded now
   because it shapes which server contracts the phone shell settles first.
7. Two clients opening one workspace at once: see [Plan 173](173-two-devices-one-workspace.md).

Deliverable: the surface list and navigation model, added to this plan (the direction is already above). After the owner approves it, this plan is split into executable plans
(likely: phone shell, per-surface adaptations, touch input, and a later companion-app plan).

## Research findings (2026-09-25)

Read from `origin/main` at `9f343825` (the lane branches carry an older copy without the
Direction). References: Paseo `8cd98952`, Orca `01ed4b92`, T3 Code `7a12aff4`.

Measured against this worktree's own Vite on port 5391, started and stopped through the heavy-slot
wrapper, each run against a throwaway API server:

- `agent:browser look` and 14 scenarios at `--width 390 --height 844 --scale 2`. Evidence:
  `/work/tmp/fregat-evidence/20260925T18*` and `20260925T19*` (`session-rail`, `chat-turn-anatomy`,
  `checkpoint-states`, `async-questions`, `chat-draft-context-strip`, `git-changes`, `editor-find`,
  `command-palette-type-burst`, `chat-usage-meter`, `settings-responsive`, …).
- A layout probe, `/work/tmp/research/143/probe.ts` (results in `probe/results.json` beside it).
  It emulates a touch phone (`isMobile`, `hasTouch`) at 390×844 and 844×390, with 1440×1000 as the
  control, and records scroll widths, panel rects, target sizes and field font sizes. `look` has
  no touch emulation, so the probe fills that gap.

Scenario failures were not caused by width. `git-changes` and `chat-git-turn-rows` need a dirty
default workspace (the screenshot says "Working tree clean"), `session-actions-surfaces` needs a
project default model, and `approval-rules` is not a scenario name. `async-questions` (a selector
matched 3 elements) and `chat-usage-meter` were not rerun at desktop width, so their failures stay
unattributed.

### Q1: surfaces the approved scope needs, and what breaks at 390px

**The one thing that breaks everything.** `features/workspace/components/view.tsx:21-22` wraps
both modes in `overflow-auto` around `min-w-[1024px]`. The probe measured an inner scroller of
1024px inside a 390px viewport, and the same inside an 844px landscape phone, in both modes. The
document does not scroll (`documentElement.scrollWidth` is 390); the app shell does. Chat mode then
lays out its three panels at their minimums: sessions 220, stage 360, tools 400 (x = 0, 224, 588).
Every other breakage below is secondary.

**The components themselves mostly fit.** The stage renders at its 360px minimum without
clipping: the turn anatomy, plan card, question card and composer screenshots are readable. The
session rail reads well at 220px. The Turn file list, the settings dialog (`settings-responsive`
passes) and the editor all fit in a single column. So the phone shell is composition work. It does
not need a component rewrite.

| Screen (stack level) | Reuses                                                                                                                   | At 390px today                                                                                             | Needs                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Sessions (root)      | `chat-mode/components/session-rail.tsx` and its rows, search, groups, bulk bar, machine chips                            | Renders at 220px; search field is 12px                                                                     | Full-width host; 16px field; row menu by long-press (it already uses the Base UI trigger path) |
| New session (draft)  | `stage-empty-state.tsx`, draft context strip, composer, model/effort pickers                                             | Fits; strip and menus open (`chat-draft-context-strip` passes)                                             | Pickers as bottom sheets                                                                       |
| Session              | `chat-stage.tsx`, `stage-header.tsx`, timeline, composer, approval and question cards, plan card                         | Fits at 360px. Header crowds: breadcrumb, branch, title, PR chip and status share one bar and truncate     | Phone header: back, title, status, overflow menu. Composer keyboard handling                   |
| Turn / Changes       | `chat-mode/components/turn-files.tsx`, the chat Git tool's Working tree and Turn scopes, checkpoint state, revert dialog | Fits; the file row's stat and status letter clip at the right edge                                         | Scope switcher (turn, session, working tree, branch); commit and PR state here                 |
| Diff                 | checkpoint diff document (`chat/utils/checkpoint-diff-query.ts`) in the editor diff pane                                 | `chat-diff-syntax` timed out before a diff row painted; unattributed                                       | Unified layout by default on the phone; previous/next file                                     |
| File (leaf)          | the editor, read-mostly                                                                                                  | Usable: text, gutter and find work (`editor-find` passes); the find widget clips off the right edge        | Nothing beyond the frame, per the Direction                                                    |
| Sheets               | command palette, quick open, session menu, settings dialog, toasts                                                       | Palette fits (`command-palette-type-burst` passes); settings is already full-height with safe-area padding | Palette reachable from a button, not only a chord                                              |

Out of the first cut: the workbench panes, search, logs, problems, the file tree and the terminal
(Owner question 2).

**Found alongside the frame:**

- Focus zoom. iOS Safari zooms the page when a field under 16px takes focus. The probe measured
  the composer (`Message`) at 14px, `Search sessions` at 12px and `Commit message` at 12px. The
  terminal input is 16px. Needs a device check; the rule is WebKit's, and the host cannot run
  WebKit.
- Targets. In chat mode 36 of 37 visible controls are under 44px and 4 are under 24px (WCAG 2.2
  target minimum). The workbench has 16 of 16 under 44px. The phone shell needs a density step
  (the `--density-*` system) rather than per-call-site sizes.
- Viewport. `index.html:6` has no `viewport-fit=cover` and no `interactive-widget`. Safe-area
  insets appear only in `settings/components/dialog.tsx:56`. `components/app-shell.tsx:33` uses
  `h-svh`, so the on-screen keyboard covers the bottom composer on iOS. The composer needs
  `visualViewport` tracking on WebKit, or `interactive-widget=resizes-content` on Chromium.
- Chunks. `view.tsx:3,5` imports `ChatModeSurfaceView` and `EditorSurfaceLayoutView` statically,
  so today both modes ship in one chunk. The Direction's rule that "a phone must never download the
  workbench" needs both behind `lazy()` at this switch.
- Where the shell switch goes. `WorkspaceView` owns `GitStoreProvider`, `SearchRuntime`,
  `KeepAliveProvider` and `SessionDialogs` (`view.tsx:18-35`) around the mode switch. The phone
  shell is a third branch of that switch, inside `KeepAliveProvider`, and outside the
  `min-w-[1024px]` wrapper. That puts the state above the shells, as the Direction requires,
  without moving any provider.
- Tooling. `agent:browser look` and `scenario` need a touch flag (`isMobile` and `hasTouch` in
  `browser.ts:606`). Without it, a `(pointer: coarse)` shell switch cannot be driven, and neither
  can the long-press paths below.

### The navigation model

A stack of four levels, with sheets for choices. Every level is a projection of the address URL
(`packages/client-core/src/address/grammar.ts`), so the browser back gesture, a push-notification
deep link and a shared link all work the same way, and the native app can reuse the model as its
route table:

| Level       | Address fields                                          | Pushed by                                                                     |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0. Sessions | `mode=chat`, no `chat`                                  | cold start; Back from a session                                               |
| 1. Session  | `chat=<session>`                                        | a row; a notification; New session (the draft is level 1 with no session yet) |
| 2. Turn     | `chat` + `diff=<scope>` (a turn, session, working tree) | a turn's changed-files summary; the header's Changes action                   |
| 3. Diff     | level 2 + `editor=<diff document>`                      | a file row                                                                    |
| 3. File     | `chat` + `editor=<file>` (+ `focus` line)               | Open file from a diff; a file link in a reply; quick open                     |

- Level 0 lists sessions across machines and projects, with the ones that need you first
  (approval, question, finished and unread), then pinned, then the rest. Row actions come from a
  long-press or an overflow button.
- Level 1 is the stage alone: header (Back, title, status, overflow), timeline, and a composer
  pinned above the keyboard. Approvals and questions stay inline, with a sticky "Waiting for you"
  chip that scrolls to them when they are off screen.
- Level 2 lists files with a scope switcher; checkpoint revert and commit/PR state live here.
- Level 3 shows one diff or file, with previous/next file inside the same scope.
- Pickers, menus, the palette and settings are sheets. They are not stack levels, and Back
  closes them first.

What the references do, which this model follows:

- **T3 mobile** (`apps/mobile/src/Stack.tsx`; `docs/internals/mobile-navigation.md`). The first
  screen is Home, a thread list across environments grouped by project, with swipe actions and a
  new-task button. A thread pushes `Thread`. Review is a pushed route (`thread/:id/review`); its
  section menu is Working tree, Branch changes, Latest turn, then earlier turns
  (`features/review/review-section-menu.ts`). Git overview, commit, files
  (`thread/:id/files/:path*`) and terminal are further routes and sheets. iPad adds a sidebar
  stack. This is the closest match; level 2's scope switcher is its section menu.
- **Orca mobile** (`mobile/app/h/[hostId]/…`). The first screen is the host list (pair a
  desktop), then the host's worktree list. A worktree pushes `session/[worktreeId]` (terminal and
  chat tabs). Panel icons push full-screen `source-control` (Changes and PR segments), `files`,
  `review` and `agent-history` on a narrow layout, and dock one panel on a wide one
  (`src/session/session-panel-host.ts:46-73`).
- **Paseo** (`packages/app/src/mobile-panels/`, `docs/mobile-panels.md`). It is the exception: a
  compact layout (<720px, `constants/layout.ts:42`) is three horizontal destinations. Agent list is
  on the left, the agent in the centre and the Explorer (Changes, Files, PR) on the right, all
  driven by one swipe position. A cold start opens the last workspace's agent. A tab switcher
  replaces tabs. It has no stack depth, so a diff is an Explorer overlay that closes when a file
  opens (`docs/explorer-sidebar.md`).

Recommendation: the stack (T3, Orca), not Paseo's swipe panels. A stack maps onto the address URL
and browser history. Swipe panels fight the browser's own edge-swipe back gesture on iOS.

### Q3: server contracts a native app would need

What already exists and is enough:

- `/orchestration/rpc` over WebSocket. It is Valibot-schema'd (`packages/contracts/src/orchestration-ws.ts:133-175`)
  and carries `dispatchCommand`, `sessionDetailPage`, `replayEvents`, `serverConfig`,
  `subscribeShell` and `subscribeSession`. Every session action in scope is a command: turn
  start, steer, interrupt, approval respond, user-input respond, checkpoint revert, pin, snooze,
  archive.
- Diffs are computed on the server. `GitFileDiff` carries `patch` and `hunks`
  (`contracts/src/git.ts:55-67`), and checkpoint diffs are an HTTP read.
- Attachments upload, provider usage, settings with their events stream, and `/release` are all
  HTTP.

Gaps, roughly in the order a native app would hit them:

1. **Authentication.** The server has an exact `Origin` allowlist and nothing else
   (`apps/server/src/auth.ts:108-116`). Any non-browser client can send an allowed `Origin`. The
   TUI does so in production with a fixed value (`apps/tui/src/main.tsx:33`). On the mesh, the
   tailnet is the real gate. A native app on the tailnet would work the same way today, but
   there are no sessions to revoke. This is milestone M4 in `docs/environments-and-remote-plan.md` §4.
2. **Push.** Notices are computed and shown only in an open tab
   (`chat-mode/state/notification-host.ts`, `client-core/chat/notifications.ts`). Plan 142 adds
   Web Push. A native app needs APNs (and FCM for Android) plus device-token registration. Plan
   142's subscription record should carry a `kind` so an APNs token fits later without a second
   table.
3. **Schemas outside orchestration.** REST is typed only through Eden's TypeScript `App` type.
   Terminal, watch events and search are hand-parsed TypeScript unions
   (`docs/native-plan-of-plans.md`, plan 3 row). A TypeScript client imports them as they are. A
   Swift client needs plan 3's OpenAPI and JSON Schema emission first; plan 3 is not started.
4. **Highlighting.** The web client highlights with tree-sitter WASM and Shiki in the browser.
   Hermes (React Native) has no WebAssembly, so a native diff view needs Shiki's JavaScript engine
   (T3 mobile does this: `features/review/shikiReviewHighlighter.ts`), or tokens from the server.
5. **Version skew.** A store-installed app outlives server deploys. The `connected` frame and
   `/release` need a protocol or capability version that the client checks (T3:
   `docs/internals/remote.md`, "Clients must use advertised capabilities"). This fits Plan 150.
6. **Device-local state.** Composer drafts and the prompt stash live in browser storage. That is
   acceptable. A draft started on the desk does not follow you to the phone, and no plan
   proposes that it should.

### Q4: hover- and keyboard-only interactions that need a touch path

| Interaction                         | Where                                                                                                                                                                                                                          | Touch path                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context menus opened at the pointer | 8 call sites of `useContextMenu().openAtEvent` (`keymap/menus/hooks/use-context-menu.ts:35`): message bubble, markdown link, git change row and group header, editor frame, search results, terminal                           | iOS Safari fires no `contextmenu` on long-press; Android Chrome does. Base UI's trigger has a 500ms long-press (`ContextMenuTrigger.js:21`), but this anchor path bypasses it. Add long-press once in `useContextMenu` so every surface gets it |
| Menus through a Base UI trigger     | session row, project menu, tree row menu, tab menus                                                                                                                                                                            | Long-press already works; add an overflow button in the phone rows so the menu can be found                                                                                                                                                     |
| Controls revealed on hover          | git `action-cluster.tsx:14-17` (stage, unstage, discard), search `match-row.tsx:116`, `prompt-stash-menu.tsx:48`, `tab-trailing-slot.tsx:76`, `wallpaper-card.tsx:61`                                                          | Show at rest on `(hover: none)`. `message-bubble.tsx:160,195` already gates on `[@media(hover:hover)]`, and that is the pattern to copy                                                                                                         |
| Explanatory tooltips                | `Tooltip` in 64 files, `data-tooltip` in 5. Icon-only controls keep their `aria-label`, but the explanation is lost; e.g. the usage meter's "Weekly 83% used, resets in 5d 5h" shows on hover only (`chat-usage-meter` step 3) | Tap opens the same content as a popover on coarse pointers; icon-only labels need nothing                                                                                                                                                       |
| Truncation recovery by `title`      | `title=` in 126 files                                                                                                                                                                                                          | No touch equivalent. The phone rows wrap, or the pushed screen shows the full value                                                                                                                                                             |
| Drag to reorder the rail            | `use-rail-drag-sensors.ts:27`: `PointerSensor` with a 6px distance                                                                                                                                                             | A vertical swipe to scroll the list starts a drag instead. Use a `TouchSensor` with a press delay, or no reordering in the phone shell                                                                                                          |
| Chords with no control              | chat commands in `client-core/commands/chat.ts`: stash and restore prompt, previous and next prompt, prompt undo and redo, prompt inbox, export transcript                                                                     | A palette button in the session header's overflow menu covers the long tail                                                                                                                                                                     |
| Hover prefetch, double-click        | file tree and tab intent prefetch; file-picker rows, terminal rename                                                                                                                                                           | Prefetch simply does not happen, which costs nothing. The double-click surfaces are outside the phone scope                                                                                                                                     |

### Q5: the pairing URL

How T3 Code does it (`references/t3code`):

- The host issues a one-time pairing credential. It lasts 5 minutes by default
  (`apps/server/src/auth/PairingGrantStore.ts:239`) and is consumed atomically:
  `UPDATE … SET consumed_at … AND consumed_at IS NULL` (`persistence/AuthPairingLinks.ts:162-168`).
- The link is `<server>/pair#token=<credential>` (`startupAccess.ts:92-97`). The token rides in the
  fragment, so it never reaches the server's request log or a hosted origin. The page strips it
  from history and exchanges it through `POST /api/auth/browser-session` for a cookie. Native
  clients exchange it for a bearer or DPoP token instead.
- Bearer clients open sockets with a WebSocket ticket that lasts 5 minutes
  (`SessionStore.ts:424`, `/api/auth/websocket-ticket`), so long-lived tokens stay out of socket
  URLs. Sessions last 30 days (`SessionStore.ts:423`).
- A pairing grant can narrow scopes but never widen them, and it cannot mint further pairing
  links (`docs/internals/environment-auth.md`). The access list shows metadata and never
  recoverable secrets. A link can be copied only while the Connections page that created it stays
  open.
- The UI is Settings → Connections → Network access → create a link, shown as a QR code and a
  URL. There is a paired-clients list with revoke. `t3 pair` prints a fresh link, and the
  development `--share` flag prints `pairingUrl:` (T3 `AGENTS.md:82`).

Orca's offer is a QR payload of endpoint, device token and the desktop's public key, for an
end-to-end encrypted channel (`src/shared/mobile-relay-pairing-offer.ts:72-78`). Paseo's is a
relay-only offer with the daemon's public key (`packages/protocol/src/connection-offer.ts`).
Both fit a relay, which is the future third path.

What we would copy:

- One-time, short-lived, atomically consumed credentials.
- The token in a URL fragment, exchanged for an `HttpOnly` cookie in the browser, or a
  Keychain-held bearer plus a socket ticket for a native app.
- Scope narrowing.
- A QR code and link shown only in the desktop UI (Settings → Machines), with a paired-devices
  list, last-seen times and revoke.

What we would not copy, per `docs/environments-and-remote-plan.md` §7: the pairing URL in a
startup log, plaintext LAN pairing, bearer tokens in `localStorage`, and accounts or relays. DPoP
can wait.

The prerequisite is the M4 session model (§4; the earlier design is at
`docs/environments-and-remote-plan.md@1325b003`). Once sessions exist, the origin check stops being
the whole guard.

Recommendation: pairing ships with the first client or path that does not already sit behind
tailnet identity, meaning the native app or direct LAN. It does not ship with the phone web shell,
which the mesh serves only to tailnet devices. See Owner question 3.

### Q6: native app technology

|      | SwiftUI (beside `apps/mac`)                                                                                                                                                                                                                                                                                                                | Expo / React Native                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pros | Best platform feel, including the UIKit header transitions T3 patches `react-native-screens` to keep (`docs/internals/mobile-navigation.md`). Swift 6 toolchain and doctrine already exist in `apps/mac`, and `EditorCore` could later render a native code view. No JS runtime or bridge. APNs is first-class.                            | Reuses `@workspace/client-core` (100 files, 15.6k lines) and `@workspace/contracts` as they are. Their dependencies are Valibot, TanStack query-core, zustand/vanilla and Eden, and they already run outside the browser: the TUI renders them through OpenTUI React. That includes the 7k-line chat state (`client-core/src/chat`: selectors, pending approvals and user input, notices, writers). Android comes for free. JS iterates from this Linux host against a dev client. It is the choice of all three references. |
| Cons | `apps/mac` has no server client yet: it is `EditorCore`, a bench and a stub window, and plan 3 (OpenAPI and Codable generation) is not started. The chat state layer would be rewritten in Swift and then kept in step with the TypeScript one forever. iOS only. Every build and run needs the Mac, so agents on this host cannot run it. | A third UI stack: React Native primitives, with none of `@workspace/ui`, Tailwind or the design census. No WebAssembly in Hermes, so no tree-sitter or ghostty-webgpu. Expo SDK upgrade churn. iOS builds still need the Mac or a hosted build service. Push goes through `expo-notifications` raw device tokens, which avoids Expo's push service (on the do-not-copy list).                                                                                                                                                |

A third shape exists. Since 2026-09-18, Orca's native app can host a mobile web bundle served by
the desktop, as an over-the-air "hybrid shell": a WKWebView on a private origin behind a bridge
(Orca `b749091b`, `f2be6299`; `mobile/src/mobile-web-shell/`). That native wrapper around the
phone web shell is the cheapest native app: it adds APNs, Keychain, the share sheet and haptics,
and reuses every screen above.

Recommendation, for the later decision: Expo / React Native if the native app gets its own
screens, because the chat state it needs already exists as runtime-neutral TypeScript. Consider
the Orca-style wrapper around the phone web shell first; if it covers push and pairing, the app
may never need its own screens. Choose SwiftUI only if the app should share `EditorCore` for
native code viewing, which the Direction leaves to the web app.

### Owner questions

1. **First screen.** A: always the session list, with deep links opening a session directly (T3,
   Orca). B: resume the last session (Paseo). Recommendation: A. The phone's job is triage, and a
   notification tap already lands on the session.
2. **Terminal on the phone web app.** The Direction names chat, light review and viewing code. A:
   no terminal in the first cut. B: a read-only terminal as a level-3 screen. C: an interactive
   terminal. Recommendation: A. `lib/keep-alive` still parks desktop terminals across a shell
   switch, so nothing is lost.
3. **When pairing ships.** A: with the phone web shell. B: with the first client or path outside
   the tailnet (the native app or direct LAN). Recommendation: B. The mesh already admits only
   tailnet devices; pairing needs the M4 session model and adds nothing there yet.
4. **Which phones.** Is the target iPhone only, or Android too? This decides whether SwiftUI stays
   a real option, and whether WebKit testing needs a device before the first phone plan lands.
   Recommendation: say which phone you carry; it changes only the native decision.

### Proposed phases

The split this plan promised:

1. **Phone shell frame** (M). The boot switch, lazy chunks for both shells, `matchMedia`
   hysteresis, the viewport meta, safe areas, keyboard-aware bottom insets, and the address-driven
   stack with Back. Add a touch flag to `agent:browser` first, so every later phase can be proven
   at 390px with a coarse pointer.
2. **Screens** (L). Sessions, session, turn/changes and diff/file, composed from the components in
   the Q1 table; 16px fields and a phone density step.
3. **Touch paths** (M). Long-press in `useContextMenu`, hover-revealed controls shown at rest on
   `(hover: none)`, tap-to-open explanatory tooltips, the rail drag sensor, and a palette button.
   Parts of this help the desktop with a touchscreen too.
4. **Haptics** (S, the follow-up item below) and a device check on the iPhone through the mesh.
5. Later, each in its own plan: pairing (M4 sessions first), then the companion app.

## Phases

See "Proposed phases" under Research findings. Executable plans follow the owner's answers.

## Follow-up items

Carried in from other plans. They wait for the phone shell and join its split plans.

- **Phone haptics (from Plan 154 Phase 7).** Only if this plan keeps the phone web layout.
  `navigator.vibrate` on Android with seamui's PWM patterns, and the iOS
  `<input type="checkbox" switch>` taptic, behind `workbench.haptics`. Haptics follow device
  capability, so a shared setting does nothing on a desktop. Size S. Plan 154 Decision D3 keeps
  haptics as the only mobile difference in physical mode.

## Dependencies

- Plan 142 (Web Push) needs a minimal web app manifest and must not wait on this plan.
- A companion app would consume the same contracts as `docs/native-plan-of-plans.md` plan 3.

## Out of scope and not copied

- An editor on the phone.
- A hosted relay or third-party pairing service (Paseo relay, T3 Connect): the mesh already
  reaches the phone.
- A third-party push service (Expo push): Plan 142 uses standard Web Push.
- An offline outbox (T3 mobile) before the phone surface exists.
