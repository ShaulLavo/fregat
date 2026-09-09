import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  sessionIdSchema,
  type SessionRuntimeState,
  type SessionRuntimeStatus,
} from '@workspace/contracts'
import * as v from 'valibot'

import { isBusyChatSession } from '@workspace/client-core/chat/session-busy'

describe('chat session status', () => {
  it('treats starting, running and waiting sessions as busy', () => {
    expect(isBusyChatSession(makeSession('starting'))).toBe(true)
    expect(isBusyChatSession(makeSession('running'))).toBe(true)
    expect(isBusyChatSession(makeSession('waiting'))).toBe(true)
    expect(isBusyChatSession(makeSession('ready'))).toBe(false)
    expect(isBusyChatSession(makeSession('interrupted'))).toBe(false)
    expect(isBusyChatSession(makeSession('stopped'))).toBe(false)
    expect(isBusyChatSession(makeSession('error'))).toBe(false)
  })
})

function makeSession(status: SessionRuntimeStatus): SessionRuntimeState {
  return {
    providerResumeCursor: null,
    providerConversationMarker: null,
    runtimeEpoch: 'test-epoch',
    activeTurnId: null,
    lastError: status === 'error' ? 'failed' : null,
    providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    providerName: 'Codex',
    providerBindingHandle: null,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    status,
    sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    updatedAt: '2026-05-28T00:00:00.000Z',
  }
}
