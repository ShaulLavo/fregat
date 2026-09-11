import { fireEvent, waitFor } from '@testing-library/react'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../../../../test/fixtures'
import { seedWorkspaceCache, waitForNavigation } from '../../../../test/address'
import { createObservedInProcessClient } from '../../../../test/client'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { renderApplication } from '../../../../test/render'
import { useValidateRootFolder } from '@/features/workspace/hooks/use-validate-root-folder'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { fetchServerInfo } from '@/lib/file-server'
import { RootValidationMount } from '../../../../test/factories/root-validation-mount'

test('mounting root validation cannot supersede an already pending workspace open', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  await mkdir(path.join(server.root, 'second'))
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const application = createTestApplicationRuntime()
  const navigation = createTestNavigation({ application })
  const rendered = renderApplication(
    <RootValidationMount>
      <Validation />
    </RootValidationMount>,
    application,
    { navigation },
  )
  await waitForNavigation(navigation)
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const requestedRoots: string[] = []
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/workspace-root') return
    const body = await request.clone().json()
    requestedRoots.push(body.path)
    if (body.path !== 'second') return
    started.resolve()
    await released.promise
  })
  const owner = application.getSnapshot()
  registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
  try {
    const pending = navigation.openWorkspace({
      environmentId: confirmedEnvironmentId(owner.origin),
      path: 'second',
    })
    await started.promise
    fireEvent.click(rendered.getByRole('button'))
    released.resolve()
    expect(await pending).toEqual({ status: 'applied' })
    expect(owner.editor.workspaceStore.getState().rootFolder?.path).toBe('second')
    expect(requestedRoots).not.toContain('repo')
    await waitFor(async () => {
      const info = await fetchServerInfo(new AbortController().signal, client)
      expect(info.workspaceIndex?.scanRoot).toBe(path.join(server.root, 'second'))
    })
  } finally {
    released.resolve()
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
    rendered.unmount()
  }
})

function Validation() {
  useValidateRootFolder()
  return null
}
