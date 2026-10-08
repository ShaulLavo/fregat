# Attributions

The landing page shows five theme bundles on their own dark wallpapers. The build reads each
bundle from `packages/contracts/src/themes/bundles.ts` and re-encodes its original image from
`apps/server/src/themes/wallpapers/assets/` to WebP. Those originals come from
[Omarchy](https://github.com/basecamp/omarchy) themes, as `BUNDLED_WALLPAPERS` in
`packages/contracts/src/themes/bundle-wallpapers.ts` records.

| Plate              | Image         | Omarchy theme and file                        | Original source and licence                                                                                                                                                                    |
| ------------------ | ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokyo Night (hero) | Winding road  | `tokyo-night/backgrounds/0-winding-road.jpg`  | Added in Omarchy commit `9c9e0829` ("New launch backgrounds for Omarchy"), retouched in [basecamp/omarchy#7057](https://github.com/basecamp/omarchy/pull/7057). Artist and licence not stated. |
| Rosé Pine          | Sunset lake   | `tokyo-night/backgrounds/3-sunset-lake.png`   | Added in Omarchy commit `9c9e0829`. Artist and licence not stated.                                                                                                                             |
| Sage               | Leaves (fern) | `gruvbox/backgrounds/5-leaves.jpg`            | Added in Omarchy commit `e921ea3c` ("Additional Gruvbox backgrounds by @OldJobobo"). Photographer and licence not stated.                                                                      |
| Catppuccin         | Waves         | `catppuccin/backgrounds/2-waves.png`          | Added in [basecamp/omarchy#1008](https://github.com/basecamp/omarchy/pull/1008) by @shawnyeager. Artist and licence not stated.                                                                |
| Graphite           | Layers        | `vantablack/backgrounds/3-layers-stacked.jpg` | Added with the Vantablack theme in [basecamp/omarchy#4533](https://github.com/basecamp/omarchy/pull/4533) by @bjarneo. Artist and licence not stated.                                          |

The page's fonts are [Inter](https://github.com/rsms/inter) and
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), both under the SIL Open Font
License 1.1, installed from Fontsource. The code colours come from the Shiki themes each bundle
names (`@shikijs/themes`, MIT).
