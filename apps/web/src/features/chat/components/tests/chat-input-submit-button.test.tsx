import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { ChatInputSubmitButton } from '@/features/chat/components/chat-input-submit-button'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('sending replaces the arrow with a disabled progress control', () => {
  renderWithProviders(
    <ChatInputSubmitButton
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
  expect(button).toBeDisabled()
  expect(button.querySelector('.animate-spin')).not.toBeNull()
})

test('a starting turn remains stoppable when the session is busy', async () => {
  const stop = vi.fn()
  renderWithProviders(
    <ChatInputSubmitButton
      busy
      disabled={false}
      disabledReason={null}
      pendingAction='starting'
      sendDisabled
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
      busy
      disabled={false}
      disabledReason={null}
      pendingAction='stopping'
      sendDisabled={false}
      onStop={() => {}}
      onSubmit={async () => true}
    />,
  )

  expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled()
})

test('an unavailable connection explains why stop is disabled', () => {
  renderWithProviders(
    <ChatInputSubmitButton
      busy
      disabled={false}
      disabledReason='Reconnecting chat…'
      pendingAction={null}
      sendDisabled={false}
      onStop={() => {}}
      onSubmit={async () => true}
    />,
  )

  expect(screen.getByRole('button', { name: 'Reconnecting chat…' })).toBeDisabled()
})
