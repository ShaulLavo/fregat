/**
 * Maps an Omarchy theme's `colors.toml` onto a Platform palette document.
 *
 *   bun scripts/themes/import-omarchy-palette.ts --theme /usr/share/omarchy/themes/tokyo-night \
 *     [--id tokyo-night] [--name "Tokyo Night"] [--out ~/.platform/palettes/tokyo-night.json]
 *
 * Reads only the color table. Colors are written as authored (hex), so the file
 * stays readable; the server normalizes them to oklch on import. Every role the
 * source does not name is filled from a documented fallback and listed in the
 * report on stderr, so a reviewer knows which values are Omarchy's and which
 * are ours. An Omarchy theme has one mode, so the result is single-mode.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import {
  contrastRatio,
  parseColor,
  parsePalette,
  type PaletteDocument,
} from '../../packages/contracts/src/index'

const { values } = parseArgs({
  options: {
    theme: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    out: { type: 'string' },
    repository: { type: 'string', default: 'https://github.com/omacom/omarchy' },
  },
})

if (!values.theme) {
  console.error('usage: --theme <omarchy theme directory> [--id] [--name] [--out]')
  process.exit(2)
}

const themeDirectory = path.resolve(values.theme)
const themeName = path.basename(themeDirectory)
const id = values.id ?? themeName
const name = values.name ?? titleCase(themeName)
const table = Bun.TOML.parse(
  readFileSync(path.join(themeDirectory, 'colors.toml'), 'utf8'),
) as Record<string, unknown>
const commit = readCommit(themeDirectory)

const report: string[] = []
const color = (key: string, ...fallbacks: string[]): string => {
  for (const candidate of [key, ...fallbacks]) {
    const value = table[candidate]
    if (typeof value === 'string' && parseColor(value)) {
      if (candidate !== key) report.push(`${key} ← ${candidate} (fallback)`)
      return value
    }
  }
  console.error(`colors.toml has none of: ${[key, ...fallbacks].join(', ')}`)
  process.exit(1)
}

const mode = table.mode === 'light' ? 'light' : 'dark'
const background = color('background')
const foreground = color('foreground')
const accent = color('accent', 'blue')
const brightForeground = color('bright_foreground', 'foreground')
const darkerBackground = color('darker_background', 'dark_background', 'background')

/** The ink that reads best on a filled surface, from the theme's own ends. */
function inkFor(role: string, surface: string): string {
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
  if (!best) return brightForeground
  report.push(`${role} ← ${best.key} (contrast pick, ${best.ratio.toFixed(1)}:1)`)

  return best.value
}

const app = {
  background,
  foreground,
  card: color('lighter_background', 'background'),
  'card-foreground': foreground,
  popover: color('lighter_background', 'background'),
  'popover-foreground': foreground,
  primary: accent,
  'primary-foreground': inkFor('primary-foreground', accent),
  secondary: color('selection', 'lighter_background', 'background'),
  'secondary-foreground': brightForeground,
  muted: color('lighter_background', 'background'),
  'muted-foreground': color('dark_foreground', 'foreground'),
  accent: color('selection', 'lighter_background', 'background'),
  'accent-foreground': brightForeground,
  destructive: color('red'),
  info: color('blue'),
  'info-foreground': inkFor('info-foreground', color('blue')),
  success: color('green'),
  'success-foreground': inkFor('success-foreground', color('green')),
  warning: color('yellow'),
  'warning-foreground': inkFor('warning-foreground', color('yellow')),
  update: color('magenta'),
  'update-foreground': inkFor('update-foreground', color('magenta')),
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
  provenance: { kind: 'omarchy', repository: values.repository, commit, theme: themeName },
}

const parsed = parsePalette(document, 'user')
if (!parsed.success) {
  console.error('mapped document does not parse', parsed.issues)
  process.exit(1)
}

console.error(`${themeName}: ${mode}, ${report.length} fallbacks`)
for (const line of report) console.error(`  ${line}`)

const text = `${JSON.stringify(document, null, 2)}\n`
if (!values.out) {
  process.stdout.write(text)
} else {
  const out = values.out.replace(/^~(?=$|\/)/u, process.env.HOME ?? '~')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, text)
  console.error(`wrote ${out}`)
}

function readCommit(directory: string): string {
  // An installed Omarchy is not a checkout; its version file is the nearest pin.
  for (const candidate of [path.join(directory, '..', '..', 'version')]) {
    try {
      return `omarchy-${readFileSync(candidate, 'utf8').trim()}`
    } catch {
      // Try the next candidate.
    }
  }

  return 'unknown'
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
