import { act, waitFor } from '@testing-library/react'
import { scopedSessionKey } from '@workspace/contracts'
import { useMarkSessionSeen } from '@/features/chat-mode/hooks/use-mark-session-seen'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { TEST_SESSION_ID, TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { renderHookWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

const ref = { sessionId: TEST_SESSION_ID, environmentId: TEST_ENVIRONMENT_ID }
const completion = '2026-09-20T12:00:00.000Z'
const initialVisit = '2026-09-20T11:00:00.000Z'

test('background completion stays unread until visible and manual unread waits for engagement', async () => {
  const previous = useSessionReadStore.getState().seenBySessionKey
  const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  try {
    useSessionReadStore.setState({ seenBySessionKey: {} })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    const hook = renderHookWithProviders(
      ({ stamp }) => useMarkSessionSeen(TEST_SESSION_ID, stamp),
      { initialProps: { stamp: initialVisit } },
    )
    await waitFor(() =>
      expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(ref)]).toBe(
        initialVisit,
      ),
    )
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    hook.rerender({ stamp: completion })
    expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(ref)]).toBe(
      initialVisit,
    )
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() =>
      expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(ref)]).toBe(
        completion,
      ),
    )
    act(() => useSessionReadStore.getState().markUnread(ref, completion))
    hook.rerender({ stamp: completion })
    expect(useSessionReadStore.getState().seenBySessionKey[scopedSessionKey(ref)]).toBe(
      '2026-09-20T11:59:59.999Z',
    )
    hook.unmount()
  } finally {
    if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor)
    else Reflect.deleteProperty(document, 'visibilityState')
    useSessionReadStore.setState({ seenBySessionKey: previous })
  }
})
