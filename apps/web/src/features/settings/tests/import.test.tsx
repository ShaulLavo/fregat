import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '@/features/settings/components/page'
import { fetchSettings } from '@/features/settings/utils/api'
import {
  readSettingsCategory,
  selectSettingsCategory,
} from '@/features/settings/state/category-store'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('finds imports in Chat settings and persists the default-on update preference', async ({
  client,
}) => {
  const previousCategory = readSettingsCategory()
  selectSettingsCategory('Chat')
  const rendered = renderWithProviders(<SettingsPage />)

  try {
    const search = await screen.findByLabelText('Search settings')
    await userEvent.type(search, 'codex')
    expect(await screen.findByRole('heading', { name: 'Import existing chats' })).toBeVisible()
    expect(await screen.findByText('No import sources available')).toBeVisible()
    expect(screen.queryByRole('status', { name: 'Loading import sources' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Import from/ })).toBeNull()

    const updates = screen.getByRole('switch', { name: 'Keep imported chats updated' })
    expect(updates).toBeChecked()
    await userEvent.click(updates)
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, client)
      expect(snapshot.values['chat.keepImportedSessionsUpdated']).toBe(false)
      expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).toMatchObject({
        'chat.keepImportedSessionsUpdated': false,
      })
    })
  } finally {
    rendered.unmount()
    selectSettingsCategory(previousCategory)
  }
})
