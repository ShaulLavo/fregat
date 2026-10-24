import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fullDocumentTransform, verifyFullDocumentRow } from './full-document.mjs'
import { fixture } from './fixture.mjs'

for (const file of [
  'editor/src/editor/syntaxController.ts',
  'tree-sitter/src/session.ts',
  'tree-sitter/src/treeSitter/treeSitter.worker.ts',
]) {
  test(`full-document probe targets current ${file}`, async () => {
    const source = await readFile(new URL(`../../packages/${file}`, import.meta.url), 'utf8')
    const transformed = fullDocumentTransform(source, `/packages/${file}`)
    assert.notEqual(transformed, source)
    if (file.endsWith('treeSitter.worker.ts')) {
      assert.ok(transformed.includes("['matches', 'captures', 'captureRanges']"))
      assert.ok(transformed.includes("if (typeof original !== 'function') continue"))
    }
    if (file.endsWith('session.ts')) {
      assert.ok(
        transformed.includes(
          "this.syntaxMode === 'range' && this.result.projection.analysis?.kind !== 'cancelled' &&",
        ),
      )
    }
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
          analysis: { kind: 'full' },
          statistics: { rangeStart: 0, rangeEnd: 1024 * 1024, tokens: 100, layers: 1 },
        },
      ],
    },
  }
  verifyFullDocumentRow(result)
  const partial = structuredClone(result)
  partial.openProfile.requests[0].analysis = { kind: 'partial' }
  assert.throws(() => verifyFullDocumentRow(partial), /complete analysis/)
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

test('dense proof rejects missing and duplicate layers even when counts match', () => {
  const text = fixture(1, 'dense-injected')
  const coverage = [
    {
      languageId: 'typescript',
      kind: 'root',
      start: 0,
      end: text.length,
      ranges: [[0, text.length]],
    },
  ]
  const comments = [...text.matchAll(/\/\*\*.*?\*\//g)]
  for (const comment of comments) {
    const regex = text.indexOf('[a-z]+', comment.index)
    for (const [languageId, start, end] of [
      ['jsdoc', comment.index, comment.index + comment[0].length],
      ['regex', regex, regex + 6],
    ])
      coverage.push({ languageId, kind: 'injection', start, end, ranges: [[start, end]] })
  }
  const row = {
    mib: 1,
    corpus: 'dense-injected',
    openProfile: {
      requests: [
        {
          resultMode: 'full',
          returnedResult: true,
          analysis: { kind: 'full' },
          statistics: {
            rangeStart: 0,
            rangeEnd: text.length,
            tokens: comments.length * 17,
            layers: coverage.length,
          },
        },
      ],
    },
    outputProof: {
      coverage,
      tokenCount: comments.length * 17,
      injectionCount: comments.length * 2,
      errorCount: 0,
      tokenSha256: 'a'.repeat(64),
      stylesSha256: 'b'.repeat(64),
      structuralSha256: 'c'.repeat(64),
      queryCalls: 1,
      matchLimitExceeded: false,
      lastToken: [text.length - 80, text.length - 79, 0],
    },
  }
  verifyFullDocumentRow(row)
  const missing = structuredClone(row)
  missing.outputProof.coverage.pop()
  assert.throws(() => verifyFullDocumentRow(missing), /missing injection layers/)
  const duplicate = structuredClone(row)
  duplicate.outputProof.coverage[duplicate.outputProof.coverage.length - 1] =
    duplicate.outputProof.coverage[2]
  assert.throws(() => verifyFullDocumentRow(duplicate), /unexpected or duplicated/)
  const grammarError = structuredClone(row)
  grammarError.outputProof.errorCount = 1
  assert.throws(() => verifyFullDocumentRow(grammarError), /syntax errors/)
})
