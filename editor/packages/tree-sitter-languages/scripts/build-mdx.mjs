import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { sources } = JSON.parse(await readFile(resolve(root, 'languages.json'), 'utf8'))
const source = sources.mdx
const cli = resolve(root, 'node_modules/.bin/tree-sitter')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const scratchRoot = process.env.TMPDIR ?? '/work/tmp'
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(resolve(scratchRoot, 'native-mdx-build-'))

function run(command, args) {
  const result = spawnSync(command, args, { cwd: scratch, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command}: ${result.stderr}`)
  return result.stdout.trim()
}

function adaptQuery(query) {
  // Omit both locals-dependent specializations; identifiers keep their ordinary categories.
  const builtins = query.slice(
    query.indexOf('((identifier) @variable.builtin'),
    query.indexOf('; Literals'),
  )
  assert(builtins.includes('#is-not? local'), 'Upstream MDX builtins changed')
  return (
    '; Generated from the pinned MDX query. Builtin-name specialization is not admitted.\n' +
    query
      .replace(builtins, '')
      .replace('(fenced_code_block)\n] @text.literal', '(info_string)\n] @text.literal') +
    `
(comment) @comment
(jsx_opening_element name: (identifier) @tag (#match? @tag "^[a-z]"))
(jsx_closing_element name: (identifier) @tag (#match? @tag "^[a-z]"))
(jsx_self_closing_element name: (identifier) @tag (#match? @tag "^[a-z]"))
(jsx_attribute (property_identifier) @attribute)
(jsx_opening_element ["<" ">"] @punctuation.bracket)
(jsx_closing_element ["</" ">"] @punctuation.bracket)
(jsx_self_closing_element ["<" "/>"] @punctuation.bracket)
`
  )
}

try {
  const cliVersion = run(cli, ['--version'])
  assert(/^tree-sitter 0[.]27[.]0(?: |$)/.test(cliVersion), `Unexpected compiler: ${cliVersion}`)
  const response = await fetch(`${source.repository}/archive/${source.revision}.tar.gz`)
  assert(response.ok, `MDX source download: ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  await writeFile(resolve(scratch, 'source.tar.gz'), archive)
  run('tar', ['xf', 'source.tar.gz', '--strip-components=1'])
  const patch = await readFile(resolve(root, 'patches/mdx-inline.patch'))
  await writeFile(resolve(scratch, 'inline.patch'), patch)
  run('patch', ['-p1', '-i', 'inline.patch'])
  run(cli, ['generate'])
  run(cli, ['test'])
  run(cli, ['build', '--wasm', '.', '-o', 'tree-sitter-mdx.wasm'])
  const parser = await readFile(resolve(scratch, 'src/parser.c'))
  const upstreamQuery = await readFile(resolve(scratch, 'queries/highlights.scm'), 'utf8')
  const query = adaptQuery(upstreamQuery)
  const wasm = await readFile(resolve(scratch, 'tree-sitter-mdx.wasm'))
  const license = await readFile(resolve(scratch, 'LICENSE'))
  const lock = {
    repository: source.repository,
    revision: source.revision,
    archiveSha256: hash(archive),
    parserSha256: hash(parser),
    patchSha256: hash(patch),
    scannerSha256: hash(await readFile(resolve(scratch, 'src/scanner.c'))),
    parserABI: Number(parser.toString().match(/#define LANGUAGE_VERSION (\d+)/)?.[1]),
    compiler: source.compiler,
    cliVersion,
    wasmSha256: hash(wasm),
    querySources: [
      {
        file: 'queries/highlights.scm',
        revision: source.queryRevision,
        sha256: hash(upstreamQuery),
      },
    ],
    adaptedQuerySha256: hash(query),
    licenseSha256: hash(license),
  }
  const outputs = new Map([
    ['src/grammars/tree-sitter-mdx.wasm', wasm],
    ['src/queries/mdx-highlights.scm', Buffer.from(query)],
    ['notices/mdx.txt', Buffer.from(license.toString().replaceAll('\r\n', '\n'))],
    ['mdx-build.lock.json', Buffer.from(JSON.stringify(lock, null, 2) + '\n')],
  ])
  for (const [file, bytes] of outputs) {
    const path = resolve(root, file)
    if (process.argv.includes('--check')) {
      assert.deepEqual(await readFile(path), bytes, `MDX build differs: ${file}`)
      continue
    }
    await writeFile(path, bytes)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
