import { afterEach, beforeEach, expect, test } from 'vitest'
import { MergeReviewDetector } from '../src/merge-review'
import { appendEdit, history, peerSnapshot, syntaxFixture } from './merge-review-fixture'

let fixture: Awaited<ReturnType<typeof syntaxFixture>>
beforeEach(async () => {
  fixture = await syntaxFixture()
})
afterEach(() => fixture.dispose())

async function detect(input: ReturnType<typeof history>) {
  const result = await fixture.detector.detect(input.window, input.base.snapshot())
  expect(result.status).toBe('complete')
  return result.marks
}

test('replacement deletion footprints expose a broken merge across declarations', async () => {
  const text = 'const a = 1;\nconst b = 2;'
  const input = history(text, [
    { offset: 10, deleteCount: 12, text: '3;\n' },
    { offset: 19, deleteCount: 0, text: 'c' },
  ])
  expect(input.base.text()).toBe('const a = 3;\nc 2;')
  for (const envelope of input.confirmed) {
    const author = peerSnapshot(input.snapshot, [envelope]).buffer
    const units = await fixture.syntax(author, [{ startIndex: 0, endIndex: author.length }])
    expect(units?.[0]?.[0]?.hasErrors).toBe(false)
  }
  expect((await detect(input)).map((mark) => mark.kind)).toContain('parse')
})

test('a header-and-body replacement retains its ancestor header touch', async () => {
  const text = 'function f() { return 1; }'
  const input = history(text, [
    { offset: text.indexOf('f()'), deleteCount: 'f() { return 1'.length, text: 'g() { return 2' },
    { offset: 0, deleteCount: 0, text: 'async ' },
  ])
  expect(input.base.text()).toBe('async function g() { return 2; }')
  expect(
    (await detect(input)).some(
      (mark) => mark.kind === 'overlap' && mark.unit.type === 'function_declaration',
    ),
  ).toBe(true)
})

test('causally removed comments leave no insertion or deletion edges', async () => {
  const text = 'const value = 1;'
  const input = history(text, [
    { offset: 0, deleteCount: 0, text: '// note\n' },
    { offset: text.indexOf('1'), deleteCount: 1, text: '2' },
  ])
  appendEdit(
    input,
    { offset: 0, deleteCount: 8, text: '' },
    'author-0',
    [input.confirmed[0]!.id],
    peerSnapshot(input.snapshot, [input.confirmed[0]!]),
  )
  expect(input.base.text()).toBe('const value = 2;')
  expect(await detect(input)).toEqual([])
})

test('whitespace deletion ignores an interleaved concurrent insertion', async () => {
  const text = 'const value =  1;'
  const input = history(text, [
    { offset: text.indexOf('  '), deleteCount: 2, text: '' },
    { offset: text.indexOf('  ') + 1, deleteCount: 0, text: '2 + ' },
  ])
  expect(input.base.text()).toBe('const value =2 + 1;')
  expect(await detect(input)).toEqual([])
})

test('operation-level formatting classification agrees for full-window and batch edges', async () => {
  const text = 'const value = 1;'
  const input = history(text, [
    { offset: text.indexOf('='), deleteCount: 0, text: '  ' },
    { offset: 6, deleteCount: 5, text: 'renamed' },
  ])
  const author = peerSnapshot(input.snapshot, [input.confirmed[0]!])
  appendEdit(
    input,
    { offset: text.indexOf('1') + 2, deleteCount: 1, text: '2' },
    'author-0',
    [input.confirmed[0]!.id],
    author,
  )
  const marks = await detect(input)
  expect(marks).toHaveLength(1)
  expect(marks[0]!.pairs).toEqual([[input.confirmed[2]!.id, input.confirmed[1]!.id]])
  const batch = await fixture.detector.detect(input.window, input.base.snapshot(), [
    input.confirmed[0]!.id,
  ])
  expect(batch).toEqual({ status: 'complete', marks: [] })
})

test('formatting existing duplicate JSON names never creates signature edges', async () => {
  fixture.dispose()
  fixture = await syntaxFixture('json')
  const text = '{"x":1,"x":2}'
  expect(
    await detect(
      history(text, [
        { offset: text.indexOf('1'), deleteCount: 0, text: ' ' },
        { offset: text.indexOf('2'), deleteCount: 0, text: ' ' },
      ]),
    ),
  ).toEqual([])
})

test('content edits to pre-existing duplicate signatures do not introduce a signature conflict', async () => {
  fixture.dispose()
  fixture = await syntaxFixture('json')
  const text = '{"x":1,"x":2}'
  expect(
    await detect(
      history(text, [
        { offset: text.indexOf('1'), deleteCount: 1, text: '3' },
        { offset: text.indexOf('2'), deleteCount: 1, text: '4' },
      ]),
    ),
  ).toEqual([])
})

test('numeric hexadecimal and decimal property names collide', async () => {
  const text = 'interface Pair { }'
  expect(
    (
      await detect(
        history(text, [
          { offset: text.indexOf('}'), deleteCount: 0, text: '0x10: string; ' },
          { offset: text.indexOf('}'), deleteCount: 0, text: '16: number; ' },
        ]),
      )
    ).map((mark) => mark.kind),
  ).toEqual(['signature', 'signature'])
})

test('quoted hexadecimal names retain string semantics', async () => {
  const text = 'interface Pair { }'
  expect(
    await detect(
      history(text, [
        { offset: text.indexOf('}'), deleteCount: 0, text: '"0x10": string; ' },
        { offset: text.indexOf('}'), deleteCount: 0, text: '0x10: number; ' },
      ]),
    ),
  ).toEqual([])
})

test('orphan liveness survives a causal deletion of its first inserted character', async () => {
  const text = 'function f() { return 1; }\nconst tail = 0;'
  const input = history(text, [
    { offset: 0, deleteCount: text.indexOf('\n'), text: '' },
    { offset: text.indexOf('return'), deleteCount: 0, text: 'let flag = true; ' },
  ])
  expect((await detect(input)).map((mark) => mark.kind)).toContain('orphan')
  appendEdit(input, { offset: input.base.text().indexOf('let'), deleteCount: 1, text: '' }, 'later')
  expect((await detect(input)).map((mark) => mark.kind)).toContain('orphan')
})

test('a paste spanning several stranded declarations marks each orphan', async () => {
  const text = 'function f() { return 1; }\nconst tail = 0;'
  const input = history(text, [
    { offset: 0, deleteCount: text.indexOf('\n'), text: '' },
    { offset: text.indexOf('return'), deleteCount: 0, text: 'let flag = true; let next = false; ' },
  ])
  const orphans = (await detect(input)).filter((mark) => mark.kind === 'orphan')
  expect(orphans).toHaveLength(2)
  expect(new Set(orphans.map((mark) => mark.unitId)).size).toBe(2)
})

test('large insertions collect bounded piece intervals before syntax scheduling', async () => {
  const text = 'const value = 1;'
  const input = history(text, [
    { offset: text.indexOf('1'), deleteCount: 0, text: 'x'.repeat(16_000) },
    { offset: text.indexOf('1'), deleteCount: 0, text: 'y' },
  ])
  let ranges = 0
  const reader = new MergeReviewDetector(async (snapshot, selected) => {
    ranges += selected.length
    return selected.map(() => [
      {
        startIndex: 0,
        endIndex: snapshot.length,
        type: 'statement',
        languageId: 'typescript',
        signature: null,
        hasErrors: false,
        parent: null,
      },
    ])
  })
  expect((await reader.detect(input.window, input.base.snapshot())).status).toBe('complete')
  expect(ranges).toBe(2)
})

test('large multi-unit pastes bound real queries and retain the second signature', async () => {
  fixture.dispose()
  fixture = await syntaxFixture('typescript', true)
  const text = 'interface Pair { }'
  const input = history(text, [
    {
      offset: text.indexOf('}'),
      deleteCount: 0,
      text: `first: "${'x'.repeat(100_000)}"; duplicate: string; `,
    },
    { offset: text.indexOf('}'), deleteCount: 0, text: 'duplicate: number; ' },
  ])
  expect((await detect(input)).filter((mark) => mark.kind === 'signature')).toHaveLength(2)
  expect(fixture.metrics.ranges).toBeLessThanOrEqual(16)
  expect(fixture.metrics.queries).toBeLessThan(100)
})

test('replacing a neighbouring function retains independent-unit separation', async () => {
  const text = 'function east() { return 1; }\nfunction west() { return 2; }'
  const input = history(text, [
    { offset: 0, deleteCount: text.indexOf('\n') + 1, text: 'function north() { return 3; }\n' },
    { offset: text.indexOf('2'), deleteCount: 1, text: '4' },
  ])
  expect(await detect(input)).toEqual([])
})

test('orphan collection skips a fully removed first unit and finds surviving later units', async () => {
  const text = 'function f() { return 1; }\nconst tail = 0;'
  const inserted = 'let flag = true; '
  const input = history(text, [
    { offset: 0, deleteCount: text.indexOf('\n'), text: '' },
    { offset: text.indexOf('return'), deleteCount: 0, text: inserted + 'let next = false; ' },
  ])
  appendEdit(
    input,
    { offset: input.base.text().indexOf('let'), deleteCount: inserted.length, text: '' },
    'later',
  )
  const orphans = (await detect(input)).filter((mark) => mark.kind === 'orphan')
  expect(orphans).toHaveLength(1)
  expect(orphans[0]!.unit.type).toBe('lexical_declaration')
})
