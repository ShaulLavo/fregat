import { expect, test } from 'vitest'
import { productionMismatchWitness } from './production-mismatch'
import type { ProductionMarkdownFrame } from '../../apps/web/test/factories/markdown-production-types'

function frame(
  attributes: Readonly<Record<string, string>>,
  text = 'same',
): ProductionMarkdownFrame {
  const output = { digest: 'a'.repeat(64), textBytes: text.length, elementCount: 1 }
  return {
    text,
    elements: [{ tag: 'a', text, attributes, parents: [] }],
    revision: 2,
    observedRevision: 2,
    inputSha256: 'b'.repeat(64),
    inputUtf16Units: 4,
    live: false,
    scheduled: 1,
    received: 1,
    committed: 2,
    painted: 3,
    output,
    paintedOutput: output,
    parseCalls: 1,
    parserWallMs: 0,
  }
}
function witness(actual: ProductionMarkdownFrame, expected: ProductionMarkdownFrame) {
  return productionMismatchWitness({
    actual,
    expected,
    actualEngine: 'tree-sitter',
    expectedEngine: 'remark',
  })
}

test('mismatch witness binds both engines, revisions and input digests', () => {
  const found = witness(frame({ href: '/new' }), frame({ href: '/old' }))
  expect(found.actual).toMatchObject({
    engine: 'tree-sitter',
    revision: 2,
    inputSha256: 'b'.repeat(64),
  })
  expect(found.expected.engine).toBe('remark')
  expect(found.firstDifference).toMatchObject({
    path: '$.elements[0].attributes.href',
    pathTruncated: false,
    actual: { present: true, preview: '"/new"', truncated: false },
    expected: { present: true, preview: '"/old"', truncated: false },
  })
})

test('missing and empty attributes retain distinct presence evidence', () => {
  expect(witness(frame({}), frame({ title: '' })).firstDifference).toMatchObject({
    path: '$.elements[0].attributes.title',
    actual: { present: false },
    expected: { present: true, preview: '""', truncated: false },
  })
  expect(witness(frame({ title: '' }), frame({})).firstDifference).toMatchObject({
    actual: { present: true, preview: '""' },
    expected: { present: false },
  })
})

test('first differing field survives beyond the bounded observation preview', () => {
  const actual = frame({ title: 'x'.repeat(100_000), href: '/new' })
  const expected = frame({ title: 'x'.repeat(100_000), href: '/old' })
  const found = witness(actual, expected)
  expect(found.actual.observation.truncated).toBe(true)
  expect(found.firstDifference?.path).toBe('$.elements[0].attributes.href')
  expect(Buffer.byteLength(JSON.stringify(found))).toBeLessThanOrEqual(found.limits.maxJsonBytes)
})

test('long differing values and property names label truncation and stay within the byte bound', () => {
  const key = '\u0001'.repeat(100_000)
  const found = witness(frame({ [key]: '\u0000'.repeat(100_000) }), frame({}))
  expect(found.firstDifference?.pathTruncated).toBe(true)
  expect(found.firstDifference?.actual).toMatchObject({ present: true, truncated: true })
  expect(found.firstDifference?.expected).toEqual({ present: false })
  expect(Buffer.byteLength(JSON.stringify(found))).toBeLessThanOrEqual(found.limits.maxJsonBytes)
  expect(found.verdict).toBe('mismatch')
})

test('first differing whitespace and child presence are preserved', () => {
  expect(witness(frame({}, 'a  b'), frame({}, 'a b')).firstDifference?.path).toBe('$.text')
  const actual = frame({})
  expect(witness({ ...actual, elements: [] }, actual).firstDifference).toMatchObject({
    path: '$.elements[0]',
    actual: { present: false },
    expected: { present: true },
  })
})

test('a difference after a long common string prefix retains exact UTF16 units', () => {
  const found = witness(
    frame({ title: 'x'.repeat(100_000) + '\ud800' }),
    frame({ title: 'x'.repeat(100_000) + '\ud801' }),
  )
  expect(found.firstDifference?.stringDifference).toMatchObject({
    utf16Offset: 100_000,
    actualCodeUnit: 0xd800,
    expectedCodeUnit: 0xd801,
  })
  expect(Buffer.byteLength(JSON.stringify(found))).toBeLessThanOrEqual(found.limits.maxJsonBytes)
})

test('revision-only mismatch retains requested and observed identities with equal output', () => {
  const expected = frame({})
  const actual = { ...expected, revision: 19, observedRevision: 20, live: false }
  const found = witness(actual, expected)
  expect(found.actual).toMatchObject({ revision: 19, observedRevision: 20, live: false })
  expect(found.expected).toMatchObject({ revision: 2, observedRevision: 2, live: false })
  expect(found.classification).toBe('revision')
  expect(found.firstDifference).toBeNull()
  expect(found.verdict).toBe('mismatch')
})
