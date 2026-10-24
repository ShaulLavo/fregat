# Raw web keyboard handler audit

Plan 206. Status: Approved. This census reads the raw lane source based on `b4d1fc6175ec9f49cc35049944d0f500de1092ea`. It includes explicit props, native registrations, constructor boundaries, forwarding references, and Lexical input commands. Shared lanes are labelled and unchanged by this lane.

Reproduce the explicit-site census with:

```sh
rg -n 'onKeyDown|["']keydown["']|useHotkeys|useHotkey\(' apps/web/src --glob '!*.test.*' --glob '!*.browser.*'
```

## Converted shortcuts

| Path                                                                     | Command                                                                                                                                         | Context                              | Disposition                                                                                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/features/chat/hooks/use-prompt-stash.ts`                   | `chat.stashPrompt`                                                                                                                              | `Chat > Composer`                    | converted shortcut. Raw window capture Mod+S listener removed.                                                                 |
| `apps/web/src/features/chat/hooks/use-question-digits.ts`                | `question.select1 through question.select9`                                                                                                     | `Chat > Question`                    | converted shortcut. useHotkeys removed; fixed handler map samples current question and availability.                           |
| `apps/web/src/features/chat/components/pending-user-input-card.tsx`      | `question.select1 through question.select9`                                                                                                     | `Chat > Question`                    | converted shortcut. Returned node ref attaches to the visible card; typing elsewhere yields.                                   |
| `apps/web/src/features/git/components/commit-controls.tsx`               | `git.commit`                                                                                                                                    | `Sidebar > Git > GitCommit`          | converted shortcut. Raw Mod+Enter prop removed; input ref attaches the command node.                                           |
| `apps/web/src/features/workspace/hooks/use-tree-keyboard.ts`             | `fileTree.selectAll, fileTree.toggleMark, fileTree.rename`                                                                                      | `Sidebar > FileTree > TreeSelection` | converted shortcut. Mod+A, Mod+Space and F2 raw action branches removed; controller actions remain.                            |
| `apps/web/src/components/file-picker-dialog.tsx`                         | `filePicker.navigateBack, filePicker.navigateForward, filePicker.openSelected, filePicker.goToFolder, filePicker.toggleHidden, filePicker.goUp` | `Dialog > FilePicker`                | converted shortcut. Modified shortcut capture branches removed. Input and search cancellation remain.                          |
| `apps/web/src/features/theme-studio/components/dock.tsx`                 | `themeStudio.close, themeStudio.toggleMode, themeStudio.apply`                                                                                  | `Settings > ThemeStudio`             | converted shortcut. Raw Escape/backslash actions removed. Apply uses the existing async action and narrows to the themes list. |
| `apps/web/src/features/theme-studio/components/themes-tab.tsx`           | `themeStudio.apply`                                                                                                                             | `Settings > ThemeStudio`             | converted shortcut. List Enter action route removed; navigation remains and Enter yields to the node.                          |
| `apps/web/src/features/workbench/components/terminal-list.tsx`           | `terminal.rename, terminal.close`                                                                                                               | `TerminalList`                       | converted shortcut. F2/Delete synthetic forwarding removed; exact active list row is used.                                     |
| `apps/web/src/features/workbench/components/terminal-list-row.tsx`       | `terminal.rename, terminal.close`                                                                                                               | `TerminalList`                       | converted shortcut. Raw F2/Delete branches removed. Rename state is owned by the list.                                         |
| `apps/web/src/features/chat/components/chat-input-submit-plugin.tsx`     | `chat.sendMessage`                                                                                                                              | `Chat > Composer`                    | converted shortcut. Lexical submit action removed. Completion, IME and newline composition remain native editing.              |
| `apps/web/src/features/chat/components/chat-input-paste-fold-plugin.tsx` | `chat.pasteAsText`                                                                                                                              | `Chat > Composer`                    | converted shortcut. Raw KEY_DOWN paste-arm shortcut removed; PASTE_COMMAND remains the clipboard boundary.                     |

Handlers return false when unavailable and true after invoking the existing domain mutation or intent. Shared catalog and preset data are supplied by the integrator. No new synthetic shortcut route is added.

## Explicit production sites

The census has 65 textual sites. Forwarding references and pure event-type spellings are labelled; they are not additional listeners. Listener cleanup lines are omitted.

| Exact source site                                                               | Disposition        | Behavior                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/chat-draft-rail.tsx:151`                               | navigation         | Draft list navigation and activation. Stop propagation only after the list consumes a key.                                     |
| `apps/web/src/components/chat-draft-rail.tsx:152`                               | navigation         | Draft list navigation and activation. Stop propagation only after the list consumes a key.                                     |
| `apps/web/src/components/file-picker-dialog.tsx:576`                            | widget             | Search Enter/Up/Down and Escape for path edit or search cancellation. Six modified shortcuts are converted below.              |
| `apps/web/src/components/file-picker-dialog.tsx:699`                            | widget             | Search Enter/Up/Down and Escape for path edit or search cancellation. Six modified shortcuts are converted below.              |
| `apps/web/src/components/git-file-row.tsx:88`                                   | navigation         | Enter/Space row activation and keyboard context menu.                                                                          |
| `apps/web/src/components/pdf-viewer/document.tsx:72`                            | widget             | Enter/Shift+Enter advances the PDF search result.                                                                              |
| `apps/web/src/components/review-comment-input.tsx:30`                           | native-editing     | Escape cancels the inline text draft.                                                                                          |
| `apps/web/src/features/chat/components/chat-image-lightbox.tsx:44`              | navigation         | Left/Right gallery browsing.                                                                                                   |
| `apps/web/src/features/chat/components/model-picker.tsx:187`                    | widget             | Passive Shift observation for additive model selection.                                                                        |
| `apps/web/src/features/chat/components/timeline-minimap.tsx:58`                 | navigation         | Timeline minimap slider movement and Home/End.                                                                                 |
| `apps/web/src/features/chat/state/timeline-navigation.ts:91`                    | navigation         | Transcript viewport scrolling, start/end navigation and follow-tail state.                                                     |
| `apps/web/src/features/chat-mode/components/project-rename-dialog.tsx:89`       | native-editing     | Enter commits the typed project name.                                                                                          |
| `apps/web/src/features/chat-mode/components/session-rail.tsx:270`               | navigation         | Rail selection cancellation, list/group navigation, keyboard drag and row menus.                                               |
| `apps/web/src/features/chat-mode/components/session-rail.tsx:407`               | navigation         | Rail selection cancellation, list/group navigation, keyboard drag and row menus.                                               |
| `apps/web/src/features/chat-mode/components/session-rail.tsx:415`               | navigation         | Rail selection cancellation, list/group navigation, keyboard drag and row menus.                                               |
| `apps/web/src/features/command-palette/components/content.tsx:423`              | widget             | Backspace exits a palette sub-picker when its input is empty.                                                                  |
| `apps/web/src/features/editor/components/frame.tsx:84`                          | widget             | Overlay Escape and keyboard text-menu access. Editor lane owns this path.                                                      |
| `apps/web/src/features/editor/components/history-graph-strip.tsx:25`            | navigation         | Type declaration, destructuring and graph handler forwarding. Editor lane owns this path.                                      |
| `apps/web/src/features/editor/components/history-graph-strip.tsx:36`            | navigation         | Type declaration, destructuring and graph handler forwarding. Editor lane owns this path.                                      |
| `apps/web/src/features/editor/components/history-graph-strip.tsx:72`            | navigation         | Type declaration, destructuring and graph handler forwarding. Editor lane owns this path.                                      |
| `apps/web/src/features/editor/components/history-pane.tsx:193`                  | navigation         | History graph cursor, comparison and selection. Restore/undo app action conversion belongs to editor lane.                     |
| `apps/web/src/features/file-picker/components/icons-view.tsx:74`                | navigation         | Grid/typeahead and Backspace parent-folder navigation.                                                                         |
| `apps/web/src/features/file-picker/components/icons-view.tsx:108`               | navigation         | Grid/typeahead and Backspace parent-folder navigation.                                                                         |
| `apps/web/src/features/file-picker/components/list.tsx:102`                     | navigation         | File list/typeahead and unmodified folder traversal.                                                                           |
| `apps/web/src/features/file-picker/components/list.tsx:115`                     | navigation         | File list/typeahead and unmodified folder traversal.                                                                           |
| `apps/web/src/features/file-picker/components/location-bar.tsx:92`              | native-editing     | Enter completes the directory path field.                                                                                      |
| `apps/web/src/features/file-picker/components/picker-column.tsx:120`            | navigation         | Column list/typeahead and left/right folder traversal.                                                                         |
| `apps/web/src/features/file-picker/components/picker-column.tsx:178`            | navigation         | Column list/typeahead and left/right folder traversal.                                                                         |
| `apps/web/src/features/phone/components/terminal-keys.tsx:78`                   | native-editing     | Existing touch keyboard input adapter emits terminal keystrokes. Terminal host integration owns this boundary; unchanged here. |
| `apps/web/src/features/search/components/history-input.tsx:82`                  | native-editing     | Up/Down recalls input history.                                                                                                 |
| `apps/web/src/features/search/components/result-editor-surface.tsx:204`         | navigation         | Result tree cursor, expansion, activation and row menus.                                                                       |
| `apps/web/src/features/search/components/result-file-editor.tsx:228`            | native-editing     | Readonly excerpt input protection and result activation. Shared editor adapter changes are integrator-owned.                   |
| `apps/web/src/features/search/components/results-view.tsx:128`                  | navigation         | Result list, menu access, F2 focus to nested replace control and Escape focus return.                                          |
| `apps/web/src/features/search/components/results-view.tsx:177`                  | navigation         | Result list, menu access, F2 focus to nested replace control and Escape focus return.                                          |
| `apps/web/src/features/settings/components/keybinding-section.tsx:71`           | widget             | Passive hardware-keyboard observation; settings lane owns this path.                                                           |
| `apps/web/src/features/settings/components/page.tsx:263`                        | navigation         | Escape restores settings search focus; settings lane owns this path.                                                           |
| `apps/web/src/features/settings/components/shortcut-recorder.tsx:83`            | native-editing     | Binding recorder input; dispatcher must yield. Settings lane owns this path.                                                   |
| `apps/web/src/features/settings/components/shortcuts-toolbar.tsx:92`            | native-editing     | Shortcut recorder input; settings lane owns this path.                                                                         |
| `apps/web/src/features/settings/hooks/use-deferred-commit-field.ts:42`          | native-editing     | Field commit/cancel; settings lane owns this path.                                                                             |
| `apps/web/src/features/terminal/hooks/use-keybindings.ts:18`                    | converted shortcut | Existing claimKeybinding host bridge awaits terminal lane removal in the combined cutover.                                     |
| `apps/web/src/features/theme-studio/components/color-field.tsx:61`              | native-editing     | Enter commits and Escape discards the color draft.                                                                             |
| `apps/web/src/features/theme-studio/components/themes-tab.tsx:58`               | navigation         | Grid/list browsing and typeahead. Bare Enter yields to themeStudio.apply.                                                      |
| `apps/web/src/features/theme-studio/components/themes-tab.tsx:67`               | navigation         | Grid/list browsing and typeahead. Bare Enter yields to themeStudio.apply.                                                      |
| `apps/web/src/features/workbench/components/breadcrumbs-bar.tsx:70`             | navigation         | Roving breadcrumb focus with Left/Right.                                                                                       |
| `apps/web/src/features/workbench/components/csv-cell.tsx:65`                    | native-editing     | Spreadsheet cell cursor, start edit, commit/cancel and Tab/Enter advancement.                                                  |
| `apps/web/src/features/workbench/components/csv-cell.tsx:111`                   | native-editing     | Spreadsheet cell cursor, start edit, commit/cancel and Tab/Enter advancement.                                                  |
| `apps/web/src/features/workbench/components/terminal-list-row.tsx:64`           | navigation         | Only dnd-kit keyboard dragging remains. F2/Delete now resolve on the TerminalList node.                                        |
| `apps/web/src/features/workbench/components/terminal-list-row.tsx:128`          | navigation         | Only dnd-kit keyboard dragging remains. F2/Delete now resolve on the TerminalList node.                                        |
| `apps/web/src/features/workbench/providers/editor-groups-drag-provider.tsx:107` | navigation         | Passive copy-modifier observation during drag. Existing synthetic Escape cancels dnd-kit on blur; integrator owns this file.   |
| `apps/web/src/features/workbench/providers/editor-groups-drag-provider.tsx:114` | navigation         | Passive copy-modifier observation during drag. Existing synthetic Escape cancels dnd-kit on blur; integrator owns this file.   |
| `apps/web/src/features/workspace/components/tree-row.tsx:289`                   | navigation         | Type declaration, destructuring, and prop forwarding to the tree widget handler; no separate listener.                         |
| `apps/web/src/features/workspace/components/tree-row.tsx:333`                   | navigation         | Type declaration, destructuring, and prop forwarding to the tree widget handler; no separate listener.                         |
| `apps/web/src/features/workspace/components/tree-row.tsx:435`                   | navigation         | Type declaration, destructuring, and prop forwarding to the tree widget handler; no separate listener.                         |
| `apps/web/src/features/workspace/components/tree-view.tsx:393`                  | navigation         | Passive keyboard focus-modality observer and forwarded tree widget handler.                                                    |
| `apps/web/src/features/workspace/components/tree-view.tsx:437`                  | navigation         | Passive keyboard focus-modality observer and forwarded tree widget handler.                                                    |
| `apps/web/src/features/workspace/components/tree-view.tsx:467`                  | navigation         | Passive keyboard focus-modality observer and forwarded tree widget handler.                                                    |
| `apps/web/src/features/workspace/hooks/use-tree-focus-sync.ts:191`              | navigation         | Passive cancellation of stale viewport settlement on fresh input.                                                              |
| `apps/web/src/features/workspace/hooks/use-tree-focus-sync.ts:197`              | navigation         | Passive cancellation of stale viewport settlement on fresh input.                                                              |
| `apps/web/src/features/workspace/hooks/use-tree-viewport-sync.ts:263`           | navigation         | Passive keyboard-scroll intent bookkeeping; performs no command action.                                                        |
| `apps/web/src/features/workspace/hooks/use-tree-viewport-sync.ts:273`           | navigation         | Passive keyboard-scroll intent bookkeeping; performs no command action.                                                        |
| `apps/web/src/keymap/menus/hooks/use-context-menu.ts:46`                        | widget             | Documentation for keyboard menu access; no listener registration here.                                                         |
| `apps/web/src/keymap/state/held-modifiers.ts:47`                                | widget             | Passive physical modifier observation for shortcut hints. Integrator-owned.                                                    |
| `apps/web/src/keymap/utils/held-modifiers.ts:39`                                | widget             | Event-type spelling in a pure modifier reducer; no listener.                                                                   |
| `apps/web/src/lib/intent-prefetch/hooks/use-diff-intent.ts:61`                  | navigation         | Passive Enter/Space query activation prefetch claim.                                                                           |
| `apps/web/src/lib/list-keyboard.ts:16`                                          | navigation         | Existing keyboard drag/menu bridge to the focused row. App shortcuts no longer use synthetic row forwarding.                   |

## Lexical input boundaries

| Path                                                                        | Registration                                                                       | Disposition    | Behavior                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `apps/web/src/features/chat/components/chat-input-submit-plugin.tsx`        | `KEY_ENTER_COMMAND, KEY_TAB_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ARROW_DOWN_COMMAND` | native-editing | IME protection and completion-menu commit/navigation. No send action. |
| `apps/web/src/features/chat/components/chat-input-paste-fold-plugin.tsx`    | `PASTE_COMMAND`                                                                    | native-editing | Actual clipboard parsing, native inline paste and attachment folding. |
| `apps/web/src/features/chat/components/chat-input-mention-plugin.tsx`       | `KEY_BACKSPACE_COMMAND`                                                            | native-editing | Atomic mention token deletion.                                        |
| `apps/web/src/features/chat/components/chat-input-line-boundary-plugin.tsx` | `KEY_DOWN_COMMAND`                                                                 | native-editing | Home/End composer caret/selection movement.                           |
| `apps/web/src/features/chat/components/chat-input-history-plugin.tsx`       | `KEY_ARROW_UP_COMMAND, KEY_ARROW_DOWN_COMMAND`                                     | native-editing | Composer draft history at text boundaries.                            |

## Shared list navigation

Spread-only lists use `packages/ui/src/patterns/use-listbox.ts`. Their arrow, page, Home/End, Space, Enter, and typeahead behavior remains widget navigation. This includes changed-file trees, commit details/history, Git changes, host pickers, logs, diagnostics, appearance choices, breadcrumbs, and turn-file trees. The Theme Studio Apply action is the converted exception.

## Integration dependencies

- Composer stash, send, and paste attach to the same Lexical element. The shared hook must compose registrations and track root mounting and replacement.
- Composer submission must arbitrate before Lexical performs the native Enter edit, with IME and completion allowed to keep the key.
- Catalog availability must offer registered node handlers before rejecting an action through global target lookup.
- Question digits require focus within the visible card and yield in editable fields. GitCommit and Composer shortcuts explicitly permit typing contexts.
- FilePicker and ThemeStudio bindings yield to descendant menus/popovers and widget cancellation. Theme mode/apply yield in editable fields.
- Paste-as-text claims with `preventDefault: false` and `stopPropagation: false` so native clipboard input proceeds.
- TestCommandProvider exposes the shared keymap. Standalone tree tests use the real command and focus providers.
- Root owns browser scenarios, selectors, combined typecheck/gates, and latency acceptance. This lane changes no shared hook, catalog, preset, scenario, launcher, or package manifest.

The external canonical handoff is `/work/reports/command-foundation-2026-10-03/reports/raw/bindings-needed.json`. Source findings and normal-hook prerequisites are recorded in `/work/reports/command-foundation-2026-10-03/raw/integration-request.md`.

## Test-only sites

These sites drive or observe fixtures and do not install production shortcut actions.

| Exact source site                                                                  | Disposition               |
| ---------------------------------------------------------------------------------- | ------------------------- |
| `apps/web/src/features/chat/components/tests/chat-input-mention-node.test.tsx:156` | Test input or observation |
| `apps/web/src/features/chat/components/tests/chat-input-submit-plugin.test.tsx:97` | Test input or observation |
| `apps/web/src/features/chat/utils/tests/input-editor-actions.test.tsx:208`         | Test input or observation |
| `apps/web/src/features/chat-mode/components/tests/session-undo.test.tsx:49`        | Test input or observation |
| `apps/web/src/features/chat-mode/components/tests/turn-files.test.tsx:109`         | Test input or observation |
| `apps/web/src/features/editor/tests/diagnostic-peek.browser.tsx:85`                | Test input or observation |
| `apps/web/src/features/theme-studio/tests/palette-fields.test.tsx:14`              | Test input or observation |
| `apps/web/src/features/workbench/components/tests/diagnostics-panel.test.tsx:134`  | Test input or observation |
| `apps/web/src/features/workbench/utils/tests/editor-drag.test.ts:55`               | Test input or observation |
| `apps/web/src/features/workbench/utils/tests/editor-drag.test.ts:59`               | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-pane.browser.tsx:115`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-pane.browser.tsx:185`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-pane.browser.tsx:190`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-pane.browser.tsx:229`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-pane.browser.tsx:235`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-pane.browser.tsx:290`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-parity-chrome.browser.tsx:67`          | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-parity-chrome.browser.tsx:70`          | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-view-integration.browser.tsx:367`      | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-view.browser.tsx:58`                   | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-view.browser.tsx:98`                   | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-view.browser.tsx:627`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-view.browser.tsx:645`                  | Test input or observation |
| `apps/web/src/features/workspace/tests/tree-view.browser.tsx:654`                  | Test input or observation |
| `apps/web/src/keymap/menus/hooks/tests/use-list-context-menu.test.tsx:34`          | Test input or observation |
| `apps/web/src/keymap/tests/command-focus.browser.tsx:286`                          | Test input or observation |
| `apps/web/src/keymap/tests/command-focus.browser.tsx:330`                          | Test input or observation |
| `apps/web/src/keymap/tests/command-focus.browser.tsx:577`                          | Test input or observation |
| `apps/web/src/keymap/tests/command-focus.browser.tsx:580`                          | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:17`                              | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:98`                              | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:106`                             | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:108`                             | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:109`                             | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:115`                             | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:119`                             | Test input or observation |
| `apps/web/src/keymap/tests/shortcut-hints.test.ts:123`                             | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:18`                             | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:34`                             | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:41`                             | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:65`                             | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:186`                            | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:277`                            | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:402`                            | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:443`                            | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:499`                            | Test input or observation |
| `apps/web/src/keymap/tests/use-app-keymap.test.tsx:522`                            | Test input or observation |
