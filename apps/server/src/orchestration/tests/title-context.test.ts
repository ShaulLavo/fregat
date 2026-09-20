import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { chatAttachmentSchema } from '@workspace/contracts'
import * as v from 'valibot'
import {
  formatSessionTitleContext,
  limitTitleMessage,
  type SessionTitleMessage,
} from '../title-context'
import { assistantCitationsToPlainText } from '../title-citations'

const reference = fileURLToPath(new URL('../../../../../references/t3code', import.meta.url))
const attachment = (id: string) =>
  v.parse(chatAttachmentSchema, {
    type: 'image',
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 10,
  })
const messages = (count: number, length: number): SessionTitleMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `${index}:first ${'x'.repeat(length)} final:${index}`,
    attachments: [attachment(String(index))],
  }))

test('reserves first intent, recent constraints and four attachment slots', () => {
  const result = formatSessionTitleContext(messages(30, 3_000))
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
      { role: 'user', text: '', attachments: [attachment('first')] },
    ]),
  ).toEqual({ message: 'USER:\n[Attachments: first.png]', attachments: [attachment('first')] })
})

test('truncates both ends without exceeding budget', () => {
  expect(limitTitleMessage('a'.repeat(100) + 'z'.repeat(100), 40)).toBe(
    'a'.repeat(10) + '\n[Content truncated]\n' + 'z'.repeat(9),
  )
  expect(limitTitleMessage('x'.repeat(50), 20)).toBe('')
})

test.skipIf(!existsSync(reference))(
  'matches actual pinned context algorithm for 144 bounded conversations',
  async () => {
    const source = execFileSync(
      'git',
      [
        '-C',
        reference,
        'show',
        '7445aa733ada33e45289e5aa5055f79142556513:apps/server/src/textGeneration/ThreadTitleContext.ts',
      ],
      { encoding: 'utf8' },
    )
    // This corpus has no citation links; citation validation has separate boundary cases below.
    const plainSource = source.replace(
      'import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";',
      'const assistantCitationsToPlainText = (text: string) => text;',
    )
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(plainSource)
    const upstream = await import(
      `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
    )
    for (let count = 0; count < 24; count++) {
      for (const length of [0, 1, 100, 1_999, 2_001, 10_000]) {
        const input = messages(count, length)
        expect(formatSessionTitleContext(input)).toEqual(upstream.formatThreadTitleContext(input))
      }
    }
  },
)

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
