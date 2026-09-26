import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { healthDescriptorSchema } from '@workspace/contracts'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import {
  activateWorkspaceRoot,
  useActiveProjectStore,
} from '@/features/workspace/state/active-project'
import { openWorkspaceRootForOwner } from '@/features/workspace/state/open-root'
import { createObservedInProcessClient } from '../../../../../test/client'
import { scopeAddressEnvironment } from '../../../../../test/factories/address-environment'
import { expect, test } from '../../../../../test/fixtures'

const ORIGIN = 'http://localhost:38175'

test('an abandoned open hands the active project back and records no recent', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'next'))
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const reached = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/fs/workspace-root') return
    reached.resolve()
    await released.promise
  })
  const restore = scopeAddressEnvironment(ORIGIN, descriptor.environmentId, observed)
  activateWorkspaceRoot('previous')
  const abort = new AbortController()
  const switched: string[] = []
  try {
    const pending = openWorkspaceRootForOwner(
      {
        queryClient: queryClientFor(ORIGIN),
        switchRootFolder: (entry) => switched.push(entry.path),
        workspaceStore: createEditorWorkspaceStore(),
        workspaceEdits: null,
      },
      'next',
      { signal: abort.signal },
    )
    await reached.promise
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('next')

    abort.abort()
    released.resolve()

    expect(await pending).toBe('superseded')
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('previous')
    expect(switched).toEqual([])
    const recents = await client.fs.recents.get({
      query: { limit: 30, mode: 'folder', showHidden: false },
    })
    expect(recents.data?.entries.map((entry) => entry.path)).not.toContain('next')
  } finally {
    released.resolve()
    activateWorkspaceRoot(null)
    restore()
  }
})
