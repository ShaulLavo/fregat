# Settings

Every user-facing knob, read through the registry, written through settings intents with scope (application, machine, window).

## Sub-features

Settings pane by category, raw JSON editor with compare-and-swap, a read-only Defaults tab generated from the registry, machines section (connect, disconnect, SSH auth), palettes and themes, keybindings.

## How to get to it (user POV)

The settings command, the gear button at the bottom of the sidebar rail, or an address URL with a settings category.

## Driving it with agent:browser

`scenario settings-defaults` opens the Defaults tab, checks the generated document is read-only, and returns to User. `scenario wallpaper-library` opens the picker dialog from the Wallpaper row, uploads and deletes the bundled still, filters, selects from the keyboard, runs Next wallpaper, and puts the previous selection back. `scenario wallpaper-mode-toggle` drives the command palette through image selection, off/on, and dark-to-light while off; the image must survive toggles and color mode must never reveal it. `scenario wallpaper-palette` opens Choose wallpaper, arrows through rows to check the workbench repaints, and checks Escape restores the saved image with no write. `scenario theme-bundle-palette` opens Choose theme, arrows through the bundles to check the app palette repaints, and checks Escape restores the saved palette with no write. Change a value in the pane, then read the run's `settings.json` on disk (`platformHomePath('settings.json')` inside a scenario) and `caches` for `['settings','document']`. The raw editor save is the `['settings','raw-save', ...]` mutation.

`scenario theme-gallery` inspects the gallery and the light/dark creation form. `scenario theme-bundles` proves distinct wallpapers per mode, scoped customization, reload, system-mode changes, Escape preview restoration, creation, export/import through the UI, and copy-only actions for embedded palettes. It restores the original settings and removes only its own fixtures. The standalone wallpaper-mode scenario assumes no theme bundle is selected. `scenario bundle-wallpapers` clicks every bundled theme card in dark and light and waits for the paired Omarchy wallpaper to paint; the pairing table is `packages/contracts/src/themes/bundle-wallpapers.ts` and the server seeds those files from `/usr/share/omarchy/themes` at boot (`wallpapers.seed` in the log).

`scenario sidebar-settings-button` checks both workbench and chat rails retain their own tabs and have exactly one Settings action pinned to the bottom. It closes and reopens Search using the same icon in both modes, checking panel visibility and pressed state. It opens Settings in each mode, checks its tooltip, collapses chat's Editor tool, and opens Settings again from the remaining rail. Both rails compose the app-owned `RailTabs` and `WorkspaceRail`; see `docs/workspace-rails.md`.

`scenario font-picker` drives both font pickers: Suggested before typing, a hovered search result previewing the whole app (`--font-ui`), Escape restoring it, a chosen Fontsource font surviving reload with its stylesheet loaded at the first frame, an installed font found by search, and a Nerd Font for code with editor clicks landing on the right column. The server's installed-font list comes from `fc-list` on the machine running the API.

`scenario font-picker-hover` hovers three suggested interface fonts and fails on any frame whose `--font-ui` names a face that has not loaded (a hover must keep the last font until the next is ready), or if a row sample moves when the app behind the popup changes font.

`scenario settings-save-rejected` fulfils the settings write with a 400 structured envelope and checks the toast shows the server's own message _and_ its `fix`. The envelope carries `why` and `fix` (`responseErrorPayload` in `apps/server/src/app.ts`); `createRpcError` and `clientErrorDescription` are the two places that used to drop them.

`scenario settings-responsive` checks 40px touch controls and 16px search text in narrow Settings, with search below the scope tabs, then verifies both return to a shared bar in a wide pane.

`scenario wallpaper-icon-hints` creates an unselected wallpaper fixture through the API, hovers its action control and opens its menu. Cleanup deletes that fixture and asserts user settings are unchanged.

## Gotchas

`scenario color-mode-preview` checks saved Dark and System highlights, React View Transition snapshots in both directions, rapid keyboard previews, filtering, Escape restoration, and reduced motion. It checks that individual colors do not animate inside the snapshots and restores the original setting.

The scenario also pauses both fades halfway, captures screenshots, and checks that the modal has a snapshot above the app. Merely finding the modal in the DOM does not prove it is visible during a View Transition.

Scope is a security boundary: a window-scoped value never reaches execution. Secrets never appear in the settings document.

`scenario page-lifecycle` drives retained-page lifecycle events, cancels and accepts native reload confirmation, and reloads three times. Each restore/reload must start settings, machine and filesystem subscriptions. Inspect the run’s structured logs for unexpected stream failures. The retained-page events are simulated; this does not prove browser BFCache eligibility.

`scenario settings-models-pending` holds the provider read, reloads and opens the Models setting. The pending step must show the row skeleton and never "No models are available yet."

`scenario settings-cold-load` delays the settings module in the Vite dev server, verifies the loading state, then releases the import and checks that rendering resumes without console errors.

`scenario wallpaper-boot-handoff` reloads as a macOS tab with a theme-less boot mirror whose wallpaper is the desktop. Linux composites over the real desktop, and a theme's own wallpaper wins, so neither preloads. The boot script's preload must report `ready` on `window.platformBootWallpaper`, the record the app reads instead of the link's attributes.

`scenario settings-stale-diagnostics` plants an unknown key in the user `settings.json` of the server under test (`platformHomePath('settings.json')`, which the CLI points at the run's state home) and checks that the User JSON view marks it. It then types a space after the opening brace, which hides the marks while the text differs from the file, and undoes to bring them back. The original bytes are restored even if the run fails. A highlight holds only mounted rows, so the edit stays on a row near the marked one.

`scenario settings-usage` checks the real history route, then a fixed month with provider estimates, catalog estimates and unknown prices. It verifies the Estimated API cost label, daily bars and model rows, with no manual price inputs.

`scenario settings-route-preparation` opens the settings URL, opens a file before the settings command, then traverses back/forward. `scenario settings-module-failure` aborts the settings import, checks its contained error, permits the URL again and verifies Reload recovery after Retry retains the failed module. `caches` reports Browser resources separately from environment clients.
