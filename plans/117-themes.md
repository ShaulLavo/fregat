# Themes as bundles

Status: proposed, implementation not started. Requested 2026-09-14. Third of three plans split out of the retired Plan 104. Depends on [Plan 115](115-palettes-as-data.md) and [Plan 116](116-wallpaper-library.md).

Current wallpaper behavior (2026-09-19): `workbench.wallpaper` holds one `{ enabled, source }` choice, independent of color mode. Theme-specific light/dark defaults belong to this plan; they must not erase a manual wallpaper selection or turn visibility back on. Reconcile the selection mutation below with that contract before implementation.

A theme is a palette, a syntax pair, a wallpaper per mode, and material values, under one name. Once Plans 115 and 116 exist, a theme is a small record that references pieces that already have identities, pickers, and libraries. Picking a theme finishes the job in one click, and every part stays individually adjustable afterwards.

The product decisions from Plan 104 that survive the split are restated here so the retired plan is not needed. Its research is still the [reference](../docs/theme-standardization-reference.md).

## Shape

```ts
type ThemeParts = Readonly<{
  palette: PaletteId
  codeTheme: Readonly<{ light: string; dark: string }>
  wallpaper: Readonly<{ light: WallpaperSource; dark: WallpaperSource }>
  material: Readonly<{
    opacity: number
    contentOpacity: number
    blur: number
    saturation: number
  }>
}>

type Theme = Readonly<{
  schemaVersion: 1
  id: ThemeId
  revision: ContentHash
  name: string
  source: 'bundled' | 'user'
  parts: ThemeParts
  provenance?: ThemeProvenance
}>
```

The parts are references. A theme's mode support is its palette's: paired or single.

## Decisions

| Decision                          | Behavior                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — the parts stay authoritative | `workbench.palette`, `editor.codeTheme.*`, `workbench.wallpaper`, and the four `workbench.surface.*` keys remain the values the app renders. Selecting a theme is one settings mutation that writes all of them. Nothing renders "the theme"; everything renders its parts.                                     |
| D2 — the theme is remembered      | `workbench.theme` holds the selected `{ id, revision }`, scope `application`. **Customized** is derived: the current part values differ from the theme's parts.                                                                                                                                                 |
| D3 — customization is per theme   | `workbench.theme.customizations` holds, per theme id, the part values the user changed while that theme was selected. Selecting Tokyo Night restores the user's Tokyo Night; selecting Graphite restores Graphite's. **Use theme defaults** clears the entry for the current theme. Changes never cross themes. |
| D4 — one action, one mutation     | `selectTheme` writes the part keys and `workbench.theme` in a single request through `useSettingsActions`. A field-level part change while a theme is selected also updates the customization entry in the same request, so two windows editing different parts keep both edits.                                |
| D5 — mode stays a preference      | `workbench.colorTheme` is unchanged. A single-mode theme under the opposite preference uses its one variant and shows the limitation; the preference survives for the next paired theme.                                                                                                                        |
| D6 — Save as new theme            | Materializes the current parts as a user theme. Duplicating a palette or a wallpaper the theme references is not implied; the new theme references the same ids until the user duplicates a part.                                                                                                               |
| D7 — portable archive             | Export writes `theme.json` plus the referenced user palette JSON, referenced library wallpapers, and notices. Bundled parts are referenced by id. Import validates at the boundary: schema version, no executable fields, no traversal, size and count limits. Partial import publishes nothing.                |
| D8 — Omarchy import composes      | One command imports an Omarchy theme end to end: Plan 115's palette mapping, Plan 116's background import, a reviewed syntax registration where one is bundled, Platform's material defaults. It records the mapping report and marks wallpapers unverified. First as a script, then behind an import action.   |
| D9 — Platform keeps its language  | A theme supplies colors, code, terminal, wallpaper, and material. Shapes, spacing, bar heights, typography, focus, elevation, and motion are not theme fields.                                                                                                                                                  |

## Where the code goes

| Owner                                                | Work                                                                                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/themes/`                     | Theme schema, `ThemeId`, the two keys, the archive manifest, and the `theme` widget kind.                                                                         |
| `packages/client-core/src/themes/`                   | Bundled theme records, the "customized" diff, and the selection mutation builder.                                                                                 |
| `apps/server/src/themes/`                            | Theme library beside the palette and wallpaper libraries, archive export and import with staging, and the composed Omarchy importer.                              |
| `apps/web/src/lib/appearance/`                       | `useAppearance().selectTheme`, preview of a whole theme through the same variable adapter as Plan 115, and the derived customized flag.                           |
| `apps/web/src/features/settings/components/widgets/` | `theme-widget.tsx`: the gallery with cards previewing chrome, code, terminal, and wallpaper; Customize opens the part widgets already built by Plans 115 and 116. |
| `apps/tui/src/theme/`                                | Selection follows the shared keys. `tui.theme.colors` registers the explicit terminal-host-colors choice with its consumer in this pass.                          |
| `scripts/themes/import-omarchy-theme.ts`             | Composition of the two part importers plus syntax lookup and the report.                                                                                          |

## Implementation units

1. **Contract and selection.** Schema, keys, bundled Graphite and Sage themes, the single-mutation `selectTheme`, and the customized diff. Real in-process tests: select, customize a part, select another theme, return, and concurrent part edits from two clients.
2. **Gallery.** Cards with real previews, keyboard preview with Escape restore, Apply through the handoff, Save as new theme, Use theme defaults.
3. **Portability.** Export, staged import, structured rejections, and a round trip into an empty library that renders without the source machine.
4. **Curated packs.** The Omarchy composition script, then Tokyo Night, Rosé Pine, Catppuccin, and Gruvbox reviewed in both modes where a pair exists. A pack ships as bundled only with reviewed colors, a bundled syntax registration, and cleared artwork; otherwise it ships colors with a solid background.
5. **TUI and cleanup.** `tui.theme.colors`, docs, `bun run settings:reference`, and removal of this plan.

## Completion

| Gate             | Evidence                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One selection    | A fresh user clicks one card and sees coordinated chrome, code, terminal, and wallpaper with no further choice.                                             |
| Customized       | Change the accent; the card reads Customized. Select another theme and return; the accent change is back. Use theme defaults clears it.                     |
| Concurrent       | Two clients change different parts of the same theme; both survive. A repeated mutation is idempotent.                                                      |
| Preview          | Preview A, then B, then Escape with reordered async loads; every renderer returns to the projected selection and nothing reaches disk or the boot mirror.   |
| Portability      | Export a customized user theme, import into an empty library, compare resolved parts.                                                                       |
| Product identity | The workbench in Graphite and two imported families keeps Platform's layout, controls, typography, focus, and motion. No component gains a palette literal. |
| Accessibility    | Gallery and customization work by keyboard with visible focus. Bundled themes pass the Plan 115 contrast readout.                                           |
| Inventory        | No independent theme writer outside `selectTheme`. Generated references agree with the registry.                                                            |

Add one appearance-application event per theme apply with theme id, revision, mode, part ids, and duration. Greenfield rules apply.
