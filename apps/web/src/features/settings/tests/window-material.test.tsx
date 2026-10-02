import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'

import { SettingsPage } from '@/features/settings/components/page'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { applyBackdrop } from '@/lib/platform/backdrop'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

let previousBridge: typeof window.platformBridge
let previousBackdrop: string | null

test.beforeEach(() => {
  previousBridge = window.platformBridge
  previousBackdrop = document.documentElement.getAttribute('data-backdrop')
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('window material')
  selectSettingsCategory(null)
})

afterEach(() => {
  window.platformBridge = previousBridge
  if (previousBackdrop === null) document.documentElement.removeAttribute('data-backdrop')
  else document.documentElement.setAttribute('data-backdrop', previousBackdrop)
})

test('browser material stays visible with a disabled control and an availability reason', async ({
  client,
}) => {
  expect(client).toBeDefined()
  delete window.platformBridge
  applyBackdrop('app')
  renderWithProviders(<SettingsPage />)

  expect(await screen.findByRole('combobox', { name: 'Window material' })).toBeDisabled()
  expect(screen.getByText('Needs a transparent macOS app window.')).toBeDefined()
})

test('older macOS keeps Frosted selectable and marks Glass unavailable', async ({ client }) => {
  expect(client).toBeDefined()
  window.platformBridge = {
    platform: 'darwin',
    backdrop: 'transparent',
    colorScheme: 'dark',
    titlebar: 'overlay',
    capabilities: { windowGlass: false },
    setWindowAppearance: () => {},
  }
  applyBackdrop('transparent')
  renderWithProviders(<SettingsPage />)

  const material = await screen.findByRole('combobox', { name: 'Window material' })
  expect(material).not.toBeDisabled()
  await userEvent.click(material)
  expect(await screen.findByRole('option', { name: /Glass/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByText('Glass needs macOS 26.')).toBeDefined()
  expect(screen.getByRole('option', { name: 'Frosted' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('switching native material updates opacity applicability and restores its saved fill', async ({
  client,
}) => {
  expect(client).toBeDefined()
  window.platformBridge = {
    platform: 'darwin',
    backdrop: 'transparent',
    colorScheme: 'dark',
    titlebar: 'overlay',
    capabilities: { windowGlass: true },
    setWindowAppearance: () => {},
  }
  applyBackdrop('transparent')
  selectSettingsSearch('')
  selectSettingsCategory('Appearance')
  renderWithProviders(<SettingsPage />)

  const material = await screen.findByRole('combobox', { name: 'Window material' })
  const opacity = await screen.findByRole('slider', { name: 'Pane opacity' })
  expect(opacity).not.toBeDisabled()
  await userEvent.click(material)
  await userEvent.click(await screen.findByRole('option', { name: 'Frosted' }))
  await waitFor(() => expect(opacity).toBeDisabled())
  expect(document.documentElement.style.getPropertyValue('--surface-opacity')).toBe('0%')
  expect(document.documentElement.style.getPropertyValue('--content-opacity')).toBe('0%')
  expect(screen.getAllByText('Window material controls pane opacity.')).toHaveLength(2)

  await userEvent.click(material)
  await userEvent.click(await screen.findByRole('option', { name: 'None' }))
  await waitFor(() => expect(opacity).not.toBeDisabled())
  expect(document.documentElement.style.getPropertyValue('--surface-opacity')).toBe('80%')
})
