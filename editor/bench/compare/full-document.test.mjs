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
    mib: 10,
    openProfile: {
      requests: [
        {
          resultMode: 'full',
          returnedResult: true,
          statistics: { rangeStart: 0, rangeEnd: 10 * 1024 * 1024, tokens: 100 },
        },
      ],
    },
  }
  verifyFullDocumentRow(result)
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
