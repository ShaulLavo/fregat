import {
  AGENT_REVIEW_OUTPUT_SCHEMA,
  DEFAULT_PROVIDER_INSTANCE_ID,
  sessionIdSchema,
  turnIdSchema,
} from '@workspace/contracts'
import * as v from 'valibot'
import { expect, it } from 'vitest'

import { readReviewOutput } from '../../review/utils/findings'
import { ProviderTextGenerationTask } from '../text-generation'

const sessionId = v.parse(sessionIdSchema, '11111111-1111-4111-8111-111111111111')
const turnId = v.parse(turnIdSchema, '22222222-2222-4222-8222-222222222222')
const base = {
  createdAt: '2026-09-26T00:00:00.000Z',
  eventId: 'fixture',
  runtimeEpoch: 'fixture',
  sessionId,
  turnId,
}
const output = {
  findings: [],
  overall_correctness: 'patch is correct',
  overall_explanation: 'No bugs found.',
}

it.each([false, true])('reads the final JSON with preceding commentary: %s', (commentary) => {
  const task = new ProviderTextGenerationTask({
    interrupt: async () => {},
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    purpose: 'review',
    sessionId,
    turnId,
    outputSchema: AGENT_REVIEW_OUTPUT_SCHEMA,
  })
  const messages = commentary
    ? ['I will inspect the diff first.', JSON.stringify(output)]
    : [JSON.stringify(output)]
  for (const [index, text] of messages.entries()) {
    task.accept({
      ...base,
      itemId: String(index),
      type: 'content.delta',
      payload: { streamKind: 'assistant_text', delta: text },
    })
    task.accept({
      ...base,
      itemId: String(index),
      type: 'item.completed',
      payload: { itemType: 'assistant_message', detail: text },
    })
  }
  task.accept({ ...base, type: 'turn.completed', payload: { state: 'completed' } })
  task.accept({
    ...base,
    completedAt: base.createdAt,
    messageId: 'turn-message',
    type: 'assistant.complete',
  })
  const result = task.outcome()
  expect(result.text).toBe(JSON.stringify(output))
  expect(readReviewOutput(result.structured, result.text)).toEqual(output)
})

it('does not treat an unfinished stream as a structured answer', () => {
  const task = new ProviderTextGenerationTask({
    interrupt: async () => {},
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    purpose: 'review',
    sessionId,
    turnId,
    outputSchema: AGENT_REVIEW_OUTPUT_SCHEMA,
  })
  task.accept({
    ...base,
    type: 'content.delta',
    payload: { streamKind: 'assistant_text', delta: JSON.stringify(output) },
  })
  task.accept({ ...base, type: 'turn.completed', payload: { state: 'completed' } })
  expect(readReviewOutput(task.outcome().structured, task.outcome().text)).toBeNull()
})

it('uses the provider output-schema result independently of streamed commentary', () => {
  const task = new ProviderTextGenerationTask({
    interrupt: async () => {},
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    purpose: 'review',
    sessionId,
    turnId,
    outputSchema: AGENT_REVIEW_OUTPUT_SCHEMA,
  })
  task.accept({
    ...base,
    type: 'content.delta',
    payload: { streamKind: 'assistant_text', delta: 'I will inspect the diff first.' },
  })
  task.accept({ ...base, type: 'turn.structured-output', payload: { value: output } })
  expect(readReviewOutput(task.outcome().structured, task.outcome().text)).toEqual(output)
})

it('uses only the final completed canonical message for structured generation', () => {
  const task = new ProviderTextGenerationTask({
    interrupt: async () => {},
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    purpose: 'review',
    sessionId,
    turnId,
    outputSchema: AGENT_REVIEW_OUTPUT_SCHEMA,
  })
  for (const [index, text] of [
    'I will inspect the diff first.',
    JSON.stringify(output),
  ].entries()) {
    const messageId = String(index)
    task.accept({ ...base, messageId, type: 'assistant.delta', delta: text.slice(0, 10) })
    task.accept({ ...base, messageId, type: 'assistant.delta', delta: text.slice(10) })
    task.accept({ ...base, messageId, completedAt: base.createdAt, type: 'assistant.complete' })
  }
  expect(task.outcome().text).toBe(JSON.stringify(output))
})
