import { afterEach } from 'vitest'
import { screen } from '@testing-library/react'
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
