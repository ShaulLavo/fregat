# Settings

Every user-facing knob, read through the registry, written through settings intents with scope (application, machine, window).

## Sub-features

Settings pane by category, raw JSON editor with compare-and-swap, a read-only Defaults tab generated from the registry, machines section (connect, disconnect, SSH auth), palettes and themes, keybindings.

## How to get to it (user POV)

The settings command, the gear button at the bottom of the sidebar rail, or an address URL with a settings category.

## Driving it with agent:browser

`scenario settings-defaults` opens the Defaults tab, checks the generated document is read-only, and returns to User. `scenario wallpaper-library` opens the theme studio from the Theme row, uploads and deletes an image on the Wallpaper tab, filters, selects from the keyboard, applies, runs Next wallpaper, and puts the previous selection back. `scenario wallpaper-mode-toggle` drives the command palette through image selection, off/on, and dark-to-light while off; the image must survive toggles and color mode must never reveal it. `scenario wallpaper-palette` opens Choose wallpaper, arrows through rows to check the workbench repaints, and checks Escape restores the saved image with no write. `scenario theme-bundle-palette` opens Choose theme, arrows through the bundles to check the app palette repaints, and checks Escape restores the saved palette with no write. Change a value in the pane, then read the run's `settings.json` on disk (`platformHomePath('settings.json')` inside a scenario) and `caches` for `['settings','document']`. The raw editor save is the `['settings','raw-save', ...]` mutation.

`scenario theme-studio` opens the studio dock, previews themes and both halves, edits the accent, sorts wallpapers by match and takes colors from one, discards, then edits and applies in one write. `scenario theme-studio-library` previews themes from the `theme ` quick switch, opens the studio from its last row and the titlebar `Theme…` item, then creates, duplicates, exports, deletes and re-imports a theme. `scenario bundle-wallpapers` clicks every bundled theme card in the studio in dark and light and waits for the paired Omarchy wallpaper to paint; the pairing table is `packages/contracts/src/themes/bundle-wallpapers.ts` and the server seeds those files from `/usr/share/omarchy/themes` at boot (`wallpapers.seed` in the log).

`scenario sidebar-settings-button` checks both workbench and chat rails retain their own tabs and have exactly one Settings action pinned to the bottom. It closes and reopens Search using the same icon in both modes, checking panel visibility and pressed state. It opens Settings in each mode, checks its tooltip, collapses chat's Editor tool, and opens Settings again from the remaining rail. Both rails compose the app-owned `RailTabs` and `WorkspaceRail`; see `docs/workspace-rails.md`.

`scenario font-picker` drives both font pickers: Suggested before typing, a hovered search result previewing the whole app (`--font-ui`), Escape restoring it, a chosen Fontsource font surviving reload with its stylesheet loaded at the first frame, an installed font found by search, and a Nerd Font for code with editor clicks landing on the right column. The server's installed-font list comes from `fc-list` on the machine running the API.

`scenario font-picker-hover` hovers three suggested interface fonts and fails on any frame whose `--font-ui` names a face that has not loaded (a hover must keep the last font until the next is ready), or if a row sample moves when the app behind the popup changes font.

`scenario settings-save-rejected` fulfils the settings write with a 400 structured envelope and checks the toast shows the server's own message _and_ its `fix`. The envelope carries `why` and `fix` (`responseErrorPayload` in `apps/server/src/app.ts`); `createRpcError` and `clientErrorDescription` are the two places that used to drop them.

`scenario settings-responsive` checks 40px touch controls and 16px search text in narrow Settings, with search below the scope tabs, then verifies both return to a shared bar in a wide pane.

`scenario wallpaper-icon-hints` creates an unselected wallpaper fixture through the API, hovers its action control on the studio Wallpaper tab and opens its menu. Cleanup deletes that fixture and asserts user settings are unchanged.

## Gotchas

`scenario color-mode-preview` checks saved Dark and System highlights, React View Transition snapshots in both directions, rapid keyboard previews, filtering, Escape restoration, and reduced motion. It checks that individual colors do not animate inside the snapshots and restores the original setting.

The scenario also pauses both fades halfway, captures screenshots, and checks that the modal has a snapshot above the app. Merely finding the modal in the DOM does not prove it is visible during a View Transition.

Scope is a security boundary: a window-scoped value never reaches execution. Secrets never appear in the settings document.

`scenario page-lifecycle` drives retained-page lifecycle events, cancels and accepts native reload confirmation, and reloads three times. Each restore/reload must start settings, machine and filesystem subscriptions. Inspect the run’s structured logs for unexpected stream failures. The retained-page events are simulated; this does not prove browser BFCache eligibility.

`scenario settings-models-pending` holds the provider read, reloads and opens the Models setting. The pending step must show the row skeleton and never "No models are available yet."

`scenario settings-cold-load` delays the settings module in the Vite dev server, verifies the loading state, then releases the import and checks that rendering resumes without console errors.

`scenario wallpaper-boot-handoff` reloads as a macOS tab with a theme-less boot mirror whose wallpaper is the desktop. Linux composites over the real desktop, and a theme's own wallpaper wins, so neither preloads. The boot script's preload must report `ready` on `window.platformBootWallpaper`, the record the app reads instead of the link's attributes.

`scenario settings-stale-diagnostics` plants an unknown key in the user `settings.json` of the server under test (`platformHomePath('settings.json')`, which the CLI points at the run's state home) and checks that the User JSON view marks it. It then types a space after the opening brace, which hides the marks while the text differs from the file, and undoes to bring them back. The original bytes are restored even if the run fails. A highlight holds only mounted rows, so the edit stays on a row near the marked one.

`scenario push-subscribe` drives Settings › Chat › Push notifications in full Chromium with notification permission granted (the scenario's `notifications: true`; the headless shell denies it). Headless Chromium has no push service, so an init script stubs `PushManager.subscribe` with a subscription whose endpoint is an HTTP server the scenario runs. It holds the first device list for 1.5 s to photograph the skeleton (`loading`), turns push on, checks the device row says This device, sends a test through the real `POST /push/devices/:id/test`, verifies the VAPID header and decrypts the `aes128gcm` body, delivers the plaintext to `sw.js` with CDP `ServiceWorker.deliverPushMessage`, reads the notification back with `registration.getNotifications()`, and removes the device. `--engine firefox` cannot run it (no CDP). Set `OBSERVABILITY_BATCH_INTERVAL_MS=100` to get the `send_test` wide event into the evidence log before the throwaway server stops.

`scenario push-session-notice` runs a session on the isolated native Codex fixture (full Chromium, notification permission granted) with the same stubbed `PushManager` and local push endpoint as push-subscribe; the stub keeps its key in sessionStorage, so the device stays This device across reloads. It turns push on for the browser and flips Push session notifications in the push section (`push-on`), completes a turn while the page is focused and asserts nothing reached the endpoint (`focused-no-push`), then backgrounds the page (a second tab in front, CDP focus emulation off) and completes another: exactly one push arrives, decrypts to Session completed with the session's tag and a `~<workspace>/chat/t/<id>` path (`background-push`), and CDP delivers it to `sw.js` (`worker-shows-notice`). A script cannot make a trusted notification click, so the scenario dispatches `notificationclick` in the worker with `clients.openWindow` and `WindowClient.focus` recording their calls: with the page off the session the click opens the session URL, which the page then loads (`click-opens-session`); with the page on it the click focuses that window (`click-focuses-session`). The server's `push.session_notice` events (one suppressed, one sent) land in the run's log with `OBSERVABILITY_BATCH_INTERVAL_MS=100`.

`scenario settings-usage` checks the real history route, then a fixed month with provider estimates, catalog estimates and unknown prices. It verifies the Estimated API cost label, daily bars and model rows, with no manual price inputs.

`scenario settings-provider-update` adds a fixture codex whose fake binary sits at a standalone-installer path, so Settings › Providers shows `0.1.0 → <latest>` with an Update button. The update runs once, the toast reads "Updated Codex fixture to 99.0.0" and the row turns Up to date. The real CLIs show their version against the npm release and are never updated; a mise or Homebrew install shows a copyable command.

`scenario claude-usage-import` adds a Claude instance whose config dir holds one hand-written transcript for a fixture project, clicks its Import from Claude Code, and checks `GET /providers/usage/history` and the Usage page: 2 turns, 2000 in, 1000 out, with the repeated content-block row billed once. No real transcript is read.
