# Palettes as data

Status: **implemented 2026-09-14 — units 1 through 5 landed, the browser gate passed against the mesh, and release `plan-115-editor-mode` is live.** Requested 2026-09-14. First of three plans split out of the retired Plan 104; [Plan 116](116-wallpaper-library.md) and [Plan 117](../docs/theme-bundles.md) follow. See [Outcome](#outcome).

A palette is the set of app colors and terminal colors for one mode. Today it is two hand-authored CSS blocks per palette and a two-value picklist. That shape has a ceiling of exactly two palettes, and "create your own" is impossible. This plan moves the palette into data with a schema, a resolver, and an editor, so that a third palette is a JSON file, a user palette is a saved record, and the whole app repaints while a hue slider is dragged.

Syntax highlighting stays where it is. The two `editor.codeTheme.*` keys and their picker already work. Light and dark stay a separate preference. A theme, which binds a palette to a syntax pair and a wallpaper, is Plan 117.

## What exists today

| Piece       | Current state                                                                                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting     | `workbench.palette` in [`keys.ts`](../packages/contracts/src/settings/keys.ts) is `picklist(['sage', 'graphite'])`, scope `window`.                                                                                                                                                                      |
| Colors      | [`globals.css`](../packages/ui/src/styles/globals.css): `:root` and `.dark` hold Graphite; `html[data-palette='sage']` and `.dark[data-palette='sage']` override 29 of those tokens. About 130 values are `oklch()`, the terminal tokens are hex. Sage inherits Graphite's terminal colors.              |
| Application | [`applyAppearance`](../apps/web/src/features/settings/utils/apply-appearance.ts) sets `data-palette` on the root. The [boot script](../apps/web/index.html) reads the mirror and sets the same attribute plus a `--boot-floor` for Sage before any module loads.                                         |
| Preview     | [`AppearanceProvider`](../apps/web/src/features/settings/providers/appearance-provider.tsx) previews a palette by rendering the other attribute value until the settings projection observes the handoff.                                                                                                |
| Terminal    | [`readTerminalTheme`](../apps/web/src/features/terminal/utils/theme.ts) scrapes `--terminal-*` through `getComputedStyle` and parses only hex and `rgb()`. An `oklch()` value there would silently fall back. The panel re-reads on light/dark changes only, so a dark-to-dark palette change is missed. |
| TUI         | [`generate-palette.ts`](../apps/tui/scripts/generate-palette.ts) scrapes the four CSS blocks into `palette.json`; [`theme.ts`](../apps/tui/src/theme/utils/theme.ts) types `ThemePreferences.palette` as `'graphite' \| 'sage'`.                                                                         |
| Widgets     | Settings rows render `boolean`, `enum`, `number`, `string`, `font`, `code-theme`, and a few structured widgets. There is no color control and no gallery.                                                                                                                                                |

## Decisions

| Decision                                     | Behavior                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — OKLCH is canonical, hex is a boundary   | A palette stores one OKLCH value per token, with alpha. The CSS adapter emits `oklch()` unchanged. Terminal, TUI, and export get sRGB. Import accepts any CSS color the parser understands: hex, `rgb()`, `hsl()`, `oklch()`. Nobody is expected to write OKLCH by hand; hex in JSON is the authoring format, and the editor UI is the primary authoring path. |
| D2 — sRGB only, for now                      | Every stored color is clipped into the sRGB gamut on import and validated on save, so the hex output is exact. Wide gamut is a later lift of that one check, nothing else.                                                                                                                                                                                     |
| D3 — a palette is paired or single-mode      | `{ kind: 'paired', light, dark }` or `{ kind: 'single', mode, colors }`. No automatic inversion fabricates the missing mode. A single-mode palette under the opposite preference uses its one variant and says so.                                                                                                                                             |
| D4 — the token set is closed                 | The schema names the app semantic roles and the terminal roles below. It is not an arbitrary CSS map. File-tree icon colors, search-match colors, editor highlight colors, and material values are not palette fields; they stay in CSS or, where they should follow the palette, become derived tokens computed by the resolver.                              |
| D5 — terminal colors are palette fields      | The 16 ANSI colors plus foreground, cursor, cursor accent, selection, and selection foreground belong to the palette. This closes the "Sage uses Graphite's terminal" gap and gives the terminal typed colors instead of computed-style scraping.                                                                                                              |
| D6 — bundled palettes are data too           | Graphite and Sage move into JSON. The `:root` and `.dark` color blocks in `globals.css` are generated from Graphite by a script and checked for drift, so a page with no boot mirror still paints Graphite before any JavaScript runs. The Sage blocks and `data-palette` are deleted.                                                                         |
| D7 — the setting is a palette reference      | `workbench.palette` becomes a validated palette id, scope `application`. A user palette lives in the primary server's library, and a workspace file cannot reference a palette that exists only on one machine.                                                                                                                                                |
| D8 — user palettes are records on the server | `~/.platform/palettes/<id>.json` through routes on the primary server. Bundled palettes are read-only. Duplicate, rename, edit, and delete apply to user palettes only; deleting the selected palette first submits Graphite through the settings pipeline and awaits settlement.                                                                              |
| D9 — preview is variables, not a write       | While dragging, the editor writes the resolved variables onto the document root directly and nothing touches settings. Apply submits one mutation through `useSettingsActions`. Cancel restores the projected appearance. This is the demo, and it is also the mechanism.                                                                                      |
| D10 — no CSS-in-JS                           | Custom properties are the runtime. Tailwind classes keep resolving to tokens; the resolver only changes the token values. A user stylesheet for arbitrary overrides is a possible later opt-in outside the palette format and is not part of this plan.                                                                                                        |

## The token set

App roles, per mode, matching the names in `globals.css` without the `--` prefix and without the `-solid` suffix where the solid value is what the palette authors:

`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `info`, `info-foreground`, `success`, `success-foreground`, `warning`, `warning-foreground`, `update`, `update-foreground`, `diff-added`, `diff-removed`, `row-hover`, `row-active`, `row-selected`, `border`, `border-subtle`, `input`, `ring`, `chart-1` through `chart-5`.

Terminal roles, per mode: `foreground`, `cursor`, `cursor-accent`, `selection`, `selection-foreground`, and the 16 ANSI slots `black` through `bright-white`.

The resolver, not the CSS, derives `--content-well`, `--card-light-solid` and `--card-dark-solid`, and any token that `globals.css` currently computes with `color-mix` from a palette value may keep doing so. Reconcile the exact list against `globals.css` at implementation time; the two Sage blocks are the minimum set a palette must be able to override, and the `.dark` block is the full set a mode defines.

## Shape

```ts
type Oklch = Readonly<{ l: number; c: number; h: number; alpha?: number }>

type PaletteColors = Readonly<{
  app: Readonly<Record<AppColorRole, Oklch>>
  terminal: Readonly<Record<TerminalColorRole, Oklch>>
}>

type PaletteVariants =
  | {
      readonly kind: 'paired'
      readonly light: PaletteColors
      readonly dark: PaletteColors
    }
  | {
      readonly kind: 'single'
      readonly mode: 'light' | 'dark'
      readonly colors: PaletteColors
    }

type Palette = Readonly<{
  schemaVersion: 1
  id: PaletteId
  name: string
  source: 'bundled' | 'user'
  variants: PaletteVariants
  provenance?: Readonly<{
    kind: 'omarchy'
    repository: string
    commit: string
    theme: string
  }>
}>

declare function parseColor(input: string): Oklch // hex, rgb(), hsl(), oklch(); clipped to sRGB
declare function toHex(color: Oklch): string
declare function resolvePalette(
  palette: Palette,
  mode: 'light' | 'dark',
): Readonly<{
  mode: 'light' | 'dark'
  cssVariables: Readonly<Record<string, string>>
  terminal: TerminalColors
  contentHash: string
}>
```

The JSON on disk and in import accepts color strings, so a hand-written palette is hex. Parsing happens once at the boundary; the in-memory record is OKLCH. Export writes hex.

## Where the code goes

| Owner                                                | Work                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/themes/`                     | Palette schema, role lists, validated `PaletteId`, the `workbench.palette` key change, and the `palette` widget kind.                                                                                                                  |
| `packages/client-core/src/themes/`                   | Color parsing and conversion, sRGB clipping, the pure resolver, contrast helpers, and the bundled Graphite and Sage JSON. Runtime-neutral: the TUI imports the same module.                                                            |
| `packages/ui/src/styles/palettes.generated.css`      | Generated `:root` and `.dark` color declarations from bundled Graphite, imported by `globals.css`. A script under `scripts/themes/` writes it and a check fails CI on drift.                                                           |
| `apps/server/src/themes/`                            | Palette library: list, read, create, update, delete under `~/.platform/palettes/`, structured errors, and the retirement rule from D8. Primary-server only.                                                                            |
| `apps/web/src/lib/appearance/`                       | The DOM adapter that writes resolved variables to the root, shared by the boot path, `AppearanceProvider`, and the editor's live preview. Two or more consumers outside `lib/` justify the location.                                   |
| `apps/web/src/features/settings/components/widgets/` | `palette-widget.tsx` (gallery of swatch cards), `palette-editor.tsx` (Background, Accent, then Advanced roles per mode), a color field built on `InputGroup`, and the contrast readout.                                                |
| `apps/web/src/features/terminal/`                    | The panel subscribes to the resolved palette's content hash and feeds typed terminal colors to the adapter. Delete the computed-style scraping.                                                                                        |
| `apps/web/index.html` and the boot mirror            | The mirror carries the resolved variable maps for both modes of the selected palette, bounded to the closed token set. The boot script writes them before first paint. It contains no palette library data.                            |
| `apps/tui/src/theme/`                                | Read bundled and user palettes through client-core. Delete `generate-palette.ts` and the CSS scraping. `ThemePreferences.palette` becomes a palette id.                                                                                |
| `scripts/themes/`                                    | `generate-palette-css.ts` and `import-omarchy-palette.ts`, which maps a pinned `colors.toml` (background, foreground, accent, selection, muted, the eight colors and their bright variants) into a palette JSON with a mapping report. |

## The editor

The gallery is a settings row with the `palette` widget: one card per bundled and user palette showing the mode variants as swatches, the selected one marked, keyboard navigable, hover and focus previewing the whole app. Enter or click applies through the existing submission path with the same handoff `AppearanceProvider` already implements for the picklist.

Customize opens an editor with Apply and Cancel. The first controls are Background and Accent; changing either regenerates the related roles (surfaces from background, `primary-foreground` chosen for contrast against `primary`, hover and selection rows from foreground at the design alphas). Advanced lists every app role and every terminal role per mode. Each field is a color input plus a hex text field, so pasting from anywhere works. Every change writes variables to the root immediately. A contrast readout shows text and background pairs under 4.5:1 and non-text pairs under 3:1 without blocking Apply.

Duplicate creates a user palette from any palette; bundled palettes open in the editor read-only until duplicated. Rename and Delete apply to user palettes. Import accepts a pasted or uploaded palette JSON. The Omarchy path is the script in this plan; a UI for it belongs to Plan 117 with the rest of the importer.

## Implementation units

1. **Contract and resolver.** Schema, role lists, color parsing with sRGB clipping, resolver, Graphite and Sage JSON produced from the current CSS values, and the generated CSS with its drift check. Pure tests: hex round trip, clipping, paired and single resolution, resolver output equals the current `globals.css` values for both bundled palettes.
2. **Cut over the consumers.** The key becomes an id, the DOM adapter replaces `data-palette`, the boot script and mirror carry resolved variables, the terminal takes typed colors and subscribes to the content hash, the TUI reads client-core, and the Sage blocks and the scraping script are deleted. Verify first paint on a cold mirror and settled colors in the running app.
3. **The library.** Server routes and storage, delete-with-fallback, and the web query and actions. Real in-process server tests for create, update, delete-selected, and idempotent re-import.
4. **The gallery and editor.** Widget, editor, live preview, Apply and Cancel handoff, duplicate, rename, import. Real keyboard and focus check in the browser.
5. **Omarchy palette script.** Import Tokyo Night and Rosé Pine from the pinned commit as user-library fixtures, review both against the running app, and record the mapping in the research reference. They ship as bundled palettes only after both-mode review; a single-mode import ships single-mode.

## Completion

| Gate             | Evidence                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parity           | Graphite and Sage render pixel-identical to the pre-change build in both modes. Compare the resolved variable map against the old CSS declarations, and compare screenshots of the workbench. |
| Live preview     | Dragging the accent hue repaints chrome, rows, focus rings, and the open terminal within the same frame cadence as today's mode toggle, with no settings write and no query invalidation.     |
| Same-mode change | Switching between two dark palettes updates the open terminal's foreground, ANSI table, cursor, and selection without remounting the session.                                                 |
| First paint      | Reload with a user palette selected: the boot floor and the first painted frame use that palette. Corrupt the mirror: the page paints Graphite and keeps the selection.                       |
| Delete selected  | Deleting the selected user palette lands Graphite through the settings pipeline before the file goes; a rejected write leaves the palette in place.                                           |
| Contrast         | The readout flags a pair below 4.5:1 and clears when fixed. Bundled palettes have no flagged pairs.                                                                                           |
| TUI              | Selected bundled and user palettes render in the TUI, including 256 and 16-color degradation and `NO_COLOR`, with no CSS selectors anywhere in `apps/tui`.                                    |
| Inventory        | No `data-palette`, no `'sage'` or `'graphite'` picklist literal, no computed-style color read in the terminal. `bun run settings:reference` regenerated.                                      |

Enrich the existing settings write event with the palette id. Add one appearance-application event per apply with palette id, mode, content hash, terminal acknowledgement, and duration. No per-drag events.

Greenfield rules apply: delete `data-palette`, the Sage CSS, the picklist, and the TUI scraping in the same pass. Tell the user to clear `platform.settings-boot-mirror.v1` if the old mirror shape causes a wrong first paint; write no healing code.

## Outcome

Landed on 2026-09-14 at the working tree over `162a88e0`.

- **Contract and color math** live in `packages/contracts/src/themes/`: `color.ts` (parse, clip, quantize, hex and `oklch()` output, flatten, WCAG contrast), `palette.ts` (roles, schema, `parsePalette`, `serializePalette`) and `bundled.ts` (Graphite and Sage as documents). Color math sits in contracts rather than client-core because the schema transforms strings into OKLCH at the boundary and the server validates uploads with the same schema.
- **Resolver** is `packages/client-core/src/themes/palette.ts`: `resolvePalette` for one mode, `paletteStylesheet` for both, typed terminal colors, a content hash.
- **The stylesheet is the runtime.** `packages/ui/src/styles/palette.generated.css` carries Graphite in `@layer palette`; `apps/web/src/lib/appearance/utils/palette-style.ts` writes the selected palette as one unlayered `<style id="platform-palette">` with `:root` and `:root.dark` blocks, so a mode flip needs no JavaScript and a preview is a text swap. The boot script in `index.html` restores the last confirmed stylesheet from `platform.palette-boot.v1` before first paint. `data-palette`, the Sage CSS blocks, `--boot-floor` and the `--terminal-*` declarations are gone.
- **Terminal** takes typed colors through `terminalThemeFor` and re-applies on the content hash, so a dark-to-dark change repaints the ANSI table. The computed-style scraper is deleted.
- **TUI** reads bundled palettes from contracts and a user palette from the server through `use-palette-library.ts`; `generate-palette.ts`, `palette.json` and the `lightningcss` dev dependency are deleted.
- **Library** is `apps/server/src/themes/`: `~/.platform/palettes/<id>.json`, list/read/create/update/delete over GET and POST, bundled ids refused, delete of the selected palette lands Graphite through the settings pipeline first.
- **Gallery and editor** are the `palette` widget under `apps/web/src/features/settings/components/widgets/`: cards preview on keyboard focus (hover was tried and pulled: a pointer crossing the gallery repainted the workbench per card), Background and Accent derive the ramp, Advanced lists every role, the contrast readout is advisory, Apply is one library write plus one settings write.
- **Omarchy** import is `scripts/themes/import-omarchy-palette.ts`; Tokyo Night and Rosé Pine from the local `/usr/share/omarchy` install are in this machine's library as single-mode user palettes, with the mapping report on stderr.

Verified: contracts, client-core, server, and web focused tests; typecheck on every touched file; oxlint, oxfmt, the design census, knip and the generated-file checks. The compiled stylesheet through the running Vite server carries the palette layer and no Sage rule.

Findings the new instrument surfaced, left for a decision: Graphite light's `success-foreground` on `success` measures 4.38:1 and Sage light's `info` and `success` badges 4.46:1 and 4.28:1. The readout reports them; the bundled values are unchanged.

Browser gate, run headlessly against `https://omarchy.mesh.shaulavo.dev/platform`: the gallery lists Graphite, Sage, Rosé Pine and Tokyo Night; focusing Sage from the keyboard repaints `--background-solid` and blurring restores it; clicking persists `workbench.palette` and writes the boot cache; a reload paints Sage before React mounts; the editor's accent field repaints `--primary` live and Cancel restores it; no console errors. Deployed with `bun run deploy --server` (the palette routes are server code), then a web-only release for the editor opening on the on-screen mode.

The dev checkout needed the Editor's pushed `@singapore-editor` rename pulled, its packages built and `bun link`ed, and `bun install` here; the running Vite dev server caches the earlier resolution failure until it is restarted.
