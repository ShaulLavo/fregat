import {
  APP_COLOR_ROLES,
  contrastRatio,
  normalizeColor,
  paletteColorsFor,
  paletteSupportsMode,
  type AppColorRole,
  type ColorMode,
  type Oklch,
  type Palette,
  type PaletteColors,
  type PaletteId,
  type TerminalColorRole,
} from '@workspace/contracts'

export type ColorGroup = 'app' | 'terminal'

/** A copy under a new id and name, owned by the user. */
export function duplicatePalette(source: Palette, id: PaletteId, name: string): Palette {
  const { provenance: _provenance, ...rest } = source

  return { ...rest, id, name, source: 'user' }
}

export function renamePalette(palette: Palette, name: string): Palette {
  return { ...palette, name }
}

/** One color changed in one mode's variant; a single-mode palette has one. */
export function setPaletteColor(
  palette: Palette,
  mode: ColorMode,
  group: ColorGroup,
  role: string,
  color: Oklch,
): Palette {
  return updateColors(palette, mode, (colors) => ({
    ...colors,
    [group]: { ...colors[group], [role]: color },
  }))
}

/**
 * Background sets the surface ramp: cards a step above it, muted surfaces a
 * step below in light and above in dark, ink at the far end. Lifted from the
 * Graphite offsets so a new background lands on the same relationships.
 */
export function deriveFromBackground(colors: PaletteColors, background: Oklch): PaletteColors {
  const dark = background.l < 0.5
  const tint = { c: Math.min(background.c, 0.012), h: background.h }
  const shade = (l: number) => normalizeColor({ ...tint, l, alpha: 1 })
  const step = (delta: number) => shade(clampL(background.l + delta))
  const ink = shade(dark ? 0.985 : 0.145)
  const softInk = shade(dark ? 0.985 : 0.205)

  return {
    ...colors,
    app: {
      ...colors.app,
      background: normalizeColor({ ...background, alpha: 1 }),
      card: step(dark ? 0.06 : 0.03),
      popover: step(dark ? 0.06 : 0.03),
      secondary: step(dark ? 0.124 : -0.03),
      muted: step(dark ? 0.124 : -0.03),
      accent: step(dark ? 0.124 : -0.03),
      foreground: ink,
      'card-foreground': ink,
      'popover-foreground': ink,
      'secondary-foreground': softInk,
      'accent-foreground': softInk,
      'muted-foreground': shade(dark ? 0.708 : 0.52),
      border: dark ? { l: 1, c: 0, h: 0, alpha: 0.1 } : step(-0.09),
      input: dark ? { l: 1, c: 0, h: 0, alpha: 0.15 } : step(-0.09),
      ring: shade(dark ? 0.556 : 0.62),
    },
  }
}

/** Accent is the primary action color; its text picks whichever ink reads on it. */
export function deriveFromAccent(colors: PaletteColors, accent: Oklch): PaletteColors {
  const primary = normalizeColor({ ...accent, alpha: 1 })
  const light = normalizeColor({ l: 0.985, c: Math.min(accent.c, 0.006), h: accent.h, alpha: 1 })
  const dark = normalizeColor({ l: 0.205, c: Math.min(accent.c, 0.014), h: accent.h, alpha: 1 })
  const foreground = contrastRatio(light, primary) >= contrastRatio(dark, primary) ? light : dark

  return {
    ...colors,
    app: {
      ...colors.app,
      primary,
      'primary-foreground': foreground,
      ring: primary,
      'chart-1': primary,
    },
  }
}

const TEXT_PAIRS: readonly (readonly [AppColorRole, AppColorRole])[] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['info-foreground', 'info'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['update-foreground', 'update'],
]

export const TEXT_CONTRAST_MINIMUM = 4.5

export type ContrastFailure = Readonly<{
  foreground: AppColorRole
  background: AppColorRole
  ratio: number
}>

/** Text-on-surface pairs under WCAG's 4.5:1, worst first. */
export function contrastFailures(colors: PaletteColors): ContrastFailure[] {
  return TEXT_PAIRS.flatMap(([foreground, background]) => {
    const ratio = contrastRatio(colors.app[foreground], colors.app[background])
    if (ratio >= TEXT_CONTRAST_MINIMUM) return []

    return [{ foreground, background, ratio }]
  }).sort((a, b) => a.ratio - b.ratio)
}

/** The modes the editor can show for a palette. */
export function editableModes(palette: Palette): readonly ColorMode[] {
  return (['light', 'dark'] as const).filter((mode) => paletteSupportsMode(palette, mode))
}

export function paletteIdFromName(name: string, taken: readonly string[]): PaletteId {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60) || 'palette'
  if (!taken.includes(base)) return base

  let suffix = 2
  while (taken.includes(`${base}-${suffix}`)) suffix += 1

  return `${base}-${suffix}`
}

export const TERMINAL_ROLE_LABELS: Readonly<Record<TerminalColorRole, string>> = {
  foreground: 'Foreground',
  cursor: 'Cursor',
  'cursor-accent': 'Cursor text',
  selection: 'Selection',
  'selection-foreground': 'Selection text',
  black: 'Black',
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
  magenta: 'Magenta',
  cyan: 'Cyan',
  white: 'White',
  'bright-black': 'Bright black',
  'bright-red': 'Bright red',
  'bright-green': 'Bright green',
  'bright-yellow': 'Bright yellow',
  'bright-blue': 'Bright blue',
  'bright-magenta': 'Bright magenta',
  'bright-cyan': 'Bright cyan',
  'bright-white': 'Bright white',
}

export function appRoleLabel(role: AppColorRole): string {
  const words = role.replace(/-/gu, ' ')

  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const APP_ROLES_IN_ORDER = APP_COLOR_ROLES

function updateColors(
  palette: Palette,
  mode: ColorMode,
  update: (colors: PaletteColors) => PaletteColors,
): Palette {
  const { variants } = palette
  if (variants.kind === 'single') {
    return { ...palette, variants: { ...variants, colors: update(variants.colors) } }
  }

  return { ...palette, variants: { ...variants, [mode]: update(paletteColorsFor(palette, mode)) } }
}

function clampL(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000))
}
