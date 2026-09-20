import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

// @ts-expect-error The census is a plain ES module and the scripts workspace has no `allowJs`.
import { causeOf, censusSource, evaluate } from './react-compiler-census.mjs'

type Hit = { readonly file: string; readonly line: number; readonly value: string }
type Census = { readonly hits: Readonly<Record<string, readonly Hit[]>> }

const REFUSED = [
  "import { useRef } from 'react'",
  '',
  'export function Probe() {',
  '  const ref = useRef(0)',
  '  ref.current += 1',
  '  return <div>{ref.current}</div>',
  '}',
]

function census(file: string, lines: readonly string[]): Census {
  return censusSource(file, `${lines.join('\n')}\n`)
}

function locations(subject: Census, measure: string): readonly string[] {
  return subject.hits[measure].map((hit) => `${hit.file}:${hit.line} ${hit.value}`)
}

test('counts a component the compiler accepted as memoized and not as a bailout', () => {
  const subject = census('probe.tsx', [
    'export function Probe({ items }: { readonly items: readonly string[] }) {',
    '  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>',
    '}',
  ])

  expect(subject.hits.coverage.map((hit) => hit.value)).toEqual(['memoized'])
  expect(subject.hits.bailouts).toEqual([])
})

test('reports a ref read during render as a whole-file bailout with its line', () => {
  const subject = census('probe.tsx', REFUSED)

  expect(subject.hits.coverage.map((hit) => hit.value)).toEqual(['refused'])
  expect(locations(subject, 'bailouts')[0]).toBe('probe.tsx:5 refs-during-render')
  expect(evaluate(subject).passed).toBe(false)
})

test('keeps a test file out of the gate', () => {
  const subject = census('tests/probe.test.tsx', REFUSED)

  expect(subject.hits.bailouts).toEqual([])
  expect(subject.hits.testBailouts.length).toBeGreaterThan(0)
  expect(evaluate(subject).passed).toBe(true)
})

test('excuses an allow-listed bailout, and only with a reason', () => {
  const subject = census('probe.tsx', REFUSED)
  const entry = { file: 'probe.tsx', cause: 'refs-during-render' }

  expect(evaluate(subject, [{ ...entry, reason: 'A measured exception.' }]).passed).toBe(true)
  const unexplained = evaluate(subject, [{ ...entry, reason: ' ' }])
  expect(unexplained.passed).toBe(false)
  expect(unexplained.allowProblems[0]).toContain(
    'an exception without a reason is itself a violation',
  )
})

test('fails on a stale allow-list entry', () => {
  const subject = census('probe.tsx', ['export const value = 1'])
  const result = evaluate(subject, [
    { file: 'gone.tsx', cause: 'refs-during-render', reason: 'Once true.' },
  ])

  expect(result.passed).toBe(false)
  expect(result.allowProblems[0]).toContain('stale')
})

test('an unrecognised compiler message has no cause, which is what gates it', () => {
  expect(causeOf('Use of incompatible library')).toBe('incompatible-library')
  expect(causeOf('A message a future compiler invents')).toBeNull()
})

test('is wired into the repository: a script entry and a place in the verify chain', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> }

  expect(manifest.scripts['compiler:census']).toBe(
    'node scripts/lint/react-compiler-census.mjs --check',
  )
  expect(manifest.scripts.verify).toContain('bun run design:census && bun run compiler:census')
  expect(manifest.scripts['test:scripts']).toContain('scripts/lint/react-compiler-census.test.ts')
})
