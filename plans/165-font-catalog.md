# Plan 165: One font catalog, loaded on demand

## Status and authorization

- Status: DONE 2026-09-25 — all five phases, plus installed fonts (owner request during
  implementation). See "What landed" at the end.
- Priority: P2 in the UI refresh lane.
- Effort: M–L. A second catalog provider on the server, a shared client font loader, one new
  setting, and a picker that replaces the Nerd Font dropdown.
- Risk: MED. The editor measures glyphs, and the first paint must not flash, so a font change touches
  boot, the editor's typography and the terminal.
- Planned at: Platform `03f241fc`, 2026-09-25.
- Work in the current checkout; no branches, worktrees, commits, pushes or PRs unless separately
  requested. Server changes: `bun run deploy --server`.

## Outcome

Picking a font starts from a short curated list for its role, and typing searches every Nerd
Font and Fontsource font, which includes all of Google Fonts. A font is fetched only when it is
chosen. Rows preview in their own face, and hovering one shows the whole app in it before you
commit. Fonts are cached by the server, so they
work offline after first use, over the mesh, and on remote machines. The app still boots with no
network, on the bundled Inter and JetBrains Mono.

## What exists today

- **Server** `apps/server/src/fonts/`: `NerdFontService` scrapes the nerdfonts.com download page
  into a name → zip map, and caches it in `~/.platform/fonts/font-links.json`. It extracts the
  Regular face from the zip into `files/<name>.ttf`, and subsets previews to woff2 with
  `subset-font` into `previews/`. Routes: `GET /fonts` (catalog), `GET /fonts/:name` (ttf, immutable),
  `GET /fonts/:name/preview?text=` and `POST /fonts/batch`.
- **Client** `apps/web/src/lib/default-nerd-font.ts`:
  - `fontStack(value)` makes `"<id> Nerd Font", "<id>", ui-monospace, …`.
  - `nerdFontQueryOptions` is the one owner of a download: it registers a `FontFace` from a URL
    and the browser caches it.
  - `boot-appearance.ts:105-110` starts the face before the bundle. The two share the family name.
- **Settings:** `editor.fontFamily` (`keys.ts:379`) is a Nerd Font id or a typed family, widget
  `font`. `FontWidget` is a text field plus a dropdown of every Nerd Font, each row drawn by
  `FontPreview` from a server-subset woff2. There is no setting for the interface font: Inter is
  bundled and fixed in `globals.css` (`--font-ui`). Code and metadata share `--font-mono`, which
  follows `editor.fontFamily` (the one-mono rule in `AGENTS.md`).
- **Fontsource API** (checked 2026-09-25): keyless.
  - `GET https://api.fontsource.org/v1/fonts` lists 2,100 fonts: 792 sans-serif, 365 serif,
    72 monospace, 482 display, 364 handwriting. 570 are variable and 1,980 come from Google Fonts.
    Each entry carries id, family, category, subsets, weights, styles, `variable` and license.
  - `/v1/fonts/<id>` adds per-weight, per-subset woff2 URLs on
    `cdn.jsdelivr.net/fontsource/fonts/<id>@latest/<subset>-<weight>-<style>.woff2`.
  - `/v1/variable/<id>` gives the axes; the variable file is `<id>:vf@latest/<subset>-wght-<style>.woff2`.

## Design

### Font references

One value format for every font setting: `<source>:<id>`.

- `nerd:JetBrainsMono`, from the existing scrape
- `fontsource:geist`, from the Fontsource catalog
- `local:Berkeley Mono`, a family installed on the machine; nothing is fetched
- `bundled:inter` and `bundled:jetbrains-mono`, shipped in the app; always available with no
  network, and the defaults

A pure `parseFontRef` in `packages/contracts` validates it, and the settings schema uses it.
Greenfield: `editor.fontFamily`'s default becomes `bundled:jetbrains-mono`, and any stored bare id
is deleted instead of migrated.

### Server: one catalog, two providers

- `FontsourceProvider` beside the Nerd Font code (which becomes `NerdFontProvider`), behind one
  `FontCatalogService`. The catalog is fetched once and cached for a day under
  `~/.platform/fonts/fontsource/catalog.json`. Files are fetched from the jsDelivr URL on first
  request and cached forever by id, weight, style and subset. The fetcher is injected, and tests
  use MSW with `onUnhandledRequest: 'error'`.
- A variable font caches its `wght` file per subset. A static font caches only weights
  400/500/600/700 in normal style, plus italic 400 for code.
- `GET /fonts` returns the merged catalog: `{ ref, family, source, category, variable, weights,
license }`.
- `GET /fonts/fontsource/:id.css` is a generated stylesheet: one `@font-face` per subset, with
  its `unicode-range`, pointing at same-origin cached files. The browser downloads only the subsets
  a page actually uses, so Cyrillic or Greek arrives by itself when that text appears.
- Preview subsetting works for both sources, from the latin file.
- Hosts are fixed (nerdfonts.com, GitHub release assets, jsDelivr and the Fontsource API). A font
  value can never make the server fetch anything else.

### Client: one loader

`lib/default-nerd-font.ts` becomes `lib/fonts/`, which holds:

- `fontQueryOptions(ref)`: the one owner of a font download, for any source. For `nerd` it
  registers a `FontFace` as today. For `fontsource` it inserts the stylesheet link once and awaits
  `document.fonts.load` for the family. `bundled` and `local` resolve at once.
- `fontStack(ref, role)`: role `ui` falls back to Inter and then the system sans; role `code` falls
  back to JetBrains Mono and then `monospace`.
- `boot-appearance.ts` starts both chosen fonts before the bundle, from the settings mirror, as it
  already does for the Nerd Font. That keeps the first paint in the right face instead of flashing
  the fallback.
- Changing the code font keeps today's editor re-measure path (`use-editor-typography.ts`).

### Settings

- New `workbench.fontFamily`, the interface font: default `bundled:inter`, widget `font`, scope
  `window` (presentation only, like density), category Appearance. `applyAppearance` writes
  `--font-ui` from it.
- `editor.fontFamily` keeps its role (editor, terminal, and the metadata mono); only its value
  format changes.
- Regenerate `docs/settings-reference.md`.

### The picker: an autocomplete, not a catalog browser

Owner, 2026-09-25: nobody wants 2,100 fonts in a list. The picker is a combobox. It opens on a
curated list, and typing searches everything. One component serves both settings.

- **A `Combobox` primitive** in `packages/ui/src/components/combobox.tsx`, over Base UI's
  Combobox. `packages/ui` has none today. It uses `ListRow` styling and follows the `AGENTS.md`
  list and loading rules.
- **On open, with an empty query:** "Recent" (the last few fonts chosen for this role, derived from
  the settings history rather than a new store) above "Suggested", a curated list per role, kept as
  data in `packages/contracts/src/fonts/curated.ts`:
  - Interface: Inter (bundled), Geist, Inter Tight, IBM Plex Sans, Google Sans Flex, Figtree,
    Manrope, Instrument Sans, Public Sans, System.
  - Code: JetBrains Mono (bundled), Geist Mono, Commit Mono, Martian Mono, IBM Plex Mono, Fira Code,
    Iosevka, Cascadia Code, Monaspace, 0xProto, Zed Mono, Victor Mono. Every one has a Nerd Font
    build (checked against the cached nerdfonts.com list, 2026-09-25), which the code role uses, so
    terminal glyphs keep working. Commit Mono and Martian Mono are the nearest free fonts to
    Berkeley Mono, which is commercial and reachable only as an installed font.
- **Typing searches the whole catalog on the client.** `GET /fonts` is about 150 KB of metadata,
  fetched once (`staleTime: 'static'`) when a picker first opens. It is ranked with the existing
  `fuzzyRank` (`packages/contracts/src/fuzzy-rank.ts`), the palette's matcher, and the top 30 are
  shown. The family is the label; category, source and id are keywords, so typing "mono" or
  "serif" narrows the list the way the dropped filter chips would have. No `fuzzysort` dependency. The code role
  ranks monospace first but hides nothing. There is no request per keystroke.
- **Previews:** at most about 40 rows exist at once, so every visible row fetches its server-subset
  preview woff2 (a few KB). A row whose preview fails shows its name in the fallback and stays
  selectable.
- **No match:** the first row becomes "Use installed font '<query>'", a `local:` ref.
- **Hover to try:** moving the pointer or the list cursor onto a row applies it to the app while
  the picker is open. Escape restores the saved font; Enter writes the setting.
- Preview text per role: `The quick brown fox 0123` for the interface, `AaBbGg 0123 => !==` for code.
- Loading: skeleton rows for Suggested until the catalog arrives, and `Shimmer` on a row whose
  preview is still loading. An empty search result is the "Use installed font" row, never a blank
  list.

Later, not in this plan: uploading a font file (for example a purchased Berkeley Mono) to the
server's font cache. It would then follow the user to every device the way downloaded fonts do,
where an installed font exists only on the machine it was installed on.

Dropped from the first design: the virtualized full list, the kind and source filter chips (the
role and the search cover them), and the separate "Type a family name…" row.

## Phases

1. **Server catalog.** `FontsourceProvider`, `FontCatalogService`, the merged `GET /fonts`, the
   stylesheet route, file caching and preview subsetting for both sources. Provider and route tests
   against MSW fixtures.
2. **Refs and loader.** `parseFontRef`, the `editor.fontFamily` value change, `lib/fonts/`, and boot
   pre-registration for both roles. Delete the old stored value on the dev and mesh homes.
3. **Interface font setting.** `workbench.fontFamily` wired through `applyAppearance` and boot.
4. **Picker.** The `Combobox` primitive, curated lists, recent fonts, client-side catalog search,
   previews, hover to try, the installed-font fallback row.
5. **Verify and deploy.** `bun run deploy --server`.

## Decisions (taken as recommended)

- **D1 — value format** `<source>:<id>`, so every consumer knows where a font comes from without
  guessing.
- **D2 — hover to try** applies to the whole app while the picker is open, and reverts on close.
- **D3 — installed fonts** stay a typed name. The Local Font Access API is Chromium-only and asks
  for a permission per origin. Revisit if typing turns out to be a real friction.
- **D4 — subsets:** every subset is declared with its `unicode-range`, and the browser fetches only
  what the text on screen needs.
- **D5 — static weights** 400/500/600/700 plus italic 400. The app uses nothing else (`AGENTS.md`
  type sizes and weights).

## Verification

- Server: provider tests for the catalog merge, file cache hits, the stylesheet's `unicode-range`
  per subset, preview subsetting for a Fontsource font, and rejection of a ref outside the
  catalog.
- Client: `lib/fonts` tests for `parseFontRef` and `fontStack` per role; ranking tests for the
  catalog search (code role ranks mono first, an exact family wins, no match yields the
  installed-font row).
- Scenario `font-picker` in `scripts/agent/scenarios/`, with selectors in `selectors.ts` and a
  feature-map line:
  - open the interface-font picker and assert it shows Suggested before any typing
  - type "geist", hover it and screenshot the app in Geist
  - press Escape and assert `--font-ui` is back to Inter
  - choose it, reload, and assert the first screenshot after reload already uses Geist, with no
    fallback frame
  - repeat for the code font with a Nerd Font, and assert the editor re-measures (cursor on the
    right column after typing)
- `caches` after choosing: one font query per ref, settled.
- `look` on settings, chat and the editor in two picked fonts, both densities.
- `bun run gates`, `bun run settings:reference`, then `bun run deploy --server`.

## What landed (2026-09-25)

Everything above, with these differences:

- **Routes.** `GET /fonts` (merged catalog), `GET /fonts/preview?ref=&text=` for any ref,
  `/fonts/nerd/:name`, `/fonts/fontsource/:id.css` with files beside it, and `/fonts/local/…` for
  installed fonts. `POST /fonts/batch` had no caller and is gone.
- **Family names come from the ref, not the catalog.** Boot has no catalog, so boot, the loader and
  the server stylesheet all name a face with `fontFamilyName(ref)` in `packages/contracts`
  (`geist Fontsource`, `FiraCode Nerd Font`).
- **Nerd glyphs for every code font.** The default code font is `bundled:jetbrains-mono`, which has
  no prompt icons. Any code font that isn't a Nerd Font falls back to `nerd:NerdFontsSymbolsOnly`,
  started at boot, so the terminal keeps its glyphs.
- **`--font-code`.** `font-mono` was compiled to a literal stack (`@theme inline`), so the old
  `--font-mono` override never reached it. `--font-ui` and `--font-code` are now plain `:root`
  variables that `applyAppearance` overrides.
- **The terminal follows the code font.** It was hardcoded to JetBrains Mono Nerd Font. The saved
  reload paint is keyed by family as well as size.
- **Installed fonts.** The server lists its machine's fonts with `fc-list`, and search shows them as
  `local:` refs tagged "installed". It serves their regular, bold and italic files through a
  generated stylesheet, so a font installed here also works on the phone and the Mac over the
  mesh. A machine without fontconfig (stock macOS) lists none. A family the server lacks gets an
  empty stylesheet and renders from the viewer's own install.
- **Recent** is this session's settings writes, from the mutation cache, plus the saved value. There
  is no settings history to derive it from, so it does not survive a reload.
- **Suggested renders immediately.** The curated list is local data. Skeleton rows show only while
  a search waits for the catalog.
- **Rows carry a source tag** (`installed`, `Fontsource`, `Nerd Font`, `bundled`), because the same
  family name can come from two sources.
- **Font stylesheets are `crossorigin="anonymous"`.** A plain `<link>` sends no `Origin`, and the
  origin guard rejects it when the API is cross-origin (dev).

Evidence: `/work/tmp/fregat-evidence/20260925T095311Z-scenario-font-picker/` (scenario
`font-picker`) and `…095327Z-caches-run/` (one settled font query per ref).
