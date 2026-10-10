import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { onTestFinished } from 'vitest'

import { TestEditorStateProvider as EditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { useRestoreRecentWorkspaceRoot } from '@/features/workspace/hooks/use-restore-recent-root'
import { ensureFolderPath, recordRecentEntry } from '@/lib/file-server'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { WORKSPACE_CACHE_STORAGE_KEYS } from '@/lib/workspace-cache-keys'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { recentFolderKeys } from '@/lib/recent-folders-query'

test('restores the most recent backend folder when browser workspace state is empty', async ({
  client,
}) => {
  localStorage.removeItem(WORKSPACE_CACHE_STORAGE_KEYS.rootFolder)
  await ensureFolderPath(filesystemPath('anubis'), getClient())
  await recordRecentEntry(filesystemPath('anubis'), getClient())
  const { application } = await createAddressTestRuntime(client)
  const queryClient = application.getSnapshot().queryClient
  const navigation = createTestNavigation({ initialEntries: ['/'] })
  expect(navigation.getSnapshot().status).toBe('pending')
  let editor: EditorRuntime | null = null
  const view = renderWithProviders(
    <EditorStateProvider>
      <RecentWorkspaceRecovery
        expose={(next) => {
          editor = next
        }}
      />
    </EditorStateProvider>,
    { application, navigation, queryClient },
  )
  onTestFinished(() => {
    view.unmount()
    navigation.dispose()
  })

  expect(view.getByText('Restoring workspace')).toBeInTheDocument()
  await waitFor(() => expect(navigation.getSnapshot().status).toBe('applied'))
  await waitFor(() =>
    expect(currentEditor(editor).workspaceStore.getState().rootFolder?.path).toBe('anubis'),
  )
  expect(view.getByText('Ready')).toBeInTheDocument()
  await waitFor(() =>
    expect(readWorkspaceCache(currentEditor(editor).storage).rootFolder?.path).toBe('anubis'),
  )
})

test('an explicit workspace address claims its folder before recents', async ({ client }) => {
  await ensureFolderPath(filesystemPath('recent'), client)
  await recordRecentEntry(filesystemPath('recent'), client)
  await ensureFolderPath(filesystemPath('explicit'), client)
  const workspace = await registerTestWorkspaceAddress(client, 'explicit')
  const { application } = await createAddressTestRuntime(client)
  const navigation = createTestNavigation({
    initialEntries: [`/~${workspaceToken(workspace)}/workbench`],
  })
  let editor: EditorRuntime | null = null
  const view = renderWithProviders(
    <EditorStateProvider>
      <RecentWorkspaceRecovery
        expose={(next) => {
          editor = next
        }}
      />
    </EditorStateProvider>,
    { application, navigation, queryClient: application.getSnapshot().queryClient },
  )
  onTestFinished(() => {
    view.unmount()
    navigation.dispose()
  })
  await waitFor(() => expect(navigation.getSnapshot().status).toBe('applied'))
  expect(currentEditor(editor).workspaceStore.getState().rootFolder?.path).toBe('explicit')
  expect(view.getByText('Ready')).toBeInTheDocument()
})

test('finishes restoring when the server has no recent folders', async ({ client }) => {
  const { application } = await createAddressTestRuntime(client)
  const navigation = createTestNavigation({ initialEntries: ['/'] })
  let editor: EditorRuntime | null = null
  const view = renderWithProviders(
    <EditorStateProvider>
      <RecentWorkspaceRecovery
        expose={(next) => {
          editor = next
        }}
      />
    </EditorStateProvider>,
    { application, navigation, queryClient: application.getSnapshot().queryClient },
  )
  onTestFinished(() => {
    view.unmount()
    navigation.dispose()
  })

  expect(view.getByText('Restoring workspace')).toBeInTheDocument()
  await waitFor(() => expect(view.getByText('Ready')).toBeInTheDocument())
  expect(currentEditor(editor).workspaceStore.getState().rootFolder).toBeNull()
  expect(
    application.getSnapshot().queryClient.getQueriesData({ queryKey: recentFolderKeys.all }),
  ).toContainEqual([recentFolderKeys.list(40), []])
})

function RecentWorkspaceRecovery({ expose }: { readonly expose: (editor: EditorRuntime) => void }) {
  const editor = useEditorRuntime()
  const restoring = useRestoreRecentWorkspaceRoot()

  useEffect(() => expose(editor), [editor, expose])

  return <output>{restoring ? 'Restoring workspace' : 'Ready'}</output>
}

function currentEditor(editor: EditorRuntime | null) {
  if (!editor) return expect.unreachable('editor runtime was not exposed')
  return editor
}
