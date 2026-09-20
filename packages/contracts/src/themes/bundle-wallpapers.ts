import * as v from 'valibot'
import { assetIdSchema, type AssetId, type WallpaperSelection } from './wallpaper'

export type BundledWallpaper = {
  readonly asset: AssetId
  readonly theme: string
  readonly file: string
}

// Omarchy artwork is not redistributed; each entry is the sha256 the library
// assigns when it imports that file, so the reference resolves after a seed.
function omarchy(theme: string, file: string, sha256: string): BundledWallpaper {
  return { asset: v.parse(assetIdSchema, sha256), theme, file }
}

export const BUNDLED_WALLPAPERS = {
  graphiteLight: omarchy(
    'white',
    '2-white.jpg',
    'a261b0adb32e200534b581a3db4264ea8241365a786dce3946e2006dceed4eff',
  ),
  graphiteDark: omarchy(
    'vantablack',
    '3-layers-stacked.jpg',
    '7e30d584ba2a2dd810b94fce78a5115c36727f8c2015d8e11504ab1d355deea0',
  ),
  sageLight: omarchy(
    'everforest',
    '1-tree-tops.jpg',
    '0f00a5e2d0f78d5e75c7a2f48101f6dee69179c6d94e9f4ebc6fb7c0f39462bf',
  ),
  sageDark: omarchy(
    'gruvbox',
    '5-leaves.jpg',
    'cdbd3cd7b34a2c8e7e74818af5101a8531786878b0a3afcb8f6985b27394f66d',
  ),
  tokyoNightLight: omarchy(
    'lupine',
    '04-elegant-blue-wave.jpg',
    'aa592cf40a1be6de7e8b19a56f6dcc6dce7a843f0042d196e2a0bc195f959ae1',
  ),
  tokyoNightDark: omarchy(
    'tokyo-night',
    '0-winding-road.jpg',
    '37746404ae9a4357442e520c34ea105780232ac3d08a9f289f00156e49f37c4e',
  ),
  rosePineLight: omarchy(
    'rose-pine',
    '1-funky-shapes.jpg',
    '6f5a9ea3dc223fbe910467cc73967ba6dd9f7e80a7d806bc15e985563d15fe03',
  ),
  rosePineDark: omarchy(
    'tokyo-night',
    '3-sunset-lake.png',
    '06dfb9fce029ec35adb40ea3939296777c2b140d1232b5a1697b15052d575362',
  ),
  catppuccinLight: omarchy(
    'catppuccin-latte',
    '1-color-fade.png',
    '7f0ea4054c817e6535cfd1a01133bc9e414cc11459bb9ced2ce37aa03b0dcab7',
  ),
  catppuccinDark: omarchy(
    'catppuccin',
    '2-waves.png',
    '563190df9589beb2d5117d40db02c649232ab6bc3c3f2eb6d97a9fb3585a0cfd',
  ),
  gruvboxLight: omarchy(
    'flexoki-light',
    '1-orb.png',
    '5fec32ec9b7270c4afe5f36ac2885a8f37bff1a5a8ae4edb3b01b7d262628456',
  ),
  gruvboxDark: omarchy(
    'gruvbox',
    '1-the-backwater.jpg',
    '13cfc6ae370af984c08a820ff81b56a0febb0fbfe9712a6db128b94d14ecaac6',
  ),
} as const satisfies Record<string, BundledWallpaper>

export function bundledWallpaperSelection(wallpaper: BundledWallpaper): WallpaperSelection {
  return { enabled: true, source: { kind: 'library', asset: wallpaper.asset } }
}

export function bundledWallpaperFor(asset: AssetId): BundledWallpaper | null {
  return Object.values(BUNDLED_WALLPAPERS).find((entry) => entry.asset === asset) ?? null
}
