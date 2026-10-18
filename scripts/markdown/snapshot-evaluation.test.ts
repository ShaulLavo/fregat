import { hash } from 'node:crypto'
import { expect, test } from 'vitest'
import { selectEvaluationMessages } from './snapshot-evaluation'

const source = 'Human response with **strong** Markdown.\n'.repeat(6)
function message(id: string, overrides: Record<string, unknown> = {}) {
  return {
    message_id: id,
    text: source,
    role: 'assistant',
    lang: 'en',
    synthetic: false,
    deleted: false,
    created_date: '2023-04-01T00:00:00Z',
    ...overrides,
  }
}

test('sealed selection excludes development hashes, duplicate sources and synthetic/user/deleted rows', () => {
  const rows = [
    message('development'),
    message('duplicate'),
    message('synthetic', { text: source + 'synthetic', synthetic: true }),
    message('user', { text: source + 'user', role: 'prompter' }),
    message('deleted', { text: source + 'deleted', deleted: true }),
    message('human', { text: source + 'kept' }),
    message('repeated', { text: source + 'kept' }),
  ]
  const selected = selectEvaluationMessages(
    rows.map((row) => JSON.stringify(row)).join('\n'),
    new Set([hash('sha256', source, 'hex')]),
  )
  expect(selected).toHaveLength(1)
  expect(selected[0]?.id).toBe('human')
  expect(selected[0]?.sha256).toBe(hash('sha256', source + 'kept', 'hex'))
  expect(selected[0]?.provenance.license).toBe('Apache-2.0')
})

test('selection rejects an invalid external row and preserves authored Unicode/whitespace', () => {
  expect(() =>
    selectEvaluationMessages(JSON.stringify({ message_id: 'invalid' }), new Set()),
  ).toThrow()
  const unicode = source + '\n  שלום 👩🏽‍💻 é\r\n'
  const selected = selectEvaluationMessages(
    JSON.stringify(message('unicode', { text: unicode })),
    new Set(),
  )
  expect(selected[0]?.source).toBe(unicode)
})

test('seeded selection order is stable under dataset reorder', () => {
  const rows = Array.from({ length: 10 }, (_, index) =>
    message(String(index), { text: source + index }),
  )
  const encoded = (input: readonly Record<string, unknown>[]) =>
    input.map((row) => JSON.stringify(row)).join('\n')
  expect(selectEvaluationMessages(encoded(rows), new Set())).toEqual(
    selectEvaluationMessages(encoded(rows.toReversed()), new Set()),
  )
})
