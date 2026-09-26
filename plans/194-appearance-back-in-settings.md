# Plan 194: appearance back in settings

## Status and authorization

- Status: PROPOSED 2026-09-27. Owner direction, same day, on finding the surface opacity controls
  gone from settings: "the studio never meant to replace any setting! it's just an extra feature on
  top! we need to integrate it back into the settings".
- Effort: M. Phase 1 is the fix the owner asked for; 2 and 3 remove what made the regression
  invisible.
- Undoes Plan 124's D13 ("Appearance in settings becomes one summary row") and the deletions it
  listed. Keeps everything else Plan 124 built: the studio, its draft, preview and Apply.

## What happened

Plan 124 moved the eight theme parts into the studio and hid them from settings with
`visibility: 'internal'` and the comment "Chosen in the theme studio, which writes it as part of
the theme" (`packages/contracts/src/settings/keys.ts`, the keys in `THEME_PART_KEYS`,
`packages/contracts/src/themes/bundle-settings.ts`):

| Key                                | Settings row today | Studio control        |
| ---------------------------------- | ------------------ | --------------------- |
| `workbench.palette`                | hidden             | Colors tab            |
| `editor.codeTheme.light` / `.dark` | hidden             | Code tab              |
| `workbench.wallpaper`              | hidden             | Wallpaper tab         |
| `workbench.surface.opacity`        | hidden             | Surfaces › Panes      |
| `workbench.surface.contentOpacity` | hidden             | Surfaces › Content    |
| `workbench.surface.blur`           | hidden             | Surfaces › Blur       |
| `workbench.surface.saturation`     | hidden             | Surfaces › Saturation |

It also deleted the settings widgets for palette, code theme and wallpaper; `setting-row.tsx`
falls through to "Edit in settings.json" for those widget kinds. Settings search for "opacity",
"wallpaper" or "code theme" finds nothing.

The write path already treats settings as a peer of the studio: `setSetting` in
`features/settings/hooks/use-settings-actions.ts` turns a part write into a `theme.customize` for
the selected theme and mode, `resetSetting` returns the part to the theme's value, and
`use-setting-inspection.ts` marks a part modified against the theme. The TUI's
`apps/tui/src/settings/utils/edit.ts` does the same. Only the rows are missing.

## Decisions

| Decision                    | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — settings own them      | Every theme part is a visible settings row again, in Appearance, directly under the Theme row. The studio is a preview-and-apply layer over the same values; it hides nothing and owns no key. Delete the eight `visibility: 'internal'` lines and their comments.                                                                                                                                                                          |
| D2 — one control each       | The rows reuse the studio's controls, not the deleted widgets: `CodeTab`, `ColorsTab`'s palette list, `WallpaperTab`, and one `Slider` per `SurfacesTab` field. Each becomes a component taking a value and an `onChange`; the studio passes its draft, settings passes the resolved value and `setSetting`. With two consumers they move to `lib/appearance/components/` (AGENTS.md `lib/` rule).                                          |
| D3 — which mode a row edits | Palette, wallpaper and the four surface values are one key each but two values in a theme. A row edits the mode the app is showing and its description ends with that mode ("Dark mode."). Switching light/dark re-reads the row. Code theme keeps its two keys. Owner question Q1 below.                                                                                                                                                   |
| D4 — Theme row              | Stays a full-width row: name, both wallpapers, `Open studio`. Picking a theme still sets every part; parts changed afterwards show the modified marker and Reset returns them to the theme's value (already implemented).                                                                                                                                                                                                                   |
| D5 — no ignored values      | With a theme selected, `resolveThemeSettings` ignores user-layer values for part keys, so `settings.json` can hold a value that does nothing (the owner's holds `editor.codeTheme.dark: everforest-dark` while rose-pine shows). The settings JSON view gets a diagnostic on such a key naming the theme that sets it. Stray values in the owner's `~/.platform/settings.json` are deleted by hand with the owner's OK, not healed in code. |
| D6 — search                 | The rows carry the keywords the studio labels use ("panes", "content", "glass", "transparency", "wallpaper", "syntax"), so settings search finds each control by the word on the studio slider.                                                                                                                                                                                                                                             |

## Phases

1. **Rows back.** D1, D2, D4, D6. Extract the four controls into `lib/appearance/components/`,
   render them from `SettingControl` for widgets `palette`, `code-theme`, `wallpaper`, and
   `number` on the four surface keys (a slider, since they are bounded percentages). Run
   `bun run settings:reference`. `dom` tests over the real in-process server: each row renders the resolved
   value; editing a part with a theme selected writes one `theme.customize` for the shown mode;
   Reset returns to the theme's value; with no theme it writes the key. Update the settings page
   test that pins the hidden keys.
2. **Mode label.** D3 as decided by Q1.
3. **Ignored values.** D5: the diagnostic, then the owner-approved cleanup of their settings file.
4. **Proof and ship.** Scenario `settings-appearance-rows`: open Settings, search "content", drag
   the slider, read `--content-opacity` and the painted editor background, confirm the studio's
   Surfaces tab shows the same number, and confirm `caches` holds one settings mutation. `look`
   screenshots of the Appearance section read back and published for the owner. Ship with
   `bun run deploy --server --restart`.

## Owner questions

- **Q1 — per-mode rows.** Recommended: one row per part that edits the mode on screen and says
  which (D3), matching the studio's mode switch. The alternative is a light and a dark row for each
  part, like code themes today: nothing changes with the mode, but Appearance grows from 9 rows to 15.

## Drift check

Before starting: `THEME_PART_KEYS` still lists the eight keys; `setSetting` still routes parts to
`theme.customize`; the studio tabs still take `{ value, onEdit }`-shaped props
(`features/theme-studio/components/*-tab.tsx`); `page.tsx:133` still filters `internal` rows.
