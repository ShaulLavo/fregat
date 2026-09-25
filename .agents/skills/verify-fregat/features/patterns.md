# Pattern lists

Shared rows keep one focused container and expose its active row through `aria-activedescendant`. Arrow keys move the active row; Enter commits it. Tree rows expand and collapse with Right and Left.

## Breadcrumbs

Click an editor file breadcrumb for its sibling folders and files, or a symbol breadcrumb for document symbols. `scenario breadcrumb-picker` creates a disposable TypeScript workspace, expands a folder, navigates its child, and moves between symbols. It checks that rows stay out of the tab order and one row remains selected.

## References

Run **Find references** while the caret is on a symbol. `scenario lsp-references` opens actual TypeScript references in a disposable workspace, moves from the group header into its results, and collapses the group. The preview and selected row must follow the cursor without moving DOM focus out of the results tree.

## Machine discovery

Open the project menu and choose **Connect machine…**, then **Add machine** when saved machines exist. `scenario environments-dialog` opens discovery without connecting. It navigates existing SSH hosts when discovery returns any; an empty machine has only the discovery screenshot, so use the real-server SSH picker test for its seeded keyboard case.

`scenario machine-connect-error` chooses the first saved machine in **Connect machine…**, requires its error to fit the dialog without sideways scroll, presses **Fix with AI** and requires the dialog to close and the error report to land in a new chat composer. It needs a saved machine that refuses; with none it stops after the picker screenshot. The same Fix with AI sits on every error toast, `EmptyState` in the error tone (so every `ToolPane` and render-error fallback), and the inline `InlineError` sites.

## Assistant changed files

Expand a session's **Changed files** section. `scenario chat-changed-files` inspects up to eight existing sessions without sending a message. It navigates an available checkpoint tree and records `treeAvailable` in `inspection.json`; false means the environment has no existing checkpoint tree to exercise. The real-server assistant changed-files section tests cover empty and populated checkpoints independently.

## Workbench lists

`scenario workbench-list-focus` walks the titlebar, files, git changes, logs, terminal tabs and session rail. It enters and exits each list with Tab, asserts no extra row stops, and checks arrow navigation and session group collapse/expand. The file tree retains its existing single roving row in its shadow root. Terminal processes opened by this scenario are isolated and removed at the end.

`scenario file-picker` checks virtual row positions, typeahead-ready focus and End navigation in the folder picker. `scenario file-picker-navigation` checks Backspace/Left from empty folders and page navigation across grouped search headings. `scenario git-history-scroll` leaves and reopens scrolled history without selecting a commit. `scenario search-results` searches the workspace and checks result selection and file-group collapse. `scenario terminal-tabs` checks navigation, rename, keyboard reordering, and pointer activation returning focus to terminal input. `scenario session-rail` opens existing conversations without sending messages, then picks up a row with Space, moves it with an arrow and cancels with Escape. Cancellation must preserve the saved order and return focus to the list.

`scenario git-changes` checks selection and the keyboard context menu. `scenario git-graph-keyboard` walks commit history and opens a historical file. `scenario logs-panel` checks cursor movement and event expansion; it filters filesystem events because older server builds can emit identical chat events with colliding log IDs.

`scenario chat-timeline` finds an existing scrollable transcript, checks that virtual rows do not overlap, pages through it and returns to the end. It never sends a message. `trace files-tree` measures actual keyboard navigation on the tree's focused row.

## Icon hints

`scenario pattern-hints` hovers the workbench chat actions, opens conversation history and palette-card actions, and closes the wallpaper picker through its hinted close button. It does not create a session, change a palette, or select a wallpaper. The menu screenshots prove that composing TooltipTrigger with a second Base UI trigger preserves both actions.

`scenario icon-hints` checks shared Git toolbar actions, history search clearing, dialog closing, and Search actions. It checks native titles do not duplicate tooltips, opens and closes the history dialog, and verifies disabled Search actions retain their appearance and expose hints through hover and keyboard focus.

## Render error boundaries

`pane-render-crash` opens Logs, makes the log time formatters throw from outside the app, and checks that only the pane body shows "hit a render error" while the toolbar, rail, editor and terminal stay. It then restores the formatter and clicks Retry; the rows must come back. The crash must appear once in the log as `react.caught_error`.

## Surface stacking

Surface tokens are translucent, so painting one inside a region that already paints it doubles the alpha instead of changing the tone — an extra layer over the wallpaper, invisible over a flat background. `scenario surface-stacking` walks the four sidebar tabs and chat mode, and records in `inspection.json` every element whose painted background matches a painted ancestor, with its box so you can find it on the screenshot. Pairs whose ancestor is the root shell or `body` sit behind the wallpaper and do not paint; everything else is a real double. Run it after touching any pane, bar, field or chip background.

## Copy feedback

Every explicit copy goes through `lib/clipboard.ts`, which tries `navigator.clipboard.writeText`, then `navigator.clipboard.write`, then `document.execCommand('copy')`. Menus toast "Copied {label}"; inline `CopyButton`s turn into a check and never toast. `scenario copy-feedback` copies a setting ID from its row menu, a relative path from the file tree menu and an existing assistant response (read only, no message sent), reading the clipboard after each. It then refuses both async methods in the page and copies the setting ID again, which proves the `execCommand` fallback in real Chrome.

## File labels

`FileLabel` (`components/file-label.tsx`) draws a file as icon, basename, then muted directory, so a right cut eats the directory; `FileStatusCell` draws the change letter. Git rows, Search group headers (sidebar and editor), the Turn panel and the timeline's changed-files tree share them. `scenario file-label-cohesion` makes a disposable repository, registers it as its own project, and runs a native checkpoint fixture (`fixtures/native-checkpoint.mjs`, no tokens) whose turn adds, deletes, renames and modifies named files. It asserts A/D/R/M in both the timeline tree and the Turn panel, then basename-first rows in Search and Git for a file twelve directories deep. It deletes the session, project and provider it created and releases the fixture; `inspection.json` records each.
