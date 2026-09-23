/**
 * Defaults the pre-paint boot script reads, which the registry also uses. No schemas and no
 * palette data here: the web build inlines this module into index.html ahead of first paint.
 */

import type { WallpaperSelection } from '../themes/wallpaper'

export const WORKBENCH_DENSITIES = ['compact', 'cozy'] as const

export type WorkbenchDensity = (typeof WORKBENCH_DENSITIES)[number]

export const DEFAULT_WORKBENCH_DENSITY: WorkbenchDensity = 'compact'

export const COLOR_THEME_MODES = ['dark', 'light', 'system'] as const

export const DEFAULT_COLOR_THEME: (typeof COLOR_THEME_MODES)[number] = 'system'

export const DEFAULT_PALETTE_ID = 'graphite'

export const DEFAULT_EDITOR_FONT_FAMILY = 'JetBrainsMono'

export const DEFAULT_WALLPAPER_SELECTION: WallpaperSelection = {
  enabled: true,
  source: { kind: 'desktop' },
}

export function isWorkbenchDensity(value: unknown): value is WorkbenchDensity {
  return WORKBENCH_DENSITIES.some((density) => density === value)
}
