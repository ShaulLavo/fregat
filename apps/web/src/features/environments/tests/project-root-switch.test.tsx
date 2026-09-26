import { filesystemPath } from '@/lib/documents/utils/identity'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { act, screen, waitFor } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'

import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useValidateRootFolder } from '@/features/workspace/hooks/use-validate-root-folder'
import { useActiveProjectStore } from '@/features/workspace/state/active-project'
import { readWorkspaceCache, writeRootFolderCache } from '@/features/workspace/state/cache'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { originForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createFolderPath } from '@/lib/file-server'
import { createApplicationRuntime } from '@/state/application-runtime'

import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { renderApplication } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'

test.for([
  {
    name: 'restores both project pointers when switching between different roots A/B/A',
    originA: 'http://localhost:37311',
    originB: 'http://localhost:37312',
    rootB: 'b',
    missingOnB: false,
  },
  {
    name: 'clears both B project pointers when its cached root exists only on A',
    originA: 'http://localhost:37321',
    originB: 'http://localhost:37322',
    rootB: 'only-on-a',
    missingOnB: true,
  },
])('$name', async ({ originA, originB, rootB, missingOnB }, { client }) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const clientB = createInProcessClient(secondServer)
  const rootAEntry = await createFolderPath(filesystemPath('a'), client)
  const rootAAddress = await registerTestWorkspaceAddress(client, rootAEntry.path)
  const rootBEntry = await createFolderPath(filesystemPath(rootB), clientB)
  const rootBAddress = await registerTestWorkspaceAddress(clientB, rootBEntry.path)
  if (missingOnB) {
    await createFolderPath(filesystemPath(rootB), client)
    await rm(join(secondServer.root, rootB), { recursive: true })
  }
  const previousOrigin = activeServerOrigin()
  const previousEnvironments = useEnvironmentsStore.getState()
  const previousProject = useActiveProjectStore.getState()
  setActiveServerOrigin(originA)
  const previousClientA = getClient()
  setClient(client)
  setActiveServerOrigin(originB)
  const previousClientB = getClient()
  setClient(clientB)
  useEnvironmentsStore.getState().activate(originA)
  await readEnvironmentDescriptor(originA, new AbortController().signal)
  await readEnvironmentDescriptor(originB, new AbortController().signal)
  writeRootFolderCache(environmentScopedStorage(confirmedEnvironmentId(originA)), {
    ...rootAEntry,
    type: 'directory',
    workspaceAddress: rootAAddress,
  })
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(confirmedEnvironmentId(originA))),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      tabSize: 4,
    },
  })
  const view = renderApplication(<ProjectRoots />, application)

  try {
    await waitFor(() => expect(screen.getByTestId('active-origin').textContent).toBe(originA))
    expect(screen.getByTestId('editor-root').textContent).toBe('a')
    expect(screen.getByTestId('bf451e7b-070d-5d48-b2e4-227226449bc9').textContent).toBe('a')
    const editorA = application.getSnapshot().editor

    writeRootFolderCache(environmentScopedStorage(confirmedEnvironmentId(originB)), {
      ...rootBEntry,
      type: 'directory',
      workspaceAddress: rootBAddress,
    })
    act(() => {
      application.activateEnvironment(originB)
      expect(application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
        rootB,
      )
      expect(useActiveProjectStore.getState().workspaceRoot).toBe(rootB)
    })
    await waitFor(() => expect(screen.getByTestId('active-origin').textContent).toBe(originB))
    const editorB = application.getSnapshot().editor
    const expectedRootB = missingOnB ? null : rootB
    await waitFor(() =>
      expect(editorB.workspaceStore.getState().rootFolder?.path ?? null).toBe(expectedRootB),
    )
    expect(screen.getByTestId('editor-root').textContent).toBe(expectedRootB ?? 'none')
    expect(screen.getByTestId('bf451e7b-070d-5d48-b2e4-227226449bc9').textContent).toBe(
      expectedRootB ?? 'none',
    )
    expect(useActiveProjectStore.getState().workspaceRoot).toBe(expectedRootB)

    act(() => application.activateEnvironment(originA))
    await waitFor(() => expect(screen.getByTestId('active-origin').textContent).toBe(originA))
    expect(application.getSnapshot().editor).toBe(editorA)
    expect(screen.getByTestId('editor-root').textContent).toBe('a')
    expect(screen.getByTestId('bf451e7b-070d-5d48-b2e4-227226449bc9').textContent).toBe('a')
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('a')
    expect(editorB.workspaceStore.getState().rootFolder?.path ?? null).toBe(expectedRootB)
  } finally {
    view.unmount()
    application.dispose()
    queryClientFor(originA).clear()
    queryClientFor(originB).clear()
    setActiveServerOrigin(originA)
    setClient(previousClientA)
    setActiveServerOrigin(originB)
    setClient(previousClientB)
    useEnvironmentsStore.setState(previousEnvironments, true)
    useActiveProjectStore.setState(previousProject, true)
    setActiveServerOrigin(previousOrigin)
    await secondServer.cleanup()
  }
})

function ProjectRoots() {
  useValidateRootFolder()
  const queryClient = useQueryClient()
  const root = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const project = useActiveProjectStore((state) => state.workspaceRoot)
  return (
    <>
      <output data-testid='active-origin'>{originForQueryClient(queryClient)}</output>
      <output data-testid='editor-root'>{root ?? 'none'}</output>
      <output data-testid='bf451e7b-070d-5d48-b2e4-227226449bc9'>{project ?? 'none'}</output>
    </>
  )
}
