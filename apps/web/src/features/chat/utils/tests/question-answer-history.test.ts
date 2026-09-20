import {
  questionAnswerHistory,
  questionAnswerHistoryEqual,
  questionAnswerText,
} from '../question-answer-history'
import { expect, test } from '../../../../../test/fixtures'

const file = { type: 'file', id: 'spec', name: 'spec.txt', mimeType: 'text/plain', sizeBytes: 3 }
const payload = {
  questionTextById: { first: 'First question', last: 'Last question' },
  answers: { first: ['one', { answers: ['two'] }] },
  attachmentsByQuestionId: { last: [file] },
}

test('matches pinned ordering and recursive answer text', () => {
  const rows = questionAnswerHistory(payload)
  expect(rows.map((row) => [row.id, row.question, row.answer])).toEqual([
    ['first', 'First question', 'one, two'],
    ['last', 'Last question', ''],
  ])
  expect(rows[1]?.attachments).toEqual([file])
  expect(questionAnswerText({ unsupported: 'ignored' })).toBe('')
  expect(questionAnswerHistory({ answers: null })).toEqual([])
})

test('structural sharing notices edits to answers and attachment metadata', () => {
  const rows = questionAnswerHistory(payload)
  expect(questionAnswerHistoryEqual(rows, questionAnswerHistory(structuredClone(payload)))).toBe(
    true,
  )
  expect(
    questionAnswerHistoryEqual(
      rows,
      questionAnswerHistory({ ...payload, answers: { first: 'changed' } }),
    ),
  ).toBe(false)
  expect(
    questionAnswerHistoryEqual(
      rows,
      questionAnswerHistory({
        ...payload,
        attachmentsByQuestionId: { last: [{ ...file, name: 'renamed.txt' }] },
      }),
    ),
  ).toBe(false)
})
