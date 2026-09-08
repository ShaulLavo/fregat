> [!NOTE]
> Generated from the settings registry by `bun scripts/generate-settings-reference.ts`.
> Edit `packages/contracts/src/settings/keys.ts`, not this file.

# Settings reference

Settings live in `~/.platform/settings.json`. The file holds only what you have
changed, so anything absent takes the current build's default — which is what lets
a default improve without touching your file.

A workspace can carry its own `.platform/settings.json`. Only settings marked
**window** or **resource** can be set there: a workspace file ships inside a
cloned repository, so anything reaching process spawn, exec, env, or the keymap is
readable only from your own file.

Scopes: **application** — user file only; **machine** — user file only, machine-specific; **resource** — user or workspace; **window** — user or workspace.

Secrets — provider environment values — are **not** in this file. They live in
`~/.platform/secrets.json` with owner-only permissions, so the settings document
stays safe to read, share and export.

## Appearance

| Setting                            | Default      | Scope  | What it does                                                                             |
| ---------------------------------- | ------------ | ------ | ---------------------------------------------------------------------------------------- |
| `workbench.colorTheme`             | `"system"`   | window | Light or dark, or follow the operating system.                                           |
| `workbench.palette`                | `"graphite"` | window | Warm near-greyscale, or warm stone surfaces with a sage accent.                          |
| `workbench.reduceMotion`           | `false`      | window | Slow terminal loading indicators while keeping progress visible.                         |
| `workbench.density`                | `"compact"`  | window | Use tighter compact spacing or roomier cozy spacing throughout the app.                  |
| `workbench.surface.opacity`        | `80`         | window | How opaque panels and sidebars are over the wallpaper. 100 turns the glass material off. |
| `workbench.surface.contentOpacity` | `95`         | window | How opaque the editor and terminal background is.                                        |
| `workbench.surface.blur`           | `9`          | window | Backdrop blur radius, in pixels, behind translucent surfaces.                            |
| `workbench.surface.saturation`     | `160`        | window | Backdrop saturation, as a percentage, behind translucent surfaces.                       |
| `workbench.wallpaper.enabled`      | `true`       | window | Show the desktop wallpaper behind the workbench.                                         |
| `workbench.tree.indentGuides`      | `"onHover"`  | window | When to show editor-coloured indentation guides in the file tree.                        |

## Chat

| Setting                            | Default         | Scope       | What it does                                                                                                                                                 |
| ---------------------------------- | --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat.keepImportedSessionsUpdated` | `true`          | machine     | Imported chats receive one-way updates from local history until you send their first message in Platform. New chats are only imported when you click Import. |
| `chat.defaultRuntimeMode`          | `"full-access"` | application | Permission posture a new session starts in.                                                                                                                  |
| `chat.defaultInteractionMode`      | `"default"`     | application | Whether a new session starts in plan mode.                                                                                                                   |

## Editor

| Setting                             | Default           | Scope   | What it does                                                                                                                                                                                 |
| ----------------------------------- | ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.fontFamily`                 | `"JetBrainsMono"` | window  | Font for the editor and, unless overridden, the terminal.                                                                                                                                    |
| `editor.externalEditor`             | `""`              | machine | Executable used by the terminal client to edit settings JSON. Blank uses the local EDITOR executable, then vi. Supply one executable path; shell commands and arguments are not interpreted. |
| `editor.fontSize`                   | `13`              | window  | Editor font size in pixels.                                                                                                                                                                  |
| `editor.lineHeight`                 | `24`              | window  | Editor row height in pixels.                                                                                                                                                                 |
| `editor.tabSize`                    | `4`               | window  | Rendered width of a tab character, in spaces.                                                                                                                                                |
| `editor.diff.viewMode`              | `"stacked"`       | window  | Show diffs side by side or stacked.                                                                                                                                                          |
| `editor.minimap.enabled`            | `true`            | window  | Show the minimap beside the editor. _(restart)_                                                                                                                                              |
| `editor.guides.indentation`         | `true`            | window  | Draw indentation guides (scope lines). _(restart)_                                                                                                                                           |
| `editor.syntaxHighlighting.enabled` | `true`            | window  | Colour code by syntax. Turning this off makes very large files faster. _(restart)_                                                                                                           |
| `editor.decode.mode`                | `"off"`           | window  | Animate a file as it opens, as if it were being written. _(restart)_                                                                                                                         |

## Files

| Setting               | Default | Scope  | What it does                                                               |
| --------------------- | ------- | ------ | -------------------------------------------------------------------------- |
| `files.autoSave`      | `"off"` | window | Save edited files automatically, and when.                                 |
| `files.autoSaveDelay` | `1000`  | window | Milliseconds of quiet before an automatic save, when saving after a delay. |
| `files.showHidden`    | `false` | window | Show dot-prefixed files and folders in file pickers.                       |

## Keyboard shortcuts

| Setting                 | Default     | Scope       | What it does                                                                                                                                  |
| ----------------------- | ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `keybindings.preset`    | `"default"` | application | Editor shortcuts to use before applying your overrides. Default uses the native editor pack; vscode uses the VS Code pack.                    |
| `keybindings.overrides` | `{}`        | application | Command id to shortcut: one hotkey or two separated by a single space. A missing key keeps the default; an explicit null unbinds the command. |

## Language servers

| Setting                        | Default  | Scope   | What it does                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lsp.experimental.tyForPython` | `false`  | machine | Use ty instead of pyright for Python. Files already open keep their current server until reopened.                                                                                                                                                                                                                                         |
| `lsp.idleTimeoutMs`            | `120000` | machine | Milliseconds an unused language server stays alive after the last editor disconnects. 0 shuts it down immediately.                                                                                                                                                                                                                         |
| `lsp.downloadRuntimes`         | `true`   | machine | Download missing language servers on demand. Off means only servers already on PATH are used.                                                                                                                                                                                                                                              |
| `lsp.servers`                  | `{}`     | machine | Per-server overrides: extensions and feature ranks apply when a document is matched; command, env, and initialization apply on the next backend start. Set a feature to null to exclude that server. A running backend keeps its old process options until it idles out.                                                                   |
| `lsp.languageServers`          | `{}`     | machine | Which language servers may serve a file type, keyed by extension ('.json'). Values are server ids in preference order, '!id' drops a server, and '...' keeps the rest. Naming a registered server explicitly enables it for matching file types even without its project marker. Open documents keep their current servers until reopened. |
| `lsp.semanticTokens.enabled`   | `false`  | machine | Ask language servers to colour identifiers they have actually resolved. Off means no token request is ever sent. Each server still has its own default under lsp.semanticTokens.servers.                                                                                                                                                   |
| `lsp.semanticTokens.delta`     | `false`  | machine | Let the proxy re-ask a delta-capable server for token deltas instead of whole files. Saves bandwidth and garbage per keystroke, not latency.                                                                                                                                                                                               |
| `lsp.semanticTokens.servers`   | `{}`     | machine | Server id to true or false, overriding the per-server default. Lets one misbehaving server be turned off without turning the feature off.                                                                                                                                                                                                  |

## Logs

| Setting                 | Default | Scope  | What it does                                      |
| ----------------------- | ------- | ------ | ------------------------------------------------- |
| `logs.defaultTimeRange` | `"1h"`  | window | Time range the logs view opens on.                |
| `logs.slowThresholdMs`  | `500`   | window | How many milliseconds counts as a slow operation. |

## Machines

| Setting                 | Default | Scope   | What it does                                                                                    |
| ----------------------- | ------- | ------- | ----------------------------------------------------------------------------------------------- |
| `environments.machines` | `{}`    | machine | SSH targets and direct origins available to this client. The local machine is always available. |

## Models

| Setting         | Default | Scope       | What it does                                                                                                     |
| --------------- | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `models.hidden` | `[]`    | application | Which models the picker offers, and in what order. Turn one off to keep it out of the picker.                    |
| `models.order`  | `[]`    | application | Explicit leading order for the picker. Models named by neither list stay visible after these, in provider order. |

## Providers

| Setting               | Default | Scope       | What it does                                                       |
| --------------------- | ------- | ----------- | ------------------------------------------------------------------ |
| `providers.instances` | `[]`    | application | Configured provider instances, in the order the picker shows them. |

## Search

| Setting                   | Default     | Scope  | What it does                                            |
| ------------------------- | ----------- | ------ | ------------------------------------------------------- |
| `search.defaultMatchMode` | `"literal"` | window | How a new search interprets the query.                  |
| `search.caseSensitive`    | `false`     | window | Match case by default.                                  |
| `search.wholeWord`        | `false`     | window | Match whole words by default.                           |
| `search.maxResults`       | `200`       | window | How many matches a workspace search returns.            |
| `search.maxResultFiles`   | `100`       | window | How many files a workspace search returns matches from. |
| `search.quickOpenLimit`   | `80`        | window | How many files the file picker lists.                   |

## Terminal

| Setting                              | Default | Scope  | What it does                                            |
| ------------------------------------ | ------- | ------ | ------------------------------------------------------- |
| `terminal.integrated.fontSize`       | `12`    | window | Terminal font size in pixels.                           |
| `terminal.integrated.scrollback`     | `10000` | window | How many lines of output the terminal keeps.            |
| `terminal.integrated.cursorBlinking` | `true`  | window | Blink the terminal cursor while the terminal has focus. |

## Window

| Setting               | Default        | Scope   | What it does                                                                                                                                                                   |
| --------------------- | -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `window.transparency` | `"compositor"` | machine | Where the see-through comes from: the window manager blending an opaque window, or a per-pixel transparent window (which costs a full-surface CPU copy per frame). _(restart)_ |
