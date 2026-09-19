import { mapOmarchyPalette } from '../../apps/server/src/themes/omarchy-palette'
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

import { parsePalette } from '../../packages/contracts/src/index'

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

const { document, report } = mapOmarchyPalette({
  table,
  id,
  name,
  commit,
  themeName,
  repository: values.repository,
})

const parsed = parsePalette(document, 'user')
if (!parsed.success) {
  console.error('mapped document does not parse', parsed.issues)
  process.exit(1)
}

console.error(`${themeName}: ${table.mode}, ${report.length} fallbacks`)
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
