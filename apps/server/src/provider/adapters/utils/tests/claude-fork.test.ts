import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, test } from 'vitest'
import { claudeForkPoint } from '../claude-fork'

const sourceSessionId = v.parse(sessionIdSchema, '5b2b1c8e-4b5a-4d8a-9d0e-8a7c1a2b3c4d')
const history = [
  { createdAt: null, role: 'user' as const, sourceId: 'u1', text: 'First' },
  { createdAt: null, role: 'assistant' as const, sourceId: 'a1', text: 'One' },
  { createdAt: null, role: 'assistant' as const, sourceId: 'a1b', text: 'One, continued' },
  { createdAt: null, role: 'user' as const, sourceId: 'u2', text: 'Second' },
  { createdAt: null, role: 'assistant' as const, sourceId: 'a2', text: 'Two' },
  { createdAt: null, role: 'user' as const, sourceId: 'u3', text: 'Third' },
  { createdAt: null, role: 'assistant' as const, sourceId: 'a3', text: 'Three' },
]

test.each([
  [2, 'a2'],
  [1, 'a1b'],
  [3, 'a3'],
])('keeping %i prompts ends at %s', (keptPrompts, entry) => {
  expect(claudeForkPoint(history, { keptPrompts, sessionId: sourceSessionId })).toBe(entry)
})

test('a transcript with fewer prompts than the session shows has no fork point', () => {
  expect(() => claudeForkPoint(history, { keptPrompts: 4, sessionId: sourceSessionId })).toThrow(
    'The fork point is not in the source conversation',
  )
})
