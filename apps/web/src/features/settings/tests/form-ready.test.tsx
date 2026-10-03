import { screen, waitFor, within } from '@testing-library/react'
import { Profiler } from 'react'

import { SettingsPage } from '@/features/settings/components/page'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('the settings form stays busy until its final Appearance row mounts', async ({
  client,
  task,
}) => {
  expect(client).toBeDefined()
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsSearch('')
  selectSettingsCategory('Appearance')
  const commits: { busy: string | null; hasMaterial: boolean }[] = []

  renderWithProviders(
    <Profiler
      id='settings-form'
      onRender={() => {
        const form = screen.queryByRole('region', { name: 'Settings form' })
        if (!form) return

        commits.push({
          busy: form.getAttribute('aria-busy'),
          hasMaterial: within(form).queryByRole('combobox', { name: 'Window material' }) !== null,
        })
      }}
    >
      <SettingsPage />
    </Profiler>,
  )

  await waitFor(
    () =>
      expect(screen.getByRole('region', { name: 'Settings form' })).toHaveAttribute(
        'aria-busy',
        'false',
      ),
    { timeout: task.timeout },
  )
  expect(screen.getByRole('combobox', { name: 'Window material' })).toBeDefined()
  const partialCommits = commits.filter((commit) => !commit.hasMaterial)
  expect(partialCommits.length).toBeGreaterThan(0)
  expect(partialCommits.every((commit) => commit.busy === 'true')).toBe(true)
  expect(commits.some((commit) => commit.hasMaterial && commit.busy === 'false')).toBe(true)
})
