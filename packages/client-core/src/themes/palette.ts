import {
  APP_COLOR_ROLES,
  TERMINAL_ANSI_ROLES,
  paletteColorsFor,
  paletteSupportsMode,
  flatten,
  toCss,
  toRgb,
  type AppColorRole,
  type ColorMode,
  type Oklch,
  type Palette,
  type PaletteColors,
  type Rgb,
} from '@workspace/contracts'

/** A palette's colors for one mode, in every form a renderer needs. */
export type ResolvedPalette = Readonly<{
  id: string
  /** The mode that was asked for. */
  mode: ColorMode
  /** The variant that answered; differs from `mode` for a single-mode palette. */
  variantMode: ColorMode
  /** `--name: value` pairs for the document root, values as exact `oklch()`. */
  cssVariables: Readonly<Record<string, string>>
  terminal: TerminalColors
  /** Stable across identical colors; the key renderers subscribe on. */
  contentHash: string
}>

export type TerminalColors = Readonly<{
  foreground: Rgb
  cursor: Rgb
  cursorAccent: Rgb
  selection: Rgb
  selectionForeground: Rgb
  /** The 16 ANSI slots, black through bright white. */
  ansi: readonly Rgb[]
}>

// Surfaces the material formula mixes with the opacity setting author the
// `-solid` input; everything else is the role name itself.
const SOLID_ROLES: ReadonlySet<AppColorRole> = new Set([
  'background',
  'card',
  'popover',
  'muted',
  'accent',
])

export function cssVariableForRole(role: AppColorRole): string {
  return SOLID_ROLES.has(role) ? `--${role}-solid` : `--${role}`
}

export function resolvePalette(palette: Palette, mode: ColorMode): ResolvedPalette {
  const variantMode = paletteSupportsMode(palette, mode) ? mode : oppositeMode(mode)
  const colors = paletteColorsFor(palette, variantMode)
  const cssVariables = appVariables(colors)
  // The code-theme preview shows the other mode's card beside the current one.
  cssVariables['--card-light-solid'] = toCss(paletteColorsFor(palette, 'light').app.card)
  cssVariables['--card-dark-solid'] = toCss(paletteColorsFor(palette, 'dark').app.card)
  const terminal = terminalColors(colors)

  return {
    id: palette.id,
    mode,
    variantMode,
    cssVariables,
    terminal,
    contentHash: fnv1a(JSON.stringify([cssVariables, terminal])),
  }
}

/**
 * A stylesheet carrying both modes, for the boot path and the runtime `<style>`
 * element. `:root.dark` rather than `.dark` so it outranks the generated
 * `@layer palette` defaults and any unlayered `.dark` rule alike.
 */
export function paletteStylesheet(palette: Palette): string {
  const light = resolvePalette(palette, 'light')
  const dark = resolvePalette(palette, 'dark')

  return `${block(':root', light.cssVariables)}\n${block(':root.dark', dark.cssVariables)}\n`
}

function block(selector: string, variables: Readonly<Record<string, string>>): string {
  const lines = Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`)

  return `${selector} {\n${lines.join('\n')}\n}`
}

function appVariables(colors: PaletteColors): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const role of APP_COLOR_ROLES) {
    variables[cssVariableForRole(role)] = toCss(colors.app[role])
  }

  return variables
}

function terminalColors(colors: PaletteColors): TerminalColors {
  const { terminal } = colors

  return {
    foreground: toRgb(terminal.foreground),
    cursor: toRgb(terminal.cursor),
    cursorAccent: toRgb(terminal['cursor-accent']),
    selection: toRgb(terminal.selection),
    selectionForeground: toRgb(terminal['selection-foreground']),
    ansi: TERMINAL_ANSI_ROLES.map((role) => toRgb(terminal[role])),
  }
}

export function oppositeMode(mode: ColorMode): ColorMode {
  return mode === 'dark' ? 'light' : 'dark'
}

/** The app colors of one mode as opaque values, for renderers without alpha. */
export function flattenedAppColors(colors: PaletteColors): Readonly<Record<AppColorRole, Oklch>> {
  const background = colors.app.background
  const flat = {} as Record<AppColorRole, Oklch>
  for (const role of APP_COLOR_ROLES) flat[role] = flatten(colors.app[role], background)

  return flat
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
