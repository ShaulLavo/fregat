# Theme bundles

A bundle has separate light and dark versions, each with an app/terminal palette, syntax theme,
wallpaper selection and material values. Settings → Appearance → Theme bundles shows both versions.
Choose a card to apply it. New from current creates a bundle with an editor for each version.
Changes through the existing appearance controls customize the active version. Use theme defaults
clears both versions’ overrides. Switching bundles or color mode applies the destination wallpaper.
There is no global wallpaper-preservation setting.

## Ownership

The contracts in `packages/contracts/src/themes/` define bundles, archives, palette references and
field-level customization operations. `workbench.theme` holds the selected bundle, including its
id, revision and both variants, so rendering and reload do not wait for the library. Overrides live
in `workbench.theme.customizations`, indexed by bundle id and mode. Semantic `theme.customize`
operations merge individual fields on the server, including individual material fields. They keep
concurrent edits and retain their original bundle and mode even if selection changes while queued.

`resolveThemeSettings` projects the selected variant onto the existing part keys. It preserves valid
workspace and policy overrides. System mode resolves on each device; a system-mode notification does
not write shared settings. Web and TUI use this resolver. The TUI’s `tui.theme.colors` setting selects
bundle colors or terminal host colors independently of its light/dark preference.

The existing web appearance provider owns preview, application and confirmed boot caches. Keyboard
focus previews gallery cards; Escape or blur restores the projected selection. The creation dialog
can preview either version without writing settings. The boot mirror carries both resolved variants,
and the palette stylesheet cache contains the CSS and identities for both modes. Only confirmed
settings write those caches. The `appearance` / `theme.apply` event records the bundle revision,
resolved mode and part identities; its duration measures root appearance application.

## Library and portability

The server stores user bundles under `~/.platform/themes/<id>/theme.json`. An imported bundle also
owns `palettes/`, `wallpapers/` and `notices.json` in that directory. Imported parts appear in the
existing libraries. The importer validates and decodes in a hidden staging directory, then publishes
the entire directory with one rename. Failed imports remove staging and publish no parts.

Export includes both customized variants, referenced user palettes, original wallpaper bytes and
notices in a `.platform-theme.json` archive. Bundled palettes are referenced by id. Archives are
limited to 60 MiB, two palettes and two images, with the existing 20 MiB/40-megapixel image limits.
Image hashes must match, ids cannot contain paths, and syntax and palette modes must match their
variant. Imported user palettes receive content-based ids to avoid overwriting local palettes.
Importing a bundle whose id is taken creates a separate copy. Referenced parts cannot be deleted. Deletion checks defaults beneath customizations and standalone
settings references too. Embedded palettes are read-only; customization creates a user-owned copy.
Re-export preserves the imported notices.
Deleting an imported bundle is refused while another bundle uses its embedded parts.

## Curated families and Omarchy

Graphite and Sage have paired palettes. Catppuccin uses the installed Mocha and Latte mappings.
The installed Tokyo Night and Gruvbox sources provide dark palettes, and Rosé Pine provides a light
palette. Their opposite versions use upstream Tokyo Night Day, Gruvbox Light and Rosé Pine Main
palettes with the matching syntax theme. All twelve
bundled variants pass the existing palette editor’s 4.5:1 text-pair readout.

The twelve paired wallpapers ship with the server under `src/themes/wallpapers/assets/`. Their
original bytes retain the hashes in `BUNDLED_WALLPAPERS`; the server build validates every hash and
copies the images to `dist/assets/`. A fresh host needs no Omarchy installation or network download.
Startup populates the library in the background, and a requested built-in image is installed before
its read resolves. Export and New from current therefore work before background seeding finishes.
Missing or damaged packaged bytes fail with `wallpapers.BUNDLED_INVALID`. Updating this artwork
requires a server build and deployment. Artwork provenance remains Omarchy and redistribution
remains marked unverified.

Import from Omarchy composes the palette mapper, matching syntax registration and local artwork;
the import retains an unverified-artwork notice and its mapping report. The script produces the same
portable archive as the settings action:

```sh
bun run themes:import-omarchy --theme catppuccin --out catppuccin.platform-theme.json
```

## Verification

`apps/web/src/features/settings/tests/theme-bundles.test.ts` drives the real in-process server for
concurrent customization, mode resolution, defaults, duplicate mutations, staged rejection,
wallpaper and private-palette portability, and reference protection. It also checks all bundled
variants against the contrast readout. Existing appearance preview and optimistic handoff tests
cover the reused provider. TUI renderer tests cover explicit terminal-host color selection.

The gallery and editors now live in the theme studio; `bun run agent:browser scenario theme-studio`
drives it, and `scenario bundle-wallpapers` previews every bundled theme's paired wallpapers.

Toggling wallpaper off and on restores the original variant image. Bundle deletion keeps
artwork still referenced by another bundle's default beneath a customization, export keeps
notices, TUI theme-part drafts capture their variant when opened, embedded palettes have no edit
action, and palette creation rejects ids already owned by an imported bundle. Focused tests
cover the bundle/server, web appearance/settings and TUI settings paths.

## Appearance settings and the studio

Appearance settings expose each theme part as a regular setting. The studio provides draft,
preview and Apply over the same values; it owns no exclusive setting. A part edit customizes the
selected theme and mode, and Reset returns that part to the theme's value.

The [generated settings reference](settings-reference.md) lists the current keys.
