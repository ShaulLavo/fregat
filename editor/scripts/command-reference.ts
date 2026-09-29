// Writes docs/commands.md from the command catalog; `--check` fails when the file is out of date.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { EDITOR_COMMANDS } from '../packages/editor/src/editor/commandCatalog'

const target = resolve(import.meta.dir, '../docs/commands.md')
const check = process.argv.includes('--check')

const rows = EDITOR_COMMANDS.map((command) => {
  const vscode = command.vscodeCommandIds?.map((id) => `\`${id}\``).join(', ') ?? ''
  return `| \`${command.id}\` | ${command.title} | ${command.category} | ${command.mutates ? 'yes' : 'no'} | ${vscode} |`
})
const text = [
  '# Editor commands',
  '',
  'Generated from `packages/editor/src/editor/commandCatalog.ts` by `bun run commands:reference`;',
  'edit the catalog, not this file. A plugin adds its own commands through `createPlugin({ commands })`,',
  'each id starting with the plugin name and a dot.',
  '',
  '| Id | Title | Category | Changes the document | VS Code |',
  '| --- | --- | --- | --- | --- |',
  ...rows,
  '',
].join('\n')

const current = await readFile(target, 'utf8').catch(() => '')
if (check) {
  if (current !== text) {
    console.error('docs/commands.md is out of date: run bun run commands:reference')
    process.exit(1)
  }
  console.log('command reference: ok')
} else {
  await writeFile(target, text)
  console.log(`wrote ${target}`)
}
