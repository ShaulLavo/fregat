import { screen } from '@testing-library/react'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { SettingsDialog } from '../components/dialog'

test('a closed dialog renders no settings surface at all', ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsDialog open={false} onOpenChange={() => {}} />)

  expect(screen.queryByRole('dialog')).toBeNull()
})

test('an open dialog shows the real settings page', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsDialog open onOpenChange={() => {}} />)

  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeDefined()
  // The dialog is the folderless shell now: same page, reachable when there is
  // no tab strip to put a Settings tab in, and with a way back out.
  expect(await screen.findByLabelText('Search settings')).toBeDefined()
  expect(await screen.findByRole('button', { name: 'None' })).toBeDefined()
})
