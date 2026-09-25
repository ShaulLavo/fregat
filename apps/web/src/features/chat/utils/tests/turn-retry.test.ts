import type { ChatSession } from '@workspace/client-core/chat/types'

import { CARRY_ON_PROMPT, carryOnPayload, tryAgainPayload } from '@/features/chat/utils/turn-retry'
import { expect, test } from '../../../../../test/fixtures'

const attachment = {
  id: 'image-1',
  mimeType: 'image/png',
  name: 'shot.png',
  sizeBytes: 10,
  type: 'image',
}

function session(messages: unknown[]) {
  return {
    interactionMode: 'default',
    latestTurn: { turnId: 'turn-2' },
    messages,
    modelSelection: { model: 'gpt-5', providerInstanceId: 'codex' },
    runtimeMode: 'full-access',
  } as unknown as ChatSession
}

test('Carry on sends the fixed continuation prompt with the session settings', () => {
  expect(carryOnPayload(session([]))).toEqual({
    attachments: [],
    interactionMode: 'default',
    modelSelection: { model: 'gpt-5', providerInstanceId: 'codex' },
    runtimeMode: 'full-access',
    terminalContexts: [],
    text: CARRY_ON_PROMPT,
  })
})

test('Try again sends the stopped turn message and its attachments', () => {
  const payload = tryAgainPayload(
    session([
      { attachments: [], role: 'user', text: 'older', turnId: 'turn-1' },
      { attachments: [attachment], role: 'user', text: 'Fix the build', turnId: 'turn-2' },
      { role: 'assistant', text: 'Working on', turnId: 'turn-2' },
    ]),
  )

  expect(payload).toMatchObject({ attachments: [attachment], text: 'Fix the build' })
})

test('Try again is unavailable when the stopped turn has no user message', () => {
  expect(tryAgainPayload(session([{ role: 'user', text: 'older', turnId: 'turn-1' }]))).toBeNull()
})
