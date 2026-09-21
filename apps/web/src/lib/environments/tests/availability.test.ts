import { filesystemPath } from '@/lib/documents/utils/identity'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { QueryClient } from '@tanstack/react-query'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { fetchFile } from '@/lib/file-server'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test('offline A refuses saves without changing its buffer while B saves through its captured owner', async ({
  server,
  client,
}) => {
  const previous = useEnvironmentsStore.getState()
  const serverB = await makeTestServer({ filesystemWatch: false })
  const clientB = createInProcessClient(serverB)
  const queriesA = new QueryClient()
  const queriesB = new QueryClient()
  const originA = 'http://localhost:38078'
  const originB = 'http://localhost:38079'
  registerEnvironmentQueryClient(queriesA, originA, client)
  registerEnvironmentQueryClient(queriesB, originB, clientB)
  const documentsA = createEditorDocumentStore()
  const documentsB = createEditorDocumentStore()
  const savesA = new FileSyncService(documentsA, queriesA)
  const savesB = new FileSyncService(documentsB, queriesB)
  try {
    await Promise.all([
      writeFile(join(server.root, 'same.txt'), 'A'),
      writeFile(join(serverB.root, 'same.txt'), 'B'),
    ])
    const [fileA, fileB] = await Promise.all([
      fetchFile(filesystemPath('same.txt'), new AbortController().signal, client),
      fetchFile(filesystemPath('same.txt'), new AbortController().signal, clientB),
    ])
    const documentA = documentsA.getState().ensureLiveEditorDocument(fileA)
    const documentB = documentsB.getState().ensureLiveEditorDocument(fileB)
    createEditorBufferSession(documentA.buffer).applyText(' dirty')
    createEditorBufferSession(documentB.buffer).applyText(' saved')
    const environments = useEnvironmentsStore.getState()
    environments.describeMachine(originA, {
      kind: 'origin',
      name: 'machine-a',
      label: 'Machine A',
      localPort: null,
    })
    environments.describeMachine(originB, {
      kind: 'origin',
      name: 'machine-b',
      label: 'Machine B',
      localPort: null,
    })
    environments.setPhase(originA, 'live')
    environments.setPhase(originB, 'live')
    environments.setPhase(originA, 'offline')
    await expect(savesA.save(documentA)).rejects.toMatchObject({
      code: 'environment.MACHINE_UNAVAILABLE',
      fix: expect.stringContaining('Machine A'),
    })
    await savesB.save(documentB)
    expect(await readFile(join(server.root, 'same.txt'), 'utf8')).toBe('A')
    expect(await readFile(join(serverB.root, 'same.txt'), 'utf8')).toBe('B saved')
    expect(documentA.buffer.materializeFullText()).toBe('A dirty')
    expect(documentA.buffer.isDirty()).toBe(true)
    environments.setPhase(originA, 'live')
    await savesA.save(documentA)
    expect(await readFile(join(server.root, 'same.txt'), 'utf8')).toBe('A dirty')
  } finally {
    queriesA.clear()
    queriesB.clear()
    useEnvironmentsStore.setState(previous, true)
    await serverB.cleanup()
  }
})

test('an initial idle owner remains usable while idle after a live connection blocks writes', () => {
  const previous = useEnvironmentsStore.getState()
  const origin = 'http://localhost:38080'
  try {
    const environments = useEnvironmentsStore.getState()
    environments.addEnvironment(origin)
    expect(() => assertEnvironmentWritable(origin)).not.toThrow()
    environments.setPhase(origin, 'live')
    environments.setPhase(origin, 'idle')
    expect(() => assertEnvironmentWritable(origin)).toThrow(
      expect.objectContaining({ code: 'environment.MACHINE_UNAVAILABLE' }),
    )
  } finally {
    useEnvironmentsStore.setState(previous, true)
  }
})

test('retrying a cached owner refuses saves until its connection becomes live', async ({
  server,
  client,
}) => {
  const previous = useEnvironmentsStore.getState()
  const origin = 'http://localhost:38081'
  const queries = new QueryClient()
  registerEnvironmentQueryClient(queries, origin, client)
  const documents = createEditorDocumentStore()
  const saves = new FileSyncService(documents, queries)
  try {
    await writeFile(join(server.root, 'cached.txt'), 'cached')
    const file = await fetchFile(filesystemPath('cached.txt'), new AbortController().signal, client)
    const document = documents.getState().ensureLiveEditorDocument(file)
    createEditorBufferSession(document.buffer).applyText(' edited')
    const environments = useEnvironmentsStore.getState()
    environments.restoreDescriptor(
      origin,
      v.parse(healthDescriptorSchema, (await client.health.get()).data),
    )
    expect(useEnvironmentsStore.getState().entries[origin]?.connectedAt).toBeNull()
    for (const phase of ['offline', 'launching', 'connecting'] as const) {
      environments.setPhase(origin, phase)
      await expect(saves.save(document)).rejects.toMatchObject({
        code: 'environment.MACHINE_UNAVAILABLE',
      })
    }
    expect(await readFile(join(server.root, 'cached.txt'), 'utf8')).toBe('cached')
    expect(document.buffer.materializeFullText()).toBe('cached edited')
    expect(document.buffer.isDirty()).toBe(true)
    environments.setPhase(origin, 'live')
    await saves.save(document)
    expect(await readFile(join(server.root, 'cached.txt'), 'utf8')).toBe('cached edited')
  } finally {
    queries.clear()
    useEnvironmentsStore.setState(previous, true)
  }
})
