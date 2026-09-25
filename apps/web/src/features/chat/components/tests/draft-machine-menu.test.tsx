import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import { DraftMachineMenu } from '@/features/chat/components/draft-machine-menu'
import type { DraftMachine } from '@/features/chat/utils/draft-workspace'
import {
  fixtureEnvironmentId,
  TEST_ENVIRONMENT_ID,
  TEST_PROJECT_ID,
  TEST_WORKTREE_ID,
} from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const here: DraftMachine = {
  environmentId: TEST_ENVIRONMENT_ID,
  projectId: TEST_PROJECT_ID,
  label: 'omarchy',
  phase: 'live',
  worktree: { id: TEST_WORKTREE_ID, path: 'work/projects/platform' },
}
const mac: DraftMachine = { ...here, environmentId: fixtureEnvironmentId(2), label: 'mac' }
const offline: DraftMachine = {
  ...here,
  environmentId: fixtureEnvironmentId(3),
  label: 'box',
  phase: 'offline',
}

function renderMenu(lockedReason: string | null = null) {
  const onSelect = vi.fn()
  renderWithProviders(
    <DraftMachineMenu
      environmentId={TEST_ENVIRONMENT_ID}
      lockedReason={lockedReason}
      machines={[here, mac, offline]}
      pending={false}
      onSelect={onSelect}
    />,
  )
  return onSelect
}

test('one machine shows no control at all', () => {
  renderWithProviders(
    <DraftMachineMenu
      environmentId={TEST_ENVIRONMENT_ID}
      lockedReason={null}
      machines={[here]}
      pending={false}
      onSelect={() => {}}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Machine' })).toBeNull()
})

test('a live machine can be picked; an offline one cannot', async () => {
  const onSelect = renderMenu()
  expect(screen.getByRole('button', { name: 'Machine' })).toHaveTextContent('omarchy')
  await userEvent.click(screen.getByRole('button', { name: 'Machine' }))

  expect(await screen.findByRole('menuitemradio', { name: /box/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await userEvent.click(screen.getByRole('menuitemradio', { name: /mac/ }))
  expect(onSelect).toHaveBeenCalledWith(mac)
})

test('a draft holding machine-local content says why it cannot move', async () => {
  renderMenu('Attachments stay on this machine.')
  await userEvent.click(screen.getByRole('button', { name: 'Machine' }))

  expect(await screen.findByText('Attachments stay on this machine.')).toBeVisible()
  expect(screen.getByRole('menuitemradio', { name: /mac/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})
