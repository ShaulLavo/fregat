import { themeBundleSchema, type ThemeBundle } from './bundle'
import * as v from 'valibot'

const material = { opacity: 80, contentOpacity: 95, blur: 9, saturation: 160 }
const foundations: readonly ThemeBundle[] = ['graphite', 'sage'].map((id) =>
  v.parse(themeBundleSchema, {
    schemaVersion: 1,
    id,
    name: id === 'graphite' ? 'Graphite' : 'Sage',
    revision: '1',
    source: 'bundled',
    variants: {
      light: {
        palette: id,
        codeTheme: 'light-plus',
        wallpaper: { enabled: false, source: { kind: 'desktop' } },
        material,
      },
      dark: {
        palette: id,
        codeTheme: 'dark-plus',
        wallpaper: { enabled: false, source: { kind: 'desktop' } },
        material,
      },
    },
  }),
)

const packs = [
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    lightPalette: 'graphite',
    darkPalette: 'omarchy-tokyo-night',
    lightCode: 'light-plus',
    darkCode: 'tokyo-night',
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    lightPalette: 'omarchy-rose-pine',
    darkPalette: 'graphite',
    lightCode: 'rose-pine-dawn',
    darkCode: 'rose-pine',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    lightPalette: 'omarchy-catppuccin-latte',
    darkPalette: 'omarchy-catppuccin',
    lightCode: 'catppuccin-latte',
    darkCode: 'catppuccin-mocha',
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    lightPalette: 'graphite',
    darkPalette: 'omarchy-gruvbox',
    lightCode: 'gruvbox-light-medium',
    darkCode: 'gruvbox-dark-medium',
  },
]
export const BUNDLED_THEMES: readonly ThemeBundle[] = [
  ...foundations,
  ...packs.map((pack) =>
    v.parse(themeBundleSchema, {
      schemaVersion: 1,
      id: pack.id,
      name: pack.name,
      revision: '1',
      source: 'bundled',
      variants: {
        light: {
          palette: pack.lightPalette,
          codeTheme: pack.lightCode,
          wallpaper: { enabled: false, source: { kind: 'desktop' } },
          material,
        },
        dark: {
          palette: pack.darkPalette,
          codeTheme: pack.darkCode,
          wallpaper: { enabled: false, source: { kind: 'desktop' } },
          material,
        },
      },
    }),
  ),
]
