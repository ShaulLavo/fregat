import type { ClientOrchestrationCommand } from '@workspace/contracts'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { StageEmptyState } from '@/features/chat-mode/components/stage-empty-state'
import {
  ChatModeSessionContext,
  type ChatModeSession,
} from '@/features/chat-mode/providers/session-context'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('a failed first run says so and offers a retry', async () => {
  const calls = renderEmptyState({ error: 'Could not prepare chat for this workspace.' })

  expect(screen.getByRole('heading', { name: 'Chat could not open this folder' })).toBeVisible()
  expect(screen.getByText('Could not prepare chat for this workspace.')).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(calls.retries).toBe(1)
})

test('a first run still in progress explains itself instead of showing a dead composer', () => {
  renderEmptyState({})

  expect(screen.getByRole('heading', { name: 'Setting up chat' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('a retry already in flight cannot be fired twice', () => {
  renderEmptyState({ retrying: true })

  expect(screen.getByRole('button', { name: 'Trying…' })).toBeDisabled()
})

test('with no folder open it offers the picker rather than a retry', async () => {
  const calls = renderEmptyState({ rootPath: '' })

  expect(screen.getByRole('heading', { name: 'No folder open' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

  await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))

  expect(calls.addProjectCount).toBe(1)
})

function renderEmptyState({
  error = null,
  retrying = false,
  rootPath = '/repo/platform',
}: {
  error?: string | null
  retrying?: boolean
  rootPath?: string
}) {
  const calls = { addProjectCount: 0, retries: 0 }
  const session: ChatModeSession = {
    activeSession: { status: 'auto', sessionId: null },
    addProject: () => {
      calls.addProjectCount += 1
    },
    transport: {
      dispatchCommand: async (_command: ClientOrchestrationCommand) => ({
        deduped: false,
        sequence: 1,
      }),
    } as ChatTransport,
    error,
    project: null,
    worktree: null,
    ready: false,
    retrying,
    retryProject: () => {
      calls.retries += 1
    },
    rootPath,
  }

  renderWithProviders(
    <ChatModeSessionContext value={session}>
      <StageEmptyState />
    </ChatModeSessionContext>,
  )

  return calls
}
