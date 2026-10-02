import { afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { createClientInvariantError } from '@/lib/structured-errors'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'
import { usePickEntry } from '../use-pick-entry'

afterEach(() => {
  delete window.platformBridge
})

function PickerFixture() {
  return usePickEntry({ open: true, value: null, onOpenChange: () => {}, onPick: () => {} })
}

test('Chromium bridge without native picker opens the web folder picker', async ({ client }) => {
  void client
  window.platformBridge = {
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
  }
  renderWithProviders(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(await screen.findByRole('heading', { name: 'Open folder' })).toBeTruthy()
})

test('native picker failure exposes public guidance', async ({ client }) => {
  void client
  const count = toast.getHistory().length
  window.platformBridge = {
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
    pickEntry: async () => {
      throw createClientInvariantError('The native chooser fixture failed.')
    },
  }
  renderWithProviders(<PickerFixture />)
  await waitFor(() => expect(toast.getHistory().length).toBeGreaterThan(count))
  const failure = toast.getHistory().at(-1)!
  expect(failure).toMatchObject({
    title: 'Could not open file chooser',
    description: expect.stringContaining('The native chooser fixture failed.'),
  })
  expect(screen.queryByRole('dialog')).toBeNull()
})
