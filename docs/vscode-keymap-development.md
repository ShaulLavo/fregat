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

Plans 056 and 057 are complete. Standalone Editor executes default and custom chords, and
Platform uses the same public runtime. The [delivery record](keymap/delivery.md) contains the
paired revisions, verification results, and host limitations. The completed plans are in git history.

## Implemented runtime

- `PlatformKeyBinding` stores a non-empty `chord` tuple and canonical space-separated `keys`.
  Defaults and user overrides share this representation.
- `CommandProvider` resolves the binding table and owns one `useAppKeymap()` instance. Menus,
  the command palette, settings, and the terminal use that provider.
- `activePlatformKeyBindings()` applies pane priority before app filtering. A per-pane trie
  represents complete shortcuts and prefixes. A complete shortcut wins over a longer sequence
  with the same prefix.
- `@singapore-editor/core/keymap` owns matching, pending state, listeners, and the five-second timer.
  Platform's `state/keymap-session.ts` connects that runtime to focus, command dispatch, and one
  wide log event per chord lifecycle.
- Unarmed app shortcuts run in document bubble. A prefix installs document capture synchronously
  for the continuation, so React rendering cannot leave a gap between strokes.
- Consumed prefixes and continuations never replay into text inputs or a shell.
  Blur, hidden documents, pointer interaction, binding changes, and focus-owner changes cancel
  pending chords. IME events do not advance the sequence, and held keys do not reset the timer.
- Commands dispatch through the existing `CommandBus`. A single shortcut suppresses its event
  only after a synchronous claim. A chord's continuation is consumed even if its command declines.
- Single-stroke and multi-stroke Editor bindings use the shared runtime and dispatch through the
  same bus and deepest registered focus target. Embedded Editors disable their separate matcher
  with `keymap.enabled: false`. The target's capability and writable state govern execution.
- Trusted browser tests cover keyboard claims and terminal input through the real Ghostty engine.
  The shared provider, editor targets, settings shortcut, and terminal encoder pass these checks.

TanStack supplies hotkey grammar and normalization helpers. The shared runtime owns prefix
resolution and timers. Platform owns command dispatch. TanStack's `SequenceManager` does not consume
prefixes or expire pending state without another key event. The proposed `matchesKeyboardEvent` adoption was also rejected during
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
- Editor defaults come from the shared default and VS Code packs, including folding and
  `editor.action.moveSelectionToNextFindMatch`. The command registry includes every Editor command.

Workspace defaults are in `keymap/workspace-commands.ts`. Editor defaults and platform restrictions
come from `@singapore-editor/core/keymap`, with Platform policy applied in `keymap/editor-keymap.ts`.
Browser-hostile desktop shortcuts remain explicit reservations where Platform cannot perform the desktop action.

## Remaining parity work

- Review save-all, show-all-editors, and other VS Code `Mod+K` defaults against the shared command
  table. They no longer need a new runtime mechanism.
- Expand the closed command context model when a concrete command needs find-widget, replace-input,
  or other local focus facts.
- Add an inspector for VS Code aliases, platform restrictions, focus conditions, and unsupported
  commands beyond the existing searchable settings table.

The chat prompt stash still listens at window capture and can act on `Mod+S` before document
capture. Converting it to a pane-scoped command is separate work.
