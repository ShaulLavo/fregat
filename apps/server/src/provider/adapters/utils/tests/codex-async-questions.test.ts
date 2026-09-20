import { expect, it } from 'vitest'
import { codexAsyncQuestions } from '../codex-async-questions'

it('normalizes Codex async assistant questions with stable index IDs and optional custom answers', () => {
  const item = {
    type: 'agentMessage',
    delivery: 'async',
    id: 'native-message-1',
    questions: [
      { title: 'Choose a target', options: ['Web', 'Native'] },
      { title: 'Any constraints?', options: null },
    ],
  }
  const normalized = codexAsyncQuestions(item)
  expect(normalized).toEqual({
    itemId: 'native-message-1',
    questions: [
      {
        id: '0',
        header: 'Question',
        prompt: 'Choose a target',
        answerKind: 'single-select',
        options: [
          { value: 'Web', label: 'Web' },
          { value: 'Native', label: 'Native' },
        ],
        allowOther: true,
        secret: false,
      },
      {
        id: '1',
        header: 'Question',
        prompt: 'Any constraints?',
        answerKind: 'text',
        options: [],
        allowOther: true,
        secret: false,
      },
    ],
  })
  expect(codexAsyncQuestions(item)).toEqual(normalized)
})

it('leaves ordinary assistant text, empty questions and malformed questions outside this path', () => {
  expect(codexAsyncQuestions({ type: 'agentMessage', id: 'ordinary', text: 'Hello' })).toBeNull()
  expect(
    codexAsyncQuestions({ type: 'agentMessage', delivery: 'async', id: 'empty', questions: [] }),
  ).toBeNull()
  expect(
    codexAsyncQuestions({
      type: 'agentMessage',
      delivery: 'async',
      id: 'malformed',
      questions: [{ title: 7 }],
    }),
  ).toBeNull()
})
