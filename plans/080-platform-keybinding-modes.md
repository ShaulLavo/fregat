# Plan 080: Platform and VS Code keybinding modes

## Status and scope

- State: Proposed implementation. Interaction rules confirmed; exact navigation keys proposed below.
- Created: 2026-09-07.
- Deliverable for this planning pass: this plan and links from the roadmap and keymap documentation.
- Implementation depends on the delivered shared runtime from Plan 057. Reconcile the installed
  Editor package and current working tree before editing. Plan 057's delivery record reports completion;
  older references that call it the next implementation are stale.
- Preserve the VS Code parity work, including its baseline, delivery records, and remaining gaps.
  This plan extends preset selection to workspace commands and introduces intentional Platform defaults.
- First implementation milestone: Cmd+B toggles the entire current sidebar without selecting Files.

## Product decisions

The app has two selectable keyboard modes. **Platform** is the default and uses VS Code bindings
as its base, with documented changes for Platform's interface. **VS Code** retains the supported
VS Code bindings and behavior. Host limitations remain explicit in the parity documentation.

Use the existing application-scoped `keybindings.preset` values, `default` and `vscode`.
The display name for `default` is Platform. Extend this setting to app and editor shortcuts together.
Do not add a second mode setting or reset user overrides when the mode changes.

VS Code already binds Cmd+B to whole-primary-sidebar visibility. Platform currently maps that key
to Files specifically and switches out of chat. Correcting the Files-specific behavior is a parity
fix within the workbench. Contextual chat behavior and numbered panel navigation are Platform policy.

The user confirmed these interaction rules on 2026-09-07:

1. Cmd+B toggles the sidebar belonging to the current screen. In the workbench this is the left
   sidebar, including its tab strip and resize handle. In chat it is the left session rail.
   It does not change UI mode, close the bottom panel, or close the chat tool pane on the right.
2. A numbered panel shortcut opens the matching panel. Repeating the shortcut for the visible panel closes
   the sidebar. Selecting a different number switches the panel and opens the sidebar.
3. Sidebar panel shortcuts and chat navigation use different keys. Editor-tab navigation in the
   workbench and chat navigation in chat mode use the same keys. The active mode selects the target.

Selecting an already active editor tab or chat focuses it without closing it. Only panel selection
has the repeat-to-hide behavior. Switching tabs or chats does not change UI mode.

### Proposed Platform keys

These exact keys are the implementation proposal, not an additional user decision. Verify their
effective ownership on each supported host before finalizing them. If a host needs an alternative,
editor tabs and chats must still share that alternative on that host.

| Action                           | macOS proposal | Workbench target                | Chat-mode target                                                       |
| -------------------------------- | -------------- | ------------------------------- | ---------------------------------------------------------------------- |
| Toggle sidebar                   | Cmd+B          | Entire left sidebar             | Left session rail                                                      |
| Select item by position          | Cmd+1–9        | Editor tab in visible tab order | Chat in displayed session order                                        |
| Select previous item             | Cmd+Option+[   | Previous editor tab             | Previous chat                                                          |
| Select next item                 | Cmd+Option+]   | Next editor tab                 | Next chat                                                              |
| Open or toggle panel by position | Cmd+Option+1–9 | Sidebar panel                   | No session action; chat tool-rail bindings are outside this first pass |

Use `Mod` for Cmd and `Alt` for Option in the binding table. Preserve VS Code's editor-group
bindings in VS Code mode. Platform deliberately assigns plain numbered shortcuts to tabs and chats.
The current browser reservations claim `Mod+1`, `Mod+2`, and `Mod+3` for unimplemented editor-group
actions. Replace those reservations in Platform mode in the same pass as the new commands.
Verify all nine digits in the browser and desktop host, including any host-owned tab shortcuts.

Previous and next follow displayed order and wrap at the ends in both modes. Positional shortcuts
select the exact numbered item, including 9 as the ninth item. Out-of-range positions leave state
unchanged. Do not mix recent-use order for editor tabs with displayed order for chats.

Expose shared Select item 1–9, Previous item, and Next item actions so a user override applies to
both editor tabs and chats. Their meaning is navigation within the active mode. Route each action
to the existing editor or session owner using one captured mode snapshot. In the workbench, use
the active editor tab strip even when keyboard focus is in the sidebar or terminal. In chat, use
the session list even when focus is in the right tool pane. The selected keyboard preset controls
bindings, not which UI mode the user is in.

## Current source and constraints

| Source                                                             | Current responsibility                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/settings/keys.ts`                          | Registers `keybindings.preset` and `keybindings.overrides` at application scope. Preset description currently says editor shortcuts. |
| `apps/web/src/keymap/default-bindings.ts`                          | Chooses native or VS Code editor packs. Workspace defaults and browser reservations are shared across both presets.                  |
| `packages/client-core/src/commands/workspace.ts`                   | Shared workspace command metadata, Files toggle binding, and session number bindings.                                                |
| `apps/web/src/keymap/providers/command-provider.tsx`               | Reads the selected preset and overrides, owns the shared runtime, and dispatches through the command bus.                            |
| `apps/web/src/keymap/active-bindings.ts`                           | Resolves overrides and reports collisions and effective shortcuts.                                                                   |
| `apps/web/src/features/settings/components/keybinding-section.tsx` | Displays the selected preset's resolved command rows and diagnostics.                                                                |
| `apps/web/src/features/workbench/utils/panels.ts`                  | Stores sidebar visibility and selected tab separately. Current toggle helper targets a particular tab.                               |
| `apps/web/src/features/workbench/components/sidebar-panel.tsx`     | Renders Files, Git, Search, Logs, Chat in that order.                                                                                |
| `apps/web/src/features/chat-mode/utils/panels.ts`                  | Separates session-rail visibility from right tool-pane visibility and selection.                                                     |
| `apps/web/src/keymap/tests/session-commands.test.ts`               | Confirms Cmd+Option+1–9 already belongs to session jumps.                                                                            |
| `apps/web/src/features/editor/state/commands.ts`                   | Owns editor tab selection through `selectTab` and the existing activation path.                                                      |

The repository has concurrent source and settings changes. This documentation pass does not alter
them. Implementation must reconcile those changes rather than overwrite them.

## Binding and command design

Compose each mode from a shared VS Code base plus explicit host additions and mode differences.
Keep one resolver, one command bus, and the existing shared Editor matcher. Do not copy the full
binding table into two independently maintained lists.

For Platform, apply the documented app differences to the supported VS Code base. Both modes use
the VS Code editor pack unless a specific Platform editing difference is documented and verified.
Do not silently keep the current native-editor pack as Platform's base. Capture the resulting
editor-binding changes before changing the default so the review includes their effects.

Separate command meaning from the selected mode. A command such as Toggle sidebar must always
toggle visibility while preserving selection. Open Files and toggle a named panel are separate
actions. A preset chooses bindings to actions. Avoid handlers that secretly change meaning after
reading `keybindings.preset`.

Use shared workspace metadata only for domain commands that belong across clients. Keep web
layout policy in `apps/web/src/keymap/`, alongside its existing command enablement and dispatch.
Inspect TUI consumers before changing shared command IDs or defaults. Migrate all affected callers
in the same implementation pass, without compatibility aliases.

User overrides apply after the selected mode, with the existing null-to-unbind behavior. Resetting
a command restores that mode's default. Preset switches cancel pending chords and stale hints.
Settings, menus, tooltips, hint badges, and terminal claims must use the same effective bindings.

VS Code mode uses whole-sidebar visibility in the workbench. The chat-only extension is a host
policy, not a VS Code parity claim: use the same current-screen sidebar command in chat in both
modes, while retaining VS Code's named-view shortcuts.

## Whole-sidebar visibility

Cmd+B preserves the selected tab and remembered width. Closing removes the pane and its resize
handle. Reopening restores the same panel. It must not switch a Git or Search sidebar back to Files.
Chat uses the existing `sessionRailOpen` value and preserves the selected session.

Preserve keyboard focus when it is outside the sidebar. If closing would remove the focused
element, use the existing focus service to return to the active editor or chat composer. Opening
through a numbered panel command explicitly focuses that panel. Opening through Cmd+B preserves
outside focus; it is a visibility action.

Keep sidebar state in its existing owners. No new localStorage values, persistent hint state,
workspace-setting execution policy, or cache migration code is required.

## Numbered navigation and hints

Use the proposed `Mod+Alt+1` through `Mod+Alt+9` for sidebar panels in Platform mode. Move chat
positional navigation to the shared item actions and proposed `Mod+1` through `Mod+9` in that mode.
Do not leave the old session-number bindings active alongside panel shortcuts. Preserve the
VS Code mode's existing host additions unless the parity review documents a separate change.
Verify Ctrl+Alt on Linux and Windows, including AltGr and operating-system interception.

The current workbench mapping is 1 Files, 2 Git, 3 Search, 4 Logs, 5 Chat. Define one ordered panel
descriptor list for rendering, numeric dispatch, and hints. Numbers identify positions in the
rendered navigation order. A nonexistent position leaves selection and visibility unchanged.

The resolver must select the active mode's navigation target before claiming the event. Do not
register competing global editor and session handlers and hope a declining handler retries the
other. Panel shortcuts must never navigate chats. Changes in active mode, tab order, session
order, or panel order invalidate displayed targets immediately.

Show number badges as soon as the required modifiers are held, before a digit is pressed. Holding
the modifiers alone must not change selection, focus, UI mode, or persisted sidebar visibility.
Place badges over the existing navigation targets without replacing labels or moving layout.
Use shared UI primitives, theme tokens, `tabular-nums`, and pointer-transparent decorative badges.
Expose effective shortcuts through accessible labels or `aria-keyshortcuts` on the actual controls.

Apply the same hint behavior to positional item navigation. With the proposed defaults, holding
Cmd shows numbers on editor tabs in the workbench or session rows in chat. Adding Option switches
to panel hints in the workbench and hides item hints. Do not show session numbers for panel keys.
Both hint families derive their targets from the same displayed order used for dispatch.

The user explicitly requires T3-style small number badges beside each addressable chat sidebar
item and editor tab. Pressing and holding Cmd alone reveals them, before any number is pressed;
releasing Cmd hides them. Pressing a displayed number while holding Cmd selects that exact item.
Deliver this on both surfaces, not only the sidebar panel buttons. Preserve titles, status text,
close buttons, and click targets while the badges are visible.

When the sidebar is closed, the proposed design shows a temporary strip of its numbered targets at
the sidebar edge. The strip overlays the content without reopening or resizing the sidebar. Releasing
the modifiers removes it. Selecting a number opens the target. Verify this presentation in the real
app before settling its dimensions. It is an adaptation for Platform, not observed T3 behavior.

Hints describe shortcuts that can actually execute. Hide a target's default number when an override
unbinds or shadows it. For a replacement single-stroke shortcut, show the effective key only when
its exact modifiers match. Do not label a two-stroke override as a one-digit action.

Extra modifiers hide unrelated hints. Release, blur, hidden document, paste, preset change, and
component disposal clear held state. Synthetic paste must not leave hints stuck on screen.
Observe modifiers without consuming their key events or installing another command dispatcher.
Keep actual shortcut execution in the existing runtime, including its terminal capture handoff.

## T3 Code reference

Inspected `pingdotgg/t3code` at revision `6abdf37a50ce6c1c9fabc499f4d0e159a6182d90`.
This is a source comparison, not a live visual verification.

Before implementing the badges, inspect T3 Code's running interface while pressing, holding, and
releasing Cmd. Look at the small number beside each addressable sidebar item and inspect the source
linked below. Record badge placement, size, appearance, disappearance, and number-to-item mapping.
Use that observed interaction as the reference for both Platform's chat sidebar and editor tabs,
with only the explicit adaptations below. If a running reference is unavailable, record that gap;
source inspection alone does not complete the visual comparison.

- [Sidebar badges and target labels](https://github.com/pingdotgg/t3code/blob/6abdf37a50ce6c1c9fabc499f4d0e159a6182d90/apps/web/src/components/Sidebar.tsx):
  overlay badges do not shift rows or replace status text. Labels come from effective bindings.
- [Modifier matching](https://github.com/pingdotgg/t3code/blob/6abdf37a50ce6c1c9fabc499f4d0e159a6182d90/apps/web/src/keybindings.ts):
  exact modifiers govern hints. T3 suppresses them in its terminal because its terminal owns those keys.
- [Held modifier state](https://github.com/pingdotgg/t3code/blob/6abdf37a50ce6c1c9fabc499f4d0e159a6182d90/apps/web/src/shortcutModifierState.ts):
  capture keydown and keyup, reset on blur and paste, and prevent stale synthetic modifier flags
  from turning hints back on.
- [Hint timing](https://github.com/pingdotgg/t3code/blob/6abdf37a50ce6c1c9fabc499f4d0e159a6182d90/apps/web/src/components/Sidebar.logic.ts):
  T3 waits 200 ms. The user's request says immediate, so Platform adds no deliberate hold delay.

Copy the observable interaction with Platform's bindings and components. Two deliberate adaptations
prevent a literal implementation transplant: immediate hints, and terminal hints based on Platform's
actual command ownership rather than T3's blanket terminal suppression. The closed-sidebar strip
above is a third, provisional adaptation. Preserve applicable attribution if source is copied.

## Implementation sequence and evidence

1. Reconcile the confirmed interaction rules, proposed keys, current preset tables, and supported VS Code behavior.
   Record a compact before-and-after binding comparison for macOS, Linux, and Windows. List each
   intentional Platform difference and each host limitation separately.
2. Extend preset composition to workspace commands and deliver whole-sidebar Cmd+B behavior.
   Update command names, metadata, callers, settings description, and user-facing shortcut help
   together. Regenerate the settings reference with `bun run settings:reference` if its registry
   description changes. Preserve the existing application scope and override storage.
3. Add shared positional and previous/next navigation for editor tabs and chats. Wire user overrides
   to the shared actions. Add separate numbered panel commands and remove the old Platform session
   bindings that overlap them. Drive rendering and dispatch from the same order. Verify navigation
   with the sidebar both open and closed.
4. Inspect T3 Code's Cmd-held badges in a running reference and its source. Implement the small
   number badges beside chat sidebar items and editor tabs, then add panel hints and the proposed
   closed-sidebar presentation. Reuse the effective table and existing focus context. Compare both
   implemented surfaces against the observed T3 interaction and record the explicit adaptations.
5. Update `docs/vscode-keymap-development.md` with the shipped mode comparison, Platform differences,
   and any remaining parity gaps. Mark this plan complete only after the checks below pass.

Use focused checks with specific failure targets:

- Resolver tests catch accidental VS Code table changes, duplicate owners of Cmd+Option+digits,
  incorrect override precedence, and misleading reset values after mode changes.
- Panel-state tests catch selection or width resets, mode switches, and repeated-number errors.
- Shared navigation tests catch keys selecting different positions across modes, inconsistent wrap
  behavior, accidental tab/chat closing, stale mode snapshots, and overrides applied to only one mode.
- A real-browser mode-switch check uses the same positional and previous/next keys in an editor,
  sidebar, chat composer, and terminal. Panel keys never select chats; item keys never toggle panels.
- Real app command tests catch wrong panel focus and focus left in an unmounted sidebar.
- Real-browser modifier checks catch delayed or stuck hints, extra-modifier leakage, layout shifts,
  hidden-sidebar discoverability failures, and mismatches between badge targets and execution.
- Verify both chat sidebar and editor tabs: Cmd down reveals the small badges, Cmd+number selects
  the labeled item, and Cmd up removes the badges without changing layout or hiding existing text.
- Trusted terminal input checks catch double dispatch or command bytes reaching the shell. Ordinary
  unclaimed input still reaches the terminal. Test overridden and unavailable bindings too.
- Verify physical digits with Option and non-US layouts, plus composition and AltGr. An event-code
  workaround must preserve the shared matcher's existing layout rules.

Reuse the running dev server. Follow the repository's Bun and Vitest environments and fixture
rules. Run only the focused checks needed for these changes. This documentation-only planning
pass requires link checks and diff review, not application tests.
