import { act, waitFor } from '@testing-library/react'
import * as v from 'valibot'
import { environmentIdSchema, sessionIdSchema } from '@workspace/contracts'
import { useSessionGoal } from '@/features/chat/hooks/use-session-goal'
import { sessionGoalKeys } from '@/features/chat/utils/query-keys'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { test, expect } from '../../../../../test/fixtures'
import {
  session,
  shellSnapshot,
  TEST_ENVIRONMENT_ID,
  TEST_SESSION_ID,
} from '../../../../../test/factories/chat'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'

test('goal placeholders stay with their session and environment across turn changes', async ({
  client: _client,
}) => {
  const previous = useChatProjectionStore.getState()
  const ref = { environmentId: TEST_ENVIRONMENT_ID, sessionId: TEST_SESSION_ID }
  const queryClient = createTestQueryClient()
  queryClient.setQueryDefaults(['chat', 'session-goal'], { enabled: false })
  const goal = {
    ...ref,
    goal: {
      objective: 'Finish alpha',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 12,
      timeUsedSeconds: null,
      iterations: null,
      lastReason: null,
    },
    controllable: true,
  }
  queryClient.setQueryData(sessionGoalKeys.state(ref.environmentId, ref.sessionId, 'none'), goal)
  const view = renderHookWithProviders(useSessionGoal, { initialProps: ref, queryClient })
  try {
    await waitFor(() => expect(view.result.current.data).toEqual(goal))
    const current = session()
    act(() =>
      useChatProjectionStore.getState().syncShellSnapshot(
        TEST_ENVIRONMENT_ID,
        shellSnapshot({
          projects: [current.project],
          worktrees: [current.worktree],
          sessions: [current],
        }),
      ),
    )
    await waitFor(() => expect(view.result.current.isPlaceholderData).toBe(true))
    expect(view.result.current.data).toEqual(goal)
    view.rerender({
      ...ref,
      sessionId: v.parse(sessionIdSchema, 'ba158dd2-aafb-45f7-8d61-f701a86dcd60'),
    })
    expect(view.result.current.data).toBeUndefined()
    view.rerender(ref)
    expect(view.result.current.data).toEqual(goal)
    view.rerender({
      ...ref,
      environmentId: v.parse(environmentIdSchema, '838f8686-2502-4f5a-9023-e32c8a903e50'),
    })
    expect(view.result.current.data).toBeUndefined()
  } finally {
    view.unmount()
    queryClient.clear()
    useChatProjectionStore.setState(previous, true)
  }
})
