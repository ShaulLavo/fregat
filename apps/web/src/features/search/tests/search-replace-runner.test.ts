import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { QueryClient } from '@tanstack/react-query'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  WorkspaceEditPrepareRequest,
  WorkspaceEditRecoverRequest,
  WorkspaceEditRecoveryListResult,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditStatusResult,
  WorkspaceEditTransitionRequest,
} from '@workspace/contracts'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import {
  FileSyncService,
  type WorkspaceMutationTransition,
  type WorkspaceMutationTransport,
} from '@/features/editor/state/file-sync-service'
import {
  WorkspaceEditService,
  type WorkspaceEditServicePhase,
} from '@/features/editor/state/workspace-edit-service'
import { createFileSyncPorts } from '@/features/editor/utils/file-sync-ports'
import {
  replaceWorkspaceSearchMatches,
  workspaceSearchReplaceSummary,
} from '@/features/search/utils/replace-runner'
import type { FileResult, TreeEntry } from '@/lib/file-system-types'
import { fetchFile } from '@/lib/file-server'
import { expect, test } from '../../../../test/fixtures'

const ROOT = '/repo'
const OPERATION_ID = '10000000-0000-4000-8000-000000000063'
const SERVER_EPOCH = '20000000-0000-4000-8000-000000000063'
const QUERY: WorkspaceSearchQuery = {
  includeContent: true,
  limit: 20,
  path: ROOT,
  query: 'needle',
}

test.describe('workspace search replacement runner', () => {
  test('rejects an unopened file changed after replacement planning', async ({
    server,
    client,
  }) => {
    const path = 'unopened.ts'
    const diskPath = join(server.root, path)
    await writeFile(diskPath, 'needle')
    const store = createEditorDocumentStore()
    const fileSync = new FileSyncService(store, new QueryClient(), createFileSyncPorts(client))
    const service = new WorkspaceEditService({
      documentStore: store,
      fileSync,
      getRoot: () => ({
        generation: 1,
        path: filesystemPath(''),
        uriPath: filesystemPath('/'),
        workspacePath: filesystemPath(''),
      }),
    })
    const phases: WorkspaceEditServicePhase[] = []
    const unsubscribe = service.subscribe(() => {
      const { phase } = service.getSnapshot()
      phases.push(phase)
      if (phase === 'awaiting-confirmation') service.cancelPreview()
    })

    const result = await replaceWorkspaceSearchMatches({
      context: {
        applyWorkspaceChange: service.applyWorkspaceChange,
        fetchFile: async (filePath, signal) => {
          const file = await fetchFile(filesystemPath(filePath), signal, client)
          await writeFile(diskPath, 'prefix needle')
          return file
        },
        getLiveEditorDocument: (path) => {
          const document = store
            .getState()
            .getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))
          if (document?.target.kind !== 'file') return null
          return { path: document.target.resource.path, buffer: document.buffer }
        },
        rootPath: '/',
        signal: new AbortController().signal,
      },
      matches: [match(path, 1, 7)],
      query: { ...QUERY, path: '' },
      replaceText: 'pin',
    })
    unsubscribe()

    expect(result).toMatchObject({ code: 'snapshot-drift', status: 'failed' })
    expect(phases).not.toContain('awaiting-confirmation')
    expect(await readFile(diskPath, 'utf8')).toBe('prefix needle')
  })

  test('applies exact live-buffer and guarded unopened text through one service request', async () => {
    const harness = createHarness()
    const live = addLiveFile(harness, '/repo/live.ts', 'needle')
    addFile(harness, '/repo/unopened.ts', 'const value = "needle"')

    const pending = runReplace(harness, [
      match('/repo/live.ts', 1, 7),
      match('/repo/unopened.ts', 16, 22),
    ])
    await waitForPhase(harness.service, 'awaiting-confirmation')

    expect(harness.service.getSnapshot().preview?.rows).toMatchObject([
      {
        afterText: 'pin',
        beforeText: 'needle',
        path: '/repo/live.ts',
        targetKind: 'open',
      },
      {
        afterText: 'const value = "pin"',
        beforeText: 'const value = "needle"',
        path: '/repo/unopened.ts',
        targetKind: 'unopened',
      },
    ])
    harness.service.confirmPreview()

    await expect(pending).resolves.toEqual({
      changedFiles: 2,
      replacedMatches: 2,
      skippedMatches: 0,
      status: 'applied',
    })
    expect(live.buffer.materializeFullText()).toBe('pin')
    expect(live.buffer.isDirty()).toBe(true)
    expect(requiredFile(harness, '/repo/unopened.ts').content).toBe('const value = "pin"')
    expect(harness.transport.prepares).toHaveLength(1)
    expect(harness.transport.prepares[0]?.operations).toMatchObject([
      {
        expected: { kind: 'snapshot', version: 'test:10:22' },
        kind: 'write',
        path: 'unopened.ts',
        text: 'const value = "pin"',
      },
    ])
  })

  test('rolls back every file when one target fails', async () => {
    const harness = createHarness({ failFinalize: true })
    addFile(harness, '/repo/first.ts', 'needle')
    addFile(harness, '/repo/second.ts', 'needle')

    const pending = runReplace(harness, [
      match('/repo/first.ts', 1, 7),
      match('/repo/second.ts', 1, 7),
    ])
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()

    await expect(pending).resolves.toMatchObject({ status: 'rolled-back' })
    expect(requiredFile(harness, '/repo/first.ts').content).toBe('needle')
    expect(requiredFile(harness, '/repo/second.ts').content).toBe('needle')
    expect(harness.transport.transitions).toContain('commit')
    expect(harness.transport.transitions).toContain('rollback')
  })

  test('preview cancel changes no open or unopened target', async () => {
    const harness = createHarness()
    const live = addLiveFile(harness, '/repo/live.ts', 'needle')
    addFile(harness, '/repo/unopened.ts', 'needle')

    const pending = runReplace(harness, [
      match('/repo/live.ts', 1, 7),
      match('/repo/unopened.ts', 1, 7),
    ])
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.cancelPreview()

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
    expect(live.buffer.materializeFullText()).toBe('needle')
    expect(live.buffer.isDirty()).toBe(false)
    expect(requiredFile(harness, '/repo/unopened.ts').content).toBe('needle')
    expect(harness.transport.prepares).toEqual([])
  })

  test('group undo restores all replaced targets', async () => {
    const harness = createHarness()
    const live = addLiveFile(harness, '/repo/live.ts', 'needle')
    addFile(harness, '/repo/unopened.ts', 'needle')

    const pending = runReplace(harness, [
      match('/repo/live.ts', 1, 7),
      match('/repo/unopened.ts', 1, 7),
    ])
    await waitForPhase(harness.service, 'awaiting-confirmation')
    harness.service.confirmPreview()
    await expect(pending).resolves.toMatchObject({ status: 'applied' })

    await expect(harness.service.undo()).resolves.toBe(true)
    expect(live.buffer.materializeFullText()).toBe('needle')
    expect(live.buffer.isDirty()).toBe(false)
    expect(requiredFile(harness, '/repo/unopened.ts').content).toBe('needle')
  })

  test('summarizes an all-or-nothing applied result', () => {
    expect(
      workspaceSearchReplaceSummary({
        changedFiles: 2,
        replacedMatches: 2,
        skippedMatches: 3,
        status: 'applied',
      }),
    ).toBe('2 matches replaced, 3 skipped.')
  })
})

type Harness = ReturnType<typeof createHarness>

function createHarness(options: { readonly failFinalize?: boolean } = {}) {
  const files = new Map<string, FileResult>()
  const store = createEditorDocumentStore()
  const transport = new SearchWorkspaceMutationTransport(ROOT, files, options)
  const fileSync = new FileSyncService(store, new QueryClient(), {
    readFileContent: async (path, signal) => {
      signal.throwIfAborted()
      return requiredFile({ files }, path)
    },
    workspaceMutations: transport,
    writeFileContent: async (path, content) => treeEntry(path, content, 1),
  })
  const service = new WorkspaceEditService({
    createOperationId: () => OPERATION_ID,
    documentStore: store,
    fileSync,
    getRoot: () => ({ generation: 1, path: filesystemPath(ROOT) }),
    inspectPath: async (path, signal) => {
      signal.throwIfAborted()
      const file = files.get(path)
      if (!file) return { exists: false, path }
      return {
        canonicalPath: path,
        exists: true,
        mtimeMs: file.mtimeMs,
        path,
        type: 'file',
        version: file.version,
      }
    },
  })
  return { files, service, store, transport }
}

function runReplace(harness: Harness, matches: readonly WorkspaceSearchMatch[]) {
  const signal = new AbortController().signal
  return replaceWorkspaceSearchMatches({
    context: {
      applyWorkspaceChange: harness.service.applyWorkspaceChange,
      fetchFile: async (path, nextSignal) => {
        nextSignal.throwIfAborted()
        return requiredFile(harness, path)
      },
      getLiveEditorDocument: (path) => {
        const document = harness.store
          .getState()
          .getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))
        if (document?.target.kind !== 'file') return null
        return { path: document.target.resource.path, buffer: document.buffer }
      },
      rootPath: ROOT,
      signal,
    },
    matches,
    query: QUERY,
    replaceText: 'pin',
  })
}

function addLiveFile(harness: Harness, path: string, content: string) {
  return harness.store.getState().ensureLiveEditorDocument(addFile(harness, path, content))
}

function addFile(harness: Pick<Harness, 'files'>, path: string, content: string): FileResult {
  const file = fileResult(path, content, 10)
  harness.files.set(path, file)
  return file
}

function requiredFile(harness: { readonly files: Map<string, FileResult> }, path: string) {
  const file = harness.files.get(path)
  if (file) return file
  throw new RangeError(`Missing test file: ${path}`)
}

function fileResult(path: string, content: string, mtimeMs: number): FileResult {
  return {
    content,
    mtimeMs,
    path: filesystemPath(path),
    size: new TextEncoder().encode(content).byteLength,
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function treeEntry(path: string, content: string, mtimeMs: number): TreeEntry {
  return {
    birthtimeMs: mtimeMs,
    mtimeMs,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: new TextEncoder().encode(content).byteLength,
    type: 'file',
    version: `test:${mtimeMs}:${content.length}`,
  }
}

function match(path: string, column: number, endColumn: number): WorkspaceSearchMatch {
  return {
    column,
    endColumn,
    kind: 'content',
    line: 1,
    path,
    source: 'disk',
    type: 'file',
  }
}

class SearchWorkspaceMutationTransport implements WorkspaceMutationTransport {
  readonly prepares: WorkspaceEditPrepareRequest[] = []
  readonly transitions: WorkspaceMutationTransition[] = []
  private current: WorkspaceEditResult | null = null
  private prepared: WorkspaceEditPrepareRequest | null = null
  private readonly savedFiles = new Map<string, FileResult>()

  constructor(
    private readonly root: string,
    private readonly files: Map<string, FileResult>,
    private readonly options: { readonly failFinalize?: boolean },
  ) {}

  async prepare(request: WorkspaceEditPrepareRequest): Promise<WorkspaceEditResult> {
    this.prepares.push(request)
    this.prepared = request
    for (const operation of request.operations) {
      if (operation.kind !== 'write') continue
      const path = this.absolutePath(operation.path)
      this.savedFiles.set(path, requiredFile({ files: this.files }, path))
    }
    return this.update('prepared', 1)
  }

  async transition(
    transition: WorkspaceMutationTransition,
    request: WorkspaceEditTransitionRequest,
  ): Promise<WorkspaceEditResult> {
    this.transitions.push(transition)
    if (transition === 'finalize' && this.options.failFinalize) {
      throw new TypeError('Injected finalization failure')
    }
    if (transition === 'commit' || transition === 'redo') this.applyForward()
    if (transition === 'rollback' || transition === 'undo') this.restoreSavedFiles()
    return this.update(
      transitionState(transition, this.requiredCurrent().state),
      request.expectedGeneration + 1,
    )
  }

  async recover(request: WorkspaceEditRecoverRequest): Promise<WorkspaceEditResult> {
    if (request.recoveryTarget === 'rolled-back' || request.recoveryTarget === 'undone') {
      this.restoreSavedFiles()
    } else {
      this.applyForward()
    }
    return this.update(request.recoveryTarget, request.expectedGeneration + 1)
  }

  async release(request: WorkspaceEditReleaseRequest): Promise<WorkspaceEditResult> {
    return this.update('released', request.expectedGeneration + 1)
  }

  async status(operationId: string): Promise<WorkspaceEditStatusResult> {
    if (this.current?.operationId === operationId) return { found: true, result: this.current }
    return { found: false, operationId, serverEpoch: SERVER_EPOCH }
  }

  async recovery(): Promise<WorkspaceEditRecoveryListResult> {
    return { operations: [], serverEpoch: SERVER_EPOCH }
  }

  private applyForward(): void {
    for (const operation of this.requiredPrepared().operations) {
      if (operation.kind !== 'write') continue
      const path = this.absolutePath(operation.path)
      const previous = requiredFile({ files: this.files }, path)
      this.files.set(path, fileResult(path, operation.text, previous.mtimeMs + 1))
    }
  }

  private restoreSavedFiles(): void {
    for (const [path, file] of this.savedFiles) this.files.set(path, file)
  }

  private update(state: WorkspaceEditResult['state'], generation: number): WorkspaceEditResult {
    const request = this.requiredPrepared()
    const result: WorkspaceEditResult = {
      affectedPaths: request.operations.flatMap(operationPaths),
      entries: [],
      eventPublication: state === 'finalized' ? 'published' : 'pending',
      generation,
      operationId: request.operationId,
      rolledBackPaths: [],
      serverEpoch: SERVER_EPOCH,
      state,
      unrecoveredPaths: [],
    }
    this.current = result
    return result
  }

  private requiredCurrent(): WorkspaceEditResult {
    if (this.current) return this.current
    throw new RangeError('Missing current workspace operation')
  }

  private requiredPrepared(): WorkspaceEditPrepareRequest {
    if (this.prepared) return this.prepared
    throw new RangeError('Missing prepared workspace operation')
  }

  private absolutePath(relativePath: string): string {
    return `${this.root}/${relativePath}`
  }
}

function transitionState(
  transition: WorkspaceMutationTransition,
  current: WorkspaceEditResult['state'],
): WorkspaceEditResult['state'] {
  if (transition === 'abort') return 'aborted'
  if (transition === 'commit') return 'committed'
  if (transition === 'rollback') return 'rolled-back'
  if (transition === 'undo') return 'undo-committed'
  if (transition === 'redo') return 'redo-committed'
  if (current === 'undo-committed') return 'undone'
  if (current === 'redo-committed') return 'redone'
  return 'finalized'
}

function operationPaths(operation: WorkspaceEditPrepareRequest['operations'][number]): string[] {
  if (operation.kind === 'rename') return [operation.oldPath, operation.newPath]
  return [operation.path]
}

async function waitForPhase(
  service: WorkspaceEditService,
  phase: WorkspaceEditServicePhase,
): Promise<void> {
  if (service.getSnapshot().phase === phase) return
  await new Promise<void>((resolve) => {
    const unsubscribe = service.subscribe(() => {
      if (service.getSnapshot().phase !== phase) return
      unsubscribe()
      resolve()
    })
  })
}
