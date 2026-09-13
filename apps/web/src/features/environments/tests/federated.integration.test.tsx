import { filesystemPath } from '@/lib/documents/utils/identity'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { waitFor } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { transportFor } from '@/features/chat/state/active-transports'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { queryClientFor, clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchFile } from '@/lib/file-server'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../test/factories/federation'
import { expect, test } from '../../../../test/fixtures'

test('two machines keep live projections and retained buffers, with isolated disconnect, alias and identity drift', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const a = await registerFederatedProject(h.serverA, h.clientA, 'A')
  const b = await registerFederatedProject(h.serverB, h.clientB, 'B')
  const idA = h.descriptorA.environmentId
  const idB = h.descriptorB.environmentId
  await waitFor(() =>
    expect(sessionRailModel({ environments: currentRailEnvironments() }).sessions).toHaveLength(2),
  )
  const model = sessionRailModel({ environments: currentRailEnvironments() })
  expect(a.projectId).toBe(b.projectId)
  expect(model.projects).toHaveLength(1)
  expect(model.sessions.map((row) => row.machineLabel)).toContain('Remote fixture')
  expect(currentRailEnvironments().flatMap((entry) => entry.worktrees)).toHaveLength(2)
  const transportA = transportFor(idA)
  const transportB = transportFor(idB)
  const editorA = h.application.getSnapshot().editor
  const documentA = editorA.documentStore
    .getState()
    .ensureLiveEditorDocument(
      await fetchFile(filesystemPath('repo/shared.txt'), new AbortController().signal, h.clientA),
    )
  createEditorBufferSession(documentA.buffer).applyText(' dirty A')
  h.application.activateEnvironment(h.originB)
  const editorB = h.application.getSnapshot().editor
  const documentB = editorB.documentStore
    .getState()
    .ensureLiveEditorDocument(
      await fetchFile(filesystemPath('repo/shared.txt'), new AbortController().signal, h.clientB),
    )
  createEditorBufferSession(documentB.buffer).applyText(' saved B')
  await editorB.saveService.save(documentB.key)
  expect(await readFile(join(h.serverA.root, 'repo/shared.txt'), 'utf8')).toBe('A')
  expect(await readFile(join(h.serverB.root, 'repo/shared.txt'), 'utf8')).toBe('B saved B')
  h.application.activateEnvironment(h.originA)
  expect(h.application.getSnapshot().editor).toBe(editorA)
  expect(documentA.buffer.materializeFullText()).toBe('A dirty A')
  expect(transportFor(idA)).toBe(transportA)
  expect(transportFor(idB)).toBe(transportB)
  const owner = clientForQueryClient(queryClientFor(h.originA))
  await h.connections.connectMachine('alias')
  await h.connections.disconnectMachine('alias')
  expect(transportFor(idA)).toBe(transportA)
  expect(useEnvironmentsStore.getState().entries[h.originA]?.phase).toBe('live')
  expect(clientForQueryClient(queryClientFor(h.originA))).toBe(owner)
  h.cutConnection(h.originB)
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('reconnecting'),
  )
  expect(sessionRailModel({ environments: currentRailEnvironments() }).sessions).toHaveLength(2)
  expect(transportFor(idA)?.closed).toBe(false)
  await h.serverB.restart()
  h.restoreConnection(h.originB)
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('live'),
  )
  const beforeDrift = useChatProjectionStore.getState().slices[idB]
  h.sockets
    .get(h.originB)!
    .at(-1)!
    .deliver({ kind: 'connected', config: orchestrationServerConfig({ environmentId: idA }) })
  await waitFor(() =>
    expect(useEnvironmentsStore.getState().connectionByOrigin[h.originB]?.phase).toBe(
      'identity-drift',
    ),
  )
  expect(useChatProjectionStore.getState().slices[idB]).toBe(beforeDrift)
  expect(h.application.getSnapshot().editor).toBe(editorA)
})

test('start-stop-start recreates chat for configured machines without another runtime', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('live'),
  )
  const editor = h.application.getSnapshot().editor
  const previous = transportFor(h.descriptorB.environmentId)
  h.connections.stop()
  expect(previous?.closed).toBe(true)
  h.connections.start()
  await waitFor(() => expect(transportFor(h.descriptorB.environmentId)?.closed).toBe(false))
  expect(transportFor(h.descriptorB.environmentId)).not.toBe(previous)
  expect(h.application.getSnapshot().editor).toBe(editor)
})
