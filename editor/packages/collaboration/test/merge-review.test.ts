import { afterEach, beforeEach, expect, test } from 'vitest'
import { ConfirmedWindow, TextbufferEngine } from '@singapore-editor/collab'
import { MergeReviewDetector } from '../src/merge-review'
import { history, peerSnapshot, syntaxFixture } from './merge-review-fixture'

let fixture: Awaited<ReturnType<typeof syntaxFixture>>
beforeEach(async () => {
  fixture = await syntaxFixture('typescript', false, 'differential')
})
afterEach(() => fixture.dispose())

async function kinds(input: ReturnType<typeof history>) {
  const snapshot = input.base.snapshot()
  const result = await fixture.detector.detect(input.window, snapshot)
  expect(result.status).toBe('complete')
  expect(input.base.snapshot()).toBe(snapshot)
  return [...new Set(result.marks.map((mark) => mark.kind))].sort()
}

test('wide damaged fallback scans errors without overflowing argument limits', async () => {
  const text = 'const broken = ;\n' + 'const healthy = 1;\n'.repeat(130_000)
  const input = history(text, [])
  const units = await fixture.syntax(input.base.snapshot().buffer, [
    { startIndex: 0, endIndex: text.length },
  ])
  expect(units?.[0]?.[0]?.type).toBe('line')
  expect(units?.[0]?.[0]?.hasErrors).toBe(true)
}, 30_000)

test('independent edits in separate functions stay unmarked', async () => {
  const text = 'function east() { return 1; }\nfunction west() { return 2; }'
  expect(
    await kinds(
      history(text, [
        { offset: text.indexOf('1'), deleteCount: 1, text: '3' },
        { offset: text.indexOf('2'), deleteCount: 1, text: '4' },
      ]),
    ),
  ).toEqual([])
})

test('unordered import insertions stay unmarked', async () => {
  const text = 'import { } from "colors";'
  expect(
    await kinds(
      history(text, [
        { offset: 9, deleteCount: 0, text: 'copper, ' },
        { offset: 9, deleteCount: 0, text: 'silver, ' },
      ]),
    ),
  ).toEqual([])
})

test('formatting and content changes in one statement stay unmarked', async () => {
  const text = 'const amount = 4;'
  expect(
    await kinds(
      history(text, [
        { offset: text.indexOf('='), deleteCount: 0, text: '  ' },
        { offset: text.indexOf('4'), deleteCount: 1, text: '5' },
      ]),
    ),
  ).toEqual([])
})

test('different spellings of one rename mark the statement', async () => {
  const text = 'const count = 4;'
  expect(
    await kinds(
      history(text, [
        { offset: 6, deleteCount: 5, text: 'total' },
        { offset: 6, deleteCount: 5, text: 'amount' },
      ]),
    ),
  ).toEqual(['overlap'])
})

test('a broken combined parse is marked when both author projections parse', async () => {
  const text = 'const answer = 1;'
  expect(
    await kinds(
      history(text, [
        { offset: 15, deleteCount: 1, text: '"alpha"' },
        { offset: 15, deleteCount: 1, text: '"beta"' },
      ]),
    ),
  ).toEqual(['overlap', 'parse'])
})

test('existing syntax damage alone never produces a parse signal', async () => {
  const text = 'const answer = ;'
  expect(
    await kinds(
      history(text, [
        { offset: 6, deleteCount: 6, text: 'result' },
        { offset: 6, deleteCount: 6, text: 'output' },
      ]),
    ),
  ).toEqual(['overlap'])
})

test('equivalent quoted escape spellings collide inside an interface', async () => {
  const text = 'interface Pair { }'
  expect(
    await kinds(
      history(text, [
        { offset: text.indexOf('}'), deleteCount: 0, text: '"\\n": string; ' },
        { offset: text.indexOf('}'), deleteCount: 0, text: '"\\u000a": string; ' },
      ]),
    ),
  ).toEqual(['signature'])
})

test('literal backslashes keep quoted signatures distinct', async () => {
  const text = 'interface Pair { }'
  expect(
    await kinds(
      history(text, [
        { offset: text.indexOf('}'), deleteCount: 0, text: '"\\\\u0061": string; ' },
        { offset: text.indexOf('}'), deleteCount: 0, text: '"\\a": string; ' },
      ]),
    ),
  ).toEqual([])
})

test('duplicate imports mark both children of the unordered parent', async () => {
  const text = 'import { } from "colors";'
  const input = history(text, [
    { offset: 9, deleteCount: 0, text: 'copper, ' },
    { offset: 9, deleteCount: 0, text: 'copper, ' },
  ])
  expect(await kinds(input)).toEqual(['signature'])
  const result = await fixture.detector.detect(input.window, input.base.snapshot())
  expect(result.marks).toHaveLength(2)
  expect(new Set(result.marks.map((mark) => mark.unitId)).size).toBe(2)
})

test('delete versus body modification and stranded insertion produce an orphan', async () => {
  const text = 'function north() { return 1; }\nconst remaining = 0;'
  const end = text.indexOf('\n')
  expect(
    await kinds(
      history(text, [
        { offset: 0, deleteCount: end, text: '' },
        { offset: text.indexOf('1'), deleteCount: 1, text: '2' },
      ]),
    ),
  ).toContain('orphan')
  expect(
    await kinds(
      history(text, [
        { offset: 0, deleteCount: end, text: '' },
        { offset: text.indexOf('return'), deleteCount: 0, text: 'let flag = true; ' },
      ]),
    ),
  ).toContain('orphan')
})

test('a moved element and later edits keep their causal ordering', async () => {
  const text = 'const near = 1;\nconst far = 2;'
  const input = history(text, [{ offset: 0, deleteCount: 15, text: '' }])
  const moved = input.base.author(
    { offset: input.base.snapshot().buffer.length, deleteCount: 0, text: '\nconst near = 1;' },
    {
      document: 'review',
      epoch: '1',
      id: { actor: 'author-0', seq: 2 },
      lamport: 2,
      deps: [input.confirmed[0]!.id],
      allocate: (_left, count) => ({ bunch: `moved-${count}`, counter: 0 }),
    },
  )
  input.base.apply(moved)
  const edit = input.base.author(
    { offset: input.base.text().lastIndexOf('1'), deleteCount: 1, text: '9' },
    {
      document: 'review',
      epoch: '1',
      id: { actor: 'author-1', seq: 1 },
      lamport: 3,
      deps: [moved.id],
      allocate: () => ({ bunch: 'edited-move', counter: 0 }),
    },
  )
  input.base.apply(edit)
  input.window.append([moved, edit])
  expect(await kinds(input)).toEqual([])
})

test('confirmed snapshots ignore pending local typing and input log arrival order', async () => {
  const input = history('const count = 4;', [
    { offset: 6, deleteCount: 5, text: 'total' },
    { offset: 6, deleteCount: 5, text: 'amount' },
  ])
  const first = await fixture.detector.detect(input.window, input.base.snapshot())
  const reverse = peerSnapshot(input.snapshot, input.confirmed.toReversed())
  const second = await fixture.detector.detect(
    new ConfirmedWindow(input.confirmed.toReversed()),
    reverse,
  )
  expect(second).toEqual(first)
  const pending = new TextbufferEngine()
  pending.restore(reverse)
  const edit = pending.author(
    { offset: 0, deleteCount: 0, text: 'pending\n' },
    {
      document: 'review',
      epoch: '1',
      id: { actor: 'local', seq: 1 },
      lamport: 2,
      deps: input.confirmed.map((edit) => edit.id),
      allocate: () => ({ bunch: 'pending', counter: 0 }),
    },
  )
  pending.apply(edit)
  expect(await fixture.detector.detect(input.window, reverse)).toEqual(first)
})

test('no session and single-author logs make zero syntax calls', async () => {
  const input = history(
    'const count = 4;',
    [
      { offset: 6, deleteCount: 5, text: 'total' },
      { offset: 6, deleteCount: 5, text: 'amount' },
    ],
    ['one', 'one'],
  )
  expect(await fixture.detector.detect(null, input.base.snapshot())).toEqual({
    status: 'complete',
    marks: [],
  })
  expect(await fixture.detector.detect(input.window, input.base.snapshot())).toEqual({
    status: 'complete',
    marks: [],
  })
  expect(fixture.calls).toBe(0)
})

test('unavailable syntax yields no partial mark set', async () => {
  const input = history('const count = 4;', [
    { offset: 6, deleteCount: 5, text: 'total' },
    { offset: 6, deleteCount: 5, text: 'amount' },
  ])
  expect(
    await new MergeReviewDetector(async () => null).detect(input.window, input.base.snapshot()),
  ).toEqual({ status: 'unavailable', marks: [] })
})

test('undo removes obsolete marks', async () => {
  const input = history('const count = 4;', [
    { offset: 6, deleteCount: 5, text: 'total' },
    { offset: 6, deleteCount: 5, text: 'amount' },
  ])
  const command = { actor: 'author-1', seq: 3 }
  const undo = {
    document: 'review',
    epoch: '1',
    id: command,
    lamport: 2,
    deps: input.confirmed.map((edit) => edit.id),
    change: {
      kind: 'setEffects' as const,
      command,
      effects: [{ op: input.confirmed[1]!.id, active: false }],
    },
  }
  input.base.apply(undo)
  input.window.append([undo])
  expect(await kinds(input)).toEqual([])
})

test('equivalent JSON signature spellings collide', async () => {
  fixture.dispose()
  fixture = await syntaxFixture('json', false, 'differential')
  const input = history('{"tail":0}', [
    { offset: 1, deleteCount: 0, text: '"name":1,' },
    { offset: 1, deleteCount: 0, text: '"\\u006eame":2,' },
  ])
  expect(await kinds(input)).toContain('signature')
})

test('deleting a neighbouring function does not mark an independent edit', async () => {
  const text = 'function east() { return 1; }\nfunction west() { return 2; }'
  expect(
    await kinds(
      history(text, [
        { offset: 0, deleteCount: text.indexOf('\n') + 1, text: '' },
        { offset: text.indexOf('2'), deleteCount: 1, text: '4' },
      ]),
    ),
  ).toEqual([])
})

test('edited descendants that survive a removed wrapper stay unmarked', async () => {
  const text = 'function shell() { const value = 1; }\n'
  const input = history(
    text,
    [
      { offset: 0, deleteCount: text.indexOf('const'), text: '' },
      { offset: text.indexOf('1'), deleteCount: 1, text: '2' },
      { offset: text.indexOf(' }'), deleteCount: 2, text: '' },
    ],
    ['moving', 'editing', 'moving'],
  )
  expect(await kinds(input)).toEqual([])
})

test('commutative parents do not hide concurrent edits inside one child', async () => {
  const text = 'interface Shape { value: string; }'
  expect(
    await kinds(
      history(text, [
        { offset: text.indexOf('string'), deleteCount: 6, text: 'number' },
        { offset: text.indexOf('string'), deleteCount: 6, text: 'boolean' },
      ]),
    ),
  ).toContain('overlap')
})

test('escaped TypeScript local names normalize before signature comparison', async () => {
  const text = 'import { } from "colors";'
  expect(
    await kinds(
      history(text, [
        { offset: 9, deleteCount: 0, text: 'copper, ' },
        { offset: 9, deleteCount: 0, text: '\\u0063opper, ' },
      ]),
    ),
  ).toEqual(['signature'])
})
