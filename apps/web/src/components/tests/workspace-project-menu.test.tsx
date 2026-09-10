import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { WorkspaceProjectMenu } from '@/components/workspace-project-menu'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { TestEditorStateProvider as EditorStateProvider } from '../../../test/factories/editor-state-provider'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
} from '@/features/editor/state/workspace-state'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { createDefaultWorkbenchPanels } from '@/features/workbench/utils/panels'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'
import { ensureFolderPath, recordRecentEntry } from '@/lib/file-server'
import type { TestCommandRuntimeOverrides } from '../../../test/factories/command-runtime'

function storeWithRoot(path: string | null) {
  return createEditorWorkspaceStore({
    chatModePanels: createDefaultChatModePanels(),
    rootFolder: path
      ? {
          birthtimeMs: 0,
          mtimeMs: 0,
          name: path.split('/').filter(Boolean).at(-1) ?? path,
          path,
          size: 0,
          type: 'directory' as const,
          version: '',
        }
      : null,
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: path ? [path] : [],
    workspaces: path
      ? {
          [path]: {
            editorHistory: [],
            recentlyClosedEditorPaths: [],
            scrollPositionByPath: {},
            workbenchPanels: createDefaultWorkbenchPanels(),
          },
        }
      : {},
  })
}

function renderMenu(rootPath: string | null, shell: TestCommandRuntimeOverrides['shell'] = {}) {
  const store = storeWithRoot(rootPath)
  // Real editor stack with the workspace store swapped, so the menu gets the
  // document and ui stores it needs to open a root.
  const rendered = renderWithProviders(
    <EditorStateProvider>
      <EditorWorkspaceStateContext.Provider value={store}>
        <WorkspaceProjectMenu workspaceTitle='platform' />
      </EditorWorkspaceStateContext.Provider>
    </EditorStateProvider>,
    { command: { runtime: { workspace: store, shell } } },
  )
  return { ...rendered, store }
}

test('lists a folder only once when recents include a symlink through its parent', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath('projects/platform')
  await symlink('projects', path.join(server.root, 'Projects'))
  await recordRecentEntry('projects/platform')
  await recordRecentEntry('Projects/platform')
  const { queryClient } = renderMenu('projects/platform')

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
  await ensureFolderPath('projects/platform')
  await ensureFolderPath('Projects/platform')
  await recordRecentEntry('Projects/platform')
  const { store } = renderMenu('projects/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  const other = await screen.findByRole('menuitemradio', { name: 'platform Projects' })
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
  await userEvent.click(other)

  await waitFor(() => expect(store.getState().rootFolder?.path).toBe('Projects/platform'))
})

test('opens without a render failure and lists recents under a heading', async () => {
  renderMenu('/repo/platform')

  // Opening is the assertion: base-ui throws outright if a group label sits
  // outside its group, and nothing catches that until the menu is rendered.
  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  expect(await screen.findByText('Recent')).toBeVisible()
  expect(screen.getByRole('menuitem', { name: /Open folder/ })).toBeVisible()
})

test('offers the open project as the checked entry before recents load', async () => {
  renderMenu('/repo/platform')

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  const items = await screen.findAllByRole('menuitemradio')
  expect(items).toHaveLength(1)
  expect(items[0]).toHaveTextContent('platform')
})

test('still offers a way out when no workspace is open', async () => {
  renderMenu(null)

  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))

  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
  expect(await screen.findByRole('menuitem', { name: /Open folder/ })).toBeVisible()
})

test('opens the connect machine flow from the project dropdown with no workspace open', async () => {
  const dialogs: string[] = []
  renderMenu(null, {
    showEnvironmentDialog: (mode) => {
      dialogs.push(mode)
    },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Switch project' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Connect machine…' }))
  expect(dialogs).toEqual(['connect'])
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})
