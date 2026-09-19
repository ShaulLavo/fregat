# Settings

Every user-facing knob, read through the registry, written through settings intents with scope (application, machine, window).

## Sub-features

Settings pane by category, raw JSON editor with compare-and-swap, a read-only Defaults tab generated from the registry, machines section (connect, disconnect, SSH auth), palettes and themes, keybindings.

## How to get to it (user POV)

The settings command, or an address URL with a settings category.

## Driving it with agent:browser

`scenario settings-defaults` opens the Defaults tab, checks the generated document is read-only, and returns to User. `scenario wallpaper-library` opens the picker dialog from the Wallpaper row, uploads and deletes the bundled still, filters, selects from the keyboard, runs Next wallpaper, and puts the previous selection back. `scenario wallpaper-mode-toggle` drives the command palette through image selection, off/on, and dark-to-light while off; the image must survive toggles and color mode must never reveal it. `scenario wallpaper-palette` opens Choose wallpaper, arrows through rows to check the workbench repaints, and checks Escape restores the saved image with no write. Change a value in the pane, then read `~/.platform` settings on disk and `caches` for `['settings','document']`. The raw editor save is the `['settings','raw-save', ...]` mutation.

`scenario theme-gallery` inspects the gallery and the light/dark creation form. `scenario theme-bundles` proves distinct wallpapers per mode, scoped customization, reload, system-mode changes, Escape preview restoration, creation, export/import through the UI, and copy-only actions for embedded palettes. It restores the original settings and removes only its own fixtures. The standalone wallpaper-mode scenario assumes no theme bundle is selected.

## Gotchas

Scope is a security boundary: a window-scoped value never reaches execution. Secrets never appear in the settings document.

`scenario page-lifecycle` drives retained-page lifecycle events, cancels and accepts native reload confirmation, and reloads three times. Each restore/reload must start settings, machine and filesystem subscriptions. Inspect the run’s structured logs for unexpected stream failures. The retained-page events are simulated; this does not prove browser BFCache eligibility.
