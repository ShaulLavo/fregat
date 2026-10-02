import { afterEach } from 'vitest'
import { screen } from '@testing-library/react'
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

test('unverified locality uses the server-filesystem picker even with a native host', async ({
  client,
}) => {
  void client
  let calls = 0
  window.platformBridge = {
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
    pickEntry: async () => {
      calls += 1
      throw createClientInvariantError('The native chooser fixture failed.')
    },
  }
  renderWithProviders(<PickerFixture />)
  expect(await screen.findByRole('dialog')).toBeTruthy()
  expect(calls).toBe(0)
})
