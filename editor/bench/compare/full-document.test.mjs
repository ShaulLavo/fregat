import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fullDocumentTransform, verifyFullDocumentRow } from './full-document.mjs'

for (const file of [
  'editor/src/editor/syntaxController.ts',
  'tree-sitter/src/session.ts',
  'tree-sitter/src/treeSitter/treeSitter.worker.ts',
]) {
  test(`full-document probe targets current ${file}`, async () => {
    const source = await readFile(new URL(`../../packages/${file}`, import.meta.url), 'utf8')
    const transformed = fullDocumentTransform(source, `/packages/${file}`)
    assert.notEqual(transformed, source)
    if (file.endsWith('syntaxController.ts')) {
      assert.ok(!transformed.includes("syntaxMode: 'range'"))
      assert.ok(transformed.includes("syntaxMode: 'full'"))
    }
  })
}

test('probe fails when source targets drift and leaves unrelated modules unchanged', () => {
  assert.throws(
    () => fullDocumentTransform('', '/packages/editor/src/editor/syntaxController.ts'),
    /target changed/,
  )
  assert.equal(fullDocumentTransform('unchanged', '/other.ts'), undefined)
})

test('full-document verification rejects viewport-only and partial answers', () => {
  const result = {
    mib: 1,
    outputProof: {
      tokenCount: 100,
      tokenSha256: 'a'.repeat(64),
      stylesSha256: 'b'.repeat(64),
      structuralSha256: 'c'.repeat(64),
      queryCalls: 3,
      matchLimitExceeded: false,
      lastToken: [1024 * 1024 - 5, 1024 * 1024, 0],
      coverage: [{ kind: 'root', start: 0, end: 1024 * 1024, ranges: [[0, 1024 * 1024]] }],
    },
    openProfile: {
      requests: [
        {
          resultMode: 'full',
          returnedResult: true,
          statistics: { rangeStart: 0, rangeEnd: 1024 * 1024, tokens: 100, layers: 1 },
        },
      ],
    },
  }
  verifyFullDocumentRow(result)
  const retried = structuredClone(result)
  retried.openProfile.requests.unshift({
    resultMode: 'full',
    returnedResult: true,
    statistics: { rangeStart: 0, rangeEnd: 1024 * 1024, tokens: 50, layers: 1 },
  })
  verifyFullDocumentRow(retried)
  const warm = structuredClone(result)
  warm.startup = 'warm-runtime-fresh-document'
  warm.openProfile.requests[0].worker = 1
  warm.openProfile.requests[0].documentId = 'fresh'
  warm.openProfile.requests[0].runtimeSessionId = 'fresh-runtime'
  warm.openProfile.warmup = [{ worker: 1, documentId: 'prime', runtimeSessionId: 'prime-runtime' }]
  verifyFullDocumentRow(warm)
  for (const warmup of [
    undefined,
    [{ worker: 2, documentId: 'prime' }],
    [{ worker: 1, documentId: 'fresh' }],
  ]) {
    assert.throws(
      () => verifyFullDocumentRow({ ...warm, openProfile: { ...warm.openProfile, warmup } }),
      /Warm control/,
    )
  }
  warm.openProfile.requests.push({ type: 'init' })
  assert.throws(() => verifyFullDocumentRow(warm), /Warm control/)
  const injected = structuredClone(result)
  injected.corpus = 'injected'
  assert.throws(() => verifyFullDocumentRow(injected), /expected injection layers/)
  const unsupported = structuredClone(result)
  unsupported.outputProof.missingLanguages = ['unknown']
  assert.throws(() => verifyFullDocumentRow(unsupported), /unsupported injection/)
  for (const [key, value, message] of [
    ['coverage', [{ kind: 'root', start: 0, end: 1000 }], /root tree/],
    ['matchLimitExceeded', true, /limit status/],
    ['tokenSha256', undefined, /output proof/],
    ['tokenCount', 99, /output proof/],
    ['lastToken', [0, 10, 0], /tail tokens/],
  ]) {
    const changed = structuredClone(result)
    changed.outputProof[key] = value
    assert.throws(() => verifyFullDocumentRow(changed), message)
  }
  for (const type of ['queryRange', 'parseOnly']) {
    const changed = structuredClone(result)
    changed.openProfile.requests.push(type === 'queryRange' ? { type } : { resultMode: type })
    assert.throws(() => verifyFullDocumentRow(changed), /range or parse-only/)
  }
  const degraded = structuredClone(result)
  degraded.openProfile.requests[0].degraded = [{ kind: 'timeout' }]
  assert.throws(() => verifyFullDocumentRow(degraded), /degraded phases/)
  const changed = structuredClone(result)
  changed.openProfile.requests[0].statistics.rangeEnd = 1000
  assert.throws(() => verifyFullDocumentRow(changed), /entire fixture/)
})
