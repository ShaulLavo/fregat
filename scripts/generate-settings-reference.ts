import { targetArgument } from './target-argument'
/**
 * Regenerates `docs/settings-reference.md` from the registry.
 *
 * Generated rather than written, because a hand-maintained table of ~36 keys
 * with defaults and scopes is a table that is wrong within a month. Run `bun run settings:reference`
 * after changing `packages/contracts/src/settings/keys.ts`.
 *
 * `--check` makes that instruction enforceable: `generated:check` runs it in CI.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { SETTING_IDS, descriptorFor, type SettingId } from '../packages/contracts/src/index'

const SCOPE_NOTES: Record<string, string> = {
  application: 'user file only',
  machine: 'user file only, machine-specific',
  resource: 'user or workspace',
  window: 'user or workspace',
}

function table(ids: readonly SettingId[]) {
  const rows = ids.map((id) => {
    const descriptor = descriptorFor(id)
    const flags = [
      descriptor.requiresRestart ? 'restart' : '',
      descriptor.readOnlyReason ? 'read-only' : '',
      descriptor.sensitive ? 'sensitive' : '',
    ].filter(Boolean)

    const parent = descriptor.dependsOn ? ` Applies while \`${descriptor.dependsOn}\` is on.` : ''

    return `| \`${id}\` | \`${JSON.stringify(descriptor.default)}\` | ${descriptor.scope} | ${
      descriptor.description
    }${parent}${flags.length > 0 ? ` _(${flags.join(', ')})_` : ''} |`
  })

  return align([
    '| Setting | Default | Scope | What it does |',
    '| --- | --- | --- | --- |',
    ...rows,
  ])
}

/**
 * Pads the columns so the generator's output is what stays in the file.
 *
 * The committed table was column-aligned by whichever editor last touched it,
 * which made `bun run settings:reference` produce a whole-file diff on a registry
 * nobody had changed — and a generated file that reformats itself on every run is
 * one people stop regenerating.
 */
function align(lines: readonly string[]): string {
  const grid = lines.map((line) => line.slice(1, -1).split('|'))
  const widths = grid[0]!.map((_, column) =>
    Math.max(...grid.map((cells) => cells[column]!.trim().length)),
  )
  const padded = grid.map((cells, row) =>
    cells.map((cell, column) => pad(cell.trim(), widths[column]!, row === 1)),
  )

  return padded.map((cells) => `|${cells.join('|')}|`).join('\n')
}

/** The delimiter row pads with its own dashes; every other cell pads with spaces. */
function pad(cell: string, width: number, delimiter: boolean): string {
  if (delimiter) return ` ${'-'.repeat(width)} `

  return ` ${cell.padEnd(width)} `
}

const byCategory = new Map<string, SettingId[]>()
for (const id of SETTING_IDS) {
  const category = descriptorFor(id).category
  byCategory.set(category, [...(byCategory.get(category) ?? []), id])
}

const sections = [...byCategory]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([category, ids]) => `## ${category}\n\n${table(ids)}`)

const body = `> [!NOTE]
> Generated from the settings registry by \`bun scripts/generate-settings-reference.ts\`.
> Edit \`packages/contracts/src/settings/keys.ts\`, not this file.

# Settings reference

Settings live in \`~/.platform/settings.json\`. The file holds only what you have
changed, so anything absent takes the current build's default — which is what lets
a default improve without touching your file.

A workspace can carry its own \`.platform/settings.json\`. Only settings marked
**window** or **resource** can be set there: a workspace file ships inside a
cloned repository, so anything reaching process spawn, exec, env, or the keymap is
readable only from your own file.

Scopes: ${Object.entries(SCOPE_NOTES)
  .map(([scope, note]) => `**${scope}** — ${note}`)
  .join('; ')}.

Secrets — provider environment values — are **not** in this file. They live in
\`~/.platform/secrets.json\` with owner-only permissions, so the settings document
stays safe to read, share and export.

${sections.join('\n\n')}
`

const DEFAULT_TARGET = path.join(import.meta.dirname, '..', 'docs', 'settings-reference.md')

/** A valueless `--target` used to fall through to the default and overwrite it. */

function writeReference(target: string): void {
  writeFileSync(target, body, 'utf8')
  console.log(`wrote ${target} (${SETTING_IDS.length} settings)`)
}

// Compares the rendered body, not just the table: `SCOPE_NOTES` is interpolated
// into prose too.
function checkReference(target: string): void {
  if (!existsSync(target)) {
    console.error(`settings reference is missing at ${target}`)
    process.exitCode = 1
    return
  }
  if (readFileSync(target, 'utf8') === body) return

  console.error('settings reference is stale: run bun run settings:reference')
  process.exitCode = 1
}

const target = targetArgument(DEFAULT_TARGET)
if (process.argv.includes('--check')) checkReference(target)
else writeReference(target)
