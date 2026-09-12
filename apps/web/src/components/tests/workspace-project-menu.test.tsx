import { getClient } from '@/lib/client'
import { registerTestWorkspaceAddress } from '../../../test/factories/workspace-address'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { WorkspaceProjectMenu } from '@/components/workspace-project-menu'
import { TestEditorStateProvider as EditorStateProvider } from '../../../test/factories/editor-state-provider'
import { createTestApplicationRuntime } from '../../../test/factories/application-runtime'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'
import { ensureFolderPath, recordRecentEntry } from '@/lib/file-server'
import type { TestCommandRuntimeOverrides } from '../../../test/factories/command-runtime'

async function renderMenu(
  rootPath: string | null,
  shell: TestCommandRuntimeOverrides['shell'] = {},
) {
  const application = createTestApplicationRuntime()
  const store = application.getSnapshot().editor.workspaceStore
  store.getState().clearRootFolder()
  store.getState().setUiMode('workbench')
  if (rootPath) {
    await ensureFolderPath(filesystemPath(rootPath))
    const workspaceAddress = await registerTestWorkspaceAddress(getClient(), rootPath)
    store.getState().switchWorkspace({
      workspaceAddress,
      birthtimeMs: 0,
      mtimeMs: 0,
      name: rootPath.split('/').filter(Boolean).at(-1) ?? rootPath,
      path: filesystemPath(rootPath),
      size: 0,
      type: 'directory',
      version: '',
    })
  }
  const rendered = renderWithProviders(
    <EditorStateProvider>
      <WorkspaceProjectMenu workspaceTitle='platform' />
    </EditorStateProvider>,
    {
      application,
      queryClient: application.getSnapshot().queryClient,
      command: { runtime: { workspace: store, shell } },
    },
  )
  return { ...rendered, store }
}

test('lists a folder only once when recents include a symlink through its parent', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('projects/platform'))
  await symlink('projects', path.join(server.root, 'Projects'))
  await recordRecentEntry(filesystemPath('projects/platform'))
  await recordRecentEntry(filesystemPath('Projects/platform'))
  const { queryClient } = await renderMenu('projects/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  await waitFor(() => {
    expect(
      queryClient.getQueryData(['project-menu', 'canonical-root', 'Projects/platform']),
    ).toMatchObject({ path: 'projects/platform' })
  })

  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading projects' })).toBeNull())
  const items = screen.getAllByRole('menuitemradio')
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveAttribute('aria-checked', 'true')
  expect(items[0]).toHaveTextContent('platform')
})

test('keeps distinct case-sensitive folders and opens the selected folder', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('projects/platform'))
  await ensureFolderPath(filesystemPath('Projects/platform'))
  await recordRecentEntry(filesystemPath('Projects/platform'))
  const { store } = await renderMenu('projects/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  const other = await screen.findByRole('menuitemradio', { name: 'platform Projects' })
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  await userEvent.click(other)

  await waitFor(() => expect(store.getState().rootFolder?.path).toBe('Projects/platform'))
})

test('opens without a render failure and lists recents under a heading', async () => {
  await renderMenu('repo/platform')

  // Opening is the assertion: base-ui throws outright if a group label sits
  // outside its group, and nothing catches that until the menu is rendered.
  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  expect(await screen.findByText('Recent')).toBeVisible()
  expect(screen.getByRole('menuitem', { name: /Open folder/ })).toBeVisible()
})

test('offers the open project as the checked entry before recents load', async () => {
  await renderMenu('repo/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  const items = await screen.findAllByRole('menuitemradio')
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveTextContent('platform')
})

test('still offers a way out when no workspace is open', async () => {
  await renderMenu(null)

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  expect(await screen.findByRole('menuitem', { name: /Open folder/ })).toBeVisible()
})

test('opens the connect machine flow from the project dropdown with no workspace open', async () => {
  const dialogs: string[] = []
  await renderMenu(null, {
    showEnvironmentDialog: (mode) => {
      dialogs.push(mode)
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Connect machine…' }))
  expect(dialogs).toEqual(['connect'])
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})
