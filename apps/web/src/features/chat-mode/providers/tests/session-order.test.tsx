import { useSessions } from '@/features/command-palette/hooks/use-sessions'
import { readSettings } from '@workspace/client-core/settings/read'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { useContext } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { createSessionPlaceCommand } from '@workspace/client-core/chat/commands'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { ChatModeSessionController } from '@/features/chat-mode/providers/session-controller'
import { ChatModeSessionContext } from '@/features/chat-mode/providers/session-context'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { sessionDeletion } from '@/features/chat-mode/state/removal'
import { activeProjectSession } from '@/features/chat-mode/utils/active-session'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { renderWithProviders, renderHookWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

function SelectedSession() {
  const context = useContext(ChatModeSessionContext)
  return <output aria-label='Selected session'>{context?.activeSession.sessionId}</output>
}

test('project auto-pick, mounted stage and removal successor use pin priority and identity ties', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server, [
    'Older pin',
    'Newer pin',
    'Newest unpinned',
  ])
  const [first, second] = harness.sessionIds
  expect(first).toBeDefined()
  expect(second).toBeDefined()
  await harness.dispatch(createSessionPlaceCommand({ sessionId: first!, orderKey: 'b' }))
  await harness.dispatch(createSessionPlaceCommand({ sessionId: second!, orderKey: 'b' }))
  await harness.refresh()
  useSessionSelectionStore.setState({ selection: { kind: 'auto' }, restored: false })
  const slice = useChatProjectionStore.getState().slices[harness.environmentId]!
  expect(
    activeProjectSession({
      slice,
      projectId: harness.projectId,
      environmentId: harness.environmentId,
      selection: { kind: 'auto' },
    }),
  ).toEqual({ status: 'auto', sessionId: first })
  expect(
    sessionDeletion({ environmentId: harness.environmentId, sessionId: first! })
      ?.successorSessionId,
  ).toBe(second)
  renderWithProviders(
    <EditorStateProvider runtime={harness.application.getSnapshot().editor}>
      <ChatTransportContext value={harness.context.transport}>
        <ChatModeSessionController editorRootPath={harness.context.worktree!.path}>
          <SelectedSession />
        </ChatModeSessionController>
      </ChatTransportContext>
    </EditorStateProvider>,
    {
      application: harness.application,
      queryClient: harness.application.getSnapshot().queryClient,
    },
  )
  await waitFor(() => expect(screen.getByLabelText('Selected session')).toHaveTextContent(first!))
})

test.for(['created_at', 'updated_at'] as const)(
  'palette and deletion consume configured %s order independently of shelf pins',
  async (sortOrder, { client, server }) => {
    const harness = await createRailHarness(client, server, [
      'Older pin',
      'Newer pin',
      'Newest unpinned',
    ])
    const [first, second, third] = harness.sessionIds
    await harness.dispatch(createSessionPlaceCommand({ sessionId: first!, orderKey: 'b' }))
    await harness.dispatch(createSessionPlaceCommand({ sessionId: second!, orderKey: 'c' }))
    await harness.refresh()
    const write = await client.settings.write.post({
      mutationId: crypto.randomUUID(),
      target: 'user',
      operations: [{ kind: 'set', key: 'chat.sessionSortOrder', value: sortOrder }],
    })
    expect(write.error).toBeNull()
    const hook = renderHookWithProviders(() => useSessions(), {
      application: harness.application,
      queryClient: harness.application.getSnapshot().queryClient,
    })
    const expected = sortOrder === 'created_at' ? third : second
    await waitFor(() => expect(hook.result.current.sessions[0]?.id).toBe(expected))
    const snapshot = await readSettings({ client })
    writeBootMirror(snapshot.values, snapshot.layers)
    expect(
      sessionDeletion({ environmentId: harness.environmentId, sessionId: first! })
        ?.successorSessionId,
    ).toBe(expected)
  },
)
