# Plan 166: The keyboard shortcuts editor, redone for desk and phone

## Status and authorization

- Status: RESEARCH DONE 2026-09-26 — findings in
  [docs/ui-research/keyboard-shortcuts.md](../docs/ui-research/keyboard-shortcuts.md), mockups at
  1440, 820 and 390 in `docs/images/shortcuts-mock-*.webp`. D1–D6 decided by the owner on
  2026-09-25. Q1–Q2 below need the owner; the owner reviews the mockups (Q1) before Phase 2.
- Phase 1's two keymap fixes landed 2026-09-26 (wave 2, lane S): an override keeps every default
  (pane, `editorWhen`) template of its command, and the recorder keeps Control and Meta apart
  (`recordedStroke(event, platform)`; the TUI records as Linux).
- Priority: P2 in the UI refresh lane. The owner asked for it on 2026-09-25: research how VS Code
  does it, make it work on a phone, and redo it.
- Effort: M overall. Phase 1 fixes two live keymap bugs. Phase 7 (several shortcuts per command,
  D4) changes the overrides schema and the resolver.
- Risk: LOW for Phases 1–6. Phase 7 touches contracts, the keymap resolver and the TUI editor.
  Every phase lands green on its own.
- Planned at: Platform `3347239f`, 2026-09-25; researched at `c130dd35a`. Before screenshots and
  their script: `/work/tmp/fregat-evidence/20260925-keybindings-before/`. Research probes, the
  mockup generator and the compiled mockup pages: `/work/tmp/research2/166/`.
- Depends on: Plan 102 P3 and
  Plan 157, both done in lane L1 (PR #30, not on `main` at research time):
  `Kbd`, `TabsList variant='segmented'`, listbox typeahead refine, `hold-button`. Phase 1 does not
  need them; Phase 2 lands after L1. Plan 080 is on `main` (preset titles Platform / VS Code,
  [keyboard modes](../docs/keymap/modes.md)). Lane L8 has merged, so `keymap/**` is open.
- Work in the current checkout. Deploy with `bun run deploy` (web only).

## Outcome

Keyboard shortcuts is a page you can read at a glance and edit without fighting it. On a desk it
reads like VS Code's Keyboard Shortcuts editor: every command in one list with its keys drawn as
keycaps, where it applies, and whether you changed it, with search by name or by pressing the keys.
In a narrow pane or on a phone the same page is a single column of tappable rows that still looks
deliberate, and a command can carry more than one shortcut, as in VS Code.

## Today

Component: `features/settings/components/keybinding-section.tsx` (57 lines), rendered by
`setting-row.tsx` as the control of the `keybindings.overrides` row. Rows are
`keybinding-row.tsx`, recording is `components/widgets/chord-recorder.tsx`, the debug report is
`keybinding-resolution.tsx`, filtering and conflict counts are `utils/keybinding-rows.ts`. The row
model is `commandKeyBindings` in `keymap/active-bindings.ts`: one row per command in
`platformCommands`. Tests: `features/settings/tests/keybinding-section.test.tsx`. No
`agent:browser` scenario covers it.

Measured 2026-09-26 (Bun probe over `presetPlatformKeyBindings` and `commandKeyBindings`):

| Preset / host   | Commands | Unbound | Commands with 2+ default chords | Report entries |
| --------------- | -------- | ------- | ------------------------------- | -------------- |
| Platform, Linux | 253      | 83      | 9                               | 4              |
| Platform, macOS | 253      | 82      | 10                              | 5              |
| VS Code, Linux  | 253      | 89      | 20                              | 4              |
| VS Code, macOS  | 253      | 88      | 21                              | 5              |

What the before screenshots show:

1. **A list in a box in half a row.** `w-[28rem]` beside the label column; 253 commands scroll in
   a `max-h-64` box inside a page that also scrolls. On a phone that inner box is a scroll trap.
2. **The row header is the registry key.** `keybindings.overrides` has no `title`, so the heading
   is "Overrides", and the description is JSON grammar.
3. **Titles are cut to nothing** in a ~190 px column beside a 208 px recorder and two icons.
4. **Unassigned is the loudest thing on screen**: a wide bold mono "Unassigned" button on each of
   83 rows.
5. **Phone rows are three stacked controls**; three commands fill the screen.
6. **The resolution report is a debug dump.** It has shrunk since: 4–5 app-side reservations,
   the same 4–5 unmapped VS Code ids, and 21–22 editor commands without a chord.
7. **Recording commits on the first stroke**, reports conflicts after the write, and guesses
   two-stroke chords with `isChordPrefix`.
8. **Stray pieces**: the `⋯` floats at the list's vertical middle; custom rows use a `Badge`.

Found in research, not visible in the screenshots:

9. **A second default chord is hidden and an override drops it.** The row shows
   `keys: primary.keys` only, so F1 for the command palette and Ctrl+K Ctrl+S for Settings never
   appear, and overriding either command removes them.
10. **An override narrows a multi-pane command to one pane.** `userKeyBinding` copies the first
    default's pane. Overriding Undo session action (bound in six panes) yields one `global`
    binding: the new chord does nothing in Git, Logs, Problems, Search or Settings.
11. **Control cannot be recorded on macOS.** `recordedStroke` turns Ctrl and Cmd into `Mod`, so
    the VS Code preset's macOS Ctrl+1–9 cannot be re-recorded; on Linux, Super records as Ctrl.
12. **Usage renders under the list.** Keyboard shortcuts is the last registry category and
    `matchesUsageSearch('')` appends Usage after it, below 253 rows once the list flows inline.

## Rules this plan holds to

- Responsive by the settings container query (`@3xl/settings`), not the viewport, so a narrow
  desktop pane and a phone get the same layout. At 820 wide the dialog's container is 772 px,
  which is the desktop layout.
- One scroller. The list flows in the settings page scroll; the toolbar is sticky inside it.
- Rows are `ListRow`, focus is `useListbox`, windowing is `VirtualList`. Keys are drawn only with
  Plan 102's `Kbd`, one chip per stroke.
- Touch targets are at least 40 px and inputs keep 16 px text when narrow, including menus opened
  from a row.
- Tokens only, no dividers, `font-mono` for command ids and chords, `text-muted-foreground` or
  `text-2xs` for quiet text. Truncated titles carry `title` with the title, command id, chords and
  places.
- Writes stay `setKeybinding` / `resetKeybinding` from `use-settings-actions.ts`, which are
  already mutations.

## Phase 0 — Research (done 2026-09-26)

[docs/ui-research/keyboard-shortcuts.md](../docs/ui-research/keyboard-shortcuts.md) covers VS
Code's editor from source (`references/vscode` `90da900128e`) and vscode.dev screenshots at 1440
and 390; Zed's keymap editor from source; Obsidian, JetBrains, Warp, iPadOS and Android from
their docs and source; the mobile facts (hardware-keyboard detection, chords browsers keep, iOS
delivery); the row anatomy for both widths; the where and source words; the recording popover;
the menu; VS Code's model for several shortcuts per command and the Platform schema proposed for
Phase 7; and which lane L1 primitives to reuse.

The `/dev/shortcuts` tab moved to Phase 1: research made no product changes, and a `/dev` tab
built on the Phase 1 row model shows real rows instead of hand-made ones.

## Phase 1 — Row model, keymap fixes, `/dev/shortcuts` (M)

Pure code in `features/settings/utils/` plus two fixes in `keymap/` and `client-core`.

- **Fix the pane bug (finding 10)** in `keymap/active-bindings.ts`: `userKeyBinding` emits one
  binding per distinct default (`pane`, `editorWhen`) template of the command, deduplicated, and
  falls back to `commandDefaultPane` when the command has no default. Test: overriding
  `workspace.undoSessionAction` yields six bindings and the chord runs in the Git pane.
- **Fix recording of Control and Meta (finding 11)** in `client-core/settings/recording.ts`:
  on macOS Cmd records as `Mod` and Ctrl as `Control`; elsewhere Ctrl records as `Mod` and Meta
  as `Meta`. Test per host.
- **Row model**, one row per command until Phase 7:
  - `keys`: every configured chord (live ones, or the configured ones of a shadowed row), not
    just the first.
  - **Where**: words from `pane` and `editorWhen` per the table in the findings doc ("Everywhere",
    "Editor, editable", "Editor, find open", "App" for `global`), identical chords across panes
    merged.
  - **Source**: Default, Custom, Removed (an explicit `null` over a default); blank when unbound.
  - **Conflict**: the command that shadows this row (`shadowedBy`), the commands it shadows, and
    a browser-kept note on its chord (below).
  - **Filters**: All, Custom, Conflicts, Unassigned, with counts. Search matches title, id and
    chord text (`matchingKeybindingRows`), plus an exact-chord mode for Record keys.
  - **Order**: bound (shadowed included) before unbound, then by title.
- **Browser-kept chords**: a data table in `client-core/commands/` keyed by engine (Chromium in a
  tab, Gecko, WebKit macOS, WebKit iPadOS) from the findings doc, and a pure function
  `browserKeeps(chord, engine, standalone)`.
- **`/dev/shortcuts`** in `features/dev`: the desktop row, the narrow row, the recording popover
  and the row menu as static components over fixture rows built with the Phase 1 model. The markup
  and class lists come from the mockups in `/work/tmp/research2/166/mockup/` (generator
  `gen.mjs`). Deploy, so the owner can open `/platform/dev/shortcuts` on a phone.
- Unit tests beside the utils, one per rule.

## Phase 2 — Desktop page (M, after lane L1 merges)

- `setting-row.tsx`: the `keybindings` widget renders full-width like `theme`. Registry
  `keybindings.overrides` gets `title: 'Shortcuts'`. Its page text: "Every command and its keys.
  Enter or double-click changes a shortcut; right-click for more." (narrow: "Tap a command for its
  actions."). The JSON grammar moves to Plan 167's `details` if that has landed, and otherwise
  stays the registry `description` while the section renders its own sentence. Run
  `bun run settings:reference`.
- `page.tsx`: Keyboard shortcuts renders after every other category, Usage included.
- Keyboard mode becomes `TabsList variant='segmented'` (Platform | VS Code) in its own row.
- **Sticky toolbar**: search `InputGroup` ("Search by name, id or keys") with a trailing Record
  keys toggle, the toolbar `⋯` (Reset all shortcuts with `HoldButton`, Open settings JSON, Copy
  resolution report), then the filter segmented control with `font-mono tabular-nums` counts, then
  column labels in `text-2xs`. It paints the owner region's surface through one page-root CSS
  variable (`bg-popover-solid` in the dialog, `bg-background` in an editor tab).
- **Rows**: `ListRow` at the token height in a grid `minmax(0,1fr) 12rem 10rem 4.5rem 3.25rem`:
  title; first chord as `Kbd` plus `+N`; where; source; actions. Unassigned draws nothing in Keys.
  Custom and Removed rows carry the `bg-info` modified bar; the `Badge` goes. A shadowed row shows
  its chord struck through in `text-muted-foreground` and "Taken by <command>" in `text-warning`.
- **List**: `VirtualList` through `renderLayout` with the settings scroller as `scrollRef`. Add a
  `scrollMargin` prop to `packages/ui/src/patterns/virtual-list.tsx` (forwarded to TanStack,
  measured from the list's offset with a `ResizeObserver`) and pass `scrollPaddingStart` equal to
  the toolbar height (S).
- **Actions** on hover, active row and focus, and the same set as the row's context menu: Change
  shortcut (Enter or double-click), Add shortcut on an unbound row, Remove shortcut (Delete), Reset
  to default, Copy command id, Show conflicts (sets the Conflicts filter to this chord). Disabled
  states as in VS Code.
- **Keyboard**: one tab stop via `useListbox` with typeahead on; Enter records; Delete removes;
  the toolbar and list are reachable with Tab.
- Delete `keybinding-row.tsx` and the section's floating `⋯`.

## Phase 3 — Recording (M)

A popover anchored to the row, at every width. VS Code's flow (D2).

- Shows the chord live as `Kbd` chips; add `size` to `Kbd` (`sm` default, `md` here) instead of
  a class at the call site.
- Keys: Enter saves; Escape clears a recorded chord, a second Escape closes; blur cancels; every
  other key records, Backspace included. Two strokes at most, the second only after a first stroke
  with Ctrl or Cmd (`isBindableChord`); a third stroke starts over. `isChordPrefix` leaves the
  recorder. `recordingControl` loses its `remove` case.
- Before saving it lists the commands the chord would take from, with where each applies, from a
  dry run of `keyBindingResolution` with the candidate override, and shows the browser-kept note
  for the current engine (Chromium only outside `display-mode: standalone`).
- Cancel and Save buttons stay: an iPad keyboard has no Escape key.
- `ChordRecorder` is rebuilt as this surface; `recordedStroke` and `normalizedChord` stay.
- No chord builder (D3). Until a hardware keyboard has been seen (session flag set by the first
  keydown with Ctrl, Meta or Alt, or a non-text key), the popover says "Recording needs a
  keyboard. Remove and Reset work from the row menu." and keeps listening.

## Phase 4 — Narrow and phone (S)

Below `@3xl/settings`:

- A row is a fixed 3 rem: title in `text-sm` with the first chord on the right, where · source on
  a quiet second line. No inline buttons. Fixed height keeps `VirtualList` unmeasured.
- Tapping a row opens the same row menu as desktop, anchored to the row (D6).
- Menus portal outside the container, so container variants cannot size them: add
  `pointer-coarse:min-h-10` to the item classes of `dropdown-menu.tsx` and `context-menu.tsx` in
  `packages/ui`. This makes every menu 40 px per item on a touch device.
- Chord hints in the menu and the Record keys toggle show only once a keyboard has been seen or
  `(any-pointer: fine)` matches.
- The filter control fits at 390 px (measured, 0 px overflow), so it needs no sideways scroll.
  The toolbar stays sticky; search keeps 16 px text.

## Phase 5 — The resolution report (S)

- Its facts move onto rows: a shadowed row names the winner; a row whose chord the browser keeps
  says so.
- In the VS Code preset, a collapsed "VS Code shortcuts not available here" group lists the 4–5
  unmapped bindings as rows (VS Code command, keys, reason in words).
- The raw report is Copy resolution report in the toolbar menu (D5). Delete
  `keybinding-resolution.tsx`.

## Phase 6 — Verification and landing

- `scripts/agent/scenarios/settings-keybindings.ts`, desktop then 390 × 844 with touch: search,
  each filter, Record keys search, record Ctrl+Alt+K on a command with Enter, read the run's
  `settings.json` for the override, record a conflicting chord and check the warning shows before
  saving, reset, remove. Override Undo session action and run it with focus in the Git pane.
  Narrow: assert the list has no scroller of its own, rows and menu items ≥ 40 px, tap a row,
  Remove from its menu, check `settings.json`. Selectors in `scripts/agent/selectors.ts`. Add a
  line to `.agents/skills/verify-fregat/features/settings.md`.
- Rewrite `keybinding-section.test.tsx` for the new structure; delete tests of removed behaviour.
- `bun run gates`, the web typecheck, `compiler:memos` on the touched files.
- `look` at 1440 and 390 on the mesh after `bun run deploy`, and read both screenshots back. The
  owner checks an iPhone.
- The TUI's `apps/tui/src/settings/components/keybinding-editor.tsx` is out of scope until
  Phase 7.

## Phase 7 — Several shortcuts per command (M/L)

VS Code lets a command carry any number of keybindings (D4). After Phases 1–6 land:

- `keybindingOverridesSchema` (`packages/contracts/src/settings.ts`) becomes
  `Record<commandId, string[] | null>`: absent keeps the defaults, `null` or `[]` unbinds, a list
  replaces the defaults. Add writes defaults + new, Remove writes the rest, Reset deletes the key.
  Greenfield: no shim for the single-string form; update `settings-keys-released.json`,
  `schema.json` and the reference.
- The resolver applies every chord in the list, each with every default template of the command
  (the Phase 1 fix), and `CommandKeyBinding.keys` becomes a list.
- The page shows one row per chord, as VS Code does, with Add shortcut in the row menu; Remove and
  Change act on that one chord.
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

Decided 2026-09-26: research recommendation.

| #   | Question                                        | Decision and reason                                                                                                                                              |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D7  | Backspace and Escape in the recorder            | As VS Code (D2): Backspace records, Escape clears then closes. Dropping a stroke with Backspace would make bare Backspace unbindable.                            |
| D8  | Rows before Phase 7 with several default chords | One row per command, first chord plus `+N`, all chords in `title`. Per-chord rows need the Phase 7 schema; until then Change replaces them all.                  |
| D9  | Desktop row height                              | One line at the `ListRow` token height, command id in `title` and shown inline only when the search matched it (VS Code's rule).                                 |
| D10 | Phase 7 schema                                  | A full list per command, not VS Code's removal entries. Fits `merge: 'record'`, needs no negation grammar.                                                       |
| D11 | Touch-size menus                                | `pointer-coarse:min-h-10` on menu items in `packages/ui`, app-wide. The 40 px rule already holds for every other control on touch, and it adds no new primitive. |
| D12 | Where Keyboard shortcuts sits on the page       | Last, after Usage. A 253-row list above a category hides it.                                                                                                     |
| D13 | Words for `global` and conditions               | `global` is "App"; the condition words are the table in the findings doc.                                                                                        |
| D14 | Hardware keyboard signal                        | A session flag from the first keydown with a modifier or a non-text key; `(any-pointer: fine)` as the prior. No web API reports a keyboard.                      |

### Owner questions

**Q1. Do the mockups match what you want for Phase 2 and Phase 4?** Images:
`docs/images/shortcuts-mock-1440-list.webp`, `-1440-mixed`, `-1440-record`, `-1440-browser`,
`-1440-menu`, `-1440-record-search`, `-820-list`, `-390-list-touch`, `-390-mixed`,
`-390-touch-menu`, `-390-touch-record` (2× originals in `/work/tmp/research2/166/shots/`). After
Phase 1 the same design is live at `/platform/dev/shortcuts` for a phone check.

- (a) Yes, build them as drawn.
- (b) Yes, with changes you list.
- (c) No; say what is wrong.

**Recommendation: (a).** They follow VS Code's columns and flow, and they hold every rule this plan
lists.

Decided 2026-09-26: owner — (a), build them as drawn.

**Q2. Should the settings search box also find shortcuts?** Typing "sidebar" in Search settings
today shows sidebar settings only; the Toggle sidebar shortcut appears only when you search
"keyboard" or open the category.

- (a) No. The shortcut list has its own search; settings search matches the category's words only.
- (b) Yes. When a command title or id matches, the Keyboard shortcuts section shows with its list
  pre-filtered to the matches, and the toolbar search narrows further.

**Recommendation: (b).** One search box finds both a setting and its shortcut, which is the point
of D1 keeping the editor inside Settings; `matchingKeybindingRows` already does the matching.

Decided 2026-09-26: owner — (b).
