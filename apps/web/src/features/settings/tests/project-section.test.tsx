import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectId } from '@workspace/contracts'

import { getClient } from '@/lib/client'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { fetchSettings } from '@/features/settings/utils/api'
import { ProjectSection } from '@/features/settings/components/project-section'
import { renderWithProviders } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'

const PROJECT = 'project-fixture' as ProjectId

async function choose(row: string, option: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: row }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

test('a project override is written for that project alone, and the default removes it', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(
    <ProjectSection
      project={{
        ref: { environmentId: activeEnvironmentId(), projectId: PROJECT },
        title: 'Fixture',
      }}
    />,
  )
  const autoPull = 'Keep the default branch current'
  expect(await screen.findByRole('combobox', { name: autoPull })).toHaveTextContent('Default · Off')

  await choose(autoPull, 'On')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['git.projectAutoPull']).toEqual({ [PROJECT]: true })
    expect(snapshot.values['git.autoPull']).toBe(false)
  })

  await choose(autoPull, 'Default · Off')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['git.projectAutoPull']).toEqual({})
  })
})

test('the two settlement rows share one override entry', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(
    <ProjectSection
      project={{
        ref: { environmentId: activeEnvironmentId(), projectId: PROJECT },
        title: 'Fixture',
      }}
    />,
  )

  await choose('Settle inactive sessions after days', '7 days')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['chat.projectAutoSettle']).toEqual({ [PROJECT]: { afterDays: 7 } })
  })
  await choose('Settle sessions when their pull request merges', 'Off')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['chat.projectAutoSettle']).toEqual({
      [PROJECT]: { afterDays: 7, onMerge: false },
    })
  })
})
