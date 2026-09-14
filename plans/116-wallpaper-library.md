# A wallpaper library and picker

Status: implemented and deployed. Browser verification passed; native shell smoke checks remain unverified. Requested 2026-09-14. Second of three plans split out of the retired Plan 104; independent of [Plan 115](115-palettes-as-data.md) and consumed by [Plan 117](117-themes.md).

Wallpaper previously used a boolean over whatever the desktop happened to show. This plan gives the app its own wallpaper library, a picker with per-mode selection, explicit image rendering on every platform, and an importer that seeds the library from the Omarchy themes installed on the server host.

## Starting point

| Piece     | Current state                                                                                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setting   | the retired wallpaper boolean, a boolean. `applyAppearance` writes `data-wallpaper-hidden` from it, and `globals.css` keys the popover vibrancy layer off that attribute.                                                                                                                                                      |
| Source    | One: the desktop. [`service.ts`](../apps/server/src/wallpaper/service.ts) resolves the compositor's current image, on Linux through `~/.local/state/omarchy/current/background`, on macOS through the desktop database. Routes serve `/wallpaper`, `/wallpaper/still`, `/wallpaper/info`.                                      |
| Rendering | [`Wallpaper`](../apps/web/src/features/workbench/components/wallpaper.tsx) mounts [`WebWallpaper`](../apps/web/src/features/workbench/components/web-wallpaper.tsx) only when [`documentBackdrop()`](../apps/web/src/lib/platform/backdrop.ts) is `app`. On a Linux desktop the backdrop is `compositor`, so nothing is drawn. |
| Fallback  | A bundled `workbench/wallpaper.jpg` under `apps/web/public`, shown until the desktop still loads or when it fails.                                                                                                                                                                                                             |
| Omarchy   | 22 themes under `/usr/share/omarchy/themes/<name>/backgrounds/`, 2 to 9 stills each, about 119 MB total on this machine. Code is MIT; per-image provenance is not recorded upstream.                                                                                                                                           |

## Decisions

| Decision                               | Behavior                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — a source per mode                 | `workbench.wallpaper` replaces the boolean with `{ light: WallpaperSource; dark: WallpaperSource }`. A source is `{ kind: 'none' }`, `{ kind: 'desktop' }`, or `{ kind: 'library'; asset: AssetId }`. Scope `application`, primary-server owner.                                                   |
| D2 — explicit images render everywhere | A library source draws in the `app` and `compositor` backdrops alike. Only `transparent` suppresses it, because the window itself is see-through. The Desktop source keeps the current policy exactly.                                                                                             |
| D3 — the library is content-addressed  | `~/.platform/wallpapers/<hash>.<ext>` plus an index of name, dimensions, content type, a generated thumbnail, and provenance. Installing the same bytes twice is one asset. Deleting an asset that a mode references first submits `{ kind: 'none' }` for that mode through the settings pipeline. |
| D4 — stills only in the library        | Library assets are JPEG, PNG, and WebP stills with size, dimension, and decode limits enforced before write. The existing Desktop video path is retained untouched. Video in the library can follow later.                                                                                         |
| D5 — Omarchy is a seed, not a bundle   | The importer reads a theme directory from the server host's disk and records `provenance: { kind: 'omarchy', theme, path }` and `redistribution: 'unverified'` on each asset. Nothing from it ships in a release build until cleared. The bundled `wallpaper.jpg` remains the only shipped image.  |
| D6 — fit is cover, focal point later   | The first version uses `object-fit: cover` and no crop UI. Focal point is an optional index field from day one so a later crop control needs no migration.                                                                                                                                         |
| D7 — the still loads progressively     | The thumbnail paints first, the full still replaces it when decoded, the solid background shows if both fail. An image from the previously selected source is never shown during a switch.                                                                                                         |

## Where the code goes

| Owner                                                | Work                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/themes/`                     | `WallpaperSource`, `AssetId`, the asset index schema, the `workbench.wallpaper` key, and the `wallpaper` widget kind.                                                                                                                                                |
| `apps/server/src/themes/wallpapers/`                 | Library storage, index, thumbnail generation, upload with limits, delete-with-fallback, and routes: list, asset bytes, thumbnail, upload, delete, and `import-directory` for a server-side path. Structured errors through the feature catalog. Primary-server only. |
| `apps/server/src/wallpaper/`                         | Unchanged. It remains the Desktop source.                                                                                                                                                                                                                            |
| `apps/web/src/features/workbench/`                   | `Wallpaper` resolves the source for the current mode and backdrop; `WebWallpaper` gains a library branch. The query module adds library asset and thumbnail options. `applyAppearance` writes `data-wallpaper-hidden` from the resolved source being `none`.         |
| `apps/web/src/features/settings/components/widgets/` | `wallpaper-widget.tsx`: source tabs, a thumbnail grid per mode, upload, delete, and an "Import from Omarchy" action shown when the primary server reports the directory exists.                                                                                      |
| `keymap/`                                            | A `wallpaper.next` command that advances the current mode's library selection.                                                                                                                                                                                       |
| `scripts/themes/import-omarchy-wallpapers.ts`        | Same importer as the route, runnable from the checkout for curation, with a written mapping of theme to asset ids.                                                                                                                                                   |

## Implementation units

1. **Contract and library.** Schema, key, storage, index, thumbnails, limits, and routes. Real in-process server tests: upload, idempotent re-upload, invalid file, oversize file, delete-selected fallback, and directory import from a fixture tree.
2. **Rendering.** The per-mode source resolution, library branch in `WebWallpaper`, backdrop rule from D2, progressive loading, and the attribute write. Verify in a Linux browser tab, in the shell with an opaque window, and in the shell with a transparent window.
3. **Picker and command.** The widget, the keymap command, and the Omarchy import action. Real keyboard and focus check.
4. **Seed and review.** Import the local Omarchy themes on this machine, pick defaults per mode for the workbench, and record the theme-to-asset mapping in the research reference for Plan 117 to bind.

## Completion

| Gate              | Evidence                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux rendering   | A library image shows in a browser tab on a Linux desktop and in the opaque shell window. The transparent shell window shows none. Desktop source behaves exactly as before. |
| Per mode          | Different images in light and dark; toggling mode swaps them with no frame showing the previous image.                                                                       |
| Limits            | An oversize or non-image upload is rejected with a structured error and leaves no partial file.                                                                              |
| Delete            | Deleting the selected asset lands `none` for that mode first; a rejected write leaves the file in place.                                                                     |
| Import            | Importing `/usr/share/omarchy/themes` twice yields the same asset set with provenance recorded and every asset marked unverified.                                            |
| Reduced motion    | Unchanged for the Desktop video path.                                                                                                                                        |
| Floating surfaces | No media inside dialogs, menus, popovers, tooltips, or editor panels.                                                                                                        |
| Inventory         | No references to the retired boolean key. `bun run settings:reference` regenerated.                                                                                          |

Enrich the wallpaper request events with source kind and asset id, never a path or bytes. Greenfield rules apply: the boolean key goes in the same pass.

## Implementation evidence

- The library stores one atomic JSON index entry per hash, beside the original still and a WebP thumbnail. Sharp decodes the full input before a write, with a 20 MiB byte limit, 16384 pixel side limit, 40 megapixel limit and 10 second processing timeout. Animated PNG and WebP are rejected.
- Library images render through a separate `LibraryWallpaper` component. Changing the asset remounts its thumbnail and decoded-image state. The Desktop component and video lifecycle are unchanged.
- The primary settings owner runs the picker mutations. Deletion refreshes confirmed settings and invalidates the library before resolving. The existing toggle acts on the current mode; `wallpaper.next` cycles the library.
- Imported 91 unique assets from 22 Omarchy themes twice with identical IDs. All provenance remains unverified. Local bytes live at `/work/platform-data/wallpapers`, linked from `~/.platform/wallpapers`. The committed [mapping](../docs/research/omarchy-wallpapers.json) contains no images.
- Selected Catppuccin Latte `1-color-fade.png` for light mode and Tokyo Night `3-sunset-lake.png` for dark mode. These are local settings, not bundled defaults.
- 72 focused tests passed across contracts, settings, library routes, command behavior, Desktop preload and wallpaper rendering. Web, server and scripts typechecks, changed-file lint, design census and generated settings checks passed.
- Browser evidence: `/work/tmp/fregat-evidence/20260914T182219Z-scenario-wallpaper-library/`. Screenshots cover keyboard selection, cycling and switching the workbench between light and dark. No request failures or error logs. Screenshot capture reports software GPU warnings.
- The dev API still predates the new route and returns 404. It was not restarted. Live browser verification used the mesh production build. App/compositor/transparent rendering policies passed component tests; actual native shell windows were not driven.
