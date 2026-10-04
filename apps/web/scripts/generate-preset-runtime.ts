import assert from 'node:assert/strict'
import { format } from 'oxfmt'
import formatOptions from '../../../.oxfmtrc.json'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'
import { isBindableChord } from '@workspace/client-core/commands/chord'
import { isCommandId } from '@workspace/client-core/commands/catalog'
import zed from '../src/keymap/presets/zed.json'
import patches from '../src/keymap/presets/ours-patches.json'
import type { RuntimeRow } from '../src/keymap/presets/runtime'

export function registeredPresetCommandIds(): ReadonlySet<string> {
  const configPath = fileURLToPath(new URL('../tsconfig.app.json', import.meta.url))
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined, 'The web TypeScript configuration must be readable.')
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  assert.deepEqual(parsed.errors, [], 'The web TypeScript configuration must be valid.')
  const filename = fileURLToPath(new URL('../src/keymap/types.ts', import.meta.url))
  const host = ts.createCompilerHost(parsed.options)
  host.jsDocParsingMode = ts.JSDocParsingMode.ParseForTypeErrors
  const program = ts.createProgram([filename], parsed.options, host)
  const source = program.getSourceFile(filename)
  assert(source, 'The web command types must be readable.')
  const declaration = source.statements
    .filter(ts.isTypeAliasDeclaration)
    .find((entry) => entry.name.text === 'PlatformCommandId')
  assert(declaration, 'PlatformCommandId must declare the live web command IDs.')
  const type = program.getTypeChecker().getTypeAtLocation(declaration)
  assert(
    type.isUnion(),
    'PlatformCommandId must resolve to literal IDs. Install dependencies and build the workspaces first.',
  )
  return new Set(
    type.types.map((member) => {
      assert(
        member.isStringLiteral(),
        'Every PlatformCommandId must resolve to a literal ID. Install dependencies and build the workspaces first.',
      )
      assert(
        isCommandId(member.value),
        'Every web command must belong to the shared command catalog.',
      )
      return member.value
    }),
  )
}

export async function presetRuntimeSource(): Promise<string> {
  const commands = registeredPresetCommandIds()
  for (const patch of patches) {
    const row = zed[patch.index]
    assert(row, `Missing preset row ${patch.index}`)
    const { platform, keys, upstreamCommand, upstreamContext } = row
    assert.deepEqual({ platform, keys, upstreamCommand, upstreamContext }, patch.identity)
  }
  const rows = zed.flatMap((row, index): RuntimeRow[] => {
    if ('reserved' in row && row.reserved && row.context && row.reason === null)
      return [[index, row.platform, row.keys, null, row.context, row.upstreamCommand]]
    if (!row.command || !row.context || !commands.has(row.command) || !isBindableChord(row.keys))
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
