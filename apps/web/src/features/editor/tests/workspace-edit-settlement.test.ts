import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { nodeWorkspaceEditFileSystemDriver } from 'server/testing'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { expect, test } from '../../../../test/fixtures'
import {
  createWorkspaceTextChanges,
  textChangePreview,
} from '../../../../test/factories/workspace-text-changes'
import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { installTestEnvironment } from '../../../../test/factories/client-binding'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { makeTestServer } from '../../../../test/server'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { fetchFile } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fileSystemKeys } from '@/lib/query-keys'
import { runSearch } from '@/features/search/utils/buffer-runner'
import { DiskSearchProvider } from '@/features/search/utils/providers'
import type { WorkspaceSearchQuery } from '@workspace/contracts'
import {
  WorkspaceEditService,
  type WorkspaceEditRoot,
  type WorkspaceEditServicePhase,
} from '@/features/editor/state/workspace-edit-service'

test('notifies once after disk text and history settle, before Undo and Redo resolve', async ({
  client,
  server,
  onTestFinished,
}) => {
  await writeFile(join(server.root, 'live.ts'), 'before')
  await writeFile(join(server.root, 'disk.ts'), 'before')
  const fixture = createWorkspaceTextChanges(client)
  fixture.service.dispose()
  const live = fixture.store
    .getState()
    .ensureLiveEditorDocument(
      await fetchFile(filesystemPath('live.ts'), new AbortController().signal, client),
    )
  let resolved = false
  const observations: {
    rootPath: string
    text: string
    disk: string
    barrier: boolean
    phase: WorkspaceEditServicePhase
    resolved: boolean
  }[] = []
  const service = new WorkspaceEditService({
    owner: clientLogContext(client),
    documentStore: fixture.store,
    fileSync: fixture.fileSync,
    getRoot: () => ({ generation: 1, path: filesystemPath(''), uriPath: filesystemPath('/') }),
    onHistorySettled: (rootPath) => {
      observations.push({
        rootPath,
        text: live.buffer.materializeFullText(),
        disk: readFileSync(join(server.root, 'disk.ts'), 'utf8'),
        barrier: service.hasHistoryBarrier(live.buffer),
        phase: service.getSnapshot().phase,
        resolved,
      })
    },
  })
  onTestFinished(() => service.dispose())
  expect(await service.undo()).toBe(false)
  expect(await service.redo()).toBe(false)
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace text',
      requireConfirmation: true,
      targets: await Promise.all(
        ['live.ts', 'disk.ts'].map(async (path) => ({
          source: await operation.readText(filesystemPath(path)),
          edits: [{ from: 0, to: 6, text: 'after' }],
        })),
      ),
    }),
  })
  service.confirmPreview(await textChangePreview(service))
  expect(await pending).toEqual({ status: 'applied' })
  expect(observations).toEqual([])

  expect(await service.undo().then((result) => ((resolved = true), result))).toBe(true)
  expect(observations).toEqual([
    {
      rootPath: '',
      text: 'before',
      disk: 'before',
      barrier: false,
      phase: 'undoing',
      resolved: false,
    },
  ])
  expect(service.getSnapshot()).toMatchObject({ phase: 'applied', canRedo: true, canUndo: false })
  expect(await service.undo()).toBe(false)
  resolved = false
  expect(await service.redo().then((result) => ((resolved = true), result))).toBe(true)
  expect(observations[1]).toEqual({
    rootPath: '',
    text: 'after',
    disk: 'after',
    barrier: true,
    phase: 'redoing',
    resolved: false,
  })
  expect(await service.redo()).toBe(false)
  await writeFile(join(server.root, 'disk.ts'), 'external')
  expect(await service.undo()).toBe(false)
  expect(service.getSnapshot().phase).toBe('stale')
  expect(live.buffer.materializeFullText()).toBe('after')
  expect(readFileSync(join(server.root, 'disk.ts'), 'utf8')).toBe('external')
  expect(observations).toHaveLength(2)
})

test('retains the prepared document root through a held transition and discarded projection', async ({
  server,
  onTestFinished,
}) => {
  const held = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const observedClient = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/workspace-edit/undo') return
    held.resolve()
    await release.promise
  })
  await mkdir(join(server.root, 'repo'))
  await writeFile(join(server.root, 'repo', 'disk.ts'), 'before')
  const fixture = createWorkspaceTextChanges(observedClient)
  fixture.service.dispose()
  let root: WorkspaceEditRoot = {
    generation: 1,
    path: filesystemPath('repo'),
    uriPath: filesystemPath('/repo'),
    workspacePath: filesystemPath('repo'),
  }
  const notifications: string[] = []
  const service = new WorkspaceEditService({
    owner: clientLogContext(observedClient),
    documentStore: fixture.store,
    fileSync: fixture.fileSync,
    getRoot: () => root,
    onHistorySettled: (rootPath) => notifications.push(rootPath),
  })
  onTestFinished(() => service.dispose())
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace text',
      requireConfirmation: true,
      targets: [
        {
          source: await operation.readText(filesystemPath('repo/disk.ts')),
          edits: [{ from: 0, to: 6, text: 'after' }],
        },
      ],
    }),
  })
  service.confirmPreview(await textChangePreview(service))
  expect(await pending).toEqual({ status: 'applied' })
  await fixture.fileSync.reconcileWorkspaceMutationProjection(filesystemPath('repo'), [
    filesystemPath('repo/disk.ts'),
  ])
  const firstUndo = service.undo()
  await held.promise
  try {
    root = { generation: 2, path: filesystemPath('other'), uriPath: filesystemPath('/other') }
    expect(notifications).toEqual([])
    expect(await service.undo()).toBe(false)
  } finally {
    release.resolve()
  }
  expect(await firstUndo).toBe(true)
  expect(notifications).toEqual(['repo'])
  expect(await service.redo()).toBe(true)
  expect(notifications).toEqual(['repo', 'repo'])
  expect(readFileSync(join(server.root, 'repo', 'disk.ts'), 'utf8')).toBe('after')
})

test.for([false, true])(
  'isolates synchronous settlement failure with persisted=%s',
  async (persisted, { client, server, onTestFinished }) => {
    await writeFile(join(server.root, 'first.ts'), 'before')
    await writeFile(join(server.root, 'disk.ts'), 'before')
    const fixture = createWorkspaceTextChanges(client)
    fixture.service.dispose()
    const live = fixture.store
      .getState()
      .ensureLiveEditorDocument(
        await fetchFile(filesystemPath('first.ts'), new AbortController().signal, client),
      )
    let calls = 0
    const service = new WorkspaceEditService({
      owner: clientLogContext(client),
      documentStore: fixture.store,
      fileSync: fixture.fileSync,
      getRoot: () => ({ generation: 1, path: filesystemPath(''), uriPath: filesystemPath('/') }),
      onHistorySettled: () => {
        calls += 1
        throw new TypeError('Injected invalidation failure')
      },
    })
    onTestFinished(() => service.dispose())
    createEditorBufferSession(live.buffer).applyText('dirty')
    const dirtyText = live.buffer.materializeFullText()
    const pending = service.applyTextChange({
      source: 'search-replace',
      signal: new AbortController().signal,
      prepare: async (operation) => ({
        label: 'Replace text',
        requireConfirmation: true,
        targets: [
          {
            source: await operation.readText(filesystemPath('first.ts')),
            edits: [{ from: 0, to: dirtyText.length, text: 'after' }],
          },
        ].concat(
          persisted
            ? [
                {
                  source: await operation.readText(filesystemPath('disk.ts')),
                  edits: [{ from: 0, to: 6, text: 'after' }],
                },
              ]
            : [],
        ),
      }),
    })
    service.confirmPreview(await textChangePreview(service))
    expect(await pending).toEqual({ status: 'applied' })
    expect(await service.undo()).toBe(true)
    expect(live.buffer.materializeFullText()).toBe(dirtyText)
    expect(readFileSync(join(server.root, 'disk.ts'), 'utf8')).toBe('before')
    expect(service.getSnapshot()).toMatchObject({ phase: 'applied', canRedo: true })
    expect(await service.redo()).toBe(true)
    expect(live.buffer.materializeFullText()).toBe('after')
    expect(readFileSync(join(server.root, 'disk.ts'), 'utf8')).toBe(persisted ? 'after' : 'before')
    expect(readFileSync(join(server.root, 'first.ts'), 'utf8')).toBe('before')
    expect(calls).toBe(2)
  },
)

test('the captured runtime refreshes its Search owner after a held finalize and isolates a read error', async ({
  client,
  server,
  onTestFinished,
}) => {
  const held = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let pauseFinalize = false
  const observedClient = createObservedInProcessClient(server, async (request) => {
    if (!pauseFinalize || new URL(request.url).pathname !== '/fs/workspace-edit/finalize') return
    held.resolve()
    await release.promise
  })
  const restoreClient = await installTestEnvironment('http://localhost:38383', observedClient)
  onTestFinished(restoreClient)
  await mkdir(join(server.root, 'repo'))
  await writeFile(join(server.root, 'repo', 'disk.ts'), 'before')
  const workspaceAddress = await registerTestWorkspaceAddress(client, 'repo')
  const application = createTestApplicationRuntime()
  const first = application.getSnapshot().editor
  first.workspaceStore.getState().switchWorkspace({
    workspaceAddress,
    birthtimeMs: 0,
    mtimeMs: 0,
    name: 'repo',
    path: filesystemPath('repo'),
    size: 0,
    type: 'directory',
    version: '',
  })
  first.searchBufferStore.getState().prepareBuffer('repo')
  first.searchBufferStore.getState().setQuery('repo', 'before')
  const service = first.workspaceEditService
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace text',
      requireConfirmation: true,
      targets: [
        {
          source: await operation.readText(filesystemPath('repo/disk.ts')),
          edits: [{ from: 0, to: 6, text: 'after' }],
        },
      ],
    }),
  })
  service.confirmPreview(await textChangePreview(service))
  expect(await pending).toEqual({ status: 'applied' })
  const beforeRevision = first.searchBufferStore.getState().active!.searchRevision
  const snapshots: { phase: WorkspaceEditServicePhase; disk: string; resolved: boolean }[] = []
  const failingRead = createObservedInProcessClient(server, (request) => {
    if (new URL(request.url).pathname === '/fs/search/events')
      throw new TypeError('Injected Search read failure')
  })
  const query: WorkspaceSearchQuery = {
    path: 'repo',
    query: 'before',
    includeContent: true,
    limit: 100,
  }
  const reads: Promise<void>[] = []
  let resolved = false
  const unsubscribe = first.searchBufferStore.subscribe((state, previous) => {
    if (state.active?.searchRevision === previous.active?.searchRevision) return
    snapshots.push({
      phase: service.getSnapshot().phase,
      disk: readFileSync(join(server.root, 'repo', 'disk.ts'), 'utf8'),
      resolved,
    })
    const runId = state.startSearch(query)
    reads.push(
      runSearch(
        new DiskSearchProvider(failingRead),
        query,
        runId,
        first.searchBufferStore,
        new AbortController().signal,
      ),
    )
  })
  onTestFinished(unsubscribe)
  pauseFinalize = true
  const reversing = service.undo().then((result) => {
    resolved = true
    return result
  })
  await held.promise
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const restoreEnvironment = await installTestEnvironment(
    'http://localhost:38384',
    createInProcessClient(secondServer),
  )
  try {
    application.activateEnvironment('http://localhost:38384')
    const second = application.getSnapshot().editor
    expect(second).not.toBe(first)
    second.searchBufferStore.getState().prepareBuffer('repo')
    second.searchBufferStore.getState().setQuery('repo', 'before')
    const secondRevision = second.searchBufferStore.getState().active!.searchRevision
    expect(snapshots).toEqual([])
    expect(service.getSnapshot().phase).toBe('undoing')
    release.resolve()
    expect(await reversing).toBe(true)
    expect(snapshots).toEqual([{ phase: 'undoing', disk: 'before', resolved: false }])
    expect(first.searchBufferStore.getState().active?.searchRevision).toBe(beforeRevision + 1)
    expect(second.searchBufferStore.getState().active?.searchRevision).toBe(secondRevision)
    expect(
      first.queryClient.getQueryData(fileSystemKeys.fileSnapshot('repo/disk.ts')),
    ).toMatchObject({ content: 'before' })

    expect(reads).toHaveLength(1)
    await Promise.all(reads)
    expect(first.searchBufferStore.getState().active?.status).toBe('error')
    expect(service.getSnapshot()).toMatchObject({ phase: 'applied', canUndo: false, canRedo: true })
    expect(readFileSync(join(server.root, 'repo', 'disk.ts'), 'utf8')).toBe('before')
    resolved = false
    expect(await service.redo()).toBe(true)
    expect(reads).toHaveLength(2)
    await Promise.all(reads)
    expect(snapshots[1]).toEqual({ phase: 'redoing', disk: 'after', resolved: false })
    expect(first.searchBufferStore.getState().active?.searchRevision).toBe(beforeRevision + 2)
    expect(second.searchBufferStore.getState().active?.searchRevision).toBe(secondRevision)
  } finally {
    release.resolve()
    await reversing
    application.dispose()
    restoreEnvironment()
    await secondServer.cleanup()
  }
})

test('failed and partial recovery paths do not notify history settlement', async ({
  onTestFinished,
}) => {
  let reversing = false
  let firstReversals = 0
  const server = await makeTestServer({
    filesystemWatch: false,
    workspaceEditDriver: {
      ...nodeWorkspaceEditFileSystemDriver,
      rename(from, to) {
        if (!reversing) return nodeWorkspaceEditFileSystemDriver.rename(from, to)
        const name = basename(to)
        if (name === 'b.ts') firstReversals += 1
        if (name !== 'a.ts' && (name !== 'b.ts' || firstReversals === 1)) {
          return nodeWorkspaceEditFileSystemDriver.rename(from, to)
        }
        return nodeWorkspaceEditFileSystemDriver.rename(from, join(dirname(to), '.missing', name))
      },
    },
  })
  onTestFinished(() => server.cleanup())
  const client = createInProcessClient(server)
  await writeFile(join(server.root, 'a.ts'), 'before')
  await writeFile(join(server.root, 'b.ts'), 'before')
  const fixture = createWorkspaceTextChanges(client)
  fixture.service.dispose()
  const notifications: string[] = []
  const service = new WorkspaceEditService({
    owner: clientLogContext(client),
    documentStore: fixture.store,
    fileSync: fixture.fileSync,
    getRoot: () => ({ generation: 1, path: filesystemPath(''), uriPath: filesystemPath('/') }),
    onHistorySettled: (rootPath) => notifications.push(rootPath),
  })
  onTestFinished(() => service.dispose())
  const pending = service.applyTextChange({
    source: 'search-replace',
    signal: new AbortController().signal,
    prepare: async (operation) => ({
      label: 'Replace text',
      requireConfirmation: true,
      targets: await Promise.all(
        ['a.ts', 'b.ts'].map(async (path) => ({
          source: await operation.readText(filesystemPath(path)),
          edits: [{ from: 0, to: 6, text: 'after' }],
        })),
      ),
    }),
  })
  service.confirmPreview(await textChangePreview(service))
  expect(await pending).toEqual({ status: 'applied' })
  reversing = true
  expect(await service.undo()).toBe(false)
  expect(service.getSnapshot().phase).toBe('recovery-required')
  expect(notifications).toEqual([])
  expect(await service.undo()).toBe(false)
  expect(await service.redo()).toBe(false)
  expect(await service.retryRecovery()).toBe(false)
  expect(notifications).toEqual([])
  reversing = false
  expect(await service.retryRecovery()).toBe(true)
  expect(notifications).toEqual([])
})
