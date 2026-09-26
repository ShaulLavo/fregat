import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { onlineManager, useQueryClient } from '@tanstack/react-query'
import type { GitStatusResult } from '@workspace/contracts'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { Button } from '@workspace/ui/components/button'

import { useStagePathsMutation } from '@/features/git/hooks/use-stage-paths-mutation'
import { useStatus } from '@/features/git/hooks/use-status'
import { mutationKeys } from '@/features/git/utils/mutation-keys'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { useActiveProjectStore } from '@/features/workspace/state/active-project'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { originForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { gitKeys } from '@/lib/query-keys'
import { createApplicationRuntime } from '@/state/application-runtime'

import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { renderApplication } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'
import { runGit } from '../../../../test/factories/git'

const originA = 'http://localhost:37211'
const originB = 'http://localhost:37212'

test('an offline Git mutation resumes on A while its provider is unmounted and B is active', async ({
  client,
  server,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  for (const root of [server.root, secondServer.root]) {
    const repo = join(root, 'repo')
    await mkdir(repo)
    runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })
    await writeFile(join(repo, 'shared.txt'), 'separate checkout\n')
  }

  const previousOrigin = activeServerOrigin()
  const previousEnvironments = useEnvironmentsStore.getState()
  const previousProject = useActiveProjectStore.getState()
  const wasOnline = onlineManager.isOnline()
  setActiveServerOrigin(originA)
  const previousClientA = getClient()
  setClient(client)
  setActiveServerOrigin(originB)
  const previousClientB = getClient()
  setClient(createInProcessClient(secondServer))
  useEnvironmentsStore.getState().activate(originA)
  await readEnvironmentDescriptor(originA, new AbortController().signal)
  await readEnvironmentDescriptor(originB, new AbortController().signal)
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
  const queryClientA = queryClientFor(originA)
  const view = renderApplication(<StageChanges />, application)

  try {
    await waitFor(() =>
      expect(queryClientA.getQueryState(gitKeys.status('repo'))?.status).toBe('success'),
    )
    act(() => onlineManager.setOnline(false))
    fireEvent.click(screen.getByRole('button', { name: 'Stage changes' }))
    await waitFor(() => expect(queryClientA.isMutating()).toBe(1))
    // By key: other features park their own mutations in the same cache.
    const mutation = queryClientA
      .getMutationCache()
      .find({ mutationKey: mutationKeys.stageMany('repo', ['repo/shared.txt']) })
    await waitFor(() => expect(mutation?.state.isPaused).toBe(true))

    act(() => application.activateEnvironment(originB))
    await waitFor(() => expect(screen.getByTestId('active-origin').textContent).toBe(originB))
    expect(
      queryClientA
        .getQueryCache()
        .find({ queryKey: gitKeys.status('repo') })
        ?.getObserversCount(),
    ).toBe(0)
    expect(
      queryClientFor(originB)
        .getQueryCache()
        .find({ queryKey: gitKeys.status('repo') })
        ?.getObserversCount(),
    ).toBe(1)

    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(mutation?.state.status).toBe('success'))

    // The response seeded A's status under the caller's key, with no refetch behind it.
    const settled = queryClientA.getQueryData<GitStatusResult>(gitKeys.status('repo'))
    expect(settled?.files.map((file) => [file.path, file.index])).toEqual([
      ['repo/shared.txt', 'added'],
    ])
    expect(queryClientA.getQueryState(gitKeys.status('repo'))?.fetchStatus).toBe('idle')

    expect(application.getSnapshot().origin).toBe(originB)
    expect(
      runGit(join(server.root, 'repo'), ['diff', '--cached', '--name-only'], {
        cwdMode: 'option',
      }).stdout.trim(),
    ).toBe('shared.txt')
    expect(
      runGit(join(secondServer.root, 'repo'), ['diff', '--cached', '--name-only'], {
        cwdMode: 'option',
      }).stdout.trim(),
    ).toBe('')
  } finally {
    view.unmount()
    application.dispose()
    queryClientA.clear()
    queryClientFor(originB).clear()
    onlineManager.setOnline(wasOnline)
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

function StageChanges() {
  const queryClient = useQueryClient()
  useStatus('repo')
  const mutation = useStagePathsMutation(['repo/shared.txt'], 'repo')
  return (
    <>
      <output data-testid='active-origin'>{originForQueryClient(queryClient)}</output>
      <Button onClick={() => mutation.mutate()}>Stage changes</Button>
    </>
  )
}
