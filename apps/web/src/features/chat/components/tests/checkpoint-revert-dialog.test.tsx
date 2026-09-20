import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { CheckpointRevertDialog } from '@/features/chat/components/checkpoint-revert-dialog'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('checkpoint zero opens an in-app confirmation with Cancel focused', async () => {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  renderWithProviders(
    <CheckpointRevertDialog
      turnCount={0}
      disabled={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )

  expect(screen.getByRole('alertdialog')).toHaveAccessibleName(
    'Revert this session to checkpoint 0?',
  )
  expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(
    'Newer messages will be removed and the original prompt restored to the composer. Keep your current files, or restore files in an isolated worktree. This cannot be undone.',
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(onConfirm).not.toHaveBeenCalled()
})

test('Escape cancels without reverting', async () => {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  renderWithProviders(
    <CheckpointRevertDialog
      turnCount={3}
      disabled={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )

  await userEvent.keyboard('{Escape}')
  expect(onCancel).toHaveBeenCalledOnce()
  expect(onConfirm).not.toHaveBeenCalled()
})

test('Revert waits while the session is busy and requires an explicit click', async () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const view = renderWithProviders(
    <CheckpointRevertDialog turnCount={2} disabled onCancel={onCancel} onConfirm={onConfirm} />,
  )

  const revert = screen.getByRole('button', { name: 'Rewind conversation only' })
  expect(revert).toBeDisabled()
  await userEvent.click(revert)
  expect(onConfirm).not.toHaveBeenCalled()
  view.rerender(
    <CheckpointRevertDialog
      turnCount={2}
      disabled={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Rewind conversation only' }))
  expect(onConfirm).toHaveBeenCalledWith(false)
  expect(onCancel).not.toHaveBeenCalled()
})
