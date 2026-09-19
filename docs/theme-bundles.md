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
palette. Their opposite versions use Graphite app colors and the specified syntax theme. All twelve
bundled variants pass the existing palette editor’s 4.5:1 text-pair readout. Mapping corrections and
source versions are recorded in [theme-pack-mapping.txt](theme-pack-mapping.txt).

Bundled packs use solid backgrounds because installed artwork has no reviewed redistribution grant.
Import from Omarchy composes the palette mapper, matching syntax registration and local artwork;
the import retains an unverified-artwork notice and its mapping report. The script produces the same
portable archive as the settings action:

```sh
bun run themes:import-omarchy --theme catppuccin --out /work/tmp/catppuccin.platform-theme.json
```

## Verification

`apps/web/src/features/settings/tests/theme-bundles.test.ts` drives the real in-process server for
concurrent customization, mode resolution, defaults, duplicate mutations, staged rejection,
wallpaper and private-palette portability, and reference protection. It also checks all bundled
variants against the contrast readout. Existing appearance preview and optimistic handoff tests
cover the reused provider. TUI renderer tests cover explicit terminal-host color selection.

`bun run agent:browser scenario theme-gallery` inspects the gallery and both editors.
`bun run agent:browser scenario theme-bundles` drives distinct wallpapers, mode-local customization,
reload, system changes, wallpaper re-enabling, preview cancellation, UI creation and export/import,
then restores settings and removes
its own fixtures.

Verified on the mesh on 2026-09-19, release
`20260919T122244Z-e78c4c44-plan117-theme-bundles`. The 12-step browser run passed at
`/work/tmp/fregat-evidence/20260919T122315Z-scenario-theme-bundles/`, including restoration
of the original variant image after toggling wallpaper off and on. The focused bundle,
command-provider and environment-ownership tests passed (19 tests), alongside affected
package typechecks, generated-file checks, the design census and unused-code checks.
The source remains uncommitted on `main`.

## Review follow-up

A second review fixed deletion of artwork still referenced by another bundle's default beneath a
customization, notices lost during export, stale standalone values in TUI theme-part drafts, and
an unsupported edit action on embedded palettes. TUI drafts capture their variant when opened.
Palette creation also rejects ids already owned by an imported bundle.

Release `20260919T131135Z-e78c4c44-plan117-reviewed` passed deployment checks. Forty-three focused
tests passed (9 bundle/server, 26 web appearance/settings, 8 TUI settings), as did affected
package typechecks, changed-file formatting/lint, generated-file checks and unused-code checks.
The expanded 13-step live scenario passed; screenshots were inspected:
`/work/tmp/fregat-evidence/20260919T131206Z-scenario-theme-bundles/`.

The production log window contains machine-events, file-watcher and settings-stream errors at
13:12:11 UTC during the forced reload; settings refetch succeeded. The browser reported no page
errors or failed HTTP responses. The CLI's automatic log reader points at the development logs,
so production logs were checked separately under `/work/platform-production/logs/`.

The reload-time log errors recorded above were addressed by the subsequent
[page-subscription cleanup](page-subscriptions.md). The production verification for that change
had no warnings or errors in its structured log window.
