import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { WorkspaceProjectMenu } from '@/components/workspace-project-menu'
import { TestEditorStateProvider as EditorStateProvider } from '../../../test/factories/editor-state-provider'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'
import { ensureFolderPath, recordRecentEntry } from '@/lib/file-server'
import type { TestCommandRuntimeOverrides } from '../../../test/factories/command-runtime'
import type { Client } from '@/lib/client'
import { seedWorkspaceCache } from '../../../test/address'
import { createTestApplicationRuntime } from '../../../test/factories/application-runtime'
import { registerTestWorkspaceAddress } from '../../../test/factories/workspace-address'
import { testScopedStorage } from '../../../test/factories/scoped-storage'
import { writeRootFolderCache } from '@/features/workspace/state/cache'

async function renderMenu(
  client: Client,
  rootPath: string | null,
  shell: TestCommandRuntimeOverrides['shell'] = {},
) {
  if (rootPath) {
    const workspaceAddress = await registerTestWorkspaceAddress(client, rootPath)
    seedWorkspaceCache({ rootPath, workspaceAddress })
  }
  if (!rootPath) writeRootFolderCache(testScopedStorage, null)

  const application = createTestApplicationRuntime()
  const store = application.getSnapshot().editor.workspaceStore
  const rendered = renderWithProviders(
    <EditorStateProvider>
      <WorkspaceProjectMenu workspaceTitle='platform' />
    </EditorStateProvider>,
    { application, command: { runtime: { shell } } },
  )
  return { ...rendered, store }
}

test('lists a folder only once when recents include a symlink through its parent', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('projects/platform'), getClient())
  await symlink('projects', path.join(server.root, 'Projects'))
  await recordRecentEntry(filesystemPath('projects/platform'), getClient())
  await recordRecentEntry(filesystemPath('Projects/platform'), getClient())
  const { queryClient } = await renderMenu(client, 'projects/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  await waitFor(() => {
    expect(
      queryClient.getQueryData(['project-menu', 'canonical-roots', ['Projects/platform']]),
    ).toMatchObject([{ path: 'Projects/platform', address: { path: 'projects/platform' } }])
  })

  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading projects' })).toBeNull())
  const items = screen.getAllByRole('menuitemradio')
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveAttribute('aria-checked', 'true')
  expect(items[0]).toHaveTextContent('platform')
})

test('keeps distinct case-sensitive folders and opens the selected folder', async ({ client }) => {
  await ensureFolderPath(filesystemPath('projects/platform'), getClient())
  await ensureFolderPath(filesystemPath('Projects/platform'), getClient())
  await recordRecentEntry(filesystemPath('Projects/platform'), getClient())
  const { store } = await renderMenu(client, 'projects/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  const other = await screen.findByRole('menuitemradio', { name: 'platform Projects' })
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  await userEvent.click(other)

  await waitFor(() => expect(store.getState().rootFolder?.path).toBe('Projects/platform'))
})

test('opens without a render failure and lists recents under a heading', async ({ client }) => {
  await ensureFolderPath(filesystemPath('repo/platform'), getClient())
  await renderMenu(client, 'repo/platform')

  // Opening is the assertion: base-ui throws outright if a group label sits
  // outside its group, and nothing catches that until the menu is rendered.
  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  expect(await screen.findByText('Recent')).toBeVisible()
  expect(screen.getByRole('menuitem', { name: /Open folder/ })).toBeVisible()
})

test('offers the open project as the checked entry before recents load', async ({ client }) => {
  await ensureFolderPath(filesystemPath('repo/platform'), getClient())
  await renderMenu(client, 'repo/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  const items = await screen.findAllByRole('menuitemradio')
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveTextContent('platform')
})

test('still offers a way out when no workspace is open', async ({ client }) => {
  await renderMenu(client, null)

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  expect(await screen.findByRole('menuitem', { name: /Open folder/ })).toBeVisible()
})

test('opens the connect machine flow from the project dropdown with no workspace open', async ({
  client,
}) => {
  const dialogs: string[] = []
  await renderMenu(client, null, {
    showEnvironmentDialog: (mode) => {
      dialogs.push(mode)
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Connect machine…' }))
  expect(dialogs).toEqual(['connect'])
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})
