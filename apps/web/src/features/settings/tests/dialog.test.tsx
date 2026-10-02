import { screen, within } from '@testing-library/react'

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

  const dialog = within(await screen.findByRole('dialog', { name: 'Settings' }))
  // Allow the lazy page to load, then assert a setting mounted with its first screen.
  expect(
    await dialog.findByLabelText('Search settings', undefined, { timeout: 10_000 }),
  ).toBeDefined()
  expect(dialog.getByRole('switch', { name: 'Plan mode controls' })).toBeDefined()
})
