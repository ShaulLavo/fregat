import { waitFor } from '@testing-library/react'
import { expect, test } from '../../../test/fixtures'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../test/factories/federation'
import { readWorkspaceCache, workspaceSliceStorageKey } from '@/features/workspace/state/cache'
import { subscribeWorkspaceCachePersistence } from '@/features/workspace/hooks/use-cache-persistence'

test('confirmed worktrees retain Git drafts across A/B/A and promote an open raw folder without replacing its store', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const editorA = h.application.getSnapshot().editor
  const rawFolderStore = editorA.gitStoreForRoot('repo')
  rawFolderStore.getState().setCommitMessage('Unfinished A commit')
  expect(editorA.worktreeRefForRoot('repo')).toBeNull()
  const a = await registerFederatedProject(h.serverA, h.clientA, 'A')
  const b = await registerFederatedProject(h.serverB, h.clientB, 'B')
  await waitFor(() => expect(editorA.worktreeRefForRoot('repo')?.worktreeId).toBe(a.worktreeId))
  expect(editorA.gitStoreForRoot('repo')).toBe(rawFolderStore)
  await h.application.openEnvironmentWorkspaceRoot(h.descriptorA.environmentId, 'repo')
  editorA.workspaceStore.getState().setEditorHistory(['repo/shared.txt'])
  const unsubscribe = subscribeWorkspaceCachePersistence({
    storage: editorA.storage,
    documentStore: editorA.documentStore,
    searchStore: editorA.searchBufferStore,
    workspaceStore: editorA.workspaceStore,
  })
  unsubscribe()
  expect(editorA.storage.getItem(workspaceSliceStorageKey('repo', a.worktreeId!))).not.toBeNull()
  expect(readWorkspaceCache(editorA.storage).worktreeIdByRootPath.repo).toBe(a.worktreeId)
  h.application.activateEnvironment(h.originB)
  const editorB = h.application.getSnapshot().editor
  await waitFor(() =>
    expect(editorB.worktreeRefForRoot('repo')).toEqual({
      environmentId: h.descriptorB.environmentId,
      worktreeId: b.worktreeId,
    }),
  )
  const gitB = editorB.gitStoreForRoot('repo')
  expect(gitB.getState().commitMessage).toBe('')
  gitB.getState().setCommitMessage('Unfinished B commit')
  h.application.activateEnvironment(h.originA)
  expect(h.application.getSnapshot().editor.gitStoreForRoot('repo')).toBe(rawFolderStore)
  expect(rawFolderStore.getState().commitMessage).toBe('Unfinished A commit')
  expect(gitB.getState().commitMessage).toBe('Unfinished B commit')
})
