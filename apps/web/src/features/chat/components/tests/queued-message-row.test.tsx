import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { createTurnSubmission } from '@workspace/client-core/chat/commands'
import { QueuedMessageRow } from '../queued-message-row'
import type { QueuedFollowUp } from '../../state/follow-up-store'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { session, TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'

test('uncertain delivery offers an idempotent retry and explains why Restore is unavailable', async () => {
  const message = queuedMessage(true)
  const restore = vi.fn()
  const retry = vi.fn()
  renderWithProviders(
    <QueuedMessageRow message={message} disabled={false} onSendNow={retry} onRestore={restore} />,
  )
  expect(screen.getByText('Delivery unconfirmed')).toBeInTheDocument()
  const restoreButton = screen.getByRole('button', { name: 'Restore queued message' })
  expect(restoreButton).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(restoreButton)
  expect(restore).not.toHaveBeenCalled()
  await userEvent.hover(restoreButton)
  expect(
    await screen.findByText(
      'Retry delivery to confirm whether this message was sent before restoring it.',
    ),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry queued message delivery' }))
  expect(retry).toHaveBeenCalledExactlyOnceWith(message.id)
})

test('an ordinary queued message retains Send now and can return to the composer', async () => {
  const message = queuedMessage(false)
  const restore = vi.fn()
  renderWithProviders(
    <QueuedMessageRow
      message={message}
      disabled={false}
      onSendNow={() => {}}
      onRestore={restore}
    />,
  )
  expect(screen.getByRole('button', { name: 'Send queued message now' })).toHaveTextContent(
    'Send now',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Restore queued message' }))
  expect(restore).toHaveBeenCalledExactlyOnceWith(message.id)
})

function queuedMessage(uncertain: boolean): QueuedFollowUp {
  const running = session()
  const payload = {
    text: 'Follow-up',
    attachments: [],
    terminalContexts: [],
    interactionMode: running.interactionMode,
    runtimeMode: running.runtimeMode,
    modelSelection: running.modelSelection,
  }
  return {
    id: 'queued-message',
    target: { environmentId: TEST_ENVIRONMENT_ID, draftKey: running.id, rootPath: '/repo' },
    payload,
    content: { prompt: payload.text, attachments: [], terminalContexts: [] },
    afterToolActivityId: null,
    held: uncertain,
    submission: uncertain
      ? createTurnSubmission({
          ...payload,
          sessionId: running.id,
          createdAt: new Date().toISOString(),
        })
      : null,
  }
}
