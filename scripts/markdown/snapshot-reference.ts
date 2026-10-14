import { execFile } from 'node:child_process'
import { hash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { createScriptError } from '../structured-errors'

const execute = promisify(execFile)

export function extractReferenceExamples(raw: string, profile: 'commonmark' | 'gfm') {
  const source = raw.replace(/\r\n?/gu, '\n').split('<!-- END TESTS -->')[0] ?? ''
  const pattern = /^`{32} example([^\n]*)\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$|^#{1,6} *(.*)$/gmu
  let section = ''
  let number = 0
  const examples = []
  for (const match of source.matchAll(pattern)) {
    if (match[4] !== undefined) {
      section = match[4]
      continue
    }
    number += 1
    examples.push({
      id: `${profile}-${number}`,
      number,
      section,
      extension: match[1]?.trim() ?? '',
      source: (match[2] ?? '').replace(/→/gu, '\t'),
      html: (match[3] ?? '').replace(/→/gu, '\t'),
    })
  }
  return examples
}

async function main() {
  const { values } = parseArgs({
    options: {
      commonmark: { type: 'string' },
      gfm: { type: 'string' },
      'parser-root': { type: 'string' },
      revision: { type: 'string' },
      out: { type: 'string' },
    },
  })
  if (
    !values.commonmark ||
    !values.gfm ||
    !values['parser-root'] ||
    !values.revision ||
    !values.out
  )
    throw createScriptError(
      'Reference snapshots need --commonmark, --gfm, --parser-root, --revision and --out.',
      { internal: { boundary: 'snapshot-arguments' } },
    )
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const assets = []
  for (const profile of ['commonmark', 'gfm'] as const) {
    const input = profile === 'commonmark' ? values.commonmark : values.gfm
    const bytes = await readFile(input)
    const examples = extractReferenceExamples(bytes.toString('utf8'), profile)
    const content = `${JSON.stringify(examples, null, 2)}\n`
    const file = `${profile}.json`
    await writeFile(path.join(output, file), content)
    assets.push({
      file,
      source:
        profile === 'commonmark'
          ? 'commonmark-spec@0.31.2/spec.txt'
          : `tree-sitter-md@${values.revision}/bench/spec/gfm-spec.txt`,
      license: 'CC-BY-SA-4.0',
      sourceSha256: hash('sha256', bytes, 'hex'),
      sha256: hash('sha256', content, 'hex'),
      cases: examples.length,
    })
  }
  for (const [file, cases] of [
    ['chat.json', 183],
    ['repositories.json.gz', 497],
  ] as const) {
    const { stdout } = await execute('git', ['show', `${values.revision}:bench/corpus/${file}`], {
      cwd: values['parser-root'],
      encoding: 'buffer',
      maxBuffer: 8 * 1024 * 1024,
    })
    await writeFile(path.join(output, file), stdout)
    assets.push({
      file,
      source: `tree-sitter-md@${values.revision}/bench/corpus/${file}`,
      license: 'MIT',
      sha256: hash('sha256', stdout, 'hex'),
      cases,
      usage: 'development-regression',
    })
  }
  await writeFile(
    path.join(output, 'manifest.json'),
    `${JSON.stringify({ parserRevision: values.revision, assets }, null, 2)}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ output, assets: assets.map(({ file, cases }) => ({ file, cases })) })}\n`,
  )
}

if (import.meta.main) await main()
