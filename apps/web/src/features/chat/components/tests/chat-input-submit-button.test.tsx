import { Profiler } from 'react'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, vi } from 'vitest'

import { ChatInputSubmitButton } from '@/features/chat/components/chat-input-submit-button'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import {
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '../../state/chat-input-draft-store'

const draftTarget = {
  environmentId: TEST_ENVIRONMENT_ID,
  draftKey: 'send-test',
  rootPath: '/garden',
}
beforeEach(() => {
  resetChatInputDraftStore()
  useChatInputDraftStore.getState().setPrompt(draftTarget, 'A garden question')
})

test('an empty draft enables a working Send once, without rerendering for further characters', async () => {
  const sent = vi.fn(async () => true)
  let commits = 0
  useChatInputDraftStore.getState().setPrompt(draftTarget, '')
  renderWithProviders(
    <Profiler
      id='send'
      onRender={() => {
        commits += 1
      }}
    >
      <ChatInputSubmitButton
        draftTarget={draftTarget}
        busy={false}
        disabled={false}
        disabledReason={null}
        pendingAction={null}
        sendDisabled={false}
        onStop={() => {}}
        onSubmit={sent}
      />
    </Profiler>,
  )
  const button = screen.getByRole('button', { name: 'Send message' })
  expect(button).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(button)
  await userEvent.keyboard('{Enter}')
  expect(sent).not.toHaveBeenCalled()
  act(() => useChatInputDraftStore.getState().setPrompt(draftTarget, 'H'))
  expect(button).not.toHaveAttribute('aria-disabled', 'true')
  const contentCommits = commits
  act(() => useChatInputDraftStore.getState().setPrompt(draftTarget, 'How does the garden work?'))
  expect(commits).toBe(contentCommits)
  await userEvent.click(button)
  expect(sent).toHaveBeenCalledOnce()
  act(() => useChatInputDraftStore.getState().clearDraft(draftTarget))
  expect(button).toHaveAttribute('aria-disabled', 'true')
})

test('sending replaces the arrow with a disabled progress control', () => {
  renderWithProviders(
    <ChatInputSubmitButton
      draftTarget={draftTarget}
      busy={false}
      disabled={false}
      disabledReason={null}
      pendingAction='sending'
      sendDisabled={false}
      onStop={() => {}}
      onSubmit={async () => true}
    />,
  )

  const button = screen.getByRole('button', { name: 'Sending…' })
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button.querySelector('.animate-spin')).not.toBeNull()
})

test('a starting turn remains stoppable when the session is busy', async () => {
  const stop = vi.fn()
  renderWithProviders(
    <ChatInputSubmitButton
      draftTarget={draftTarget}
      busy
      disabled={false}
      disabledReason={null}
      pendingAction='starting'
      sendDisabled={false}
      onStop={stop}
      onSubmit={async () => true}
    />,
  )

  await userEvent.click(screen.getByRole('button', { name: 'Stop current turn' }))
  expect(stop).toHaveBeenCalledOnce()
})

test('stopping stays disabled instead of inviting a second stop', () => {
  renderWithProviders(
    <ChatInputSubmitButton
      draftTarget={draftTarget}
      busy
      disabled={false}
      disabledReason={null}
      pendingAction='stopping'
      sendDisabled={false}
      onStop={() => {}}
      onSubmit={async () => true}
    />,
  )

  expect(screen.getByRole('button', { name: 'Stopping…' })).toHaveAttribute('aria-disabled', 'true')
})

test('an unavailable connection explains why stop is disabled', () => {
  renderWithProviders(
    <ChatInputSubmitButton
      draftTarget={draftTarget}
      busy
      disabled={false}
      disabledReason='Reconnecting chat…'
      pendingAction={null}
      sendDisabled={false}
      onStop={() => {}}
      onSubmit={async () => true}
    />,
  )

  expect(screen.getByRole('button', { name: 'Reconnecting chat…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('a running turn can receive a correction while Stop remains available', async () => {
  const sent = vi.fn(async () => true)
  const stop = vi.fn()
  renderWithProviders(
    <ChatInputSubmitButton
      draftTarget={draftTarget}
      busy
      disabled={false}
      disabledReason={null}
      pendingAction={null}
      sendDisabled={false}
      onStop={stop}
      onSubmit={sent}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send correction' }))
  expect(sent).toHaveBeenCalledOnce()
  expect(stop).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Stop current turn' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})
