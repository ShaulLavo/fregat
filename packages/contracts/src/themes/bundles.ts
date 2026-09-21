import { themeBundleSchema, type ThemeBundle } from './bundle'
import * as v from 'valibot'
import { BUNDLED_WALLPAPERS, bundledWallpaperSelection } from './bundle-wallpapers'

const material = { opacity: 80, contentOpacity: 50, blur: 9, saturation: 160 }
const packs = [
  {
    id: 'graphite',
    name: 'Graphite',
    lightPalette: 'graphite',
    darkPalette: 'graphite',
    lightCode: 'light-plus',
    darkCode: 'dark-plus',
    lightWallpaper: BUNDLED_WALLPAPERS.graphiteLight,
    darkWallpaper: BUNDLED_WALLPAPERS.graphiteDark,
  },
  {
    id: 'sage',
    name: 'Sage',
    lightPalette: 'sage',
    darkPalette: 'sage',
    lightCode: 'light-plus',
    darkCode: 'poimandres',
    lightWallpaper: BUNDLED_WALLPAPERS.sageLight,
    darkWallpaper: BUNDLED_WALLPAPERS.sageDark,
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    lightPalette: 'upstream-tokyo-night-day',
    darkPalette: 'omarchy-tokyo-night',
    lightCode: 'light-plus',
    darkCode: 'tokyo-night',
    lightWallpaper: BUNDLED_WALLPAPERS.tokyoNightLight,
    darkWallpaper: BUNDLED_WALLPAPERS.tokyoNightDark,
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    lightPalette: 'omarchy-rose-pine',
    darkPalette: 'upstream-rose-pine-main',
    lightCode: 'rose-pine-dawn',
    darkCode: 'rose-pine',
    lightWallpaper: BUNDLED_WALLPAPERS.rosePineLight,
    darkWallpaper: BUNDLED_WALLPAPERS.rosePineDark,
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    lightPalette: 'omarchy-catppuccin-latte',
    darkPalette: 'omarchy-catppuccin',
    lightCode: 'catppuccin-latte',
    darkCode: 'catppuccin-mocha',
    lightWallpaper: BUNDLED_WALLPAPERS.catppuccinLight,
    darkWallpaper: BUNDLED_WALLPAPERS.catppuccinDark,
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    lightPalette: 'upstream-gruvbox-light',
    darkPalette: 'omarchy-gruvbox',
    lightCode: 'gruvbox-light-medium',
    darkCode: 'gruvbox-dark-medium',
    lightWallpaper: BUNDLED_WALLPAPERS.gruvboxLight,
    darkWallpaper: BUNDLED_WALLPAPERS.gruvboxDark,
  },
]
export const BUNDLED_THEMES: readonly ThemeBundle[] = packs.map((pack) =>
  v.parse(themeBundleSchema, {
    schemaVersion: 1,
    id: pack.id,
    name: pack.name,
    revision: '3',
    source: 'bundled',
    variants: {
      light: {
        palette: pack.lightPalette,
        codeTheme: pack.lightCode,
        wallpaper: bundledWallpaperSelection(pack.lightWallpaper),
        material,
      },
      dark: {
        palette: pack.darkPalette,
        codeTheme: pack.darkCode,
        wallpaper: bundledWallpaperSelection(pack.darkWallpaper),
        material,
      },
    },
  }),
)
