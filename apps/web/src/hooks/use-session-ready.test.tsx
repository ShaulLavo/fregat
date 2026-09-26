import { act, renderHook } from '@testing-library/react'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { useSessionReady } from '@/hooks/use-session-ready'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useSessionDetailSyncStore } from '@/features/chat/state/session-detail-sync-store'
import { createChatTransport } from '@/features/chat/transport/create-chat-transport'
import { activeServerOrigin } from '@/lib/client'
import { test, expect } from '../../test/fixtures'
import { session, shellSnapshot, TEST_ENVIRONMENT_ID } from '../../test/factories/chat'
import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'

test('holds the complete loaded subject until selected detail arrives, including rapid selection', ({
  client: _client,
}) => {
  const previous = useChatProjectionStore.getState()
  const previousSync = useSessionDetailSyncStore.getState()
  const alpha = session({ title: 'alpha', detailSynced: true })
  const bravo = session({
    title: 'bravo',
    id: v.parse(sessionIdSchema, 'ba158dd2-aafb-45f7-8d61-f701a86dcd60'),
  })
  const transport = createChatTransport(activeServerOrigin(), {
    createSocket: () => new FakeOrchestrationSocket(),
  })
  const store = useChatProjectionStore.getState()
  store.syncShellSnapshot(
    TEST_ENVIRONMENT_ID,
    shellSnapshot({
      projects: [alpha.project],
      worktrees: [alpha.worktree],
      sessions: [alpha, bravo],
    }),
  )
  store.syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, {
    session: { ...alpha, deletedAt: null, deletion: null },
    snapshotSequence: 1,
    checkpoints: [],
    proposedPlans: [],
  })
  const view = renderHook((next) => useHeldUntilReady(next, useSessionReady(transport, next.id)), {
    initialProps: alpha,
  })
  try {
    expect(view.result.current).toBe(alpha)
    view.rerender(bravo)
    expect(view.result.current).toBe(alpha)
    view.rerender(alpha)
    expect(view.result.current).toBe(alpha)
    view.rerender(bravo)
    act(() =>
      useSessionDetailSyncStore
        .getState()
        .setSessionDetailSync(
          { environmentId: TEST_ENVIRONMENT_ID, sessionId: bravo.id },
          { status: 'blocked', attempt: 1, error: 'Refused' },
        ),
    )
    expect(view.result.current).toBe(bravo)
    act(() =>
      useSessionDetailSyncStore
        .getState()
        .clearSessionDetailSync({ environmentId: TEST_ENVIRONMENT_ID, sessionId: bravo.id }),
    )
    view.rerender(alpha)
    view.rerender(bravo)
    expect(view.result.current).toBe(alpha)
    act(() =>
      store.syncSessionDetailSnapshot(TEST_ENVIRONMENT_ID, {
        session: { ...bravo, deletedAt: null, deletion: null },
        snapshotSequence: 2,
        checkpoints: [],
        proposedPlans: [],
      }),
    )
    expect(view.result.current).toBe(bravo)
  } finally {
    view.unmount()
    transport.close()
    useChatProjectionStore.setState(previous, true)
    useSessionDetailSyncStore.setState(previousSync, true)
  }
})
