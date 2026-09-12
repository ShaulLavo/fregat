import { initLogger } from 'evlog'
import { vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { environmentIdSchema } from '@workspace/contracts'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'

import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile, fetchTree } from '@/lib/file-server'
import { createInProcessClient, createObservedInProcessClient } from '../../../test/client'
import { createRequestGate } from '../../../test/factories/request-gate'
import { expect, test } from '../../../test/fixtures'
import { makeTestServer } from '../../../test/server'

test('delayed file reads and tree batches retain separate owners through selection and flush', async ({
  server,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const gate = createRequestGate((request) =>
    ['/fs/read', '/fs/tree'].includes(new URL(request.url).pathname),
  )
  const clientA = createObservedInProcessClient(server, gate.beforeRequest)
  const clientB = createInProcessClient(secondServer)
  const originA = activeServerOrigin()
  const originB = 'http://localhost:3497'
  const previousA = getClient()
  const previousEnvironments = useEnvironmentsStore.getState()
  const idA = v.parse(environmentIdSchema, '01900000-0000-4000-8000-000000000097')
  const idB = v.parse(environmentIdSchema, '01900000-0000-4000-8000-000000000098')
  setClient(clientA)
  setActiveServerOrigin(originB)
  const previousB = getClient()
  setClient(clientB)
  useEnvironmentsStore.setState({
    entries: {
      [originA]: {
        ...createEnvironmentEntry(originA, originA),
        environmentId: idA,
        name: 'machine-a',
      },
      [originB]: {
        ...createEnvironmentEntry(originB, originA),
        environmentId: idB,
        name: 'machine-b',
      },
    },
  })
  const events: Record<string, unknown>[] = []
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  initLogger({
    enabled: true,
    silent: true,
    drain: ({ event }) => {
      events.push(event)
    },
  })

  try {
    await mkdir(path.join(server.root, 'folder'))
    await mkdir(path.join(secondServer.root, 'folder'))
    await writeFile(path.join(server.root, 'shared.txt'), 'owner A')
    await writeFile(path.join(secondServer.root, 'shared.txt'), 'owner B has different bytes')
    setActiveServerOrigin(originA)
    const signal = new AbortController().signal
    const readingA = fetchFile(filesystemPath('shared.txt'), signal, clientA)
    const treeA = fetchTree(filesystemPath(''), signal, clientA)
    await gate.entered
    setActiveServerOrigin(originB)
    const readingB = fetchFile(filesystemPath('shared.txt'), signal, clientB)
    const treeB = fetchTree(filesystemPath(''), signal, clientB)
    gate.release()
    const [fileA, fileB] = await Promise.all([readingA, readingB, treeA, treeB])
    expect(fileA).toMatchObject({ content: 'owner A' })
    expect(fileB).toMatchObject({ content: 'owner B has different bytes' })
    await Promise.all([
      fetchTree(filesystemPath('folder'), signal, clientA),
      fetchTree(filesystemPath('folder'), signal, clientB),
    ])
    setActiveServerOrigin(originA)
    await vi.waitFor(() => expect(events.filter(isFileEvent)).toHaveLength(4))
    const fileEvents = events.filter(isFileEvent)
    for (const [environmentId, machine] of [
      [idA, 'machine-a'],
      [idB, 'machine-b'],
    ]) {
      expect(fileEvents.filter((event) => event.environmentId === environmentId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'fs.read',
            coalescedCount: 1,
            environmentId,
            machine,
            path: 'shared.txt',
          }),
          expect.objectContaining({
            action: 'fs.tree',
            coalescedCount: 2,
            environmentId,
            machine,
            pathCount: 2,
          }),
        ]),
      )
    }
  } finally {
    gate.release()
    initLogger({ enabled: false })
    vi.unstubAllEnvs()
    setActiveServerOrigin(originB)
    setClient(previousB)
    setActiveServerOrigin(originA)
    setClient(previousA)
    useEnvironmentsStore.setState(previousEnvironments, true)
    await secondServer.cleanup()
  }
})

function isFileEvent(event: Record<string, unknown>) {
  return event.runtime === 'browser' && (event.action === 'fs.read' || event.action === 'fs.tree')
}
