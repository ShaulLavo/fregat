import assert from 'node:assert/strict'
import { format } from 'oxfmt'
import formatOptions from '../../../.oxfmtrc.json'
import { readFile, writeFile } from 'node:fs/promises'
import { isBindableChord } from '@workspace/client-core/commands/chord'
import { isPlatformCommandId } from '../src/keymap/table'
import { zed } from '../src/keymap/presets/inventory'
import patches from '../src/keymap/presets/ours-patches.json'
import type { RuntimeRow } from '../src/keymap/presets/runtime'

export async function presetRuntimeSource(): Promise<string> {
  for (const patch of patches) {
    const row = zed[patch.index]
    assert(row, `Missing preset row ${patch.index}`)
    const { platform, keys, upstreamCommand, upstreamContext } = row
    assert.deepEqual({ platform, keys, upstreamCommand, upstreamContext }, patch.identity)
  }
  const rows = zed.flatMap((row, index): RuntimeRow[] => {
    if ('reserved' in row && row.reserved && row.context && row.reason === null)
      return [[index, row.platform, row.keys, null, row.context, row.upstreamCommand]]
    if (
      !row.command ||
      !row.context ||
      !isPlatformCommandId(row.command) ||
      !isBindableChord(row.keys)
    )
      return []
    const fields: readonly [number, string, string, string, string, string] = [
      index,
      row.platform,
      row.keys,
      row.command,
      row.context,
      row.upstreamCommand,
    ]
    return ['args' in row ? [...fields, row.args] : fields]
  })
  const runtimePatches = patches.map(({ index, fields }) => [index, fields.command, fields.context])
  const source =
    `import type { Binding } from '@fregat/hotkeys'\n\n` +
    `export type RuntimeRow = readonly [index: number, platform: string, keys: string, command: string | null, context: string, upstreamCommand: string, args?: Binding['args']]\n\n` +
    `export const presetRuntimeRows: readonly RuntimeRow[] = [\n${rows.map((row) => `  ${JSON.stringify(row)},`).join('\n')}\n]\n\n` +
    `export const oursRuntimePatches: readonly (readonly [index: number, command: string, context: string])[] = ${JSON.stringify(runtimePatches)}\n`
  const formatted = await format('runtime.ts', source, { ...formatOptions, trailingComma: 'all' })
  assert.deepEqual(formatted.errors, [])
  return formatted.code
}

if (import.meta.main) {
  const target = new URL('../src/keymap/presets/runtime.ts', import.meta.url)
  const source = await presetRuntimeSource()
  if (process.argv.includes('--check')) assert.equal(await readFile(target, 'utf8'), source)
  else await writeFile(target, source)
}
