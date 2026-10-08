import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fixture } from './fixture.mjs'

function replaceRequired(code, before, after) {
  if (!code.includes(before)) throw new RangeError(`Full-document probe target changed: ${before}`)
  return code.replace(before, after)
}

// The benchmark selects the existing full-result path without adding a shipping editor option.
export function fullDocumentTransform(code, id) {
  if (id.endsWith('/editor/src/editor/syntaxController.ts'))
    return replaceRequired(code, "syntaxMode: 'range'", "syntaxMode: 'full'").replaceAll(
      "syntaxMode: 'range'",
      "syntaxMode: 'full'",
    )
  if (id.endsWith('/tree-sitter/src/session.ts')) {
    code = replaceRequired(
      code,
      'return this.parsedSnapshotVersion !== 0 && this.parsedSnapshotVersion === this.snapshotVersion',
      "return this.syntaxMode === 'range' && this.parsedSnapshotVersion !== 0 && this.parsedSnapshotVersion === this.snapshotVersion",
    )
    return replaceRequired(
      code,
      'if (result.tokensPacked) return EditorTokenStore.fromPacked(result.tokensPacked)',
      `if (result.tokensPacked) {
        const start = performance.now()
        const store = EditorTokenStore.fromPacked(result.tokensPacked)
        ;(globalThis as any).__compareOpenProbe?.diagnostics.push({
          name: 'compare.full.tokenStore', durationMs: performance.now() - start,
        })
        return store
      }`,
    )
  }
  if (id.endsWith('/tree-sitter/src/treeSitter/treeSitter.worker.ts')) {
    code = replaceRequired(
      code,
      'const request = event.data',
      `const request = event.data
      ;(request as any).__compareReceivedAt = performance.timeOrigin + performance.now()`,
    )
    code = replaceRequired(
      code,
      '.then((result) => postResponse({ id: request.id, ok: true, result }))',
      `.then((result) => postResponse({ id: request.id, ok: true, result,
        __compareReceivedAt: (request as any).__compareReceivedAt,
        __comparePostedAt: performance.timeOrigin + performance.now(),
      } as any))`,
    )
    return code
  }
}

export function verifyFullDocumentRow(row) {
  const full = row.openProfile.requests.find((request) => request.resultMode === 'full')
  if (
    !full?.returnedResult ||
    full.statistics?.rangeStart !== 0 ||
    full.statistics?.rangeEnd !== row.mib * 1024 * 1024 ||
    !full.statistics?.tokens
  )
    throw new RangeError('Full-document result must cover the entire fixture and contain tokens')
  if (full.degraded?.length) throw new RangeError('Full-document result contains degraded phases')
  if (
    row.openProfile.requests.some(
      (request) => request.type === 'queryRange' || request.resultMode === 'parseOnly',
    )
  )
    throw new RangeError('Full-document probe dispatched range or parse-only work')
}

async function nativeBenchmark(source, destination) {
  const grammar = resolve(
    fileURLToPath(
      new URL(
        '../../packages/tree-sitter-languages/node_modules/tree-sitter-typescript',
        import.meta.url,
      ),
    ),
    'typescript/src',
  )
  const input = resolve(destination, 'fixture.ts')
  const binary = resolve(destination, 'native-parse')
  const text = fixture(10)
  await writeFile(input, text)
  const args = [
    '-O3',
    '-std=c11',
    '-D_DEFAULT_SOURCE',
    '-D_POSIX_C_SOURCE=200112L',
    `-I${resolve(source, 'lib/include')}`,
    `-I${resolve(source, 'lib/src')}`,
    `-I${grammar}`,
    fileURLToPath(new URL('./native-full-parse.c', import.meta.url)),
    resolve(source, 'lib/src/lib.c'),
    resolve(grammar, 'parser.c'),
    resolve(grammar, 'scanner.c'),
    '-o',
    binary,
  ]
  execFileSync('cc', args, { stdio: 'inherit' })
  const samples = JSON.parse(execFileSync(binary, [input, '3'], { encoding: 'utf8' }))
  return {
    label:
      'Noisy experiment. Native UTF-8 contiguous input; browser uses UTF-16 piece-table callbacks. Ratio is not pure WASM overhead.',
    date: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    compiler: execFileSync('cc', ['--version'], { encoding: 'utf8' }).split('\n')[0],
    flags: ['-O3', '-std=c11'],
    grammarVersion: '0.23.2',
    fixtureSha256: createHash('sha256').update(text).digest('hex'),
    samples,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [option, source, destination] = process.argv.slice(2)
  if (option !== '--native' || !source || !destination)
    throw new RangeError(
      'Use full-document.mjs --native <tree-sitter source checkout> <existing output directory>',
    )
  await readFile(resolve(source, 'lib/include/tree_sitter/api.h'))
  const result = await nativeBenchmark(resolve(source), resolve(destination))
  await writeFile(resolve(destination, 'native.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
