# Plan 142: Web Push notifications from the mesh server

## Status and authorization

- Status: SPIKE AND PHASE 1 IMPLEMENTED (2026-09-25, completion wave lane L5, branch
  `lane/L5-push`). Phase 2 (session notices) is next. The phone checks are owner checks, pending.
- Priority: P1. It is the first piece of working away from the desk.
- Effort: M.
- Risk: MED. A service worker outlives deploys and caches badly if it does anything but push.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (Paseo,
  Orca, T3 Code).
- Work happens in the completion wave's lane L5 worktree and lands through the lane's pull request.

## Outcome

When a session completes or needs input, the owner's phone or laptop shows a notification even
with every Platform tab closed. Tapping it opens that session.

## What exists today

- Notices are derived in the browser. `packages/client-core/src/chat/notifications.ts` turns
  session transitions into a `SessionNotice` (`kind: 'input' | 'completion'`, title, body, scoped
  session ref).
- `apps/web/src/features/chat-mode/state/notification-host.ts` delivers them: a toast when the tab
  is focused on another session, a native `Notification` only when the tab is not focused, a sound
  when enabled, and a favicon badge.
- The setting is `chat.notificationMode` (`packages/contracts/src/settings/keys.ts:99`):
  `off | notifications | sound | notifications-and-sound`, `application` scope, default `off`.
  `chat.inAppNotificationsEnabled` controls the toasts.
- Phase 1 added `apps/web/public/manifest.webmanifest`, `apps/web/public/sw.js` (`push` and
  `notificationclick`, plus `skipWaiting()` on install; no fetch handler, no caches) and `apps/web/public/icons/`, linked from `apps/web/index.html`. Demo
  mode still registers MSW's `mockServiceWorker.js` at the asset base (`apps/web/src/demo/start.ts`);
  the push worker is never registered there (see the spike note).
- The secret store (`apps/server/src/settings/secrets.ts`) has a second ref kind,
  `ServerSecretRef`, for secrets the server generates. `push.vapid.privateKey` is the only one.
  `SettingsStore.ensureSecret` creates it on first use under the settings write coordinator.
- `apps/server/src/push/`: `PushService` (list, register, remove, test send), `pushRoutes`
  (`GET`/`POST /push/devices`, `DELETE /push/devices/:id`, `POST /push/devices/:id/test`),
  `deliverPush` (encrypt, sign, post; returns the outcome and never throws), the `push` error
  catalog, and the `push_devices` table (migration 25). The push-service boundary is
  `AppOptions.push.fetcher`.
- `packages/contracts/src/push.ts`: the wire schemas, `PushNotice` (the payload the worker reads)
  and `pushDeviceId(endpoint)`, which server and browser both derive.
- Settings › Chat has a Push notifications section (`features/settings/components/push-section.tsx`).
- The server does not import `@workspace/client-core`, so it cannot run today's notice derivation.
- Session routes are `chat/t/$sessionId` (`apps/web/src/state/routes/chat.ts`). The mesh serves
  the app under `/platform`.

## What the references do

| Reference | Feature                                    | Paths                                                                                     |
| --------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Paseo     | Server push through Expo to its mobile app | `packages/server/src/server/push/push-service.ts`, `packages/app/src/push-notifications/` |
| Orca      | Mobile companion notifications             | `mobile/`                                                                                 |

Both push to a native app through a vendor service. Platform has no native app yet, and standard
Web Push reaches browsers and installed web apps directly from the mesh server.

Claude Code's own `PushNotification` tool pushes to the Claude app for one Claude session. It is
not a substitute: it covers neither Codex nor Platform's session model, and it does not deep-link
into Platform.

## Scope

- A service worker that only handles `push` and `notificationclick` (install only calls
  `skipWaiting()`). No caching, no offline.
- A minimal web app manifest, because iOS Safari delivers Web Push only to a web app added to the
  home screen.
- VAPID keys generated once on the server and kept in the secret store.
- Per-device subscriptions stored by the server, with add, list and remove.
- Server-side notice derivation on the same transitions the browser uses.
- Suppression when the owner is already looking, and a deep link on click.

## Decisions

- **D1 — Where notices are derived.** Recommended: move the pure transition logic out of
  `client-core` into a package the server can import, and derive on the server for push. The tab
  keeps its toast and sound path. One derivation, two deliveries.
  Decided 2026-09-25: recommendation (completion wave). Built in Phase 2.
- **D2 — How a push is suppressed when the owner is looking.** Recommended: the server skips the
  push when a connected client reports a visible, focused window for that environment over the
  existing socket. Checking `clients.matchAll()` inside the service worker is not enough on its
  own: browsers expect every push to show a notification (`userVisibleOnly`), and Safari can
  revoke a subscription that stays silent.
  Decided 2026-09-25: recommendation (completion wave). Built in Phase 2.
- **D3 — Settings.** Recommended: one new registry entry, `chat.pushNotifications` (boolean,
  `application` scope), registered in the same pass as the server code that reads it.
  Subscriptions are device records, not settings. Permission is requested from a button, since
  browsers require a user gesture.
  Decided 2026-09-25: recommendation (completion wave). Phase 1 stores devices in `push_devices`
  and asks permission from the Turn on button. `chat.pushNotifications` is registered in Phase 2,
  with the server code that reads it.
- **D4 — Library.** Recommended: the `web-push` package if it runs under Bun. Otherwise VAPID
  signing plus `aes128gcm` payload encryption (RFC 8291) on WebCrypto. The spike decides.
  Decided 2026-09-25: recommendation (completion wave). `web-push` 3.6.7 runs under Bun, so the
  server uses it, pinned. Only `generateVAPIDKeys` and `generateRequestDetails` are called; the
  request goes out through the injected fetcher, never through the library's `https.request`.

## Research phase (spike, before Phase 1)

- Service worker scope under `/platform`: serve `sw.js` from the Vite base
  (`import.meta.env.BASE_URL`) or send `Service-Worker-Allowed`. Confirm the scope and route on
  the mesh, in the dev server, and with demo mode's MSW worker present.
- iOS: manifest fields needed (`display: standalone`, `start_url` and `scope` under `/platform/`),
  and whether the Tailscale HTTPS origin is accepted. Test on the owner's phone; the CLI cannot.
- `web-push` under Bun, or the WebCrypto fallback.
- The push payload is end-to-end encrypted, but the endpoint host (Apple, Google, Mozilla) learns
  timing. Confirm that is acceptable to the owner.
- Deliverable: a short note appended here with the chosen library and scope, and a pass/fail per
  platform (desktop Chrome, desktop Firefox, iOS home-screen app, Android Chrome).

## Phases

### Phase 1: Keys, subscriptions, a test push — DONE 2026-09-25

1. Server: generate VAPID keys into the secret store (new `SecretRef` kind); routes to register,
   list and delete a device subscription; a "send test notification" action.
2. Web: manifest and service worker; a settings control that asks permission, subscribes and shows
   the device list. Every effect is a TanStack mutation with a key from the feature's
   `mutation-keys.ts`, settling the device list query.
3. Errors go through the feature's structured-error catalog with a `fix` the user can act on
   (permission denied, unsupported browser, not installed on iOS).

### Phase 2: Session notices — NEXT

Seams Phase 1 left for it: `deliverPush` returns `expired` for a 404 or 410 without deleting the
row (the test route reports it as `push.SUBSCRIPTION_EXPIRED`), `PushNotice.path` is opened
relative to the worker's scope, and `notificationclick` focuses an open app window without
navigating it yet.

1. Move the transition logic (D1) and derive notices on the server.
2. Send per D2. A `410 Gone` from the push service deletes that subscription.
3. The service worker's `notificationclick` focuses an open Platform window or opens
   `/platform/chat/t/<sessionId>` for the notice's environment.
4. One wide event per delivery: kind, device count, suppressed or sent, push-service status. No
   endpoint URLs or session titles in logs.

## Verification

- Unit tests for notice derivation on the server with the same cases the client tests cover.
- `bun run agent:browser` can drive permission and subscription in Chromium; a scenario asserts
  the device appears and a test push arrives in the service worker. Selectors in
  `scripts/agent/selectors.ts`.
- The iOS path is manual on the owner's phone; say so in the report.
- Server changes deploy with `bun run deploy --server`.

## Spike note (2026-09-25)

- **Library:** `web-push` 3.6.7 under Bun 1.4.0 passes. `apps/server/src/push/tests/routes.test.ts`
  generates a subscriber key pair, sends a test through the real route and the injected fetcher,
  verifies the `vapid t=…, k=…` header (ES256 over the stored key, `aud` = the push service
  origin, `sub` = the page origin when it is https), and decrypts the `aes128gcm` body with an
  RFC 8291 implementation written in the test (`apps/server/test/factories/push-subscriber.ts`).
  The bundled server (`bun build src/index.ts`) encrypts the same way. The library prints Node's
  `url.parse()` deprecation warning once per process, on the first send.
- **Scope:** `sw.js` lives in `apps/web/public`, so Vite serves it at the base, and the app
  registers it with `import.meta.env.BASE_URL` as script prefix and scope. In the lane Vite
  (base `/`) the registration's scope is `http://localhost:5235/`. On the mesh the same code gives
  `/platform/sw.js` with scope `/platform/`, the script's own directory, so no
  `Service-Worker-Allowed` header is needed. The server serves both files from the release with
  `no-cache`, and `.webmanifest` as `application/manifest+json`. The worker calls `skipWaiting()`
  on install: it caches nothing, so a deployed worker can replace the old one at once, and a
  changed `notificationclick` takes effect without waiting for every tab to close.
- **Demo:** the worker is registered only from the Turn on button. The section first checks
  `navigator.serviceWorker.controller`: when another worker controls the page (the demo's MSW
  worker), it shows "Another service worker controls this page" and sends no `/push` request. In
  the lane Vite, `demo.html` starts, `scenario demo-workspace --url http://localhost:5235/demo.html`
  completes, the only registration is `mockServiceWorker.js`, and the demo's unhandled-request list
  has no `/push` entry (`/work/tmp/plan142-spike/demo-settings-push.png`). `scenario demo-startup`
  needs the built site under `/fregat/`, which the lane Vite does not serve, so it was not run.
  The other order collides in dev. There both workers use scope `/` (demo.html is served beside
  the app), so opening `/demo.html` after turning push on updates the registration to
  `mockServiceWorker.js`. The subscription then has no push handler, and the app at `/` reports
  "Another service worker controls this page". This happens only in dev: the mesh build has no
  demo.html. To recover, remove the worker in the browser's site data for that origin (DevTools ›
  Application › Service workers › Unregister), then turn push on again. Probe: register sw.js at
  `/`, open `/demo.html`, then read the registrations and the controller of `/`
  (`/work/tmp/plan142-spike/real-subscribe-probe.log`, "demo collision").
- **iOS fields:** `manifest.webmanifest` has `display: standalone`, `start_url` and `scope` of
  `./` (relative to the manifest, so `/platform/` on the mesh), and 192 and 512 px PNG icons.
  `index.html` links it and an `apple-touch-icon`. On iPhone and iPad outside the Home Screen the
  section says push needs the app on the Home Screen.
- **Per platform:** the Chromium and Firefox rows come from
  `/work/tmp/plan142-spike/real-subscribe-probe.ts`, output with browser versions in
  `/work/tmp/plan142-spike/real-subscribe-probe.log`. The probe subscribes with a freshly
  generated P-256 key, which the push service treats the same as the server's.

| Platform                      | Result                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Chromium (Playwright) | Worker registers at the base scope, notification permission granted, `showNotification` works. A real `pushManager.subscribe` fails: `AbortError: Registration failed - permission denied` (no push service in this build). `scenario push-subscribe` stubs the subscription and passes end to end. The headless shell denies notification permission outright, so the scenario runs full Chromium. |
| Desktop Firefox (Playwright)  | Worker registers, permission granted, `showNotification` works. A real subscribe fails: `AbortError: Error retrieving push subscription.` It gets no further than Chromium, and CDP push delivery is Chromium-only.                                                                                                                                                                                 |
| iOS home-screen app           | Owner check pending.                                                                                                                                                                                                                                                                                                                                                                                |
| Android Chrome                | Owner check pending.                                                                                                                                                                                                                                                                                                                                                                                |

## Owner questions

- The payload is end-to-end encrypted, but the push endpoint's host (Apple, Google or Mozilla,
  whichever the device's browser uses) learns when each notification is sent and roughly how
  large it is. Is that acceptable? It does not block Phase 1 or 2: push stays off until a device
  turns it on.

## Owner checks

- iOS: on the owner's iPhone, open `https://omarchy.mesh.shaulavo.dev/platform/`, Share › Add to
  Home Screen, open it from there, Settings › search "push", Turn on for this device, Send test.
  This also answers whether the Tailscale HTTPS origin is accepted.
- Android Chrome: the same without the Home Screen step.
- Desktop Chrome or Firefox against the mesh, with a real push service.

## Out of scope and not copied

- Expo or any hosted relay (Paseo, T3 Connect). The mesh server sends directly.
- Offline caching or an app shell in the service worker.
- The phone layout itself (Plan 143) and a native companion app.
