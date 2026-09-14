# Wallpaper library

Plan 116 imported 91 unique stills from 22 installed Omarchy themes on 2026-09-14. Importing twice produced identical asset IDs. [omarchy-wallpapers.json](omarchy-wallpapers.json) maps each theme to its assets for Plan 117. Every imported asset records its theme and original path and is marked `redistribution: unverified`.

The machine's library is `/work/platform-data/wallpapers`, linked from `~/.platform/wallpapers`. No library images are included in the web build.

Local selections:

| Mode  | Image                              | Asset ID                                                           |
| ----- | ---------------------------------- | ------------------------------------------------------------------ |
| Light | Catppuccin Latte, 1-color-fade.png | `7f0ea4054c817e6535cfd1a01133bc9e414cc11459bb9ced2ce37aa03b0dcab7` |
| Dark  | Tokyo Night, 3-sunset-lake.png     | `06dfb9fce029ec35adb40ea3939296777c2b140d1232b5a1697b15052d575362` |

To reproduce the mapping, run `bun scripts/themes/import-omarchy-wallpapers.ts`. Pass `--directory` to read another server-side theme tree and `--output` to choose the mapping file.
