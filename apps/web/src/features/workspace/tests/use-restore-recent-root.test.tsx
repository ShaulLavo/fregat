import { filesystemPath } from '@/lib/documents/utils/identity'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { waitFor } from '@testing-library/react'

import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
} from '@/features/editor/state/workspace-state'
import { useRestoreRecentWorkspaceRoot } from '@/features/workspace/hooks/use-restore-recent-root'
import { useWorkspaceCachePersistence } from '@/features/workspace/hooks/use-cache-persistence'
import { ensureFolderPath, recordRecentEntry } from '@/lib/file-server'
import { WORKSPACE_CACHE_STORAGE_KEYS, readWorkspaceCache } from '@/features/workspace/state/cache'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('restores the most recent backend folder when browser workspace state is empty', async ({
  client,
}) => {
  void client
  localStorage.removeItem(WORKSPACE_CACHE_STORAGE_KEYS.rootFolder)
  await ensureFolderPath(filesystemPath('anubis'))
  await recordRecentEntry(filesystemPath('anubis'))
  const workspaceStore = emptyWorkspaceStore()

  const view = renderWithProviders(
    <EditorStateProvider>
      <EditorWorkspaceStateContext.Provider value={workspaceStore}>
        <RecentWorkspaceRecovery />
      </EditorWorkspaceStateContext.Provider>
    </EditorStateProvider>,
  )

  expect(view.getByText('Restoring workspace')).toBeInTheDocument()
  await waitFor(() => expect(workspaceStore.getState().rootFolder?.path).toBe('anubis'))
  expect(view.getByText('Ready')).toBeInTheDocument()
  await waitFor(() => expect(readWorkspaceCache(testScopedStorage).rootFolder?.path).toBe('anubis'))
})

test('finishes restoring when the server has no recent folders', async ({ client }) => {
  void client
  const workspaceStore = emptyWorkspaceStore()
  const view = renderWithProviders(
    <EditorStateProvider>
      <EditorWorkspaceStateContext.Provider value={workspaceStore}>
        <RecentWorkspaceRecovery />
      </EditorWorkspaceStateContext.Provider>
    </EditorStateProvider>,
  )

  expect(view.getByText('Restoring workspace')).toBeInTheDocument()
  await waitFor(() => expect(view.getByText('Ready')).toBeInTheDocument())
  expect(workspaceStore.getState().rootFolder).toBeNull()
})

function RecentWorkspaceRecovery() {
  useWorkspaceCachePersistence()
  const restoring = useRestoreRecentWorkspaceRoot()

  return <output>{restoring ? 'Restoring workspace' : 'Ready'}</output>
}

function emptyWorkspaceStore() {
  return createEditorWorkspaceStore({
    chatModePanels: createDefaultChatModePanels(),
    rootFolder: null,
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: [],
    workspaces: {},
  })
}
