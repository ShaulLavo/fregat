import { act, waitFor } from '@testing-library/react'
import { test, expect } from '../../../../test/fixtures'
import { createRailHarness } from '../../../../test/factories/rail-harness'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { renderHookWithProviders } from '../../../../test/render'
import { recordHistoryWrites, waitForNavigation } from '../../../../test/address'
import { useActiveChatSessionId } from '@/features/chat/hooks/use-active-chat-session-id'

test('draft promotion at the environment root replaces the sidebar draft destination', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server, ['Created session'], '')
  const navigation = createTestNavigation({ application: harness.application })
  const hook = renderHookWithProviders(
    () =>
      useActiveChatSessionId({
        environmentId: harness.environmentId,
        projectId: harness.projectId,
        sessionIds: harness.sessionIds,
      }),
    {
      application: harness.application,
      navigation,
      queryClient: harness.application.getSnapshot().queryClient,
    },
  )
  try {
    await waitForNavigation(navigation)
    expect(
      harness.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path,
    ).toBe('')
    expect(
      await navigation.openChat({
        environmentId: harness.environmentId,
        projectId: harness.projectId,
        sessionId: null,
        surface: 'sidebar',
      }),
    ).toEqual({ status: 'applied' })
    await waitFor(() => expect(hook.result.current.activeSessionId).toBeNull())
    const writes = recordHistoryWrites(navigation)
    const sessionId = harness.sessionIds[0]
    if (!sessionId) return expect.unreachable('fixture session is missing')
    act(() => hook.result.current.promoteDraftSession(sessionId))
    await waitFor(() => expect(navigation.currentAddress().chat).toBe(`t/${sessionId}`))
    await waitForNavigation(navigation)
    expect(writes.pushes).toHaveLength(0)
    expect(writes.replaces).toHaveLength(1)
    writes.restore()
  } finally {
    hook.unmount()
    navigation.dispose()
  }
})
