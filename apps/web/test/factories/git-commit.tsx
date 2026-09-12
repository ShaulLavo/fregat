import { filesystemPath } from '@/lib/documents/utils/identity'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'

import { useCommitAction } from '@/features/git/hooks/use-commit-action'
import { GitStoreProvider } from '@/features/git/providers/store-provider'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { originForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { createInProcessClient } from '../client'
import { renderApplication } from '../render'
import { makeTestServer, type TestServer } from '../server'
import { createTestApplicationRuntime } from './application-runtime'

export async function createGitCommitHarness(server: TestServer, caseId: number) {
  const second = await makeTestServer({ filesystemWatch: false })
  // QueryClients keep their first client, so each case needs distinct origins.
  const originA = `http://localhost:${38200 + caseId * 2}`
  const originB = `http://localhost:${38201 + caseId * 2}`
  const previousOrigin = activeServerOrigin()
  const previousEnvironments = useEnvironmentsStore.getState()
  const restoreClients: (() => void)[] = []
  for (const [origin, owner] of [
    [originA, server],
    [originB, second],
  ] as const) {
    setActiveServerOrigin(origin)
    const previousClient = getClient()
    setClient(createInProcessClient(owner))
    restoreClients.push(() => {
      setActiveServerOrigin(origin)
      setClient(previousClient)
    })
    await readEnvironmentDescriptor(origin, new AbortController().signal)
  }
  useEnvironmentsStore.getState().activate(originA)
  const application = createTestApplicationRuntime()
  onTestFinished(async () => {
    application.dispose()
    queryClientFor(originA).clear()
    queryClientFor(originB).clear()
    for (const restore of restoreClients) restore()
    useEnvironmentsStore.setState(previousEnvironments, true)
    setActiveServerOrigin(previousOrigin)
    await second.cleanup()
  })
  const cwd = join(server.root, 'repo')
  await mkdir(cwd)
  execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'Commit fixture'], { cwd })
  execFileSync('git', ['config', 'user.email', 'commit@example.com'], { cwd })
  await writeFile(join(cwd, 'shared.txt'), 'A staged change\n')
  execFileSync('git', ['add', 'shared.txt'], { cwd })
  const ownerA = application.getSnapshot().editor.gitStoreForRoot(filesystemPath('repo'))
  const view = renderApplication(
    <GitStoreProvider rootPath='repo'>
      <CommitProbe />
    </GitStoreProvider>,
    application,
  )
  onTestFinished(() => view.unmount())
  return { application, cwd, originA, originB, ownerA }
}

function CommitProbe() {
  const action = useCommitAction('repo')
  const queryClient = useQueryClient()
  return (
    <>
      <output data-testid='active-origin'>{originForQueryClient(queryClient)}</output>
      <Button onClick={action.submit}>Commit</Button>
    </>
  )
}
