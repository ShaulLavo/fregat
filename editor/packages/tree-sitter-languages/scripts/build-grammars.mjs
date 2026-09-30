import { mkdtemp, readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { sources } = JSON.parse(await readFile(resolve(root, 'languages.json'), 'utf8'))
const source = sources.astro
const scratchRoot = process.env.TMPDIR ?? '/work/tmp'
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(resolve(scratchRoot, 'native-grammars-'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  assert.equal(result.status, 0, `${command} failed`)
}
try {
  const archive = await fetch(`${source.repository}/archive/${source.revision}.tar.gz`)
  assert(archive.ok, `Source download: ${archive.status}`)
  const bytes = Buffer.from(await archive.arrayBuffer())
  await writeFile(resolve(scratch, 'source.tar.gz'), bytes)
  run('tar', ['xf', resolve(scratch, 'source.tar.gz'), '--strip-components=1', '-C', scratch])
  const wasm = resolve(scratch, 'tree-sitter-astro.wasm')
  run(resolve(root, 'node_modules/.bin/tree-sitter'), ['build', '--wasm', scratch, '-o', wasm])
  const parser = await readFile(resolve(scratch, 'src/parser.c'), 'utf8')
  const lock = {
    repository: source.repository,
    revision: source.revision,
    archiveSha256: hash(bytes),
    parserSha256: hash(parser),
    scannerSha256: hash(await readFile(resolve(scratch, 'src/scanner.c'))),
    parserABI: Number(parser.match(/#define LANGUAGE_VERSION (\d+)/)?.[1]),
    compiler: source.compiler,
    wasmSha256: hash(await readFile(wasm)),
    querySources: await Promise.all(
      ['highlights', 'injections'].map(async (kind) => ({
        file: `queries/${kind}.scm`,
        revision: source.queryRevision,
        sha256: hash(await readFile(resolve(scratch, `queries/${kind}.scm`))),
      })),
    ),
  }
  const output = JSON.stringify(lock, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    assert.equal(
      await readFile(resolve(root, 'astro-build.lock.json'), 'utf8'),
      output,
      'Astro build differs from lock',
    )
  } else {
    await copyFile(wasm, resolve(root, 'src/grammars/tree-sitter-astro.wasm'))
    await writeFile(resolve(root, 'astro-build.lock.json'), output)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
