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
      "this.result.projection.analysis?.kind !== 'cancelled' &&",
      "this.syntaxMode === 'range' && this.result.projection.analysis?.kind !== 'cancelled' &&",
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
    code = replaceRequired(
      code,
      'type Runtime = {',
      `let compareMatchLimitExceeded = false
    let compareQueryCalls = 0
    for (const method of ['matches', 'captures', 'captureRanges'] as const) {
      const original = Query.prototype[method]
      if (typeof original !== 'function') continue
      ;(Query.prototype as any)[method] = function (...args: any[]) {
        const result = (original as any).apply(this, args)
        compareQueryCalls++
        compareMatchLimitExceeded ||= this.didExceedMatchLimit()
        return result
      }
    }
    type Runtime = {`,
    )
    code = replaceRequired(
      code,
      'layers: document.layers.length,',
      `layers: document.layers.length,
      __compareCoverage: document.layers.map(layer => ({
        languageId: layer.languageId, kind: layer.kind,
        start: layer.tree.rootNode.startIndex, end: layer.tree.rootNode.endIndex,
        ranges: layer.ranges.map(range => [range.startIndex, range.endIndex]),
      })),
      __compareWasmBytes: heap().buffer.byteLength,
      __compareQueryCalls: compareQueryCalls,
      __compareMatchLimitExceeded: compareMatchLimitExceeded,`,
    )
    return code
  }
}

export function verifyFullDocumentRow(row) {
  const full = row.openProfile.requests.findLast(
    (request) => request.resultMode === 'full' && request.returnedResult,
  )
  if (
    !full?.returnedResult ||
    full.statistics?.rangeStart !== 0 ||
    full.statistics?.rangeEnd !== row.mib * 1024 * 1024 ||
    !full.statistics?.tokens
  )
    throw new RangeError('Full-document result must cover the entire fixture and contain tokens')
  if (full.degraded?.length) throw new RangeError('Full-document result contains degraded phases')
  if (
    row.startup === 'warm-runtime-fresh-document' &&
    (!full.runtimeSessionId ||
      !row.openProfile.warmup?.some((request) => request.worker === full.worker) ||
      row.openProfile.warmup.some(
        (request) => request.runtimeSessionId === full.runtimeSessionId,
      ) ||
      row.openProfile.warmup.some((request) => request.documentId === full.documentId) ||
      row.openProfile.requests.some((request) => request.type === 'init'))
  )
    throw new RangeError('Warm control requires the same worker and a fresh document')
  if (full.analysis?.kind !== 'full')
    throw new RangeError('Full-document result must declare complete analysis')
  const proof = row.outputProof
  const root = proof?.coverage?.find((layer) => layer.kind === 'root')
  if (!root || root.start !== 0 || root.end !== row.mib * 1024 * 1024)
    throw new RangeError('Full-document root tree must cover the entire fixture')
  if (proof.missingLanguages?.length)
    throw new RangeError('Full-document output has unsupported injection languages')
  const expectedLanguages =
    {
      injected: ['typescript', 'regex', 'jsdoc'],
      'dense-injected': ['typescript', 'regex', 'jsdoc'],
      'dense-recovery': ['typescript', 'regex', 'jsdoc'],
      html: ['html', 'css', 'javascript', 'regex'],
      markdown: ['html', 'css', 'javascript', 'regex'],
    }[row.corpus] ?? []
  if (
    expectedLanguages.some(
      (language) => !proof.coverage.some((layer) => layer.languageId === language),
    )
  )
    throw new RangeError('Full-document output is missing expected injection layers')
  if (row.corpus?.startsWith('dense-')) {
    const text = fixture(row.mib, row.corpus)
    const comments = [...text.matchAll(/\/\*\*.*?\*\//g)]
    const pairs = comments.length
    const expected = new Set(
      comments.flatMap((comment) => {
        const regex = text.indexOf('[a-z]+', comment.index)
        return [
          `jsdoc:${comment.index}:${comment.index + comment[0].length}`,
          `regex:${regex}:${regex + 6}`,
        ]
      }),
    )
    const children = proof.coverage.filter((layer) => layer.kind === 'injection')
    for (const layer of children) {
      const key = `${layer.languageId}:${layer.start}:${layer.end}`
      if (
        layer.ranges.length !== 1 ||
        layer.ranges[0][0] !== layer.start ||
        layer.ranges[0][1] !== layer.end ||
        !expected.delete(key)
      )
        throw new RangeError('Dense full-document injection range is unexpected or duplicated')
    }
    if (expected.size || children.length !== pairs * 2)
      throw new RangeError('Dense full-document output is missing injection layers')
    if (proof.tokenCount !== pairs * 17)
      throw new RangeError('Dense full-document fixture has an unexpected token count')
    if (row.corpus === 'dense-recovery' && proof.errorCount !== pairs * 3)
      throw new RangeError('Dense recovery output is missing grammar error records')
    if (row.corpus === 'dense-injected' && proof.errorCount !== 0)
      throw new RangeError('Grammar-valid dense fixture produced syntax errors')
    if (proof.injectionCount !== pairs * 2)
      throw new RangeError('Dense full-document output is missing injection records')
  }
  if (proof.matchLimitExceeded !== false || !proof.queryCalls)
    throw new RangeError('Full-document query limit status is missing or exceeded')
  if (
    proof.tokenCount !== full.statistics.tokens ||
    !/^[a-f0-9]{64}$/.test(proof.tokenSha256) ||
    !/^[a-f0-9]{64}$/.test(proof.stylesSha256) ||
    !/^[a-f0-9]{64}$/.test(proof.structuralSha256)
  )
    throw new RangeError('Full-document output proof is incomplete')
  if ((row.corpus ?? 'repeated') === 'repeated' && row.mib === 10 && proof.tokenCount !== 1_198_376)
    throw new RangeError('Repeated 10 MiB fixture has an unexpected token count')
  if (
    proof.lastToken[1] > row.mib * 1024 * 1024 ||
    proof.lastToken[1] < row.mib * 1024 * 1024 - 100
  )
    throw new RangeError('Full-document output is missing tail tokens')
  if (
    proof.coverage.length !== full.statistics.layers ||
    proof.coverage.some(
      (layer) =>
        layer.start < 0 ||
        layer.end > row.mib * 1024 * 1024 ||
        layer.ranges.some(([start, end]) => start < layer.start || end > layer.end || start >= end),
    )
  )
    throw new RangeError('Full-document layer coverage is invalid')
  if (
    row.openProfile.requests.some(
      (request) => request.type === 'queryRange' || request.resultMode === 'parseOnly',
    )
  )
    throw new RangeError('Full-document probe dispatched range or parse-only work')
}

async function nativeBenchmark(source, destination) {
  const grammar = resolve(
    fileURLToPath(new URL('./node_modules/tree-sitter-typescript', import.meta.url)),
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
