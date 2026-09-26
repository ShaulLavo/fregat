import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { selectSettingsProject } from '@/lib/project-settings/state/selection'
import { installTestEnvironment } from '../../../../test/factories/client-binding'
import type { ProjectId } from '@workspace/contracts'
import { tabId } from '@/lib/documents/utils/identity'
import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsPage } from '@/features/settings/components/page'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

test('page reset follows the remote JSON document and returns to the primary owner in form view', async ({
  client,
}) => {
  const serverB = await makeTestServer({ filesystemWatch: false })
  const clientB = createInProcessClient(serverB)
  const primary = createTestQueryClient()
  primary.setDefaultOptions({ queries: { enabled: false } })
  const editor = new QueryClient()
  registerEnvironmentQueryClient(editor, 'http://localhost:3513', clientB)
  await saveSettings(
    {
      mutationId: 'primary-page-actions',
      target: 'user',
      operations: [{ kind: 'set', key: 'editor.fontSize', value: 19 }],
    },
    client,
  )
  await saveSettings(
    {
      mutationId: 'remote-page-actions',
      target: 'user',
      operations: [{ kind: 'set', key: 'editor.fontSize', value: 21 }],
    },
    clientB,
  )
  editor.setQueryData(settingsKeys.document(), await fetchSettings(undefined, clientB))
  selectSettingsScope('user')
  selectSettingsView('json')
  const rendered = renderWithProviders(<SettingsPage tabId={tabId('remote-settings')} />, {
    queryClient: editor,
    settingsOwner: primary,
  })
  try {
    await userEvent.click(await screen.findByRole('button', { name: 'Settings actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset all user settings' }))
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, clientB)
      expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).toEqual({})
    })
    const primarySnapshot = await fetchSettings(undefined, client)
    expect(primarySnapshot.values['editor.fontSize']).toBe(19)
    act(() => primary.setQueryData(settingsKeys.document(), primarySnapshot))

    await userEvent.click(screen.getByRole('tab', { name: /^Settings$/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Settings actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset all user settings' }))
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, client)
      expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).toEqual({})
    })
  } finally {
    rendered.unmount()
    selectSettingsView('form')
    primary.clear()
    editor.clear()
    await serverB.cleanup()
  }
})

test('a remote project page offers no global reset and leaves the primary settings intact', async ({
  client,
}) => {
  const primary = createTestQueryClient()
  const serverB = await makeTestServer({ filesystemWatch: false })
  const clientB = createInProcessClient(serverB)
  for (const [owner, size] of [
    [client, 19],
    [clientB, 21],
  ] as const) {
    await saveSettings(
      {
        mutationId: `project-owner-${size}`,
        target: 'user',
        operations: [{ kind: 'set', key: 'editor.fontSize', value: size }],
      },
      owner,
    )
  }
  const primaryBefore = await fetchSettings(undefined, client)
  const remoteBefore = await fetchSettings(undefined, clientB)
  primary.setQueryData(settingsKeys.document(), primaryBefore)
  const restoreEnvironment = await installTestEnvironment('http://localhost:3514', clientB)
  selectSettingsScope('user')
  selectSettingsView('form')
  selectSettingsProject({
    ref: { environmentId: activeEnvironmentId(), projectId: 'remote-project' as ProjectId },
    title: 'Remote project',
  })
  const rendered = renderWithProviders(<SettingsPage />, { settingsOwner: primary })
  try {
    expect(
      await screen.findByRole('combobox', { name: 'Keep the default branch current' }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Settings actions' })).toBeNull()
    expect((await fetchSettings(undefined, client)).layers).toEqual(primaryBefore.layers)
    expect((await fetchSettings(undefined, clientB)).layers).toEqual(remoteBefore.layers)

    await userEvent.click(screen.getByRole('button', { name: 'Show all settings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Settings actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset all user settings' }))
    await waitFor(async () => {
      const snapshot = await fetchSettings(undefined, client)
      expect(snapshot.layers.find((layer) => layer.id === 'user')?.raw).toEqual({})
    })
    expect((await fetchSettings(undefined, clientB)).layers).toEqual(remoteBefore.layers)
  } finally {
    rendered.unmount()
    selectSettingsProject(null)
    primary.clear()
    restoreEnvironment()
    await serverB.cleanup()
  }
})
