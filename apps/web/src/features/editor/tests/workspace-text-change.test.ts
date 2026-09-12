import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorBufferSession } from '@singapor/core'
import { expect, test } from '../../../../test/fixtures'
import {
  createWorkspaceTextChanges,
  prepareTextTarget,
  textChangePreview,
} from '../../../../test/factories/workspace-text-changes'
import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { makeTestServer } from '../../../../test/server'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { getClient, setClient } from '@/lib/client'
import type {
  TextChangePreparation,
  TextChangeSource,
  TextChangeTarget,
} from '@/lib/workspace-edits/utils/types'

test('persists through the retained server after selected client changes and confirms only once', async ({
  client,
  server,
}) => {
  const other = await makeTestServer()
  const harness = createWorkspaceTextChanges(client)
  await writeFile(join(server.root, 'first.ts'), 'needle')
  await writeFile(join(other.root, 'first.ts'), 'needle other')
  const pending = harness.service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace',
      requireConfirmation: true,
      targets: [await prepareTextTarget(operation)],
    }),
  })
  const token = await textChangePreview(harness.service)
  const previous = getClient()
  try {
    setClient(createInProcessClient(other))
    harness.service.confirmPreview(token)
    harness.service.confirmPreview(token)
    expect(await pending).toEqual({ status: 'applied' })
    expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('pin')
    expect(await readFile(join(other.root, 'first.ts'), 'utf8')).toBe('needle other')
    expect(await harness.service.undo()).toBe(true)
    expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('needle')
  } finally {
    setClient(previous)
    await other.cleanup()
  }
})

test('rejects root A to B to A during an initial read', async ({ server }) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const started = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/read') return
    started.resolve()
    await gate.promise
  })
  const harness = createWorkspaceTextChanges(client)
  const pending = harness.service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace',
      requireConfirmation: true,
      targets: [await prepareTextTarget(operation)],
    }),
  })
  await started.promise
  harness.setRoot({ generation: 2, path: filesystemPath('other') })
  harness.setRoot({ generation: 3, path: filesystemPath(''), uriPath: filesystemPath('/') })
  gate.resolve()
  expect(await pending).toMatchObject({ status: 'failed', code: 'workspace-root-changed' })
  expect(harness.service.getSnapshot().preview).toBeNull()
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('needle')
})

test.for(['live-to-disk', 'disk-to-live', 'live-edited', 'live-replaced'] as const)(
  'rejects %s after source capture',
  async (change, { client, server }) => {
    await writeFile(join(server.root, 'first.ts'), 'needle')
    const harness = createWorkspaceTextChanges(client)
    const file = await fetchFile(filesystemPath('first.ts'), new AbortController().signal, client)
    if (change !== 'disk-to-live') harness.store.getState().ensureLiveEditorDocument(file)
    const result = await harness.service.applyTextChange({
      source: 'search-replace',
      signal: new AbortController().signal,
      prepare: async (operation) => {
        const target = await prepareTextTarget(operation)
        const state = harness.store.getState()
        if (change === 'live-to-disk') state.deleteLiveEditorDocument(fileDocumentKey(file.path))
        if (change === 'disk-to-live') state.ensureLiveEditorDocument(file)
        if (change === 'live-replaced')
          state.forceReplaceLiveEditorDocument({ ...file, content: 'newer' })
        if (change === 'live-edited')
          createEditorBufferSession(
            state.getLiveEditorDocument(fileDocumentKey(file.path))!.buffer,
          ).applyText('!')
        return { label: 'Replace', requireConfirmation: true, targets: [target] }
      },
    })
    expect(result).toMatchObject({ status: 'failed', code: 'snapshot-drift' })
    expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('needle')
  },
)

test('rejects forged sources and sources issued by an earlier operation', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const retained: TextChangeSource[] = []
  await service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => {
      retained.push(await operation.readText(filesystemPath('first.ts')))
      return { label: 'Empty', requireConfirmation: false, targets: [] }
    },
  })
  for (const source of [retained[0]!, { ...retained[0]!, path: filesystemPath('second.ts') }]) {
    const result = await service.applyTextChange({
      source: 'search-replace',
      signal: new AbortController().signal,
      prepare: async () => ({
        label: 'Invalid',
        requireConfirmation: true,
        targets: [{ source, edits: [{ from: 0, to: 6, text: 'bad' }] }],
      }),
    })
    expect(result).toMatchObject({ status: 'failed', code: 'invalid-source' })
  }
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('needle')
})

test('reuses one source and rejects duplicate canonical targets', async ({ client, server }) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const result = await service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => {
      const target = await prepareTextTarget(operation)
      expect(await operation.readText(filesystemPath('first.ts'))).toBe(target.source)
      return { label: 'Duplicate', requireConfirmation: true, targets: [target, target] }
    },
  })
  expect(result).toMatchObject({ status: 'failed', code: 'duplicate-target' })
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('needle')
})

test('settles planner exceptions and closes escaped readers', async ({ client, server }) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const escaped: TextChangePreparation[] = []
  const result = await service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => {
      escaped.push(operation)
      await prepareTextTarget(operation)
      throw new TypeError('planner failed')
    },
  })
  expect(result.status).toBe('failed')
  expect(service.canMutateWorkspace()).toBe(true)
  expect(() => escaped[0]!.readText(filesystemPath('first.ts'))).toThrow(
    'Text preparation has finished',
  )
})

test('does not invoke a planner whose signal is already aborted', async ({ client }) => {
  const { service } = createWorkspaceTextChanges(client)
  const controller = new AbortController()
  controller.abort()
  let plannerCalls = 0
  const result = await service.applyTextChange({
    source: 'search-replace',
    signal: controller.signal,
    prepare: async (operation) => {
      plannerCalls += 1
      return {
        label: 'Cancelled',
        requireConfirmation: true,
        targets: [await prepareTextTarget(operation)],
      }
    },
  })
  expect(result).toEqual({ status: 'cancelled' })
  expect(plannerCalls).toBe(0)
  expect(service.canMutateWorkspace()).toBe(true)
})

test('observes a planner rejection after the planner synchronously aborts', async ({ client }) => {
  const { service } = createWorkspaceTextChanges(client)
  const controller = new AbortController()
  let plannerCalls = 0
  const result = await service.applyTextChange({
    source: 'search-replace',
    signal: controller.signal,
    prepare: async (operation) => {
      plannerCalls += 1
      controller.abort()
      return {
        label: 'Cancelled',
        requireConfirmation: true,
        targets: [await prepareTextTarget(operation)],
      }
    },
  })
  expect(result).toEqual({ status: 'cancelled' })
  expect(plannerCalls).toBe(1)
  expect(service.canMutateWorkspace()).toBe(true)
  await new Promise<void>((resolve) => setImmediate(resolve))
})

test('supersedes a paused planner and ignores its late targets and preview tokens', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const first = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => {
      const target = await prepareTextTarget(operation)
      started.resolve()
      await gate.promise
      return { label: 'Old', requireConfirmation: true, targets: [target] }
    },
  })
  await started.promise
  const second = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'New',
      requireConfirmation: true,
      targets: [await prepareTextTarget(operation)],
    }),
  })
  expect(await first).toEqual({ status: 'cancelled' })
  const secondToken = await textChangePreview(service)
  gate.resolve()
  service.confirmPreview('old-operation')
  service.cancelPreview('old-operation')
  expect(service.getSnapshot().preview?.operationId).toBe(secondToken)
  service.confirmPreview(secondToken)
  expect(await second).toEqual({ status: 'applied' })
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('pin')
})

test('retained target and edit arrays cannot change an accepted preview', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const edits = [{ from: 0, to: 6, text: 'pin' }]
  const targets: TextChangeTarget[] = []
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => {
      targets.push({ source: await operation.readText(filesystemPath('first.ts')), edits })
      return { label: 'Immutable', requireConfirmation: true, targets }
    },
  })
  const token = await textChangePreview(service)
  expect(Object.isFrozen(service.getSnapshot().preview?.rows[0])).toBe(true)
  expect(Object.isFrozen(service.getSnapshot().preview?.rows[0]?.annotationIds)).toBe(true)
  edits[0]!.text = 'corrupted'
  targets.length = 0
  service.confirmPreview(token)
  expect(await pending).toEqual({ status: 'applied' })
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('pin')
})

test('stale confirmation and cancellation tokens cannot affect the next displayed preview', async ({
  client,
  server,
}) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const request = {
    source: 'search-replace' as const,
    signal: new AbortController().signal,
    prepare: async (operation: TextChangePreparation) => ({
      label: 'Replace',
      requireConfirmation: true,
      targets: [await prepareTextTarget(operation)],
    }),
  }
  const first = service.applyTextChange(request)
  const firstToken = await textChangePreview(service)
  const second = service.applyTextChange(request)
  expect(await first).toEqual({ status: 'cancelled' })
  const secondToken = await textChangePreview(service)
  expect(secondToken).not.toBe(firstToken)
  service.confirmPreview(firstToken)
  service.cancelPreview(firstToken)
  expect(service.getSnapshot()).toMatchObject({
    phase: 'awaiting-confirmation',
    preview: { operationId: secondToken },
  })
  service.confirmPreview(secondToken)
  expect(await second).toEqual({ status: 'applied' })
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('pin')
})

test('aborted local-only preview leaves live text unchanged', async ({ client, server }) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const harness = createWorkspaceTextChanges(client)
  const live = harness.store
    .getState()
    .ensureLiveEditorDocument(
      await fetchFile(filesystemPath('first.ts'), new AbortController().signal, client),
    )
  const controller = new AbortController()
  const pending = harness.service.applyTextChange({
    source: 'search-replace',
    signal: controller.signal,
    prepare: async (operation) => ({
      label: 'Local',
      requireConfirmation: true,
      targets: [await prepareTextTarget(operation)],
    }),
  })
  const token = await textChangePreview(harness.service)
  controller.abort()
  harness.service.confirmPreview(token)
  expect(await pending).toEqual({ status: 'cancelled' })
  expect(live.buffer.materializeFullText()).toBe('needle')
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('needle')
})

test('rejects disk drift during confirmation', async ({ client, server }) => {
  await writeFile(join(server.root, 'first.ts'), 'needle')
  const { service } = createWorkspaceTextChanges(client)
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace',
      requireConfirmation: true,
      targets: [await prepareTextTarget(operation)],
    }),
  })
  const token = await textChangePreview(service)
  await writeFile(join(server.root, 'first.ts'), 'newer')
  service.confirmPreview(token)
  expect((await pending).status).toBe('failed')
  expect(await readFile(join(server.root, 'first.ts'), 'utf8')).toBe('newer')
})
