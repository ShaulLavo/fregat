import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsPage } from '@/features/settings/components/page'
import { selectSettingsScope, settingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView, settingsView } from '@/features/settings/state/view-store'
import { saveCapability } from '@/lib/documents/utils/capabilities'
import { settingsJsonDocument, tabId } from '@/lib/documents/utils/identity'
import { activeTabDocument, settingsTab } from '@/lib/documents/utils/tabs'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test.afterEach(() => {
  selectSettingsScope('user')
  selectSettingsView('form')
})

test('the Defaults tab opens the generated document, and the form view leaves it for User', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage tabId={tabId('settings-tab')} />)

  await userEvent.click(await screen.findByRole('tab', { name: 'Defaults' }))

  // A form for values nobody set has nothing to do, so the tab is a document only.
  expect(settingsScope()).toBe('default')
  expect(settingsView()).toBe('json')
  expect(screen.queryByLabelText('Search settings')).toBeNull()

  await userEvent.click(await screen.findByRole('tab', { name: 'Settings' }))

  expect(settingsScope()).toBe('user')
  expect(settingsView()).toBe('form')
  expect(await screen.findByLabelText('Search settings')).toBeDefined()
})

test('the Defaults tab is disabled outside an editor tab, where there is no document view', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(<SettingsPage />)

  const tab = await screen.findByRole('tab', { name: 'Defaults' })
  expect(tab.getAttribute('aria-disabled')).toBe('true')
})

test('the defaults document is a member of the settings tab with nothing to save to', () => {
  const document = settingsJsonDocument('default')

  expect(saveCapability(document)).toEqual({ kind: 'none' })
  expect(activeTabDocument(settingsTab(), { kind: 'json', target: 'default' })).toEqual(document)
})
