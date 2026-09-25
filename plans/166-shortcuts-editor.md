# Plan 166: The keyboard shortcuts editor, redone for desk and phone

## Status and authorization

- Status: PROPOSED — research phase first. D1–D6 decided by the owner on 2026-09-25; the owner
  reviews the Phase 0 write-up and mockups before Phase 2 starts.
- Priority: P2 in the UI refresh lane. The owner asked for it on 2026-09-25: research how VS Code
  does it, make it work on a phone, and redo it.
- Effort: M. One settings surface, its row model, a recording surface and a scenario. Phase 7
  (several shortcuts per command, D4) changes the overrides schema and the resolver.
- Risk: LOW for Phases 1–6, which rebuild only the surface. Phase 7 touches contracts, the keymap
  resolver and the TUI editor. Every phase lands green on its own.
- Planned at: Platform `3347239f`, 2026-09-25. Before screenshots (1440, 820 and 390 wide, list,
  filtered list and the expanded resolution report) and the script that took them:
  `/work/tmp/fregat-evidence/20260925-keybindings-before/`.
- Depends on: [Plan 102](102-scroll-and-keyboard-affordance.md) P3 (`Kbd` chip, lane L1),
  [Plan 157](157-base-components.md) (segmented control, scroll fades, typeahead refine, lane L1),
  [Plan 080](080-platform-keybinding-modes.md) (preset display names Platform / VS Code, lane L8).
  Take whatever of those has landed on `main`; do not rebuild any of it here.
- Work in the current checkout. Deploy with `bun run deploy` (web only).

## Outcome

Keyboard shortcuts is a page you can read at a glance and edit without fighting it. On a desk it
reads like VS Code's Keyboard Shortcuts editor: every command in one list with its keys drawn as
keycaps, where it applies, and whether you changed it, with search by name or by pressing the keys.
In a narrow pane or on a phone the same page is a single column of tappable rows that still looks
deliberate, and a command can carry more than one shortcut, as in VS Code.

## Today

Component: `features/settings/components/keybinding-section.tsx` (57 lines), rendered by
`setting-row.tsx:175` as the control of the `keybindings.overrides` row. Rows are
`keybinding-row.tsx`, recording is `widgets/chord-recorder.tsx`, the debug report is
`keybinding-resolution.tsx`, filtering and conflict counts are `utils/keybinding-rows.ts`. The row
model is `commandKeyBindings` in `keymap/active-bindings.ts:73`: one row per command in
`platformCommands`, 231 of them, 88 unbound in the default preset. Tests:
`features/settings/tests/keybinding-section.test.tsx` (185 lines). No `agent:browser` scenario
covers it.

What the screenshots show:

1. **A list in a box in half a row.** The editor is the right-hand control of a generic setting
   row: `w-[28rem]` beside the label column on desktop. 231 commands scroll inside a
   `max-h-64` box, five rows at a time, inside a page that also scrolls. On a phone that inner box
   is a scroll trap.
2. **The row header is the registry key.** `keybindings.overrides` has no `title`, so the heading
   is "Overrides", and the description is JSON grammar ("an explicit null unbinds the command")
   that means nothing on this page.
3. **Titles are cut to nothing.** On desktop "Undo workspace e…" and "workspace.undoWork…" share a
   ~190 px column with a 208 px recorder button and two icon buttons.
4. **Unassigned is the loudest thing on screen.** 88 of the 231 commands have no binding, each
   drawn as a wide bold mono "Unassigned" button, and registry order puts two of them first.
5. **Phone rows are three stacked controls.** At 390 px each row becomes title, id, a full-width
   recorder button and two bare icon buttons; three commands fill the screen.
6. **The resolution report is a debug dump.** "Shortcut resolution" expands into
   `Browser reservation · Mod+Tab · reservation` lines and every unmapped VS Code command id with
   the same sentence repeated. It pushes the list off screen.
7. **Recording commits on the first stroke.** A conflict is reported after the write, as
   "N other commands use this" under the button, and two-stroke chords rely on the
   `isChordPrefix` guess.
8. **Stray pieces.** The row's `⋯` menu floats at the vertical middle of the list; custom rows use
   a `Badge` where every other setting uses the `bg-info` modified bar; the preset shows the raw
   values `default` and `vscode`.

## Rules this plan holds to

- Responsive by the settings container query (`@3xl/settings`), not the viewport, so a narrow
  desktop pane and a phone get the same layout.
- One scroller. The list flows in the settings page scroll; the toolbar is sticky inside it.
- Rows are `ListRow`, focus is `useListbox`, windowing is `VirtualList`. Keys are drawn only with
  Plan 102's `Kbd`.
- Touch targets are at least 40 px and inputs keep 16 px text when narrow, as
  `scenario settings-responsive` already asserts for the page header.
- Tokens only, no dividers, `font-mono` for command ids and chords, `text-muted-foreground` or
  `text-2xs` for quiet text. Truncated titles carry `title` with the title and command id.
- Writes stay `setKeybinding` / `resetKeybinding` from `use-settings-actions.ts`, which are already
  mutations.

## Phase 0 — Research

Deliverable: `docs/ui-research/keyboard-shortcuts.md`, with screenshots under `docs/images/`, and a
`/dev` tab (`/dev/shortcuts`) holding static mockups of the desktop row, the narrow row and the
recording popover on fixture rows. The owner looks at `/dev/shortcuts` on the mesh from a phone before Phase 2.

**VS Code**, from `references/vscode` (`e81ea68fc02`, 2026-09-23):

- `workbench/contrib/preferences/browser/keybindingsEditor.ts` (1,314 lines): the Command /
  Keybinding / When / Source table (`:488-509`), Record Keys search (`:145`, placeholder
  "Recording Keys. Press Escape to exit" at `:370`), Sort by Precedence (`:148`), the row context
  menu, and how an unbound command's row looks.
- `keybindingWidgets.ts` (336 lines): the define-keybinding overlay. "Press desired key combination
  and then press ENTER" (`:169`) and the live "N existing commands have this keybinding" (`:230`)
  before anything is written.
- `services/preferences/browser/keybindingsEditorModel.ts:244`: default order is bound commands
  first, then by title.
- `@source:user`, `@source:default`, `@source:system`, quoted-chord search
  (`preferences.contribution.ts:983-1027`).
- Screenshots of vscode.dev's Keyboard Shortcuts at 1440 and 390 wide, taken with a scratch
  Playwright script like the one in the before-evidence directory. VS Code has no narrow layout;
  the 390 shot is there to show what not to copy.

**Keymap editors with a narrow or touch layout.** For each: what a row shows, how editing starts,
how recording works, how conflicts are shown, what changes when the window is narrow.

- Zed's keymap editor (a table with Context and Source columns; locate its crate first). Clone
  into `references/zed` only if the web source and screenshots are not enough.
- Obsidian's Hotkeys settings, and what its iPad and iPhone apps show for the same page.
- JetBrains Keymap and Warp's keyboard shortcuts page, for search by keystroke and conflicts.
- iPadOS's hold-⌘ shortcut overlay and Android's keyboard shortcuts helper, for how a touch OS
  presents shortcuts to a keyboard user.

**Mobile facts to settle, with sources:**

- Whether a page can tell a hardware keyboard is attached, so the recorder can say it needs one
  instead of waiting for keys an on-screen keyboard never sends. Candidates: the first keydown
  carrying a modifier, `(hover: none) and (pointer: coarse)`. Check `navigator.keyboard` in WebKit.
- Which chords iOS Safari and iPadOS keep for themselves (⌘Tab, ⌘Space, ⌘H, ⌘W, ⌘T, ⌘L…). Compare
  with the reservations `keyBindingResolution` already reports, so the recorder can say "Safari
  keeps ⌘W" instead of doing nothing.
- Playwright's WebKit does not start on this host, so the iPhone check is the owner's, on the mesh.

The doc ends with a proposed row anatomy for both widths and VS Code's model for several
shortcuts per command (one row per binding, Add Keybinding, removal entries), which Phase 7 follows.

## Phase 1 — Row model

Pure code in `features/settings/utils/`. `keymap/**` belongs to lane L8 during the completion wave;
if `CommandKeyBindingRow` must grow, keep the addition to one field and land it after L8 merges.

- **Where** each binding applies: the `pane` of its live bindings (`FocusArea` in
  `packages/client-core/src/commands/focus.ts`) and whether `editorWhen` narrows it, rendered as
  "Everywhere", "Editor", "Terminal", "Editor, with a selection". The research decides the words.
- **Source**: Default, Preset (VS Code), Custom, Unbound.
- **Conflict**: the commands this row shadows and the one that shadows it, from `shadowedBy`, and a
  browser reservation on its chord.
- **Filters**: All, Custom, Conflicts, Unassigned. Search keeps matching title, id and chord
  (`matchingKeybindingRows`), plus a recorded-keys mode that matches the exact chord.
- **Order**: bound first, then by title, as VS Code does.

Unit tests beside the utils, one per rule.

## Phase 2 — Desktop page

- The `keybindings.overrides` row renders full-width like the `theme` and `usage` widgets. It
  gets a real `title` and a description written for the page; the JSON grammar moves to
  `docs/settings-reference.md` if the registry can carry it separately, otherwise it stays in the
  schema's own description. Regenerate with `bun run settings:reference`.
- The preset becomes Plan 157's segmented control (Platform | VS Code) at the top of the section
  if 157 and 080 have landed, and stays the enum row otherwise.
- **Sticky toolbar** in `--bar-height` rows: search `InputGroup` with a trailing Record keys
  toggle (VS Code's), then the filter segmented control with counts in `font-mono tabular-nums`.
- **Rows**, `ListRow` in a `VirtualList` that scrolls with the page. `VirtualList` has `scrollRef`
  but no `scrollMargin`; add it in `packages/ui` if the list must start below the section header
  inside the page scroller, or give the Keyboard shortcuts category its own scroll body.
  Columns: title (with the command id muted beneath or in `title`), keys as `Kbd` chips, where,
  source. Unassigned shows nothing in the keys column, not a button. Custom rows carry the
  `bg-info` modified bar that other setting rows use; the `Badge` goes.
- **Actions** appear on row hover and focus, and the same set is the row's context menu:
  Change shortcut (Enter or double-click), Remove shortcut, Reset to default, Copy command id,
  Show conflicts (sets the Conflicts filter to this chord).
- **Keyboard**: one tab stop for the list via `useListbox`; Enter records; Delete removes; the
  toolbar and list are reachable with Tab.
- The section's `⋯` moves into the toolbar: Reset all shortcuts, Open settings JSON, Copy
  resolution report.

## Phase 3 — Recording

A popover anchored to the row, at every width. VS Code's flow (D2).

- Shows the chord live as `Kbd` chips while keys are pressed. Enter saves, Escape cancels,
  Backspace drops the last stroke. Two strokes are allowed without `isChordPrefix` (D2).
- Before saving it lists the commands that already use the chord, and names a browser or OS
  reservation, so a conflict is visible before the write rather than after it.
- `ChordRecorder` is rebuilt as this surface; its capture logic (`recordedStroke`,
  `recordingControl`, `normalizedChord` in `client-core`) stays.
- No chord builder (D3). On a device with no hardware keyboard the popover says a keyboard is
  needed to record; Remove and Reset still work by touch.

## Phase 4 — Narrow and phone

Below `@3xl/settings`:

- A row is one line of title plus keys on the right, with where and source on a quiet second line.
  Row height at least 44 px. No inline buttons.
- Tapping a row opens the same row menu as desktop (Change, Remove, Reset, Copy command id, Show
  conflicts). No bottom sheet and no new `packages/ui` primitive (D6); the bar is that it looks
  deliberate at 390 px, not that it is a native phone surface.
- The filter control scrolls sideways with Plan 157's scroll fade; the Record keys toggle hides
  when no hardware keyboard has been seen.
- The toolbar stays sticky under the settings header. Search keeps 16 px text.

## Phase 5 — The resolution report

- Its facts move onto rows: a shadowed row says which command wins; a chord the browser keeps says
  so in the row and in the recorder.
- In the VS Code preset, a collapsed "VS Code shortcuts not available here" group lists the
  unmapped bindings as rows (VS Code command, keys, reason in words), deduplicated by reason.
- The raw report leaves the page and is available as Copy resolution report (D5). Delete
  `keybinding-resolution.tsx` once nothing renders it.

## Phase 6 — Verification and landing

- `scripts/agent/scenarios/settings-keybindings.ts`, desktop then 390 × 844 with touch:
  search, each filter, Record keys search, record Ctrl+Alt+K on a command with Enter, read the
  run's `settings.json` for the override, record a conflicting chord and check the warning shows
  before saving, reset, remove. Narrow: assert the list has no scroller of its own, row and control
  heights ≥ 40 px, tap a row, Remove from its menu, check `settings.json`.
  Selectors in `scripts/agent/selectors.ts`. Add a line to
  `.agents/skills/verify-fregat/features/settings.md`.
- Rewrite `keybinding-section.test.tsx` for the new structure; delete tests of removed behaviour.
- `bun run gates`, the web typecheck, `compiler:memos` on the touched files.
- `look` at 1440 and 390 on the mesh after `bun run deploy`, and read both screenshots back. The
  owner checks an iPhone.
- The TUI's `apps/tui/src/settings/components/keybinding-editor.tsx` is out of scope until
  Phase 7.

## Phase 7 — Several shortcuts per command

VS Code lets a command carry any number of keybindings (D4). After Phases 1–6 land, and after lane
L8 merges `keymap/**`:

- `keybindingOverridesSchema` (`packages/contracts/src/settings.ts:120`) becomes a record of
  command id to a list of chords, `null` still meaning unbound. Greenfield: no shim for the
  single-string form; update `settings-keys-released.json`, `schema.json` and the reference.
- The resolver in `keymap/active-bindings.ts` applies every chord in the list, and
  `CommandKeyBinding.keys` becomes a list.
- The page shows one row per binding, as VS Code does, with Add shortcut in the row menu; Remove
  and Change act on that one binding.
- The TUI's keybinding editor writes the new shape.
- The scenario adds a second shortcut to a command, checks both chords run it, then removes one.

## Decisions

Decided by the owner on 2026-09-25.

| #   | Question                                 | Decision                                                                                                    |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D1  | Where does the editor live?              | Inside Settings, full-width in the Keyboard shortcuts category. Splitting Settings into tabs is later work. |
| D2  | Save on the first stroke, or on Enter?   | Whatever VS Code does: Enter, with conflicts shown before the write.                                        |
| D3  | Editing on a phone without a keyboard?   | No chord builder. Not worth the work; Remove and Reset work by touch.                                       |
| D4  | One shortcut per command, or several?    | Several, because VS Code allows it. Phase 7, after the redesign lands.                                      |
| D5  | Where does the raw resolution report go? | Behind Copy resolution report in the toolbar menu.                                                          |
| D6  | Phone edit surface?                      | No bottom sheet. The narrow layout just has to look good; rows open the same menu as desktop.               |
