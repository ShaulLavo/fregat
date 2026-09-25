# Plan 142: Web Push notifications from the mesh server

## Status and authorization

- Status: PROPOSED — ready after the spike in the research phase.
- Priority: P1. It is the first piece of working away from the desk.
- Effort: M.
- Risk: MED. A service worker outlives deploys and caches badly if it does anything but push.
- Planned at: Platform `c2af88b4`, 2026-09-24. Origin: the 2026-09-24 reference survey (Paseo,
  Orca, T3 Code).
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested.

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
- There is no web app manifest and no service worker in `apps/web/public`. Demo mode registers
  MSW's `mockServiceWorker.js` scoped to the asset base (`apps/web/src/demo/start.ts:54`).
- The secret store is `apps/server/src/settings/secrets.ts`. Its `SecretRef` type only names
  provider environment variables (`provider.${id}.env.${name}`), so a VAPID key needs a new ref
  kind.
- The server does not import `@workspace/client-core`, so it cannot run today's notice derivation.
- Session routes are `chat/t/$sessionId` (`apps/web/src/state/routes/chat.ts:23`). The mesh serves
  the app under `/platform`.
- No `web-push` dependency in `apps/server` or `apps/web`.

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

- A service worker that only handles `push` and `notificationclick`. No caching, no offline.
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
- **D2 — How a push is suppressed when the owner is looking.** Recommended: the server skips the
  push when a connected client reports a visible, focused window for that environment over the
  existing socket. Checking `clients.matchAll()` inside the service worker is not enough on its
  own: browsers expect every push to show a notification (`userVisibleOnly`), and Safari can
  revoke a subscription that stays silent.
- **D3 — Settings.** Recommended: one new registry entry, `chat.pushNotifications` (boolean,
  `application` scope), registered in the same pass as the server code that reads it.
  Subscriptions are device records, not settings. Permission is requested from a button, since
  browsers require a user gesture.
- **D4 — Library.** Recommended: the `web-push` package if it runs under Bun. Otherwise VAPID
  signing plus `aes128gcm` payload encryption (RFC 8291) on WebCrypto. The spike decides.

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

### Phase 1: Keys, subscriptions, a test push

1. Server: generate VAPID keys into the secret store (new `SecretRef` kind); routes to register,
   list and delete a device subscription; a "send test notification" action.
2. Web: manifest and service worker; a settings control that asks permission, subscribes and shows
   the device list. Every effect is a TanStack mutation with a key from the feature's
   `mutation-keys.ts`, settling the device list query.
3. Errors go through the feature's structured-error catalog with a `fix` the user can act on
   (permission denied, unsupported browser, not installed on iOS).

### Phase 2: Session notices

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

## Out of scope and not copied

- Expo or any hosted relay (Paseo, T3 Connect). The mesh server sends directly.
- Offline caching or an app shell in the service worker.
- The phone layout itself (Plan 143) and a native companion app.
