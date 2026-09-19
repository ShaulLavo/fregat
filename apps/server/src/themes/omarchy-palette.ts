import { contrastRatio, parseColor, toCss, type PaletteDocument } from '@workspace/contracts'
import { themeErrors } from './structured-errors'

export function mapOmarchyPalette({
  table,
  id,
  name,
  commit,
  themeName,
  repository,
}: {
  table: Record<string, unknown>
  id: string
  name: string
  commit: string
  themeName: string
  repository: string
}) {
  const report: string[] = []
  const color = (key: string, ...fallbacks: string[]) => omarchyColor(table, report, key, fallbacks)
  const mode = table.mode === 'light' ? 'light' : 'dark'
  const background = color('background')
  const foreground = color('foreground')
  const accent = color('accent', 'blue')
  const brightForeground = color('bright_foreground', 'foreground')
  const ink = (role: string, surface: string) =>
    inkFor(table, report, brightForeground, role, surface)
  const darkerBackground = color('darker_background', 'dark_background', 'background')

  const app = {
    background,
    foreground,
    card: color('lighter_background', 'background'),
    'card-foreground': foreground,
    popover: color('lighter_background', 'background'),
    'popover-foreground': foreground,
    primary: accent,
    'primary-foreground': ink('primary-foreground', accent),
    secondary: color('selection', 'lighter_background', 'background'),
    'secondary-foreground': brightForeground,
    muted: color('lighter_background', 'background'),
    'muted-foreground': readableMuted(
      color('dark_foreground', 'foreground'),
      background,
      foreground,
      report,
    ),
    accent: color('selection', 'lighter_background', 'background'),
    'accent-foreground': brightForeground,
    destructive: color('red'),
    info: color('blue'),
    'info-foreground': ink('info-foreground', color('blue')),
    success: color('green'),
    'success-foreground': ink('success-foreground', color('green')),
    warning: color('yellow'),
    'warning-foreground': ink('warning-foreground', color('yellow')),
    update: color('magenta'),
    'update-foreground': ink('update-foreground', color('magenta')),
    border: color('muted', 'selection'),
    input: color('muted', 'selection'),
    ring: accent,
    'chart-1': accent,
    'chart-2': color('blue'),
    'chart-3': color('magenta'),
    'chart-4': color('yellow'),
    'chart-5': color('orange', 'red'),
  }

  const terminal = {
    foreground,
    cursor: foreground,
    'cursor-accent': background,
    selection: color('selection', 'lighter_background'),
    'selection-foreground': brightForeground,
    black: darkerBackground,
    red: color('red'),
    green: color('green'),
    yellow: color('yellow'),
    blue: color('blue'),
    magenta: color('magenta'),
    cyan: color('cyan'),
    white: foreground,
    'bright-black': color('dark_foreground', 'foreground'),
    'bright-red': color('bright_red', 'red'),
    'bright-green': color('bright_green', 'green'),
    'bright-yellow': color('bright_yellow', 'yellow'),
    'bright-blue': color('bright_blue', 'blue'),
    'bright-magenta': color('bright_magenta', 'magenta'),
    'bright-cyan': color('bright_cyan', 'cyan'),
    'bright-white': brightForeground,
  }

  const document: PaletteDocument = {
    schemaVersion: 1,
    id,
    name,
    variants: { kind: 'single', mode, colors: { app, terminal } },
    provenance: { kind: 'omarchy', repository: repository, commit, theme: themeName },
  }

  return { document, report }
}
function omarchyColor(
  table: Record<string, unknown>,
  report: string[],
  key: string,
  fallbacks: readonly string[],
) {
  for (const candidate of [key, ...fallbacks]) {
    const value = table[candidate]
    if (typeof value !== 'string' || !parseColor(value)) continue
    if (candidate !== key) report.push(`${key} ← ${candidate} (fallback)`)
    return value
  }
  throw themeErrors.BUNDLE_INVALID({ detail: `colors.toml has no color for ${key}` })
}
/** The ink that reads best on a filled surface, from the theme's own ends. */
function inkFor(
  table: Record<string, unknown>,
  report: string[],
  brightForeground: string,
  role: string,
  surface: string,
): string {
  const fill = parseColor(surface)
  const candidates = ['bright_foreground', 'foreground', 'background', 'darker_background']
    .map((key) => ({ key, value: table[key] }))
    .filter((entry): entry is { key: string; value: string } => typeof entry.value === 'string')
    .map((entry) => ({ ...entry, color: parseColor(entry.value) }))
    .filter((entry) => entry.color !== null)
  const best = candidates
    .map((entry) => ({
      ...entry,
      ratio: fill && entry.color ? contrastRatio(entry.color, fill) : 0,
    }))
    .sort((a, b) => b.ratio - a.ratio)[0]
  if (!best || !fill) return brightForeground
  if (best.ratio < 4.5) {
    const black = parseColor('#000000')!
    const white = parseColor('#ffffff')!
    const ink = contrastRatio(black, fill) >= contrastRatio(white, fill) ? '#000000' : '#ffffff'
    report.push(`${role} ← ${ink} (4.5:1 accessibility correction)`)
    return ink
  }
  report.push(`${role} ← ${best.key} (contrast pick, ${best.ratio.toFixed(1)}:1)`)

  return best.value
}

function readableMuted(source: string, background: string, foreground: string, report: string[]) {
  const color = parseColor(source)!
  const surface = parseColor(background)!
  const target = parseColor(foreground)!
  if (contrastRatio(color, surface) >= 4.5) return source
  report.push('muted-foreground lightness adjusted to meet 4.5:1')
  for (let step = 1; step <= 20; step += 1) {
    const candidate = { ...color, l: color.l + ((target.l - color.l) * step) / 20 }
    if (contrastRatio(candidate, surface) >= 4.5) return toCss(candidate)
  }
  return foreground
}
