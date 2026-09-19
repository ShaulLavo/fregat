# A wallpaper picker worth using

Status: implemented and deployed 2026-09-17. Requested 2026-09-17. Follows [Plan 116](116-wallpaper-library.md) and runs before [Plan 117](117-themes.md), which binds wallpapers into a theme and would inherit this picker as it stands.

Plan 116 landed the library, the per-mode setting and the rendering. The picker it shipped is a thumbnail grid inside the right-hand column of one settings row. After three days the library holds 91 Omarchy imports and zero uploads, because the upload control is a bare native file input nobody recognized as one.

## What is wrong

| Area     | Finding                                                                                                                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space    | About 500px wide: three columns, 91 assets, a 384px scroll box nested inside the scrolling settings page.                                                                                                   |
| Upload   | `<input type="file">`, one file at a time, no drop, no paste. Success is silent, the new asset is not selected, and it sorts alphabetically among the imports.                                              |
| State    | The selected card is `bg-accent` on a 4px frame, which does not read. Nothing shows what light and dark are set to. The mode toggle opens on Dark whatever the app is in, and looks like the source toggle. |
| Delete   | A text button under every card, one click, no second step. Pointless on an imported asset, which the next import restores.                                                                                  |
| Noise    | `catppuccin · 1-totoro.png` plus a dimensions line per card, no grouping, and a permanent full-width "Import from Omarchy".                                                                                 |
| Preview  | The settings page covers the workbench, so a choice is made blind. The only command is "Next wallpaper", which walks 91 assets alphabetically.                                                              |
| Bytes    | The workbench loads the original: 3840×2160, median 1 MB, up to 5 MB, as the background of a window that is rarely wider than 2560.                                                                         |
| Importer | One file over the byte limit throws inside the loop and aborts the whole import.                                                                                                                            |
| Listing  | `list()` reads and parses every index file on every request.                                                                                                                                                |

## Decisions

| Decision                        | Behavior                                                                                                                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — the row summarizes         | The settings row is two tiles, Light and Dark. Each shows the current image, or names the None or Desktop source, and opens the picker on that mode.                                                                                                        |
| D2 — the picker is a dialog     | A wide modal: a mode switch that opens on the tile's mode, a filter, then sections. Sources (None, Desktop) first, "Your uploads" second, then one section per Omarchy theme. Choosing writes through the settings pipeline at once, as it does today.      |
| D3 — upload is a place          | The first card of "Your uploads" is the upload tile. The whole dialog is a drop target and accepts paste. Several files upload in order; the last one to succeed becomes the selection for the open mode. Failures toast by file name.                      |
| D4 — selection is drawn         | A `border-primary` frame and a check badge, with `aria-pressed`. Not a fill change.                                                                                                                                                                         |
| D5 — delete is for uploads      | A menu on the card, shown on hover and focus, on uploads only. Imported assets have no delete; the library is a seed the importer restores. The server route is unchanged.                                                                                  |
| D6 — names are cleaned for show | The card shows the name without the theme prefix or extension. The `title` carries the full name and the dimensions, which adds rather than echoes.                                                                                                         |
| D7 — a palette picker previews  | `Choose wallpaper` opens a `wallpaper ` palette scope for the mode the app is in. Rows carry a thumbnail. The highlighted row previews on the real workbench through a preview store `Wallpaper` reads before the setting; leaving the scope clears it.     |
| D8 — a display rendition        | Install writes `<id>.display.webp`, at most 2560 wide, beside the original and the thumbnail. The workbench loads it through `/:id/display`. Install also writes whichever derived file is missing for a known asset, so a re-import completes old entries. |
| D9 — the importer skips         | An oversize or undecodable file is skipped and reported as `{ path, code }`. The import result becomes `{ themes, skipped }`.                                                                                                                               |
| D10 — the listing is remembered | The parsed index is kept and reused while the library directory's mtime is unchanged, so a write from the curation script is still seen.                                                                                                                    |

Out of scope: rename, focal point and crop UI (Plan 116 D6 stands), video in the library.

## Where the code goes

| Owner                                                | Work                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/server/src/themes/wallpapers/`                 | Display rendition in `decode.ts`, completion of derived files and the skipping importer in `library.ts`, the `display` route, the cache.   |
| `apps/web/src/lib/wallpapers/`                       | `utils/groups.ts` for sections and display names, `state/preview-store.ts`. Both have two feature consumers.                               |
| `apps/web/src/features/settings/components/widgets/` | The two-tile widget, `wallpaper-picker-dialog.tsx`, the card, the upload tile. `hooks/use-wallpaper-upload.ts` owns drop, paste and order. |
| `apps/web/src/features/command-palette/`             | The `wallpaper` mode, its groups component and preview wiring.                                                                             |
| `apps/web/src/features/workbench/`                   | `Wallpaper` reads the preview; `LibraryWallpaper` loads `display`.                                                                         |
| `packages/client-core/src/commands/`, `keymap/`      | `workspace.selectWallpaper` and the `wallpaper ` prefix.                                                                                   |
| `scripts/agent/`                                     | The `wallpaper-library` scenario follows the dialog; a `wallpaper-palette` scenario covers D7; selectors and the feature map.              |

## Implementation units

1. **Server.** D8, D9, D10 with in-process server tests: the display route, completion on re-install, a skipped oversize file in a fixture tree, and a listing that sees an out-of-process write.
2. **Picker.** D1 through D6, with the dialog driven in the `dom` project over the real in-process server: multi-file upload selects the last, a rejected file toasts and leaves the selection, delete appears on uploads only.
3. **Palette.** D7 and the command.
4. **Proof and ship.** Both scenarios against the mesh build, screenshots read back, re-import to complete the 91 existing assets, `bun run deploy --server`.

## Completion

| Gate     | Evidence                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| Upload   | Dropping two images on the dialog adds both under "Your uploads" and selects the second for the open mode.      |
| State    | The row shows both modes' current images; the dialog opens on the clicked mode with the selection framed.       |
| Preview  | Arrowing through the palette repaints the workbench; Escape restores the saved wallpaper with no setting write. |
| Bytes    | The workbench requests `/display`, never `/asset`.                                                              |
| Importer | A fixture tree with one oversize file imports the rest and reports the skip.                                    |
| Census   | `scripts/lint/web-design-census.mjs` passes with no new allow-list entry lacking a reason.                      |

## Implementation evidence

- Server: `deriveWallpaper` writes the thumbnail and a 2560-bound WebP display rendition; a repeat install completes whichever derived file an entry lacks. Re-importing `/usr/share/omarchy/themes` on this machine completed all 91 assets in 43 s: 26 MB of display renditions against 109 MB of originals. The import result is `{ themes, skipped }`, inferred through Eden, so no contract schema was added.
- The listing cache is keyed on the directory mtime and dropped on every in-process write.
- Web: the row is two tiles; the dialog owns sources, uploads, theme sections, filter, drop and paste. Delete lives in a card menu on uploads only. `Choose wallpaper` previews through `lib/wallpapers/state/preview-store.ts`, which `Wallpaper` reads ahead of the setting.
- An upload whose bytes match an imported asset joins that asset: it gains `upload` provenance, keeps the imported name, and moves under "Your uploads". The scenario therefore uploads bytes no seed holds.
- Both scenarios change real settings on the target, so `wallpaper-library` records the selection for both modes and puts it back in a `finally`. The light / dark mode switching it used to end with is gone: it left `workbench.colorTheme` rewritten.
- Tests: 8 library tests (display route, completion, skipped file, out-of-process listing), 3 picker tests, 1 palette preview test, the settings page and command inventory tests. Web, server, TUI and client-core typechecks, changed-file lint and format, the design census and knip pass for these files.
- Browser evidence against the mesh build: `/work/tmp/fregat-evidence/20260917T154710Z-scenario-wallpaper-library/` and `/work/tmp/fregat-evidence/20260917T154642Z-scenario-wallpaper-palette/`. Screenshots read back: the row tiles, the uploaded image selected, the filtered keyboard selection with its frame, the palette repainting the workbench. The first deploy's live check failed on `/display` 404 for the selected asset, which is the Bytes gate seen from the other side; it passed after the re-import.
- The dev API process still predates `/themes/wallpapers` and returns 404. It was not restarted.
