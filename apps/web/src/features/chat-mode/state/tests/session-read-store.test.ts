import { environmentIdSchema, scopedSessionKey } from '@workspace/contracts'
import * as v from 'valibot'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { TEST_ENVIRONMENT_ID, TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

const first = { environmentId: TEST_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }
const second = {
  environmentId: v.parse(environmentIdSchema, 'e0000000-0000-4000-8000-000000000001'),
  sessionId: TEST_SESSION_ID,
}
const completedAt = '2026-09-20T12:00:00.000Z'

test('visits stay monotonic and manual unread affects only its environment', () => {
  const previous = useSessionReadStore.getState().seenBySessionKey
  try {
    useSessionReadStore.setState({ seenBySessionKey: {} })
    const reads = useSessionReadStore.getState()
    reads.markSeen(first, completedAt)
    reads.markSeen(second, completedAt)
    reads.markSeen(first, '2026-09-20T11:00:00.000Z')
    expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(first)]).toBe(
      completedAt,
    )
    reads.markUnread(first, completedAt)
    expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(first)]).toBe(
      '2026-09-20T11:59:59.999Z',
    )
    expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(second)]).toBe(
      completedAt,
    )
    reads.markSeen(first, completedAt)
    expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(first)]).toBe(
      completedAt,
    )
  } finally {
    useSessionReadStore.setState({ seenBySessionKey: previous })
  }
})
