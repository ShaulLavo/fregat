# Settings

Every user-facing knob, read through the registry, written through settings intents with scope (application, machine, window).

## Sub-features

Settings pane by category, raw JSON editor with compare-and-swap, a read-only Defaults tab generated from the registry, machines section (connect, disconnect, SSH auth), palettes and themes, keybindings.

## How to get to it (user POV)

The settings command, or an address URL with a settings category.

## Driving it with agent:browser

`scenario settings-defaults` opens the Defaults tab, checks the generated document is read-only, and returns to User. `scenario wallpaper-library` opens the picker, selects per-mode images with keyboard focus, and runs Next wallpaper. Change a value in the pane, then read `~/.platform` settings on disk and `caches` for `['settings','document']`. The raw editor save is the `['settings','raw-save', ...]` mutation.

## Gotchas

Scope is a security boundary: a window-scoped value never reaches execution. Secrets never appear in the settings document.
