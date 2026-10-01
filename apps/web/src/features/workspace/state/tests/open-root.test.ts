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

test('an abandoned open leaves a newer open of the same folder in charge', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'next'))
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  const reached = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  let opens = 0
  const observed = createObservedInProcessClient(server, async (request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/fs/workspace-root') return
    const index = opens++
    reached[index]?.resolve()
    await gates[index]?.promise
  })
  const restore = scopeAddressEnvironment(ORIGIN, descriptor.environmentId, observed)
  activateWorkspaceRoot('previous')
  const switched: string[] = []
  const owner = {
    queryClient: queryClientFor(ORIGIN),
    switchRootFolder: (entry: { readonly path: string }) => switched.push(entry.path),
    workspaceStore: createEditorWorkspaceStore(),
    workspaceEdits: null,
  }
  const abort = new AbortController()
  try {
    const first = openWorkspaceRootForOwner(owner, 'next', { signal: abort.signal })
    await reached[0]?.promise
    abort.abort()
    const second = openWorkspaceRootForOwner(owner, 'next')
    await reached[1]?.promise
    gates[0]?.resolve()
    expect(await first).toBe('superseded')
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('next')

    gates[1]?.resolve()
    expect(await second).toBe('opened')
    expect(switched).toEqual(['next'])
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('next')
  } finally {
    for (const gate of gates) gate.resolve()
    activateWorkspaceRoot(null)
    restore()
  }
})

test('when every open of a folder is abandoned, the project goes back to the last one that landed', async ({
  client,
  server,
}) => {
  await mkdir(path.join(server.root, 'next'))
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  const reached = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  let opens = 0
  const observed = createObservedInProcessClient(server, async (request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/fs/workspace-root') return
    const index = opens++
    reached[index]?.resolve()
    await gates[index]?.promise
  })
  const restore = scopeAddressEnvironment(ORIGIN, descriptor.environmentId, observed)
  activateWorkspaceRoot('previous')
  const switched: string[] = []
  const owner = {
    queryClient: queryClientFor(ORIGIN),
    switchRootFolder: (entry: { readonly path: string }) => switched.push(entry.path),
    workspaceStore: createEditorWorkspaceStore(),
    workspaceEdits: null,
  }
  const aborts = [new AbortController(), new AbortController()]
  try {
    const first = openWorkspaceRootForOwner(owner, 'next', { signal: aborts[0]?.signal })
    await reached[0]?.promise
    aborts[0]?.abort()
    const second = openWorkspaceRootForOwner(owner, 'next', { signal: aborts[1]?.signal })
    await reached[1]?.promise
    gates[0]?.resolve()
    expect(await first).toBe('superseded')

    aborts[1]?.abort()
    gates[1]?.resolve()
    expect(await second).toBe('superseded')
    expect(switched).toEqual([])
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('previous')
  } finally {
    for (const gate of gates) gate.resolve()
    activateWorkspaceRoot(null)
    restore()
  }
})

test('a switch that throws hands the active project back', async ({ client, server }) => {
  await mkdir(path.join(server.root, 'next'))
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const restore = scopeAddressEnvironment(ORIGIN, descriptor.environmentId, client)
  activateWorkspaceRoot('previous')
  try {
    const result = await openWorkspaceRootForOwner(
      {
        queryClient: queryClientFor(ORIGIN),
        switchRootFolder: () => {
          throw new TypeError('switch failed')
        },
        workspaceStore: createEditorWorkspaceStore(),
        workspaceEdits: null,
      },
      'next',
    )

    expect(result).toBe('failed')
    expect(useActiveProjectStore.getState().workspaceRoot).toBe('previous')
  } finally {
    activateWorkspaceRoot(null)
    restore()
  }
})
