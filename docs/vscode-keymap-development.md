# VS Code keymap development status

## Proposed keyboard modes

[Plan 080](../plans/080-platform-keybinding-modes.md) preserves VS Code parity as a selectable mode
and defines Platform defaults based on it. The existing preset selector currently changes editor
packs; the proposal extends it to workspace commands. Proposed behavior is not shipped behavior.

Its first milestone makes Cmd+B toggle the entire sidebar while preserving the selected panel.
VS Code already toggles the whole primary sidebar; Platform's current Files-specific handler is a
mismatch. Confirmed Platform rules keep Cmd+B on the current screen, toggle a visible panel when
its shortcut repeats, and use the same navigation keys for editor tabs and chats. Panel shortcuts
use a separate combination. Proposed keys are Cmd+1–9 for tabs or chats, Cmd+Option+[ and ] for
previous and next, and Cmd+Option+1–9 for panels. Held-modifier hints identify the matching targets.
The plan records host-conflict checks and the pinned T3 Code reference.

## Existing implementation record

Last reviewed: 2026-09-05. Plan 056 is implemented and verified through focused tests and trusted browser input.

Platform supports a subset of VS Code defaults. The command table defines the available commands,
bindings, VS Code aliases, and enablement conditions. Plan 056 adds Platform's chord runtime.
[Plan 057](../plans/057-editor-native-vscode-keymap.md) first adds standalone Editor chord execution,
then moves Platform onto the same reusable runtime and completes the remaining Editor defaults.

## Implemented runtime

- `PlatformKeyBinding` stores a non-empty `chord` tuple and canonical space-separated `keys`.
  Defaults and user overrides share this representation.
- `CommandProvider` resolves the binding table and owns one `useAppKeymap()` instance. Menus,
  the command palette, settings, and the terminal use that provider.
- `activePlatformKeyBindings()` applies pane priority before app filtering. A per-pane trie
  represents complete shortcuts and prefixes. A complete shortcut wins over a longer sequence
  with the same prefix.
- `utils/chord-machine.ts` makes pure arm, complete, and cancel decisions. `state/chord-session.ts`
  owns listeners, pending state, the five-second timer, and one wide log event per chord lifecycle.
- Unarmed app shortcuts run in document bubble. A prefix installs document capture synchronously
  for the continuation, so React rendering cannot leave a gap between strokes.
- Consumed prefixes and continuations never replay into text inputs or a shell.
  Blur, hidden documents, pointer interaction, binding changes, and focus-owner changes cancel
  pending chords. IME events do not advance the sequence, and held keys do not reset the timer.
- Commands dispatch through the existing `CommandBus`. A single shortcut suppresses its event
  only after a synchronous claim. A chord's continuation is consumed even if its command declines.
- Single-stroke Editor bindings still use the Editor layer bridge with Editor defaults disabled.
  Multi-stroke `editor.*` bindings bypass that bridge and dispatch through the same bus and deepest
  registered focus target. The target's capability and writable state govern execution.
- Trusted browser tests cover keyboard claims and terminal input through the real Ghostty engine.
  The shared provider, editor targets, settings shortcut, and terminal encoder pass these checks.

TanStack supplies hotkey grammar and normalization helpers. Platform owns dispatch, prefix
resolution, and timers. Its `SequenceManager` does not consume prefixes or expire pending state
without another key event. The proposed `matchesKeyboardEvent` adoption was also rejected during
implementation because it regressed Hebrew and Cyrillic physical-key fallback. The trie preserves
that fallback and the existing guard against treating an AZERTY Latin letter as another key.

## Terminal ownership

The terminal host forwards keydown and keyup from capture to the provider's `claimKeybinding()`
before Ghostty can encode them. A claimed event reaches Platform once; ordinary terminal input and
unavailable single-key commands pass through. Claimed keyups are tracked so Kitty keyboard mode
cannot send a release event for a key whose press Platform consumed.

There is no separate terminal chord setting. The same resolved binding table decides ownership.
On Linux and Windows, the default `Mod+K Mod+S` sequence uses Ctrl+K, which readline normally uses
for kill-line. A user can override `workspace.showSettings` with another shortcut, such as `Mod+,`,
or unbind it to return Ctrl+K to the shell. On macOS, `Mod` is Command.

## Settings and display

`keybindings.overrides` is an application-scoped record from command ID to a shortcut string or
`null`. A string contains one hotkey or two separated by a single space. A missing command keeps
its defaults; `null` removes all shortcuts for that command. The contract rejects malformed shape
before a keyed write reaches disk, and the keymap validates each stroke's grammar.

The recorder saves ordinary single shortcuts immediately. An existing chord prefix waits for a
second stroke. Enter saves that prefix alone, Backspace removes it, and Escape cancels. Settings
search matches command IDs, titles, canonical notation, and displayed shortcut labels, including
secondary defaults. Menus keep the first shortcut as the primary hint.

A hand-edited override with malformed shape invalidates the whole `keybindings.overrides` value
and produces an `invalid-value` diagnostic. The generated JSON Schema includes the shape pattern for editor
validation. The record does not support per-pane user overrides or several user shortcuts for one
command.

## Enabled defaults

- Command palette and quick access: `Mod+Shift+P`, `F1`, `Mod+P`, and `Mod+Shift+O`.
- Save and sidebar visibility: `Mod+S` and `Mod+B`.
- Settings: `Mod+,` followed by the new secondary `Mod+K Mod+S` default. The primary menu hint
  remains `Mod+,`.
- Editor navigation, selection, deletion, indentation, undo, redo, find, replace, comments, and
  multiple-cursor commands are represented in `keymap/editor-commands.ts`.

The authoritative defaults and their platform restrictions are in `keymap/workspace-commands.ts`
and `keymap/editor-commands.ts`. Browser-hostile desktop shortcuts remain explicit reservations
where Platform cannot perform the desktop action.

## Remaining parity work

- Implement standalone Editor chord execution through its ordinary binding options in Plan 057.
  Export the reusable runtime through `@singapor/core/keymap`; standalone consumers must not need
  Platform or external keyboard wiring. Prove default and custom chords with real browser input.
- Adopt that shared runtime in Platform and remove its duplicate engine. Disable embedded Editor
  matching with the existing `enabled: false` option while preserving native input handling.
- Add the `editor.action.moveSelectionToNextFindMatch` chord default and the Editor folding pack
  through Plan 057. Both standalone Editor and Platform must execute the shipped defaults.
- Review save-all, show-all-editors, and other VS Code `Mod+K` defaults against the shared command
  table. They no longer need a new runtime mechanism.
- Remove the remaining single-stroke Editor layer bridge only through the companion plan's
  target and enablement contract.
- Expand the closed command context model when a concrete command needs find-widget, replace-input,
  or other local focus facts.
- Report cross-pane prefix conflicts in the settings UI. The app trie resolves and logs conflicts
  that survive app filtering. An Editor single-stroke binding can intercept a global override prefix
  first, such as `Mod+F` in `Mod+F Mod+B`, without a warning. Same-pane override conflicts already
  populate `shadowedBy`. The remaining Editor layer bridge limits this case.
- Add a repeatable VS Code default export, a normalized manifest, and a parity report covering
  supported commands, missing commands, aliases, and conflicts.
- Add an inspector for VS Code aliases, platform restrictions, focus conditions, and unsupported
  commands beyond the existing searchable settings table.

The chat prompt stash still listens at window capture and can act on `Mod+S` before document
capture. Converting it to a pane-scoped command is separate work.
