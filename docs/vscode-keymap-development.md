# VS Code keymap development status

## Keyboard modes

`keybindings.preset` is the keyboard mode: Platform (the default) or VS Code. Both edit with the
VS Code pack and both let `Mod+B` hide the current screen's whole sidebar (the session rail in chat).
Platform adds numbered tabs or chats on `Mod+1`–`9`, previous and next on `Mod+Alt+[` / `]`, and
numbered sidebar panels on `Mod+Alt+1`–`9`; VS Code mode keeps VS Code's editor-index and
editor-group keys. Held modifiers badge the matching targets. [Keyboard modes](keymap/modes.md)
has the per-host comparison, Platform's differences, the editor-pack change and the host checks.

A preset key default carries `presets` in its command metadata (`CommandKeyDefault`); a default
without it belongs to both modes. `presetPlatformKeyBindings` filters by it and applies Platform's
macOS folding chords to the VS Code pack.

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

`keybindings.overrides` is an application-scoped record from command ID to the command's complete
list of shortcuts, or `null`. Each entry is one hotkey or two separated by a single space. A missing
command keeps its defaults; `null` or `[]` removes all its shortcuts; a list replaces the defaults.
Every chord in the list applies in every pane and editor condition the command's defaults use. The
contract rejects malformed shape before a keyed write reaches disk, and the keymap validates each
stroke's grammar; a list whose every chord is invalid keeps the defaults.

The shortcuts page lists one row per chord, as VS Code does. The recorder writes nothing until
Enter or Save, shows the commands the chord would take first, and records Backspace as a key;
Escape clears, then closes. Add another shortcut appends to the list, Remove drops one chord, and
Reset deletes the command's entry. Settings search matches command IDs, titles, canonical
notation, and displayed shortcut labels. Menus keep the first shortcut as the primary hint.

A hand-edited override with malformed shape invalidates the whole `keybindings.overrides` value
and produces an `invalid-value` diagnostic. The generated JSON Schema includes the shape pattern for
editor validation. The record does not support per-pane user overrides.

## Enabled defaults

- Command palette and quick access: `Mod+Shift+P`, `F1`, `Mod+P`, and `Mod+Shift+O`.
- Save and sidebar visibility: `Mod+S` and `Mod+B`.
- Settings: `Mod+,` followed by the new secondary `Mod+K Mod+S` default. The primary menu hint
  remains `Mod+,`.
- Editor defaults come from the shared VS Code pack in both modes, including folding and
  `editor.action.moveSelectionToNextFindMatch`. The command registry includes every Editor command.
- Tabs, chats and sidebar panels: see [Keyboard modes](keymap/modes.md).

Workspace defaults are in `keymap/workspace-commands.ts`. Editor defaults and platform restrictions
come from `@singapore-editor/core/keymap`, with Platform policy applied in `keymap/editor-keymap.ts`.
Browser-hostile desktop shortcuts remain explicit reservations where Platform cannot perform the desktop action.

## Remaining parity work

- The Windows AltGr overlap with `Mod+Alt+digit` needs the shared matcher to skip its
  physical-key fallback while `AltGraph` is down (see [Keyboard modes](keymap/modes.md)).

- Review save-all, show-all-editors, and other VS Code `Mod+K` defaults against the shared command
  table. They no longer need a new runtime mechanism.
- Expand the closed command context model when a concrete command needs find-widget, replace-input,
  or other local focus facts.
- Add an inspector for VS Code aliases, platform restrictions, focus conditions, and unsupported
  commands beyond the existing searchable settings table.

The chat prompt stash still listens at window capture and can act on `Mod+S` before document
capture. Converting it to a pane-scoped command is separate work.
