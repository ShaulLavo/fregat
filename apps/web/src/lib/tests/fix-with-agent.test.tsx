import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import { waitFor } from '@testing-library/react'

import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { canOpenAgentChat, fixWithAgent } from '@/lib/fix-with-agent'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../test/factories/federation'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

test('opens a new chat draft in the workspace on screen, titled by the surface that showed it', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await registerFederatedProject(h.serverA, h.clientA, 'A')
  await h.application.openEnvironmentWorkspaceRoot(h.descriptorA.environmentId, 'repo')
  renderWithProviders(<div />, { application: h.application, connections: h.connections })
  await waitFor(() =>
    expect(
      selectWorktreeAtPath(
        selectChatProjectionSlice(useChatProjectionStore.getState(), h.descriptorA.environmentId),
        'repo',
      ),
    ).toBeDefined(),
  )
  expect(canOpenAgentChat()).toBe(true)

  await expect(
    fixWithAgent({
      message: 'The server uses an incompatible protocol version.',
      title: 'Connect machine',
    }),
  ).resolves.toBe('chat')

  const drafts = Object.values(useChatInputDraftStore.getState().draftsByKey)
  const draft = drafts.find((entry) => entry.prompt.includes('title: Connect machine'))
  expect(draft?.identity?.rootPath).toBe('repo')
  expect(draft?.prompt).toContain('message: The server uses an incompatible protocol version.')
  expect(draft?.prompt).toContain('logs: bun run logs --since')
})

test('with no workspace open it keeps the report out of chat', async ({ server }) => {
  const h = await createFederationHarness(server)
  renderWithProviders(<div />, { application: h.application, connections: h.connections })
  const draftsBefore = Object.keys(useChatInputDraftStore.getState().draftsByKey)

  expect(canOpenAgentChat()).toBe(false)
  await expect(fixWithAgent({ message: 'boom' })).resolves.not.toBe('chat')
  expect(Object.keys(useChatInputDraftStore.getState().draftsByKey)).toEqual(draftsBefore)
})
