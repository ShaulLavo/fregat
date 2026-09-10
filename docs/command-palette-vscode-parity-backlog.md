> [!IMPORTANT]
> Historical parity backlog. The current selection policy below was implemented on 2026-09-09. The older baseline and proposals record the original comparison, not a list of remaining work.

# Command Palette VS Code Parity Backlog

## Current command and settings policy

Settings own saved preferences. The command palette offers actions, navigation, and quick pickers for common choices. Both entry points write through the same settings actions.

- **Light / dark mode**, **App colors**, and per-mode **Code theme** choices appear in Settings. Each has a command palette picker with preview and cancellation.
- Code themes share one native and imported theme catalog. The picker offers themes for the current light or dark mode. The registry stores each mode's choice separately.
- Basic cursor movement, single-character deletion, and transient input handlers remain configurable as shortcuts but do not appear in the palette.
- Palette visibility follows the invocation's context. An editor action requires an editor target; a relevant but unavailable action can remain disabled with a reason.
- The palette exposes one **Go to definition** and one **Focus editor** action. Numbered editor-group shortcuts do not imply additional groups in the palette.
- **Run project script**, **Switch session**, and **Go to line** open the existing pickers. **New file** and **New folder** use the Files pane's creation flow.
- **Open font settings** and **Open transparency settings** open Settings filtered to the relevant controls.
- The TUI's App colors picker uses the same setting. Its unsupported code-theme command is absent.

The focused checks live in `apps/web/src/features/command-palette/tests/`, `apps/web/src/keymap/tests/palette-visibility.test.tsx`, and `apps/web/src/features/settings/tests/code-theme.test.tsx`.

This tracks the gap between the first command palette pass and VS Code's Quick Access / Command Palette model. The reference points are:

- `references/vscode/src/vs/platform/quickinput/common/quickAccess.ts`
- `references/vscode/src/vs/platform/quickinput/browser/quickAccess.ts`
- `references/vscode/src/vs/platform/quickinput/browser/commandsQuickAccess.ts`
- `references/vscode/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts`
- `references/vscode/src/vs/workbench/browser/actions/quickAccessActions.ts`

## Original baseline

- Opens default Quick Access with `Mod+P`.
- Opens command mode with `Mod+Shift+P` and `F1`, prefilling `>`.
- Switches to command mode when the user types `>`.
- Default Quick Access shows loaded workspace files plus quick actions.
- Uses the shared command registry as the item source.
- Shows workspace and editor commands with default shortcuts.
- Runs workspace commands through the app command dispatcher.
- Runs editor commands through the active editor controller when an editor is mounted.
- Uses the shadcn `Command` pattern over `cmdk` for filtering, keyboard movement, empty state, and grouped results.

## Provider Architecture

- Add a Quick Access provider registry with prefixes instead of a single command-only picker.
- Support VS Code-style modes:
  - empty / file picker mode
  - `>` command mode
  - `?` help mode
  - view, symbol, line, terminal, and future extension-defined modes
- Preserve and rewrite typed text when switching providers by prefix.
- Add provider-specific placeholders and context flags.
- Add a `show(value, options)` and `pick(value, options)` API so callers can either execute or request selected items.

## Filtering And Ranking

- Replace plain `cmdk` ranking with VS Code-like matching:
  - word matching
  - contiguous substring matching
  - exact command id matching
  - duplicate-label disambiguation by command id
- Add MRU ranking for accepted commands.
- Add suggested and commonly-used command sections.
- Add optional TF-IDF / natural-language fallback results for long queries.
- Add async fast-and-slow result merging to avoid flicker when slow providers return later.
- Add cancellation tokens for provider work when input changes or the palette closes.

## Command Metadata

- Expand `CommandSpec` with:
  - alias
  - category label separate from grouping
  - command id visibility
  - enablement / precondition expression
  - argument metadata
  - source / extension owner
  - icon
- Surface disabled commands only when useful, with correct reason metadata.
- Add duplicate command label handling.
- Include command descriptions in search indexing, not only display.

## Keybindings

- Show platform-rendered keybinding labels from the actual active keymap.
- Support secondary keybindings and chords.
- Add command item action to configure a keybinding.
- Add keybinding conflict awareness once user keymaps exist.
- Add quick-navigation behavior when the opener chord is held or repeated.

## History And Persistence

- Persist command MRU history with a configurable limit.
- Add a clear command history action.
- Add setting parity for:
  - `workbench.commandPalette.history`
  - `workbench.commandPalette.preserveInput`
- Store accepted input per provider when preserve-input mode is enabled.

## Acceptance Behavior

- Add modifier-aware accept actions:
  - normal accept
  - alternative accept
  - background accept where supported
  - attach / multi-pick style accept for future providers
- Add item buttons with trigger behavior.
- Add remove-from-recently-used button for MRU items.
- Add consistent command error handling for failed executions.
- Preserve editor focus and state when transient picks preview files.

## UI And Accessibility

- Add full quick input state support:
  - busy
  - validation messages
  - buttons
  - title / step metadata
  - back button
  - multi-select
- Add screen-reader labels that include keybindings.
- Add aria state parity for disabled, selected, and grouped items.
- Match VS Code's top-aligned command center positioning across narrow and wide viewports.
- Add command palette context key so Escape, Enter, and navigation can be scoped precisely.
- Add virtualization before the command list grows large.

## Integration Points

- Register menu contributions that can open the command palette.
- Add command center / titlebar entry once that UI exists.
- Add a help provider that lists available prefixes and modes.
- Add extension/plugin command contribution support.
- Add telemetry hooks for command execution source.
- Add tests for provider switching, ranking, history, disabled states, keybinding labels, and editor-command dispatch.
