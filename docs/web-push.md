# Web Push from the mesh server

Delivery record for Plan 142 (completion wave, lane L5, 2026-09-25). The plan is done and deleted;
what remains is the owner checks and the owner question at the end of this file.

When a session needs input or completes, every device registered for push gets a notification,
with every Platform tab closed. Tapping it opens that session.

## How it works

- **One derivation, two deliveries (D1).** `packages/contracts/src/session-notices.ts` holds the
  notice derivation (`sessionNotificationTransition`, `sessionNotice`, the tab's tracker) and
  `sessionRailStatus`, which it needs. The tab's toast, sound and native path
  (`apps/web/src/features/chat-mode/state/`) and the server both import it. It moved out of
  `client-core` into `contracts` rather than behind a `client-core` subpath: `client-core` depends
  on the `server` package (for the `App` type), so the server importing `client-core` would close a
  package cycle. `contracts` is the layer both already sit on, and it already holds shared pure
  helpers. The tracker tests moved with the code (`packages/contracts/src/tests/session-notices.test.ts`),
  and `bun scripts/parity/notifications.ts` still compares the transition against T3 Code (900 cases).
- **Server delivery.** `apps/server/src/push/session-notices.ts` runs only while
  `chat.pushNotifications` is on (boolean, `application` scope, default off). It reads the same
  shell stream the tab reads, from a fresh snapshot each time it starts:
  `session-notice-feed.ts` treats the snapshot and any catch-up before `synchronized` as a silent
  baseline, so historical hydration, replay and boot recovery never notify (the stream starts after
  the engine's recovery), and an archived session never notifies (the transition's own rule). A
  session seen for the first time is baselined, as in the tab.
- **Suppression (D2).** The web app reports `{ kind: 'presence', focused }` over the orchestration
  WebSocket after each handshake and on every focus, blur and visibility change
  (`features/chat/transport/window-presence.ts`, `OrchestrationRpcClient`'s `presence` option).
  The server keeps the focused sockets (`orchestration/client-presence.ts`); a closed socket stops
  counting. While any window reports focused, the server records the notice as suppressed and sends
  nothing, because browsers expect every push to show a notification. The message is why the
  orchestration protocol is 8.
- **The push.** Title, body (the session title), tag (the scoped session key, the same tag the
  tab's native notification uses) and `path`, the session's route relative to the app base:
  `~<workspace token>/chat/t/<session id>` (`pushSessionPath`, pinned against the web address
  grammar in `features/address/tests/grammar.test.ts`). The server registers a workspace address
  for the session's worktree to build it; a worktree outside the served root gives an empty path,
  which opens the app. TTL one hour, urgency high.
- **Expired devices.** A 404 or 410 from the push service deletes the device row, for session
  notices and for Send test alike. Send test then reports `push.SUBSCRIPTION_EXPIRED` as a toast,
  since its row leaves the list.
- **Click.** `apps/web/public/sw.js` focuses a window already showing `…/chat/t/<id>` for the
  notice's session, or opens `<scope><path>`. The scope is the app base, so the mesh opens
  `/platform/~…/chat/t/<id>`. A notice without a session (Send test) focuses any app window.
- **Logs.** One `push.session_notice` wide event per notice: `kind`, `failed`, `focusedWindows`,
  `deviceCount`, `suppressed`, `link` (`session`, `no-worktree`, `outside-workspace`) and one
  `{ outcome, service, status, failure }` per device. No endpoint, key, session title or payload.
- **Settings.** Settings › Chat › Push notifications holds the switch above the device list. Each
  browser turns push on for itself with its button; the switch decides whether session notices go to
  the registered devices.

## Spike results (2026-09-25)

- `web-push` 3.6.7 runs under Bun 1.4.0 (D4), pinned; only `generateVAPIDKeys` and
  `generateRequestDetails` are called, and the request goes out through the injected fetcher. The
  library prints Node's `url.parse()` deprecation warning once per process.
- `sw.js` is served from the Vite base and registered with that base as scope: `/` in the lane
  Vite, `/platform/sw.js` with scope `/platform/` on the mesh. No `Service-Worker-Allowed` header.
  It handles only `push` and `notificationclick` and caches nothing, so it calls `skipWaiting()`.
- The worker is registered only from the Turn on button, never in the demo. When another worker
  controls the page (the demo's MSW), the section says so and sends no `/push` request. In dev both
  share scope `/`, so opening `/demo.html` after turning push on replaces the push worker; recover
  by unregistering it in DevTools › Application › Service workers. The mesh build has no demo.html.
- The manifest has `display: standalone`, `start_url` and `scope` of `./`, and 192 and 512 px icons.
  On iPhone and iPad outside the Home Screen the section says push needs the app on the Home Screen.

| Platform                      | Result                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Desktop Chromium (Playwright) | Worker registers, permission granted, `showNotification` works. A real subscribe fails (no push service in this build); the scenarios stub the subscription. |
| Desktop Firefox (Playwright)  | Worker registers, permission granted, `showNotification` works. A real subscribe fails: `AbortError: Error retrieving push subscription.`                    |
| iOS home-screen app           | Owner check pending.                                                                                                                                         |
| Android Chrome                | Owner check pending.                                                                                                                                         |

## Verification

- Server: `apps/server/src/push/tests/` (routes, feed, and session notices over the real app with
  the mock provider: sent and decrypted, setting off, focused client, disconnect, restart history,
  410), and the wide event in `observability/tests/runtime.test.ts`.
- Web: `features/settings/tests/push-section.test.tsx`, `features/chat/transport/tests/window-presence.test.tsx`.
- Browser: `scenario push-subscribe` and `scenario push-session-notice` (see the settings feature
  map). A script cannot make a trusted notification click, so the second records the worker's
  `openWindow` and `focus` calls and then loads the opened route.

## Owner checks

- iOS: on the iPhone, open `https://omarchy.mesh.shaulavo.dev/platform/`, Share › Add to Home
  Screen, open it from there, Settings › search "push", Turn on for this device, Send test. This
  also answers whether the Tailscale HTTPS origin is accepted.
- Android Chrome: the same without the Home Screen step.
- Desktop Chrome or Firefox against the mesh, with a real push service.
- Session notices: turn on Push session notifications, close every Platform tab, let a session
  finish, and tap the notification.

## Owner question

- The payload is end-to-end encrypted, but the push endpoint's host (Apple, Google or Mozilla,
  whichever the device's browser uses) learns when each notification is sent and roughly how large
  it is. Is that acceptable? Push stays off until a device turns it on and the switch is on.
