import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodedAsText } from '@workspace/contracts'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { createFileSyncPorts } from '@/features/editor/utils/file-sync-ports'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import {
  FileSyncService,
  type FileSyncWriteFileContent,
  type WorkspaceMutationTransport,
} from '@/features/editor/state/file-sync-service'
import type { FileResult, TreeEntry, WorkspaceEditPrepareRequest } from '@/lib/file-system-types'
import { fileSystemKeys, gitKeys } from '@/lib/query-keys'
import { treeModel } from '@/lib/tree-model'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { QueryClient } from '@tanstack/react-query'
import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import type { WorkspaceEditResult, WorkspaceEditTransitionRequest } from '@workspace/contracts'

describe('FileSyncService', () => {
  it('retains an orphaned buffer and recreates its deleted parent on save', async ({
    client,
    server,
  }) => {
    const path = filesystemPath('nested/note.txt')
    await mkdir(join(server.root, 'nested'))
    await writeFile(join(server.root, path), 'original')
    const ports = createFileSyncPorts(client)
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const fileSync = new FileSyncService(store, queryClient, ports)
    const document = store
      .getState()
      .ensureLiveEditorDocument(await ports.readFileContent(path, new AbortController().signal))
    await rm(join(server.root, 'nested'), { recursive: true })
    store.getState().setFileOrphaned(document.key, true)
    store.getState().retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
    const orphan = store.getState().getLiveEditorDocument(document.key)!
    expect(orphan.buffer).toBe(document.buffer)
    expect(orphan.buffer.isDirty()).toBe(false)
    expect(orphan.buffer.materializeFullText()).toBe('original')
    await fileSync.save(orphan)
    expect(await readFile(join(server.root, path), 'utf8')).toBe('original')
    expect(store.getState().getLiveEditorDocument(document.key)?.sync).toMatchObject({
      orphaned: false,
    })
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toMatchObject({
      content: 'original',
    })
  })

  it('refuses to recreate over a file another process has restored', async ({ client, server }) => {
    const path = filesystemPath('note.txt')
    await writeFile(join(server.root, path), 'original')
    const ports = createFileSyncPorts(client)
    const store = createEditorDocumentStore()
    const service = new FileSyncService(store, new QueryClient(), ports)
    const document = store
      .getState()
      .ensureLiveEditorDocument(await ports.readFileContent(path, new AbortController().signal))
    store.getState().setFileOrphaned(document.key, true)
    await writeFile(join(server.root, path), 'restored by agent')
    await expect(
      service.save(store.getState().getLiveEditorDocument(document.key)!),
    ).rejects.toBeDefined()
    expect(await readFile(join(server.root, path), 'utf8')).toBe('restored by agent')
    expect(document.buffer.materializeFullText()).toBe('original')
  })

  it('saves with a base file version and marks unchanged saved buffers clean', async () => {
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const document = store.getState().ensureLiveEditorDocument(file('src/app.ts', 'old', 100))
    createEditorBufferSession(document.buffer).applyText('!')
    const writes: Array<{ content: string; options: Parameters<FileSyncWriteFileContent>[2] }> = []

    const service = new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async () => file('unused', '', 0),
      writeFileContent: async (path, content, options) => {
        writes.push({ content, options })
        return entry(path, content, 200)
      },
    })
    await service.save(store.getState().getLiveEditorDocument(document.key)!)

    const saved = store.getState().getLiveEditorDocument(document.key)!
    expect(service.isOwnWriteEvent(writes[0]!.options!.writeId!)).toBe(true)
    expect(writes).toEqual([
      {
        content: 'old!',
        options: expect.objectContaining({
          baseVersion: 'test:100:3',
          expectedMtimeMs: 100,
          origin: 'editor',
          writeId: expect.stringMatching(/^editor:/),
        }),
      },
    ])
    expect(saved.sync.kind).toBe('file')
    if (saved.sync.kind !== 'file') throw new RangeError('expected file sync metadata')
    expect(saved.sync.fileVersion).toBe('test:200:4')
    expect(saved.sync.mtimeMs).toBe(200)
    expect(saved.buffer.isDirty()).toBe(false)
    expect(store.getState().dirtyDocumentKeys.has(document.key)).toBe(false)
    expect(
      queryClient.getQueryData(fileSystemKeys.fileSnapshot(filesystemPath('src/app.ts'))),
    ).toEqual(file('src/app.ts', 'old!', 200))
  })

  it('keeps the document dirty when edits land during an in-flight save', async () => {
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const document = store.getState().ensureLiveEditorDocument(file('src/app.ts', 'old', 100))
    createEditorBufferSession(document.buffer).applyText('!')
    const savingDocument = store.getState().getLiveEditorDocument(document.key)!

    await new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async () => file('unused', '', 0),
      writeFileContent: async (path, content) => {
        const latest = store.getState().getLiveEditorDocument(testDocumentKey(path))!
        createEditorBufferSession(latest.buffer).applyText('?')
        return entry(path, content, 200)
      },
    }).save(savingDocument)

    const afterSave = store.getState().getLiveEditorDocument(document.key)!
    expect(afterSave.buffer.materializeFullText()).toBe('old!?')
    expect(afterSave.sync.kind).toBe('file')
    if (afterSave.sync.kind !== 'file') throw new RangeError('expected file sync metadata')
    expect(afterSave.sync.fileVersion).toBe('test:200:4')
    expect(afterSave.sync.mtimeMs).toBe(200)
    expect(afterSave.buffer.isDirty()).toBe(true)
    expect(store.getState().dirtyDocumentKeys.has(document.key)).toBe(true)
    expect(
      queryClient.getQueryData(fileSystemKeys.fileSnapshot(filesystemPath('src/app.ts'))),
    ).toEqual(file('src/app.ts', 'old!', 200))
  })

  it('reads an abortable unopened text snapshot without creating a live document', async () => {
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const controller = new AbortController()
    const service = new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async (path, signal) => {
        expect(signal).toBe(controller.signal)
        return file(path, '\uFEFFhello', 123)
      },
      writeFileContent: async (path, content) => entry(path, content, 200),
    })

    await expect(
      service.readWorkspaceSnapshot(filesystemPath('src/unopened.ts'), controller.signal),
    ).resolves.toEqual({
      byteLength: 6,
      mtimeMs: 123,
      path: 'src/unopened.ts',
      text: '\uFEFFhello',
      version: 'test:123:6',
    })
    expect(store.getState().hasLiveEditorDocument(testDocumentKey('src/unopened.ts'))).toBe(false)
  })

  it('inspects the injected document path without changing its namespace', async () => {
    const store = createEditorDocumentStore()
    const controller = new AbortController()
    const inspectedPaths: string[] = []
    const service = new FileSyncService(store, new QueryClient(), {
      inspectPath: async (path, signal) => {
        expect(signal).toBe(controller.signal)
        inspectedPaths.push(path)
        return entry(path, 'content', 123)
      },
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async (path) => file(path, '', 0),
      writeFileContent: async (path, content) => entry(path, content, 0),
    })

    await expect(
      service.inspectWorkspacePath(filesystemPath('/injected/root/file.ts'), controller.signal),
    ).resolves.toMatchObject({
      canonicalPath: '/injected/root/file.ts',
      exists: true,
      path: '/injected/root/file.ts',
      type: 'file',
      version: 'test:123:7',
    })
    expect(inspectedPaths).toEqual(['/injected/root/file.ts'])
  })

  it('discards an unopened read that settles after cancellation', async () => {
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const controller = new AbortController()
    let settle!: (file: FileResult) => void
    const service = new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: () =>
        new Promise((resolve) => {
          settle = resolve
        }),
      writeFileContent: async (path, content) => entry(path, content, 200),
    })
    const pending = service.readWorkspaceSnapshot(
      filesystemPath('src/unopened.ts'),
      controller.signal,
    )

    controller.abort()
    settle(file('src/unopened.ts', 'late', 123))

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.getState().hasLiveEditorDocument(testDocumentKey('src/unopened.ts'))).toBe(false)
  })

  it('prepares an ordered workspace mutation with exact expected versions', async () => {
    const requests: WorkspaceEditPrepareRequest[] = []
    const service = workspaceService({
      prepare: async (request) => {
        requests.push(request)
        return workspaceResult(request.operationId, 1, 'prepared')
      },
    })
    const request: WorkspaceEditPrepareRequest = {
      bodyDigest: `sha256:${'a'.repeat(64)}`,
      category: 'workspace-edit',
      label: 'Rename symbol',
      operationId: '10000000-0000-4000-8000-000000000001',
      operations: [
        {
          expected: { kind: 'snapshot', mtimeMs: 10, version: 'v1' },
          index: 1,
          kind: 'write',
          path: filesystemPath('src/a.ts'),
          text: 'A',
        },
        {
          destination: { kind: 'missing' },
          ignoreIfExists: false,
          index: 2,
          kind: 'create',
          overwrite: false,
          path: filesystemPath('src/b.ts'),
        },
      ],
      origin: 'workspace-edit',
      workspace: filesystemPath('/repo'),
    }

    await expect(
      service.prepareWorkspaceMutation(request, new AbortController().signal),
    ).resolves.toMatchObject({ generation: 1, state: 'prepared' })
    expect(requests).toEqual([request])
  })

  it('recovers a lost commit response through status without retrying the mutation', async () => {
    let commits = 0
    const committed = workspaceResult('10000000-0000-4000-8000-000000000002', 2, 'committed')
    const service = workspaceService({
      status: async () => ({ found: true, result: committed }),
      transition: async () => {
        commits += 1
        throw new TypeError('response lost')
      },
    })

    await expect(
      service.commitWorkspaceMutation(
        workspaceResult('10000000-0000-4000-8000-000000000002', 1, 'prepared'),
      ),
    ).resolves.toBe(committed)
    expect(commits).toBe(1)
  })

  it('uses one retry id but fresh transition ids and generations for later undo redo', async () => {
    const requests: WorkspaceEditTransitionRequest[] = []
    let lost = true
    let current = workspaceResult('10000000-0000-4000-8000-000000000003', 4, 'finalized')
    const service = workspaceService({
      status: async () => ({ found: true, result: current }),
      transition: async (transition, request) => {
        requests.push(request)
        if (lost) {
          lost = false
          throw new TypeError('response lost before mutation')
        }
        const state = transition === 'undo' ? 'undo-committed' : 'redo-committed'
        current = workspaceResult(current.operationId, current.generation + 1, state)
        return current
      },
    })

    const undone = await service.undoWorkspaceMutation(current)
    const redone = await service.redoWorkspaceMutation(undone)

    expect(requests[0]?.transitionId).toBe(requests[1]?.transitionId)
    expect(requests[2]?.transitionId).not.toBe(requests[1]?.transitionId)
    expect(requests.map((request) => request.expectedGeneration)).toEqual([4, 4, 5])
    expect(redone).toMatchObject({ generation: 6, state: 'redo-committed' })
  })

  it('projects provisional file and tree results before finalize and restores them exactly', () => {
    const store = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const path = '/repo/src/a.ts'
    const oldFile = file(path, 'old', 10)
    queryClient.setQueryData(fileSystemKeys.fileSnapshot(path), oldFile)
    queryClient.setQueryData(gitKeys.status('/repo'), { changed: false })
    queryClient.setQueryData(
      fileSystemKeys.tree('/repo'),
      treeModel({ entries: [entry(path, 'old', 10)], path: filesystemPath('/repo') }, '/repo'),
    )
    const service = new FileSyncService(store, queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async () => oldFile,
      writeFileContent: async (nextPath, content) => entry(nextPath, content, 20),
    })
    const committed = workspaceResultWithEntries('projection', 2, 'committed', [
      resultEntry(path, 'new', 20),
    ])

    const receipt = service.projectWorkspaceMutation(committed, {
      afterContents: new Map([[path, 'new']]),
      beforeContents: new Map([[path, 'old']]),
      entries: committed.entries,
      renames: [],
      rootPath: filesystemPath('/repo'),
    })

    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toEqual(
      file(path, 'new', 20),
    )
    expect(
      queryClient
        .getQueryData<ReturnType<typeof treeModel>>(fileSystemKeys.tree('/repo'))
        ?.entriesByTreePath.get('src/a.ts')?.version,
    ).toBe('test:20:3')
    expect(queryClient.getQueryState(gitKeys.status('/repo'))?.isInvalidated).toBe(false)
    const projectedFile = queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))
    expect(
      service.sealWorkspaceMutationProjection(
        receipt,
        workspaceResultWithEntries('projection', 3, 'finalized', committed.entries),
      ),
    ).toBe(true)
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toBe(projectedFile)
    expect(queryClient.getQueryState(gitKeys.status('/repo'))?.isInvalidated).toBe(true)

    expect(service.rollbackWorkspaceMutationProjection(receipt)).toBe(true)
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toEqual(oldFile)
    expect(
      queryClient
        .getQueryData<ReturnType<typeof treeModel>>(fileSystemKeys.tree('/repo'))
        ?.entriesByTreePath.get('src/a.ts')?.version,
    ).toBe('test:10:3')
  })

  it('projects each provisional undo and redo result once through reciprocal receipts', () => {
    const queryClient = new QueryClient()
    const path = '/repo/a.ts'
    queryClient.setQueryData(fileSystemKeys.fileSnapshot(path), file(path, 'before', 10))
    const service = new FileSyncService(createEditorDocumentStore(), queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async () => file(path, 'before', 10),
      writeFileContent: async (nextPath, content) => entry(nextPath, content, 20),
    })
    const forward = workspaceResultWithEntries('history', 2, 'committed', [
      resultEntry(path, 'after', 20),
    ])
    const forwardReceipt = service.projectWorkspaceMutation(forward, {
      afterContents: new Map([[path, 'after']]),
      beforeContents: new Map([[path, 'before']]),
      entries: forward.entries,
      renames: [],
      rootPath: filesystemPath('/repo'),
    })
    expect(
      service.sealWorkspaceMutationProjection(
        forwardReceipt,
        workspaceResultWithEntries('history', 3, 'finalized', forward.entries),
      ),
    ).toBe(true)

    const undo = workspaceResultWithEntries('history', 4, 'undo-committed', [
      resultEntry(path, 'before', 10),
    ])
    const undoReceipt = service.reverseWorkspaceMutationProjection(
      forwardReceipt,
      undo,
      undo.entries,
    )!
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toEqual(
      file(path, 'before', 10),
    )
    expect(
      service.sealWorkspaceMutationProjection(
        undoReceipt,
        workspaceResultWithEntries('history', 5, 'undone', undo.entries),
      ),
    ).toBe(true)

    const redo = workspaceResultWithEntries('history', 6, 'redo-committed', forward.entries)
    const redoReceipt = service.reverseWorkspaceMutationProjection(undoReceipt, redo, redo.entries)!
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toEqual(
      file(path, 'after', 20),
    )
    expect(service.isWorkspaceMutationProjectionCurrent(redoReceipt)).toBe(true)
  })

  it('re-reads recovery file snapshots and removes inactive tree and git caches without fetchers', async () => {
    const queryClient = new QueryClient()
    const path = '/repo/a.ts'
    queryClient.setQueryData(fileSystemKeys.fileSnapshot(path), file(path, 'old', 10))
    queryClient.setQueryData(fileSystemKeys.tree('/repo'), { stale: 'tree' })
    queryClient.setQueryData(gitKeys.status('/repo'), { stale: 'git' })
    const reads: string[] = []
    const service = new FileSyncService(createEditorDocumentStore(), queryClient, {
      recreateFileContent: () => Promise.reject('Unexpected file recreation'),
      readFileContent: async (nextPath) => {
        reads.push(nextPath)
        return file(nextPath, 'recovered', 30)
      },
      writeFileContent: async (nextPath, content) => entry(nextPath, content, 30),
    })

    await service.reconcileWorkspaceMutationProjection(filesystemPath('/repo'), [
      filesystemPath(path),
    ])

    expect(reads).toEqual([path])
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(path))).toEqual(
      file(path, 'recovered', 30),
    )
    expect(queryClient.getQueryState(fileSystemKeys.tree('/repo'))).toBeUndefined()
    expect(queryClient.getQueryState(gitKeys.status('/repo'))).toBeUndefined()
  })
})

function workspaceService(overrides: Partial<WorkspaceMutationTransport>): FileSyncService {
  const operationId = '10000000-0000-4000-8000-000000000099'
  const base: WorkspaceMutationTransport = {
    prepare: async (request) => workspaceResult(request.operationId, 1, 'prepared'),
    transition: async (_transition, request) =>
      workspaceResult(request.operationId, request.expectedGeneration + 1, 'committed'),
    recover: async (request) =>
      workspaceResult(request.operationId, request.expectedGeneration + 1, request.recoveryTarget),
    release: async (request) =>
      workspaceResult(request.operationId, request.expectedGeneration + 1, 'released'),
    status: async () => ({ found: false, operationId, serverEpoch: SERVER_EPOCH }),
    recovery: async () => ({ operations: [], serverEpoch: SERVER_EPOCH }),
  }
  const store = createEditorDocumentStore()
  return new FileSyncService(store, new QueryClient(), {
    recreateFileContent: () => Promise.reject('Unexpected file recreation'),
    readFileContent: async () => file('unused', '', 0),
    writeFileContent: async (path, content) => entry(path, content, 0),
    workspaceMutations: { ...base, ...overrides },
  })
}

const SERVER_EPOCH = '20000000-0000-4000-8000-000000000001'

function workspaceResult(
  operationId: string,
  generation: number,
  state: WorkspaceEditResult['state'],
): WorkspaceEditResult {
  return {
    affectedPaths: ['src/a.ts'],
    entries: [],
    eventPublication: 'pending',
    generation,
    operationId,
    rolledBackPaths: [],
    serverEpoch: SERVER_EPOCH,
    state,
    unrecoveredPaths: [],
  }
}

function workspaceResultWithEntries(
  operationId: string,
  generation: number,
  state: WorkspaceEditResult['state'],
  entries: WorkspaceEditResult['entries'],
): WorkspaceEditResult {
  return { ...workspaceResult(operationId, generation, state), entries }
}

function resultEntry(path: string, content: string, mtimeMs: number) {
  return {
    exists: true as const,
    mtimeMs,
    path,
    size: content.length,
    type: 'file' as const,
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function file(path: string, content: string, mtimeMs: number): FileResult {
  return {
    ...decodedAsText,
    content,
    mtimeMs,
    path: filesystemPath(path),
    size: content.length,
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function entry(path: string, content: string, mtimeMs: number): TreeEntry {
  return {
    birthtimeMs: mtimeMs,
    mtimeMs,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: content.length,
    type: 'file',
    version: `test:${mtimeMs}:${content.length}`,
  }
}

it('classifies only canonical write IDs issued by the retained file owner', ({ client }) => {
  const ports = createFileSyncPorts(client)
  const owner = new FileSyncService(createEditorDocumentStore(), new QueryClient(), ports)
  const other = new FileSyncService(createEditorDocumentStore(), new QueryClient(), ports)
  const first = owner.issueWriteId()
  const prefix = first.slice(0, first.lastIndexOf(':') + 1)
  expect(owner.isOwnWriteEvent(first)).toBe(true)
  for (const suffix of ['0', '2', '01', '1.0', '1e0', '-1', 'Infinity', '']) {
    expect(owner.isOwnWriteEvent(`${prefix}${suffix}`)).toBe(false)
  }
  expect(owner.isOwnWriteEvent(other.issueWriteId())).toBe(false)
  const second = owner.issueWriteId()
  expect(owner.isOwnWriteEvent(second)).toBe(true)
  expect(owner.isOwnWriteEvent(first)).toBe(true)
})
