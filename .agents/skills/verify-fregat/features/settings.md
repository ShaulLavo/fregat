# Settings

Every user-facing knob, read through the registry, written through settings intents with scope (application, machine, window).

## Sub-features

Settings pane by category, raw JSON editor with compare-and-swap, a read-only Defaults tab generated from the registry, machines section (connect, disconnect, SSH auth), palettes and themes, keybindings.

## How to get to it (user POV)

The settings command, the gear button at the bottom of the sidebar rail, or an address URL with a settings category.

## Driving it with agent:browser

`scenario settings-defaults` opens the Defaults tab, checks the generated document is read-only, and returns to User. `scenario wallpaper-library` opens the picker dialog from the Wallpaper row, uploads and deletes the bundled still, filters, selects from the keyboard, runs Next wallpaper, and puts the previous selection back. `scenario wallpaper-mode-toggle` drives the command palette through image selection, off/on, and dark-to-light while off; the image must survive toggles and color mode must never reveal it. `scenario wallpaper-palette` opens Choose wallpaper, arrows through rows to check the workbench repaints, and checks Escape restores the saved image with no write. `scenario theme-bundle-palette` opens Choose theme, arrows through the bundles to check the app palette repaints, and checks Escape restores the saved palette with no write. Change a value in the pane, then read `~/.platform` settings on disk and `caches` for `['settings','document']`. The raw editor save is the `['settings','raw-save', ...]` mutation.

`scenario theme-gallery` inspects the gallery and the light/dark creation form. `scenario theme-bundles` proves distinct wallpapers per mode, scoped customization, reload, system-mode changes, Escape preview restoration, creation, export/import through the UI, and copy-only actions for embedded palettes. It restores the original settings and removes only its own fixtures. The standalone wallpaper-mode scenario assumes no theme bundle is selected. `scenario bundle-wallpapers` clicks every bundled theme card in dark and light and waits for the paired Omarchy wallpaper to paint; the pairing table is `packages/contracts/src/themes/bundle-wallpapers.ts` and the server seeds those files from `/usr/share/omarchy/themes` at boot (`wallpapers.seed` in the log).

`scenario sidebar-settings-button` checks both workbench and chat rails retain their own tabs and have exactly one Settings action pinned to the bottom. It opens Settings in each mode, checks its tooltip, collapses chat's Editor tool, and opens Settings again from the remaining rail. Both rails compose the app-owned `WorkspaceRail`; see `docs/workspace-rails.md`.

`scenario settings-font-input` types a font draft and cancels with Escape, checking that the shared string editor restores the saved font family.

`scenario settings-save-rejected` fulfils the settings write with a 400 structured envelope and checks the toast shows the server's own message _and_ its `fix`. The envelope carries `why` and `fix` (`responseErrorPayload` in `apps/server/src/app.ts`); `createRpcError` and `clientErrorDescription` are the two places that used to drop them.

`scenario settings-responsive` checks 40px touch controls and 16px search text in narrow Settings, with search below the scope tabs, then verifies both return to a shared bar in a wide pane.

`scenario wallpaper-icon-hints` creates an unselected wallpaper fixture through the API, hovers its action control and opens its menu. Cleanup deletes that fixture and asserts user settings are unchanged. It requires a server with the wallpaper-library routes; use the mesh URL if the running development API predates them.

## Gotchas

`scenario color-mode-preview` checks saved Dark and System highlights, React View Transition snapshots in both directions, rapid keyboard previews, filtering, Escape restoration, and reduced motion. It checks that individual colors do not animate inside the snapshots and restores the original setting.

The scenario also pauses both fades halfway, captures screenshots, and checks that the modal has a snapshot above the app. Merely finding the modal in the DOM does not prove it is visible during a View Transition.

Scope is a security boundary: a window-scoped value never reaches execution. Secrets never appear in the settings document.

`scenario page-lifecycle` drives retained-page lifecycle events, cancels and accepts native reload confirmation, and reloads three times. Each restore/reload must start settings, machine and filesystem subscriptions. Inspect the run’s structured logs for unexpected stream failures. The retained-page events are simulated; this does not prove browser BFCache eligibility.

`scenario settings-models-pending` holds the provider read, reloads and opens the Models setting. The pending step must show the row skeleton and never "No models are available yet."
