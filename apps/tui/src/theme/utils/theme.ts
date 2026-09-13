import { RGBA, type ColorInput, type TerminalColors } from '@opentui/core'
import {
  bundledPalette,
  DEFAULT_PALETTE_ID,
  paletteColorsFor,
  toHex,
  type Palette,
} from '@workspace/contracts'
import { flattenedAppColors } from '@workspace/client-core/themes/palette'

import type { TerminalColorMode } from '@/host/utils/capabilities'
import { colorForTerminal } from '@/theme/utils/colors'
import { systemTheme } from '@/theme/utils/system'

const THEME_COLOR_KEYS = [
  'background',
  'card',
  'popover',
  'muted',
  'accent',
  'primary',
  'primaryForeground',
  'foreground',
  'mutedForeground',
  'border',
  'destructive',
  'info',
  'success',
  'warning',
  'diffAdded',
  'diffRemoved',
] as const

export type ThemeColors = { readonly [Key in (typeof THEME_COLOR_KEYS)[number]]: ColorInput }
export type Theme = ThemeColors & {
  readonly reducedMotion: boolean
  readonly noColor: boolean
  readonly appearance: 'dark' | 'light'
  readonly colorMode: TerminalColorMode
  readonly terminalColors: TerminalColors | null
}
export type ThemePreferences = {
  readonly palette?: Palette
  readonly reducedMotion?: boolean
}

// The test `bundled palettes parse` pins Graphite's presence.
const GRAPHITE = bundledPalette(DEFAULT_PALETTE_ID)!

/** The shared palette flattened to opaque hex: a terminal cell has no alpha. */
export function paletteThemeColors(palette: Palette, mode: 'light' | 'dark'): ThemeColors {
  const flat = flattenedAppColors(paletteColorsFor(palette, mode))

  return {
    background: toHex(flat.background),
    card: toHex(flat.card),
    popover: toHex(flat.popover),
    muted: toHex(flat.muted),
    accent: toHex(flat.accent),
    primary: toHex(flat.primary),
    primaryForeground: toHex(flat['primary-foreground']),
    foreground: toHex(flat.foreground),
    mutedForeground: toHex(flat['muted-foreground']),
    border: toHex(flat.border),
    destructive: toHex(flat.destructive),
    info: toHex(flat.info),
    success: toHex(flat.success),
    warning: toHex(flat.warning),
    diffAdded: toHex(flat.success),
    diffRemoved: toHex(flat.destructive),
  }
}

const plain: ThemeColors = {
  background: RGBA.defaultBackground(),
  card: RGBA.defaultBackground(),
  popover: RGBA.defaultBackground(),
  muted: RGBA.defaultBackground(),
  accent: RGBA.defaultBackground(),
  primary: RGBA.defaultForeground(),
  primaryForeground: RGBA.defaultBackground(),
  foreground: RGBA.defaultForeground(),
  mutedForeground: RGBA.defaultForeground(),
  border: RGBA.defaultForeground(),
  destructive: RGBA.defaultForeground(),
  info: RGBA.defaultForeground(),
  success: RGBA.defaultForeground(),
  warning: RGBA.defaultForeground(),
  diffAdded: RGBA.defaultForeground(),
  diffRemoved: RGBA.defaultForeground(),
}

export function resolveTheme(
  mode: 'light' | 'dark' | 'system',
  system: 'light' | 'dark',
  noColor: boolean,
  options: ThemePreferences & {
    readonly colors?: TerminalColors | null
    readonly colorMode?: TerminalColorMode
  } = {},
): Theme {
  const reducedMotion = options.reducedMotion ?? false
  const appearance = mode === 'system' ? system : mode
  const terminalColors = options.colors ?? null
  if (noColor)
    return { ...plain, noColor, reducedMotion, appearance, terminalColors, colorMode: 'none' }
  const fallback = paletteThemeColors(options.palette ?? GRAPHITE, appearance)
  const colors = mode === 'system' ? systemTheme(options.colors ?? null, fallback) : fallback
  const colorMode = options.colorMode ?? 'truecolor'
  const convert = (color: ColorInput) => colorForTerminal(color, colorMode, options.colors)
  return {
    background: convert(colors.background),
    card: convert(colors.card),
    popover: convert(colors.popover),
    muted: convert(colors.muted),
    accent: convert(colors.accent),
    primary: convert(colors.primary),
    primaryForeground: convert(colors.primaryForeground),
    foreground: convert(colors.foreground),
    mutedForeground: convert(colors.mutedForeground),
    border: convert(colors.border),
    destructive: convert(colors.destructive),
    info: convert(colors.info),
    success: convert(colors.success),
    warning: convert(colors.warning),
    diffAdded: convert(colors.diffAdded),
    diffRemoved: convert(colors.diffRemoved),
    noColor,
    reducedMotion,
    appearance,
    colorMode,
    terminalColors,
  }
}
