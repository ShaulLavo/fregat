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

| Setting                             | Default                                        | Scope       | What it does                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workbench.colorTheme`              | `"system"`                                     | window      | Light or dark, or follow the operating system.                                                                                                    |
| `workbench.theme`                   | `null`                                         | application | A light and dark version of your app colors, code colors, wallpaper and material.                                                                 |
| `workbench.theme.customizations`    | `{}`                                           | application | Part overrides saved separately for each theme bundle and mode.                                                                                   |
| `tui.theme.colors`                  | `"theme"`                                      | application | Use the selected theme bundle or the terminal host colors in the TUI.                                                                             |
| `workbench.palette`                 | `"graphite"`                                   | application | Colors for app backgrounds, text, borders, accents and the terminal. Pick a palette or make your own.                                             |
| `editor.codeTheme.dark`             | `"dark-plus"`                                  | window      | Colors for code in editors and chat code blocks when the app uses dark mode.                                                                      |
| `editor.codeTheme.light`            | `"light-plus"`                                 | window      | Colors for code in editors and chat code blocks when the app uses light mode.                                                                     |
| `workbench.reduceMotion`            | `false`                                        | window      | Slow terminal loading indicators while keeping progress visible.                                                                                  |
| `workbench.fontFamily`              | `"bundled:inter"`                              | window      | Font for the words the app writes: titles, labels, menus and prose.                                                                               |
| `workbench.density`                 | `"compact"`                                    | window      | Use tighter compact spacing or roomier cozy spacing throughout the app.                                                                           |
| `workbench.surface.opacity`         | `80`                                           | window      | How opaque panels and sidebars are over the wallpaper. 100 turns the glass material off.                                                          |
| `workbench.surface.contentOpacity`  | `50`                                           | window      | How opaque the extra layer under the editor, terminal and settings is. It sits on top of the panel, so 0 leaves them as see-through as a sidebar. |
| `workbench.surface.blur`            | `9`                                            | window      | Backdrop blur radius, in pixels, behind translucent surfaces.                                                                                     |
| `workbench.surface.saturation`      | `160`                                          | window      | Backdrop saturation, as a percentage, behind translucent surfaces.                                                                                |
| `workbench.surface.continuousSeams` | `false`                                        | window      | Carry one background across panels and their resize handles, instead of showing the wallpaper in the gap between them.                            |
| `workbench.wallpaper`               | `{"enabled":true,"source":{"kind":"desktop"}}` | application | Choose a wallpaper and turn it on or off without losing the selection.                                                                            |
| `workbench.tree.indentGuides`       | `"always"`                                     | window      | When to show indentation guides in the file tree. Guides take editor colours while the tree is hovered.                                           |

## Chat

| Setting                              | Default                                                                                     | Scope       | What it does                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.followUpBehavior`              | `"queue"`                                                                                   | application | Queue messages during a running turn or send them immediately as corrections. Ctrl/Cmd+Enter uses the other behavior.                                                                                                                                                                                                  |
| `chat.sendShortcut`                  | `"enter"`                                                                                   | application | Which key sends a message. enter: Enter sends and Shift+Enter adds a line. mod-enter-multiline: like enter until the message has a second line, then Ctrl/Cmd+Enter sends. mod-enter: Ctrl/Cmd+Enter sends and Enter adds a line. Where Ctrl/Cmd+Enter sends, Shift+Ctrl/Cmd+Enter takes the other follow-up behavior. |
| `chat.planModeEnabled`               | `false`                                                                                     | application | Show the Plan mode picker and /plan and /default commands for providers that support them. Stored draft preferences are retained while hidden.                                                                                                                                                                         |
| `chat.contextWindowMeterEnabled`     | `false`                                                                                     | application | Show conversation context occupancy in the composer and session header. Provider quota information is independent.                                                                                                                                                                                                     |
| `chat.responseStreamingMode`         | `"paragraph"`                                                                               | application | Publish assistant responses by paragraph, complete turn, or individual token.                                                                                                                                                                                                                                          |
| `chat.projectResponseStreamingModes` | `{}`                                                                                        | application | Response streaming mode overrides keyed by project UUID on this machine.                                                                                                                                                                                                                                               |
| `chat.notificationMode`              | `"off"`                                                                                     | application | Notify when a session needs attention or completes. Native notifications require browser permission; sound starts after a pointer or keyboard gesture.                                                                                                                                                                 |
| `chat.inAppNotificationsEnabled`     | `false`                                                                                     | application | Show an Open session action when another session needs attention or completes while this window is focused.                                                                                                                                                                                                            |
| `chat.pushNotifications`             | `false`                                                                                     | application | Push to every device registered below when a session needs attention or completes. Held back while a window of this server is visible and focused.                                                                                                                                                                     |
| `chat.textGenerationModel`           | `{"providerInstanceId":"codex","model":"gpt-5.6-luna","options":{"reasoningEffort":"low"}}` | application | Provider and model used to generate session titles, independently of the conversation model.                                                                                                                                                                                                                           |
| `chat.projectTextGenerationModels`   | `{}`                                                                                        | application | Title generation model overrides keyed by project UUID on this machine.                                                                                                                                                                                                                                                |
| `chat.sessionSortOrder`              | `"updated_at"`                                                                              | application | Order palette sessions and choose the surviving project session after deletion by latest user activity or creation time. Shelf ordering remains independent.                                                                                                                                                           |
| `chat.confirmSessionDelete`          | `true`                                                                                      | application | Ask before permanently deleting one or more conversations.                                                                                                                                                                                                                                                             |
| `chat.projectGrouping`               | `"repository"`                                                                              | application | Group projects by repository, repository-relative path, or owning machine. Git projects currently register at the repository root, so both repository modes are equivalent.                                                                                                                                            |
| `chat.autoSettleAfterDays`           | `3`                                                                                         | application | Move a session to Settled once it has had no activity for this many days. 0 turns it off.                                                                                                                                                                                                                              |
| `chat.autoSettleOnMerge`             | `true`                                                                                      | application | Move a session to Settled when its worktree's pull request is merged. A closed pull request settles it whenever automatic settlement is on.                                                                                                                                                                            |
| `chat.projectAutoSettle`             | `{}`                                                                                        | application | Automatic settlement overrides keyed by project UUID on this machine.                                                                                                                                                                                                                                                  |
| `chat.projectGroupingOverrides`      | `{}`                                                                                        | application | Grouping mode per scoped project key (environment UUID:project UUID).                                                                                                                                                                                                                                                  |
| `chat.keepImportedSessionsUpdated`   | `true`                                                                                      | machine     | Imported chats receive one-way updates from local history until you send their first message in Platform. New chats are only imported when you click Import.                                                                                                                                                           |
| `chat.defaultRuntimeMode`            | `"full-access"`                                                                             | application | Permission posture a new session starts in.                                                                                                                                                                                                                                                                            |
| `chat.defaultInteractionMode`        | `"default"`                                                                                 | application | Whether a new session starts in plan mode.                                                                                                                                                                                                                                                                             |

## Developer

| Setting                        | Default | Scope       | What it does                                                                                                        |
| ------------------------------ | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `developer.simulatedLatencyMs` | `0`     | application | Milliseconds added before every request to the server, to see how the app behaves on a slow link. Zero disables it. |

## Editor

| Setting                                       | Default                    | Scope       | What it does                                                                                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.fontFamily`                           | `"bundled:jetbrains-mono"` | window      | Font for the editor, the terminal, and code and metadata across the app.                                                                                                                                                                                         |
| `editor.fontSize`                             | `13`                       | window      | Editor font size in pixels.                                                                                                                                                                                                                                      |
| `editor.lineHeight`                           | `24`                       | window      | Editor row height in pixels.                                                                                                                                                                                                                                     |
| `editor.tabSize`                              | `4`                        | window      | Width of a tab character, in spaces. Also the indentation width for a file whose own cannot be detected.                                                                                                                                                         |
| `editor.history.retainedStates`               | `200`                      | application | Earlier states kept per open file, across every undo branch. The least recently visited go first when the budget is exceeded.                                                                                                                                    |
| `editor.history.persist`                      | `true`                     | application | Keep undo history for closed files in this browser, so reopening a file or reloading the window brings it back. A file that changed on disk in the meantime starts fresh.                                                                                        |
| `editor.history.persistDays`                  | `30`                       | application | Days a closed file keeps its stored undo history before it is dropped.                                                                                                                                                                                           |
| `editor.history.persistBudget`                | `67108864`                 | application | Total stored undo history across closed files, in UTF-16 code units. The least recently saved files go first when it is exceeded.                                                                                                                                |
| `editor.diff.viewMode`                        | `"stacked"`                | window      | Show diffs side by side or stacked.                                                                                                                                                                                                                              |
| `editor.inputRoute`                           | `"edit-context"`           | application | How typed text reaches the editor. EditContext (Chromium) receives IME, autocorrect and dictation edits with their exact ranges instead of reading them back out of a hidden textarea; other browsers always use the textarea. _(restart)_                       |
| `editor.retainedTextBudget`                   | `67108864`                 | machine     | Total text the editor keeps resident across the active and parked projects, in UTF-16 code units, re-checked at a project switch and a tab close. The active project is charged first and is never trimmed, so a large one leaves less room for parked projects. |
| `editor.unicodeHighlight.ambiguousCharacters` | `true`                     | window      | Highlight Unicode characters that resemble other characters. Hover a highlight for an explanation.                                                                                                                                                               |
| `editor.unicodeHighlight.invisibleCharacters` | `true`                     | window      | Highlight invisible Unicode characters. Hover a highlight for its code point.                                                                                                                                                                                    |
| `editor.unicodeHighlight.allowedCharacters`   | `""`                       | window      | Characters allowed without Unicode highlighting. Paste the characters here, for example an en dash.                                                                                                                                                              |
| `editor.minimap.enabled`                      | `true`                     | window      | Show the minimap beside the editor. _(restart)_                                                                                                                                                                                                                  |
| `editor.guides.indentation`                   | `true`                     | window      | Draw indentation guides (scope lines). _(restart)_                                                                                                                                                                                                               |
| `editor.syntaxHighlighting.enabled`           | `true`                     | window      | Colour code by syntax. Turning this off makes very large files faster. _(restart)_                                                                                                                                                                               |
| `editor.decode.mode`                          | `"off"`                    | window      | Animate a file as it opens, as if it were being written. _(restart)_                                                                                                                                                                                             |

## Files

| Setting               | Default | Scope  | What it does                                                               |
| --------------------- | ------- | ------ | -------------------------------------------------------------------------- |
| `files.autoSave`      | `"off"` | window | Save edited files automatically, and when.                                 |
| `files.autoSaveDelay` | `1000`  | window | Milliseconds of quiet before an automatic save, when saving after a delay. |
| `files.showHidden`    | `false` | window | Show dot-prefixed files and folders in file pickers.                       |

## Git

| Setting                              | Default       | Scope   | What it does                                                                                                                                                                                       |
| ------------------------------------ | ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git.autoPull`                       | `false`       | machine | Fast-forward a project checkout on its default branch when its upstream moves. A checkout with changes, local commits or another branch checked out is left alone.                                 |
| `git.projectAutoPull`                | `{}`          | machine | Automatic default-branch pull keyed by project UUID on this machine.                                                                                                                               |
| `git.worktreeSubmodules`             | `"recursive"` | machine | Initialize every nested submodule, only the ones this repository declares, or none when a session creates a worktree.                                                                              |
| `git.projectWorktreeSubmodules`      | `{}`          | machine | Submodule modes for new worktrees keyed by project UUID on this machine.                                                                                                                           |
| `git.worktreeCleanupOnDelete`        | `false`       | machine | Remove a session worktree once every session using it is deleted and has stopped. A worktree with uncommitted changes, ignored files other than node_modules, or another branch checked out stays. |
| `git.projectWorktreeCleanupOnDelete` | `{}`          | machine | Worktree removal after the last session is deleted, keyed by project UUID on this machine.                                                                                                         |

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
| `lsp.semanticTokens.delta`     | `true`   | machine | Ask delta-capable language servers for only the tokens an edit changed. Saves bandwidth, parse time and garbage on every keystroke.                                                                                                                                                                                                        |
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

| Setting            | Default | Scope       | What it does                                                                                                     |
| ------------------ | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `models.hidden`    | `[]`    | application | Which models the picker offers, and in what order. Turn one off to keep it out of the picker.                    |
| `models.order`     | `[]`    | application | Explicit leading order for the picker. Models named by neither list stay visible after these, in provider order. |
| `models.favorites` | `[]`    | application | Models starred as favorites. The picker lists them first and gathers them under Favorites.                       |

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
| `search.maxResults`       | `20000`     | window | How many matches a workspace search returns.            |
| `search.maxResultFiles`   | `20000`     | window | How many files a workspace search returns matches from. |
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
