import { titleAttachment, titleMessages } from '../../../test/factories/title-context'
import { expect, test } from 'vitest'
import { formatSessionTitleContext, limitTitleMessage } from '../title-context'
import { assistantCitationsToPlainText } from '../title-citations'

test('reserves first intent, recent constraints and four attachment slots', () => {
  const result = formatSessionTitleContext(titleMessages(30, 3_000))
  expect(result.message.length).toBeLessThanOrEqual(8_000)
  expect(result.message).toContain('0:first')
  expect(result.message).toContain('final:28')
  expect(result.attachments).toHaveLength(4)
  expect(result.attachments[0]?.id).toBe('0')
  expect(result.attachments.at(-1)?.id).toBe('29')
  expect(result.message).toContain('[Earlier content truncated]')
})

test('excludes thinking, system and empty messages but includes attachment-only intent', () => {
  expect(
    formatSessionTitleContext([
      { role: 'reasoning', text: 'SECRET REASONING' },
      { role: 'system', text: 'SYSTEM' },
      { role: 'assistant', text: ' ' },
      { role: 'user', text: '', attachments: [titleAttachment('first')] },
    ]),
  ).toEqual({ message: 'USER:\n[Attachments: first.png]', attachments: [titleAttachment('first')] })
})

test('truncates both ends without exceeding budget', () => {
  expect(limitTitleMessage('a'.repeat(100) + 'z'.repeat(100), 40)).toBe(
    'a'.repeat(10) + '\n[Content truncated]\n' + 'z'.repeat(9),
  )
  expect(limitTitleMessage('x'.repeat(50), 20)).toBe('')
})

function citation(overrides: Record<string, string> = {}) {
  return `[Assistant quote](t3-citation://v1/env/thread/message?${new URLSearchParams({ text: 'quoted intent', start: '1', end: '14', prefix: '', suffix: '', ...overrides })})`
}

test('normalizes valid citation text and comment before building title context', () => {
  expect(assistantCitationsToPlainText(citation({ comment: 'my constraint' }))).toBe(
    'quoted intent\nComment: my constraint',
  )
  expect(formatSessionTitleContext([{ role: 'user', text: citation() }]).message).toBe(
    'USER:\nquoted intent',
  )
})

const invalidCitations: Record<string, Record<string, string>> = {
  empty: { text: ' ' },
  oversized: { text: 'x'.repeat(8_001) },
  comment: { comment: 'x'.repeat(8_001) },
  reversed: { end: '0' },
  unsafe: { end: '9007199254740992' },
  negative: { start: '-1' },
  prefix: { prefix: 'x'.repeat(33) },
  unknown: { alien: 'value' },
}
for (const [name, overrides] of Object.entries(invalidCitations)) {
  test(`preserves malformed citation: ${name}`, () => {
    const link = citation(overrides)
    expect(assistantCitationsToPlainText(link)).toBe(link)
  })
}

test('preserves duplicate keys, malformed encoding and wrong citation owner', () => {
  for (const link of [
    citation().replace('text=', 'text=duplicate&text='),
    citation().replace('/env/', '/%ZZ/'),
    citation().replace('//v1/', '//evil/'),
    citation().replace('/env/', '//'),
  ])
    expect(assistantCitationsToPlainText(link)).toBe(link)
})
