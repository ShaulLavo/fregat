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

| Setting                             | Default                                        | Scope       | What it does                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workbench.colorTheme`              | `"system"`                                     | window      | Light or dark, or follow the operating system.                                                                                                                  |
| `workbench.theme`                   | `null`                                         | application | App colors, code colors, wallpaper and surfaces, in a light and a dark version. Try them in the theme studio.                                                   |
| `workbench.theme.customizations`    | `{}`                                           | application | Part overrides saved separately for each theme bundle and mode.                                                                                                 |
| `tui.theme.colors`                  | `"theme"`                                      | application | Use the selected theme bundle or the terminal host colors in the TUI.                                                                                           |
| `workbench.palette`                 | `"graphite"`                                   | application | Colors for app backgrounds, text, borders, accents and the terminal. Pick a palette or make your own.                                                           |
| `editor.codeTheme.dark`             | `"dark-plus"`                                  | window      | Colors for code in editors and chat code blocks when the app uses dark mode.                                                                                    |
| `editor.codeTheme.light`            | `"light-plus"`                                 | window      | Colors for code in editors and chat code blocks when the app uses light mode.                                                                                   |
| `workbench.reduceMotion`            | `false`                                        | window      | Slow terminal loading indicators while keeping progress visible.                                                                                                |
| `workbench.fontFamily`              | `"bundled:inter"`                              | window      | Font for the words the app writes: titles, labels, menus and prose.                                                                                             |
| `workbench.feel`                    | `"flat"`                                       | window      | Motion and control depth: Flat, Seam, Brisk, Relaxed or Playful.                                                                                                |
| `workbench.density`                 | `"compact"`                                    | window      | Use tighter compact spacing or roomier cozy spacing throughout the app.                                                                                         |
| `workbench.surface.opacity`         | `80`                                           | window      | How opaque panels and sidebars are over the wallpaper. 100 turns the glass material off.                                                                        |
| `workbench.surface.contentOpacity`  | `50`                                           | window      | How opaque the extra layer under the editor, terminal and settings is. It sits on top of the panel, so 0 leaves them as see-through as a sidebar.               |
| `workbench.surface.blur`            | `9`                                            | window      | Backdrop blur radius, in pixels, behind translucent surfaces.                                                                                                   |
| `workbench.surface.saturation`      | `160`                                          | window      | Backdrop saturation, as a percentage, behind translucent surfaces.                                                                                              |
| `workbench.surface.continuousSeams` | `false`                                        | window      | Paint one background across panels and the resize handles between them, so the panels read as one surface. Off, the wallpaper shows in the gaps between panels. |
| `workbench.wallpaper`               | `{"enabled":true,"source":{"kind":"desktop"}}` | application | Choose a wallpaper and turn it on or off without losing the selection.                                                                                          |
| `workbench.tree.indentGuides`       | `"always"`                                     | window      | When to show indentation guides in the file tree. Guides take editor colours while the tree is hovered.                                                         |

### Details

- `workbench.theme`: Picking a theme sets the app colors, code colors, wallpaper and surfaces at once. Changes you make afterwards are saved for that theme and come back when you pick it again. With no theme, the app uses Graphite colors, Dark+ and Light+ code colors and the desktop wallpaper.
- `workbench.reduceMotion`: Applies to the terminal app: its spinners and loaders run at half speed. The web app follows the operating system's reduce-motion setting.
- `workbench.fontFamily`: Bundled fonts ship with the app and load with no network. Installed fonts come from the server machine's fontconfig (fc-list), so a font installed there works on every device; a server without fontconfig lists none.
- `workbench.feel`: Flat moves on fixed durations with flat controls. Seam, Brisk, Relaxed and Playful move on springs and give controls raised keys, sunken wells and squircle corners (squircles in Chromium only). Under reduced motion every feel uses fades.
- `workbench.surface.contentOpacity`: This layer sits over the panel's own surface, so 50 over a panel at 80 makes the ground behind code and terminal text 90% opaque: text stays readable and a trace of the wallpaper shows through.
- `workbench.surface.blur`: Capped at 40 px. A repository's settings file can set this, and a large backdrop blur costs GPU time on every frame.
- `workbench.wallpaper`: Desktop shows the server machine's current wallpaper: Omarchy's current background on Linux, the desktop picture on macOS. On a Linux screen the compositor already shows the desktop behind the window, so Desktop draws nothing there.

## Chat

| Setting                              | Default                                                                                     | Scope       | What it does                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.followUpBehavior`              | `"queue"`                                                                                   | application | Queue messages sent during a running turn, or send them at once as corrections. The alternate send key (Ctrl/Cmd+Enter, or Shift+Ctrl/Cmd+Enter where Ctrl/Cmd+Enter sends) takes the other behavior.                                                                                                                  |
| `chat.sendShortcut`                  | `"enter"`                                                                                   | application | Which key sends a message. enter: Enter sends and Shift+Enter adds a line. mod-enter-multiline: like enter until the message has a second line, then Ctrl/Cmd+Enter sends. mod-enter: Ctrl/Cmd+Enter sends and Enter adds a line. Where Ctrl/Cmd+Enter sends, Shift+Ctrl/Cmd+Enter takes the other follow-up behavior. |
| `chat.planModeEnabled`               | `false`                                                                                     | application | Show the Plan mode picker and /plan and /default commands for providers that support them. Stored draft preferences are retained while hidden.                                                                                                                                                                         |
| `chat.activeFileContext`             | `false`                                                                                     | application | Show the file open in the editor as a chip in the composer. While the chip is there, sending mentions that file. Remove the chip to send without it.                                                                                                                                                                   |
| `chat.contextWindowMeterEnabled`     | `true`                                                                                      | application | Show how full the session's context window is, in the composer and the session header.                                                                                                                                                                                                                                 |
| `chat.responseStreamingMode`         | `"paragraph"`                                                                               | application | Publish assistant responses by paragraph, complete turn, or individual token.                                                                                                                                                                                                                                          |
| `chat.projectResponseStreamingModes` | `{}`                                                                                        | application | Response streaming mode overrides keyed by project UUID on this machine.                                                                                                                                                                                                                                               |
| `chat.notificationMode`              | `"off"`                                                                                     | application | Notify when a session needs attention or completes. Native notifications require browser permission; sound starts after a pointer or keyboard gesture.                                                                                                                                                                 |
| `chat.inAppNotificationsEnabled`     | `false`                                                                                     | application | Show an Open session action when another session needs attention or completes while this window is focused.                                                                                                                                                                                                            |
| `chat.pushNotifications`             | `false`                                                                                     | application | Push to every device registered below when a session needs attention or completes. Held back while a window of this server is visible and focused.                                                                                                                                                                     |
| `chat.textGenerationModel`           | `{"providerInstanceId":"codex","model":"gpt-5.6-luna","options":{"reasoningEffort":"low"}}` | application | Provider and model that write session titles.                                                                                                                                                                                                                                                                          |
| `chat.projectTextGenerationModels`   | `{}`                                                                                        | application | Title generation model overrides keyed by project UUID on this machine.                                                                                                                                                                                                                                                |
| `chat.sessionSortOrder`              | `"updated_at"`                                                                              | application | Order sessions in the palette, and pick which session opens after a deletion, by latest user activity or by creation time.                                                                                                                                                                                             |
| `chat.confirmSessionDelete`          | `true`                                                                                      | application | Ask before permanently deleting one or more sessions.                                                                                                                                                                                                                                                                  |
| `chat.projectGrouping`               | `"repository"`                                                                              | application | Group projects by repository, repository-relative path, or owning machine. Git projects currently register at the repository root, so both repository modes are equivalent.                                                                                                                                            |
| `chat.autoSettleAfterDays`           | `3`                                                                                         | application | Move a session to Settled once it has had no activity for this many days, including existing sessions. 0 turns it off.                                                                                                                                                                                                 |
| `chat.autoSettleOnMerge`             | `true`                                                                                      | application | Move a session to Settled when its worktree's pull request is merged. A closed pull request settles it whenever automatic settlement is on.                                                                                                                                                                            |
| `chat.projectAutoSettle`             | `{}`                                                                                        | application | Automatic settlement overrides keyed by project UUID on this machine.                                                                                                                                                                                                                                                  |
| `chat.projectGroupingOverrides`      | `{}`                                                                                        | application | Grouping mode per scoped project key (environment UUID:project UUID).                                                                                                                                                                                                                                                  |
| `chat.keepImportedSessionsUpdated`   | `true`                                                                                      | machine     | Imported chats receive one-way updates from local history until you send their first message in Platform. New chats are only imported when you click Import.                                                                                                                                                           |
| `chat.defaultRuntimeMode`            | `"full-access"`                                                                             | application | Permission posture a new session starts in.                                                                                                                                                                                                                                                                            |
| `chat.defaultInteractionMode`        | `"default"`                                                                                 | application | Whether a new session starts in plan mode. Applies while `chat.planModeEnabled` is on.                                                                                                                                                                                                                                 |

### Details

- `chat.activeFileContext`: The chip names the file relative to the workspace. Removing it lasts until the editor's active file changes.
- `chat.contextWindowMeterEnabled`: Claude reports what fills the window: system prompt, tools, messages, and the reserve kept for compaction. Other providers show the turn's token counts. The meter's popover also shows the session's tokens and cost.
- `chat.responseStreamingMode`: Paragraph publishes text at blank lines, closed code fences and new list items: the first break at once, later ones at least 400 ms apart. The end of the turn, a question from the agent, or 24,000 buffered characters flushes the rest. Token mode still delivers reasoning by paragraph.
- `chat.pushNotifications`: Only live changes push: replaying history, recovering after a restart and archived sessions never notify. A device the push service rejects with 404 or 410 is removed.
- `chat.textGenerationModel`: Titles use gpt-5.6-luna at low effort through Codex. When Codex is disabled or missing, the server uses the first enabled provider in the order Codex, Claude, Cursor, Grok, OpenCode, Antigravity, with that provider's small model. A failed title request keeps the current title and logs a warning.
- `chat.projectGrouping`: Repository puts one repository's checkouts on this machine and on connected machines under one project row. Separate gives each machine's project its own row.
- `chat.autoSettleAfterDays`: The server checks every 5 minutes. A session with an open pull request, a pending approval or question, a queued or running turn, or live background work stays unsettled.
- `chat.autoSettleOnMerge`: A merge or close counts when it happens after your last request in the session.
- `chat.keepImportedSessionsUpdated`: The server rescans local Claude and Codex history every minute and brings imported chats up to date. A chat stops updating once it has a turn sent from Platform.
- `chat.defaultRuntimeMode`: Full access suits a machine with one owner who trusts agents with its checkouts: Codex starts with approval policy never and sandbox danger-full-access, and Claude pre-approves every tool. This is an application setting, so a workspace file in a cloned repository cannot change it.

## Developer

| Setting                              | Default | Scope       | What it does                                                                                                                                                                                      |
| ------------------------------------ | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `developer.simulatedLatencyMs`       | `0`     | application | Milliseconds added before every request to the server, to see how the app behaves on a slow link. Zero disables it.                                                                               |
| `developer.devServerIdleMinutes`     | `15`    | machine     | Minutes the shared dev server keeps running after its last connection closes; mesh then stops it and starts it again on the next connection. Takes effect the next time `bun run dev:serve` runs. |
| `developer.deployRestartWaitMinutes` | `30`    | machine     | Minutes `bun run deploy --restart` waits for running sessions to finish before it gives up. `--interrupt` restarts at once and ends those turns.                                                  |

### Details

- `developer.deployRestartWaitMinutes`: Thirty minutes covers a typical agent turn. A session busy for longer is usually stuck or running background work, and deploy --interrupt ends it.

## Editor

| Setting                                       | Default                    | Scope       | What it does                                                                                                                                                                                                                                                     |
| --------------------------------------------- | -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.fontFamily`                           | `"bundled:jetbrains-mono"` | window      | Font for the editor, the terminal, and code and metadata across the app.                                                                                                                                                                                         |
| `editor.fontSize`                             | `13`                       | window      | Editor font size in pixels.                                                                                                                                                                                                                                      |
| `editor.lineHeight`                           | `24`                       | window      | Editor row height in pixels.                                                                                                                                                                                                                                     |
| `editor.tabSize`                              | `4`                        | window      | Width of a tab character, in spaces. Also the indentation width for a file whose own cannot be detected.                                                                                                                                                         |
| `editor.history.retainedStates`               | `200`                      | application | Earlier states kept per open file, across every undo branch. The least recently visited go first when the budget is exceeded.                                                                                                                                    |
| `editor.history.persist`                      | `true`                     | application | Keep undo history for closed files in this browser, so reopening a file or reloading the window brings it back. A file that changed on disk in the meantime starts fresh.                                                                                        |
| `editor.history.persistDays`                  | `30`                       | application | Days a closed file keeps its stored undo history before it is dropped. Applies while `editor.history.persist` is on.                                                                                                                                             |
| `editor.history.persistBudget`                | `67108864`                 | application | Total stored undo history across closed files, in UTF-16 code units. The least recently saved files go first when it is exceeded. Applies while `editor.history.persist` is on.                                                                                  |
| `editor.markdownView`                         | `"preview"`                | window      | How markdown files open: source text, source beside a rendered view, or rendered in place while you edit. Cycle markdown view changes one file.                                                                                                                  |
| `editor.diff.viewMode`                        | `"stacked"`                | window      | Show diffs side by side or stacked.                                                                                                                                                                                                                              |
| `editor.inputRoute`                           | `"edit-context"`           | application | How typed text reaches the editor. EditContext (Chromium) hands IME, autocorrect and dictation edits to the editor with their exact ranges. Other browsers use a hidden textarea. _(restart)_                                                                    |
| `editor.retainedTextBudget`                   | `67108864`                 | machine     | Total text the editor keeps resident across the active and parked projects, in UTF-16 code units, re-checked at a project switch and a tab close. The active project is charged first and is never trimmed, so a large one leaves less room for parked projects. |
| `editor.unicodeHighlight.ambiguousCharacters` | `true`                     | window      | Highlight Unicode characters that resemble other characters. Hover a highlight for an explanation.                                                                                                                                                               |
| `editor.unicodeHighlight.invisibleCharacters` | `true`                     | window      | Highlight invisible Unicode characters. Hover a highlight for its code point.                                                                                                                                                                                    |
| `editor.unicodeHighlight.allowedCharacters`   | `""`                       | window      | Characters allowed without Unicode highlighting. Paste the characters here, for example an en dash.                                                                                                                                                              |
| `editor.minimap.enabled`                      | `true`                     | window      | Show the minimap beside the editor. _(restart)_                                                                                                                                                                                                                  |
| `editor.guides.indentation`                   | `true`                     | window      | Draw indentation guides (scope lines). _(restart)_                                                                                                                                                                                                               |
| `editor.syntaxHighlighting.enabled`           | `true`                     | window      | Colour code by syntax. Turning this off makes very large files faster. _(restart)_                                                                                                                                                                               |
| `editor.decode.mode`                          | `"off"`                    | window      | Animate a file as it opens, as if it were being written. _(restart)_                                                                                                                                                                                             |

### Details

- `editor.fontFamily`: Also the terminal font. A code font without Nerd Font icons borrows them from Nerd Fonts Symbols Only, so terminal prompts keep their glyphs. Installed fonts come from the server machine (fc-list).
- `editor.tabSize`: Diffs skip indentation detection, so tabs in a diff always use this width.
- `editor.history.retainedStates`: A state is a run of typing. Each retained state keeps its text snapshot in memory, and each edit copies a map of them: 1,000 commits with pruning took 4.55 ms under Bun in the Editor's undo-graph measurement.
- `editor.history.persistBudget`: Same ceiling as the retained text budget, capped at 1 GiB because browser storage is shared with every other site. A single history larger than the budget is skipped.
- `editor.markdownView`: Live preview draws markdown from tree-sitter's markdown captures, so with syntax highlighting off a file shows as source. Split view renders with the chat's markdown renderer.
- `editor.inputRoute`: In the editor-edit-context-input scenario, an IME correction over the first word yields Hello日本 on EditContext and hello日本Hello on the textarea. EditContext is Chromium-only; Firefox and Safari use the textarea whatever this says.
- `editor.retainedTextBudget`: Checked at a project switch and at a tab close, so opening two large projects can exceed it until the next switch or close. Counted in UTF-16 code units, which equals bytes for ASCII text. Parked documents over the budget are dropped and reload from disk when you switch back.
- `editor.unicodeHighlight.ambiguousCharacters`: A confusable character looks like an ASCII one, so the Cyrillic а in pаssword names a different identifier from the one you read. Typographic punctuation such as an en dash also counts; add it to Allowed characters to stop highlighting it.
- `editor.unicodeHighlight.invisibleCharacters`: An invisible character draws nothing. A bidirectional override can reorder a line so the code the compiler reads differs from the line on screen.
- `editor.decode.mode`: Autoregressive types one character at a time, line after line. Parallel types every line at once, staggered. Token streams one token at a time, like a language model. Diffusion settles scrambled glyphs into the text.

## Files

| Setting                        | Default  | Scope       | What it does                                                                                                                                                                         |
| ------------------------------ | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `files.autoSave`               | `"off"`  | window      | Save edited files automatically, and when.                                                                                                                                           |
| `files.autoSaveDelay`          | `1000`   | window      | Milliseconds of quiet before an automatic save, when saving after a delay.                                                                                                           |
| `files.picker.view`            | `"auto"` | application | How the file picker shows a folder: columns, a list, or icons. Auto uses columns when choosing a folder and a list when choosing a file.                                             |
| `files.previewKilobytes`       | `64`     | application | Kilobytes of a text file the file picker and quick open read for their preview. A longer file shows its first part and says how much of it that is.                                  |
| `files.showHidden`             | `false`  | window      | Show dot-prefixed files and folders in file pickers.                                                                                                                                 |
| `files.watchDirectoryLimit`    | `200000` | machine     | How many folders all open workspaces may watch for live changes together. A workspace that would pass it updates its top level and open files only.                                  |
| `files.searchIndexLimit`       | `4`      | machine     | How many open folders keep a file index for fast search at once. Opening one more drops the least recently used index; search there reads the disk until the folder is opened again. |
| `files.searchIndexIdleMinutes` | `15`     | machine     | Minutes a folder keeps its file index after the last window showing it closes, so reopening it searches at full speed at once.                                                       |

### Details

- `files.watchDirectoryLimit`: Each watched folder uses one inotify watch from a per-user pool that every watcher on the machine shares (524,288 on the owner's machine). Opening /work took 484,687 watches and other apps began failing with ENOSPC. 200,000 fits four roots the size of the Platform checkout (45,036 folders) and leaves 62% of the pool free.

## Git

| Setting                              | Default       | Scope   | What it does                                                                                                                                                                                                                    |
| ------------------------------------ | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git.autoPull`                       | `false`       | machine | Fast-forward a project checkout on its default branch when its upstream moves. A checkout with changes, local commits or another branch checked out is left alone.                                                              |
| `git.projectAutoPull`                | `{}`          | machine | Automatic default-branch pull keyed by project UUID on this machine.                                                                                                                                                            |
| `git.worktreeSubmodules`             | `"recursive"` | machine | Initialize every nested submodule, only the ones this repository declares, or none when a session creates a worktree.                                                                                                           |
| `git.projectWorktreeSubmodules`      | `{}`          | machine | Submodule modes for new worktrees keyed by project UUID on this machine.                                                                                                                                                        |
| `git.worktreeCleanupOnDelete`        | `false`       | machine | Remove a session worktree once every session using it is deleted and has stopped, including earlier deletions. A worktree with uncommitted changes, ignored files other than node_modules, or another branch checked out stays. |
| `git.projectWorktreeCleanupOnDelete` | `{}`          | machine | Worktree removal after the last session is deleted, keyed by project UUID on this machine.                                                                                                                                      |

### Details

- `git.autoPull`: Checked on each Git status read after the background fetch moves the upstream. After a failed pull the next try waits 60 seconds. The Git panel shows why a pull was skipped.
- `git.worktreeSubmodules`: Runs git submodule update --init after the worktree is created, with --recursive in the recursive mode. Credential prompts are off and the step stops after 15 minutes. A failed step keeps the worktree, and the Git panel offers Initialize to retry.
- `git.worktreeCleanupOnDelete`: While this is off, the delete dialog offers removal for that one deletion. node_modules is allowed because a package install recreates it.

## Keyboard shortcuts

| Setting                 | Default     | Scope       | What it does                                                                                                                                                  |
| ----------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keybindings.preset`    | `"default"` | application | Shortcuts your overrides apply on top of. VS Code keeps VS Code bindings. Platform starts from them and adds its own keys for tabs, chats and sidebar panels. |
| `keybindings.overrides` | `{}`        | application | Every command and its keys.                                                                                                                                   |

### Details

- `keybindings.overrides`: In settings.json this is command id to its complete list of shortcuts, each one hotkey or two separated by a single space. A missing command keeps its defaults; null or an empty list unbinds it.

## Language servers

| Setting                        | Default  | Scope   | What it does                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lsp.experimental.tyForPython` | `false`  | machine | Run ty as the Python language server. Off runs pyright. Files already open keep their current server until reopened.                                                                                                                                                                                                                       |
| `lsp.idleTimeoutMs`            | `120000` | machine | Milliseconds an unused language server stays alive after the last editor disconnects. 0 shuts it down immediately.                                                                                                                                                                                                                         |
| `lsp.downloadRuntimes`         | `true`   | machine | Download missing language servers on demand. Off means only servers already on PATH are used.                                                                                                                                                                                                                                              |
| `lsp.servers`                  | `{}`     | machine | Per-server overrides: extensions and feature ranks apply when a document is matched; command, env, and initialization apply on the next backend start. Set a feature to null to exclude that server. A running backend keeps its old process options until it idles out.                                                                   |
| `lsp.languageServers`          | `{}`     | machine | Which language servers may serve a file type, keyed by extension ('.json'). Values are server ids in preference order, '!id' drops a server, and '...' keeps the rest. Naming a registered server explicitly enables it for matching file types even without its project marker. Open documents keep their current servers until reopened. |
| `lsp.semanticTokens.enabled`   | `false`  | machine | Ask language servers to colour identifiers they have actually resolved. Off means no token request is ever sent. Each server still has its own default under lsp.semanticTokens.servers.                                                                                                                                                   |
| `lsp.semanticTokens.delta`     | `true`   | machine | Ask delta-capable language servers for only the tokens an edit changed. Saves bandwidth, parse time and garbage on every keystroke. Applies while `lsp.semanticTokens.enabled` is on.                                                                                                                                                      |
| `lsp.semanticTokens.servers`   | `{}`     | machine | Server id to true or false, overriding the per-server default. Turns one server's semantic colour on or off while the feature stays on.                                                                                                                                                                                                    |

### Details

- `lsp.semanticTokens.enabled`: Server colour paints over the syntax highlighter's colour. On a first open with no saved paint, a warm server can answer before the highlighter has run, so identifiers take colour while the rest of the text is still plain, for up to about a second and a half. Reopening a file with a saved paint is unaffected.
- `lsp.semanticTokens.delta`: Measured with rust-analyzer on hashbrown's map.rs (197 KB, 11,978 tokens) over twelve keystrokes: whole files cost 1.60 MB, 14.1 ms of JSON.parse and 9.0 MB of heap; deltas cost 1.9 KB, 0.1 ms and 2.0 MB, at the same latency. About 5 of 37 servers support delta.
- `lsp.semanticTokens.servers`: Six servers are measured and on by default: rust-analyzer 1.88.0, gopls v0.21.0, clangd, zls 0.16.0, terraform-ls and typescript-language-server. A server nobody has measured stays off until named here.

## Logs

| Setting                 | Default | Scope   | What it does                                                                                                                                       |
| ----------------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logs.defaultTimeRange` | `"1h"`  | window  | Time range the logs view opens on.                                                                                                                 |
| `logs.retentionDays`    | `0`     | machine | Days of server log files this machine keeps, today included; older days are deleted once a day. 0 keeps every day, up to the writer's 60-file cap. |
| `logs.slowThresholdMs`  | `500`   | window  | How many milliseconds counts as a slow operation.                                                                                                  |

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

### Details

- `models.hidden`: Only turned-off models are stored, so a model a provider adds later appears in the picker on its own.

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

### Details

- `search.maxResults`: 20,000 is VS Code's default cap. Once a parallel ripgrep run is cut off, which matches it returns can change from run to run, so the cap sits high enough that this is rare. The server refuses larger values.
- `search.maxResultFiles`: Every file in the results holds at least one match, so at the default the match limit always stops a search first. It takes effect when set below the match limit.

## Sounds

| Setting                         | Default | Scope       | What it does                                                                              |
| ------------------------------- | ------- | ----------- | ----------------------------------------------------------------------------------------- |
| `workbench.sounds.controls`     | `false` | application | Play clicks when pressing controls and changing values with the pointer.                  |
| `workbench.sounds.errors`       | `false` | application | Play a short rattle when an error toast appears.                                          |
| `workbench.sounds.git`          | `false` | application | Play two rising clicks when a commit is created, a push finishes or a pull request opens. |
| `workbench.sounds.terminalBell` | `false` | application | Play a click when a terminal program rings the bell.                                      |
| `workbench.sounds.volume`       | `50`    | application | Loudness of every sound, agent notifications included.                                    |

### Details

- `workbench.sounds.controls`: Only pointer presses click. Keyboard presses stay silent, and nothing sounds while the tab is hidden.
- `workbench.sounds.terminalBell`: At most one bell every 500 ms. Silent while the tab is hidden.
- `workbench.sounds.volume`: Agent notification sounds (turn finished, input requested) play through this volume too. At 100 they play at their recorded level.

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

### Details

- `window.transparency`: A per-pixel transparent window switches the embedded Chromium renderer to off-screen rendering. On macOS a 1440×960 window then copies 5.5 MB through the CPU on every paint, where the opaque window produced no paint events at all. On Linux the window manager already blends an opaque window over the desktop.
