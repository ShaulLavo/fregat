import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClientOrchestrationCommand, SessionId } from '@workspace/contracts'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { renderChatDraft } from '../../../../test/factories/chat-view'
import { useChatInputDraftStore } from '@/features/chat/state/chat-input-draft-store'
import { createWorktreeLifecycleHarness } from '../../../../test/factories/worktree-lifecycle'
import { expect, test } from '../../../../test/fixtures'

test('typing while a send is in flight survives it, and a later unchanged send still clears the draft', async ({
  client,
  server,
}) => {
  const harness = await createWorktreeLifecycleHarness(client, server)
  const base = await harness.worktree()
  const project = (await harness.refresh()).projects.find(
    (project) => project.id === harness.projectId,
  )!
  const draftTarget = {
    environmentId: harness.environmentId,
    draftKey: crypto.randomUUID(),
    rootPath: base.path,
  }
  const drafts = useChatInputDraftStore.getState()
  drafts.setPrompt(draftTarget, 'First message')
  drafts.setModelSelection(draftTarget, {
    model: 'mock-model',
    providerInstanceId: server.providerAdapter.adapterKey,
  })

  // Holds the bootstrap command open so a store write can land while `handleSend`
  // is still awaiting it, the same window a real worktree-creation round trip has.
  let gate: ReturnType<typeof Promise.withResolvers<void>> | null = null
  const transport: ChatTransport = {
    ...harness.context.transport,
    dispatchCommand: async (command: ClientOrchestrationCommand) => {
      if (gate && command.type === 'session.turn.start') {
        const held = gate
        gate = null
        await held.promise
      }
      return harness.context.transport.dispatchCommand(command)
    },
  }

  const created: SessionId[] = []
  const draft = renderChatDraft({
    draftId: draftTarget.draftKey,
    disabled: false,
    transport,
    project,
    worktree: base,
    rootPath: base.path,
    onSessionCreated: (id) => created.push(id),
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())

  gate = Promise.withResolvers<void>()
  const held = gate
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(gate).toBeNull())
  // The composer's own editable disables while a send is in flight, so this reaches
  // for the store directly, the same way the mid-send edit in
  // chat-input-submit-ownership.test.tsx does.
  act(() => useChatInputDraftStore.getState().setPrompt(draftTarget, 'Second message'))
  held.resolve()
  await waitFor(() => expect(created).toHaveLength(1))
  expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe('Second message')
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent('Second message'),
  )

  // A second send with nothing typed in flight still has to leave the draft empty —
  // the leftover-draft bug this file's sibling scenario (chat-draft-sent-leftover)
  // covers end to end.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(created).toHaveLength(2))
  expect(useChatInputDraftStore.getState().getDraft(draftTarget).prompt).toBe('')
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent(''),
  )
  draft.unmount()
})
