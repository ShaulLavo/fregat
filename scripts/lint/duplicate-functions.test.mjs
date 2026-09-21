import { expect, test } from 'vitest'

import { applyAllowList, inspectFunctions } from './duplicate-functions.mjs'

test('finds renamed short helpers and assigned function expressions despite formatting', () => {
  const result = inspectFunctions([
    { file: 'one.ts', source: 'function first(value) { return value + 1 }' },
    { file: 'two.ts', source: 'const second = (value) => /* same operation */ value + 1' },
  ])
  expect(result.duplicates).toHaveLength(1)
  expect(result.duplicates[0].map((item) => item.name)).toEqual(['first', 'second'])
})

test('preserves differences in literals and typed state accessors', () => {
  const result = inspectFunctions([
    { file: 'one.ts', source: 'function first(value) { return value + "a b" }' },
    { file: 'two.ts', source: 'function second(value) { return value + "ab" }' },
    { file: 'three.ts', source: 'function loaded(): Renderer | null { return state }' },
    { file: 'four.ts', source: 'function loaded(): Extensions { return state }' },
  ])
  expect(result.duplicates).toEqual([])
})

test('rejects inline clock fallbacks but permits their shared implementation', () => {
  const source = 'const mark = globalThis.performance?.now() ?? Date.now()'
  expect(inspectFunctions([{ file: 'consumer.ts', source }]).fallbacks).toHaveLength(1)
  expect(inspectFunctions([{ file: 'packages/utils/src/timing.ts', source }]).fallbacks).toEqual([])
  expect(
    inspectFunctions([
      {
        file: 'consumer.ts',
        source: "const mark = typeof performance === 'undefined' ? Date.now() : performance.now()",
      },
    ]).fallbacks,
  ).toHaveLength(1)
})

test('reports malformed source rather than silently skipping it', () => {
  expect(
    inspectFunctions([{ file: 'broken.ts', source: 'function broken( {' }]).errors.length,
  ).toBeGreaterThan(0)
})

test('ignores annotation differences but retains branded constructors and distinct registries', () => {
  const same = inspectFunctions([
    { file: 'one.ts', source: 'function first(value: number): number { return value + 1 }' },
    { file: 'two.ts', source: 'function second(value) { return value + 1 }' },
  ])
  expect(same.duplicates).toHaveLength(1)
  const different = inspectFunctions([
    {
      file: 'one.ts',
      source: 'const byId = new Map(); function lookup(id) { return byId.get(id) ?? null }',
    },
    {
      file: 'two.ts',
      source: 'const byId = new Map(); function lookup(id) { return byId.get(id) ?? null }',
    },
    { file: 'three.ts', source: 'function id(value: string) { return parse(value) as SessionId }' },
    { file: 'four.ts', source: 'function id(value: string) { return parse(value) as ProjectId }' },
  ])
  expect(different.duplicates).toEqual([])
})

test('excuses an allow-listed pair, and only with a reason naming every copy', () => {
  const { duplicates } = inspectFunctions([
    { file: 'one.ts', source: 'function send(value) { return write(value + 1) }' },
    { file: 'two.ts', source: 'function send(value) { return write(value + 1) }' },
  ])
  const entry = { name: 'send', files: ['one.ts', 'two.ts'] }

  const excused = applyAllowList(duplicates, [{ ...entry, reason: 'Copied binaries.' }])
  expect(excused.offenders).toEqual([])
  expect(excused.problems).toEqual([])

  const unexplained = applyAllowList(duplicates, [{ ...entry, reason: ' ' }])
  expect(unexplained.offenders).toHaveLength(1)
  expect(unexplained.problems[0]).toContain('an exception without a reason is itself a violation')
})

test('fails a stale allow-list entry and one that names only part of the group', () => {
  const { duplicates } = inspectFunctions([
    { file: 'one.ts', source: 'function send(value) { return write(value + 1) }' },
    { file: 'two.ts', source: 'function send(value) { return write(value + 1) }' },
  ])

  const stale = applyAllowList(duplicates, [
    { name: 'gone', files: ['a.ts', 'b.ts'], reason: 'Once true.' },
  ])
  expect(stale.problems[0]).toContain('stale')
  expect(stale.offenders).toHaveLength(1)

  const partial = applyAllowList(duplicates, [
    { name: 'send', files: ['one.ts', 'three.ts'], reason: 'Names the wrong copy.' },
  ])
  expect(partial.offenders).toHaveLength(1)
})
