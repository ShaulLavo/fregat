import { createClientInvariantError } from '@/lib/structured-errors'

import type {
  LiveEditorDocument,
  EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import {
  projectWorkspaceEditTree,
  type WorkspaceEditTreeRename,
} from '@/features/editor/utils/workspace-edit-tree-projection'
import type { WriteFileContentOptions } from '@/lib/file-server'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { assertEnvironmentWritable } from '@/lib/environments/state/availability'
import { createFileSyncPorts } from '@/features/editor/utils/file-sync-ports'
import {
  fileResultFromResponse,
  type FileResult,
  type StatResult,
  type WorkspaceEditPrepareRequest,
} from '@/lib/file-system-types'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { fileSystemKeys, gitKeys } from '@/lib/query-keys'
import type { TreeModel } from '@/lib/tree-model'
import { toClientError } from '@/lib/client-error-taxonomy'
import { notifyManager, type QueryClient, type QueryKey } from '@tanstack/react-query'
import type {
  WorkspaceEditRecoverRequest,
  WorkspaceEditRecoveryListResult,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditResultEntry,
  WorkspaceEditStatusResult,
  WorkspaceEditTransitionRequest,
} from '@workspace/contracts'

export type FileSyncWriteFileContent = (
  path: FilesystemPath,
  content: string,
  options?: WriteFileContentOptions,
) => Promise<StatResult>

export type WorkspaceFileSnapshot = {
  readonly byteLength: number
  readonly mtimeMs: number
  readonly path: FilesystemPath
  readonly text: string
  readonly version: string
}

export type WorkspaceFileInspection =
  | { readonly exists: false; readonly path: FilesystemPath }
  | {
      readonly canonicalPath: FilesystemPath
      readonly exists: true
      readonly mtimeMs: number
      readonly path: FilesystemPath
      readonly type: StatResult['type']
      readonly version: string
    }

export type FileSyncPorts = {
  readonly assertWritable?: () => void
  readonly inspectPath?: (path: FilesystemPath, signal: AbortSignal) => Promise<StatResult>
  readonly readFileContent: (path: FilesystemPath, signal: AbortSignal) => Promise<FileResult>
  readonly writeFileContent: FileSyncWriteFileContent
  readonly workspaceMutations?: WorkspaceMutationTransport
}

export type WorkspaceMutationTransition =
  | 'abort'
  | 'commit'
  | 'finalize'
  | 'redo'
  | 'rollback'
  | 'undo'

export type WorkspaceMutationTransport = {
  readonly prepare: (
    request: WorkspaceEditPrepareRequest,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditResult>
  readonly transition: (
    transition: WorkspaceMutationTransition,
    request: WorkspaceEditTransitionRequest,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditResult>
  readonly recover: (
    request: WorkspaceEditRecoverRequest,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditResult>
  readonly release: (
    request: WorkspaceEditReleaseRequest,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditResult>
  readonly status: (operationId: string, signal: AbortSignal) => Promise<WorkspaceEditStatusResult>
  readonly recovery: (
    workspace: FilesystemPath,
    signal: AbortSignal,
  ) => Promise<WorkspaceEditRecoveryListResult>
}

export type WorkspaceMutationProjectionRequest = {
  readonly afterContents: ReadonlyMap<string, string>
  readonly beforeContents: ReadonlyMap<string, string>
  readonly entries: readonly WorkspaceEditResultEntry[]
  readonly renames: readonly WorkspaceEditTreeRename[]
  readonly rootPath: FilesystemPath
}

type QueryProjectionSnapshot<T> = {
  readonly data: T | undefined
  readonly dataUpdatedAt: number
  readonly exists: boolean
  readonly invalidated: boolean
}

type QueryProjection<T> = {
  readonly after: QueryProjectionSnapshot<T>
  readonly before: QueryProjectionSnapshot<T>
  readonly queryKey: QueryKey
}

export type WorkspaceMutationProjectionReceipt = {
  readonly afterContents: ReadonlyMap<string, string>
  readonly beforeContents: ReadonlyMap<string, string>
  readonly files: readonly QueryProjection<FileResult>[]
  readonly operationId: string
  phase: 'provisional' | 'sealed'
  readonly renames: readonly WorkspaceEditTreeRename[]
  readonly rootPath: FilesystemPath
  readonly serverEpoch: string
  readonly tree: QueryProjection<TreeModel> | null
}

export class FileSyncService {
  private readonly epochListeners = new Set<(serverEpoch: string) => void>()
  private serverEpoch: string | null = null
  private readonly writeIdPrefix = `${createWriteId()}:`
  private issuedWriteCount = 0

  constructor(
    private readonly documentStore: EditorDocumentStoreApi,
    private readonly queryClient: QueryClient,
    private readonly ports: FileSyncPorts = ownedFileSyncPorts(queryClient),
  ) {}

  readonly issueWriteId = (): string => `${this.writeIdPrefix}${++this.issuedWriteCount}`

  readonly isOwnWriteEvent = (writeId: string): boolean => {
    if (!writeId.startsWith(this.writeIdPrefix)) return false
    const sequence = Number(writeId.slice(this.writeIdPrefix.length))
    return (
      Number.isSafeInteger(sequence) &&
      sequence > 0 &&
      sequence <= this.issuedWriteCount &&
      writeId === `${this.writeIdPrefix}${sequence}`
    )
  }

  readonly inspectWorkspacePath = async (
    path: FilesystemPath,
    signal: AbortSignal,
  ): Promise<WorkspaceFileInspection> => {
    const inspect = this.ports.inspectPath
    if (!inspect) {
      throw createClientInvariantError('Workspace path inspection is unavailable')
    }

    try {
      const entry = await inspect(path, signal)
      return {
        canonicalPath: entry.canonicalPath ?? entry.path,
        exists: true,
        mtimeMs: entry.mtimeMs,
        path: entry.path,
        type: entry.type,
        version: entry.version,
      }
    } catch (error) {
      if (toClientError(error).category === 'not_found') return { exists: false, path }
      throw error
    }
  }

  async readWorkspaceSnapshot(
    path: FilesystemPath,
    signal: AbortSignal,
  ): Promise<WorkspaceFileSnapshot> {
    signal.throwIfAborted()
    const file = await this.ports.readFileContent(path, signal)
    signal.throwIfAborted()
    return {
      byteLength: file.size,
      mtimeMs: file.mtimeMs,
      path: file.path,
      text: file.content,
      version: file.version,
    }
  }

  async save(document: LiveEditorDocument): Promise<FileResult> {
    if (document.sync.kind !== 'file' || document.target.kind !== 'file') {
      throw createClientInvariantError(`Cannot save unsynced editor document ${document.key}`)
    }

    this.ports.assertWritable?.()

    const sync = document.sync
    const path = document.target.resource.path
    const text = document.buffer.materializeFullText()
    const savedContentRevision = document.contentRevision
    const writeId = createWriteId()
    const entry = await this.ports.writeFileContent(path, text, {
      baseVersion: sync.fileVersion,
      expectedMtimeMs: sync.mtimeMs,
      origin: 'editor',
      writeId,
    })
    const file = fileResultForSavedDocument(path, text, entry)

    this.documentStore.getState().markLiveEditorDocumentSaved({
      documentKey: document.key,
      fileVersion: entry.version,
      mtimeMs: entry.mtimeMs,
      savedContentRevision,
      savedText: text,
    })
    setFileSnapshotQueryData(this.queryClient, file)
    return file
  }

  async prepareWorkspaceMutation(
    request: WorkspaceEditPrepareRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceEditResult> {
    this.ports.assertWritable?.()
    const transport = this.workspaceMutationTransport()
    signal.throwIfAborted()
    try {
      return this.observeWorkspaceResult(await transport.prepare(request, signal))
    } catch {
      signal.throwIfAborted()
      const status = this.observeWorkspaceStatus(
        await transport.status(request.operationId, signal),
      )
      if (status.found) return status.result
      return this.observeWorkspaceResult(await transport.prepare(request, signal))
    }
  }

  getWorkspaceMutationServerEpoch(): string | null {
    return this.serverEpoch
  }

  subscribeWorkspaceMutationServerEpoch(listener: (serverEpoch: string) => void): () => void {
    this.epochListeners.add(listener)
    return () => this.epochListeners.delete(listener)
  }

  projectWorkspaceMutation(
    result: WorkspaceEditResult,
    request: WorkspaceMutationProjectionRequest,
  ): WorkspaceMutationProjectionReceipt {
    this.observeWorkspaceResult(result)
    return this.installWorkspaceProjection(result, request)
  }

  reverseWorkspaceMutationProjection(
    current: WorkspaceMutationProjectionReceipt,
    result: WorkspaceEditResult,
    entries: readonly WorkspaceEditResultEntry[],
  ): WorkspaceMutationProjectionReceipt | null {
    this.observeWorkspaceResult(result)
    if (!this.isWorkspaceMutationProjectionCurrent(current)) return null
    const request: WorkspaceMutationProjectionRequest = {
      afterContents: current.beforeContents,
      beforeContents: current.afterContents,
      entries,
      renames: current.renames.map((rename) => ({ from: rename.to, to: rename.from })),
      rootPath: current.rootPath,
    }
    return this.installWorkspaceProjection(result, request)
  }

  sealWorkspaceMutationProjection(
    receipt: WorkspaceMutationProjectionReceipt,
    result: WorkspaceEditResult,
  ): boolean {
    this.observeWorkspaceResult(result)
    if (receipt.operationId !== result.operationId) return false
    if (receipt.serverEpoch !== result.serverEpoch) return false
    if (!this.isWorkspaceMutationProjectionCurrent(receipt)) return false
    receipt.phase = 'sealed'
    void this.queryClient.invalidateQueries({ queryKey: gitKeys.all, refetchType: 'none' })
    return true
  }

  rollbackWorkspaceMutationProjection(receipt: WorkspaceMutationProjectionReceipt): boolean {
    if (!this.isWorkspaceMutationProjectionCurrent(receipt)) return false
    notifyManager.batch(() => {
      for (const projection of receipt.files) this.restoreQueryProjection(projection)
      if (receipt.tree) this.restoreQueryProjection(receipt.tree)
    })
    return true
  }

  isWorkspaceMutationProjectionCurrent(receipt: WorkspaceMutationProjectionReceipt): boolean {
    if (receipt.serverEpoch !== this.serverEpoch) return false
    if (
      receipt.files.some((projection) => !this.queryMatches(projection.after, projection.queryKey))
    ) {
      return false
    }
    if (receipt.tree && !this.queryMatches(receipt.tree.after, receipt.tree.queryKey)) return false
    return true
  }

  invalidateWorkspaceMutationProjection(
    rootPath: FilesystemPath,
    paths: readonly FilesystemPath[],
  ): void {
    for (const path of new Set(paths)) {
      void this.queryClient.invalidateQueries({
        exact: true,
        queryKey: fileSystemKeys.fileSnapshot(path),
      })
    }
    void this.queryClient.invalidateQueries({ queryKey: fileSystemKeys.tree(rootPath) })
    void this.queryClient.invalidateQueries({ queryKey: gitKeys.all })
  }

  async reconcileWorkspaceMutationProjection(
    rootPath: FilesystemPath,
    paths: readonly FilesystemPath[],
  ): Promise<void> {
    this.invalidateWorkspaceMutationProjection(rootPath, paths)
    const signal = neverAbortedSignal()
    for (const path of new Set(paths)) {
      await this.reconcileWorkspaceFile(path, signal)
    }
    await this.refetchOrRemoveQueries(fileSystemKeys.tree(rootPath))
    await this.refetchOrRemoveQueries(gitKeys.all)
  }

  commitWorkspaceMutation(
    current: WorkspaceEditResult,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    return this.runWorkspaceTransition('commit', current, signal)
  }

  finalizeWorkspaceMutation(
    current: WorkspaceEditResult,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    return this.runWorkspaceTransition('finalize', current, signal)
  }

  abortWorkspaceMutation(
    operationId: string,
    expectedGeneration: number,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    return this.runWorkspaceTransition(
      'abort',
      { generation: expectedGeneration, operationId },
      signal,
    )
  }

  rollbackWorkspaceMutation(
    current: WorkspaceEditResult,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    return this.runWorkspaceTransition('rollback', current, signal)
  }

  undoWorkspaceMutation(
    current: WorkspaceEditResult,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    return this.runWorkspaceTransition('undo', current, signal)
  }

  redoWorkspaceMutation(
    current: WorkspaceEditResult,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    return this.runWorkspaceTransition('redo', current, signal)
  }

  async recoverWorkspaceMutation(
    current: WorkspaceEditResult,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    if (!current.recoveryTarget) {
      throw createClientInvariantError('Workspace recovery result is missing its target state')
    }
    const transport = this.workspaceMutationTransport()
    const request: WorkspaceEditRecoverRequest = {
      expectedGeneration: current.generation,
      operationId: current.operationId,
      recoveryTarget: current.recoveryTarget,
      transitionId: workspaceTransitionId(),
    }
    return this.settleWorkspaceTransition(current, signal, (nextSignal) =>
      transport.recover(request, nextSignal),
    )
  }

  async releaseWorkspaceMutation(
    current: WorkspaceEditResult,
    acknowledgePartial: WorkspaceEditReleaseRequest['acknowledgePartial'] = undefined,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditResult> {
    const transport = this.workspaceMutationTransport()
    const request: WorkspaceEditReleaseRequest = {
      expectedGeneration: current.generation,
      operationId: current.operationId,
      transitionId: workspaceTransitionId(),
      ...(acknowledgePartial === undefined ? {} : { acknowledgePartial }),
    }
    return this.settleWorkspaceTransition(current, signal, (nextSignal) =>
      transport.release(request, nextSignal),
    )
  }

  statusWorkspaceMutation(
    operationId: string,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditStatusResult> {
    return this.workspaceMutationTransport()
      .status(operationId, signal)
      .then((status) => this.observeWorkspaceStatus(status))
  }

  discoverWorkspaceRecovery(
    workspace: FilesystemPath,
    signal: AbortSignal = neverAbortedSignal(),
  ): Promise<WorkspaceEditRecoveryListResult> {
    return this.workspaceMutationTransport()
      .recovery(workspace, signal)
      .then((recovery) => this.observeWorkspaceRecovery(recovery))
  }

  private runWorkspaceTransition(
    transition: WorkspaceMutationTransition,
    current: Pick<WorkspaceEditResult, 'generation' | 'operationId'>,
    signal: AbortSignal,
  ): Promise<WorkspaceEditResult> {
    const transport = this.workspaceMutationTransport()
    const request: WorkspaceEditTransitionRequest = {
      expectedGeneration: current.generation,
      operationId: current.operationId,
      transitionId: workspaceTransitionId(),
    }
    return this.settleWorkspaceTransition(current, signal, (nextSignal) =>
      transport.transition(transition, request, nextSignal),
    )
  }

  private async settleWorkspaceTransition(
    current: Pick<WorkspaceEditResult, 'generation' | 'operationId'>,
    signal: AbortSignal,
    send: (signal: AbortSignal) => Promise<WorkspaceEditResult>,
  ): Promise<WorkspaceEditResult> {
    signal.throwIfAborted()
    try {
      return this.observeWorkspaceResult(await send(signal))
    } catch (error) {
      signal.throwIfAborted()
      const status = this.observeWorkspaceStatus(
        await this.workspaceMutationTransport().status(current.operationId, signal),
      )
      if (workspaceTransitionAdvanced(status, current.generation)) return status.result
      if (!status.found) throw error
      return this.observeWorkspaceResult(
        await retryWorkspaceTransition(
          send,
          async () =>
            this.observeWorkspaceStatus(
              await this.workspaceMutationTransport().status(current.operationId, signal),
            ),
          current,
          signal,
        ),
      )
    }
  }

  private installWorkspaceProjection(
    result: WorkspaceEditResult,
    request: WorkspaceMutationProjectionRequest,
  ): WorkspaceMutationProjectionReceipt {
    const files = this.projectFileSnapshots(request)
    const tree = this.projectRootTree(request)
    return {
      afterContents: new Map(request.afterContents),
      beforeContents: new Map(request.beforeContents),
      files,
      operationId: result.operationId,
      phase: 'provisional',
      renames: [...request.renames],
      rootPath: request.rootPath,
      serverEpoch: result.serverEpoch,
      tree,
    }
  }

  private async reconcileWorkspaceFile(path: FilesystemPath, signal: AbortSignal): Promise<void> {
    try {
      const file = await this.ports.readFileContent(path, signal)
      setFileSnapshotQueryData(this.queryClient, file)
    } catch (error) {
      if (toClientError(error).category !== 'not_found') throw error
      this.queryClient.removeQueries({ exact: true, queryKey: fileSystemKeys.fileSnapshot(path) })
    }
  }

  private async refetchOrRemoveQueries(queryKey: QueryKey): Promise<void> {
    const queries = this.queryClient.getQueryCache().findAll({ queryKey })
    for (const query of queries) {
      if (typeof query.options.queryFn !== 'function') {
        this.queryClient.removeQueries({ exact: true, queryKey: query.queryKey })
        continue
      }
      await this.queryClient.refetchQueries({
        exact: true,
        queryKey: query.queryKey,
        type: 'all',
      })
    }
  }

  private projectFileSnapshots(
    request: WorkspaceMutationProjectionRequest,
  ): readonly QueryProjection<FileResult>[] {
    const candidates = this.fileProjectionCandidates(request)
    const projections: QueryProjection<FileResult>[] = []
    notifyManager.batch(() => {
      for (const entry of request.entries) {
        const queryKey = fileSystemKeys.fileSnapshot(entry.path)
        const before = this.querySnapshot<FileResult>(queryKey)
        const candidate = entry.exists ? candidates.get(entry.path) : undefined
        if (!before.data && !candidate) continue
        this.installFileProjection(queryKey, entry, candidate)
        projections.push({ after: this.querySnapshot(queryKey), before, queryKey })
      }
    })
    return projections
  }

  private fileProjectionCandidates(
    request: WorkspaceMutationProjectionRequest,
  ): Map<string, string> {
    const candidates = new Map(request.afterContents)
    for (const rename of request.renames) {
      const cached = this.queryClient.getQueryData<FileResult>(
        fileSystemKeys.fileSnapshot(rename.from),
      )
      if (cached && !candidates.has(rename.to)) candidates.set(rename.to, cached.content)
      candidates.delete(rename.from)
    }
    return candidates
  }

  private installFileProjection(
    queryKey: QueryKey,
    entry: WorkspaceEditResultEntry,
    content: string | undefined,
  ): void {
    if (!entry.exists || content === undefined) {
      this.queryClient.removeQueries({ exact: true, queryKey })
      return
    }
    this.queryClient.setQueryData<FileResult>(
      queryKey,
      fileResultFromResponse({
        content,
        mtimeMs: entry.mtimeMs,
        path: entry.path,
        size: entry.size,
        version: entry.version,
      }),
    )
  }

  private projectRootTree(
    request: WorkspaceMutationProjectionRequest,
  ): QueryProjection<TreeModel> | null {
    const queryKey = fileSystemKeys.tree(request.rootPath)
    const before = this.querySnapshot<TreeModel>(queryKey)
    if (!before.data) return null
    const projected = projectWorkspaceEditTree(
      before.data,
      request.rootPath,
      request.entries,
      request.renames,
    )
    this.queryClient.setQueryData(queryKey, projected)
    return { after: this.querySnapshot(queryKey), before, queryKey }
  }

  private restoreQueryProjection<T>(projection: QueryProjection<T>): void {
    if (!projection.before.exists) {
      this.queryClient.removeQueries({ exact: true, queryKey: projection.queryKey })
      return
    }
    this.queryClient.setQueryData(projection.queryKey, projection.before.data, {
      updatedAt: projection.before.dataUpdatedAt,
    })
    if (!projection.before.invalidated) return
    void this.queryClient.invalidateQueries({
      exact: true,
      queryKey: projection.queryKey,
      refetchType: 'none',
    })
  }

  private queryMatches<T>(expected: QueryProjectionSnapshot<T>, queryKey?: QueryKey): boolean {
    if (!queryKey) return true
    const current = this.querySnapshot<T>(queryKey)
    return (
      current.exists === expected.exists &&
      current.data === expected.data &&
      current.dataUpdatedAt === expected.dataUpdatedAt &&
      current.invalidated === expected.invalidated
    )
  }

  private querySnapshot<T>(queryKey: QueryKey): QueryProjectionSnapshot<T> {
    const state = this.queryClient.getQueryState<T>(queryKey)
    return {
      data: state?.data,
      dataUpdatedAt: state?.dataUpdatedAt ?? 0,
      exists: state !== undefined,
      invalidated: state?.isInvalidated ?? false,
    }
  }

  private observeWorkspaceResult(result: WorkspaceEditResult): WorkspaceEditResult {
    this.observeWorkspaceEpoch(result.serverEpoch)
    return result
  }

  private observeWorkspaceStatus(result: WorkspaceEditStatusResult): WorkspaceEditStatusResult {
    this.observeWorkspaceEpoch(result.found ? result.result.serverEpoch : result.serverEpoch)
    return result
  }

  private observeWorkspaceRecovery(
    result: WorkspaceEditRecoveryListResult,
  ): WorkspaceEditRecoveryListResult {
    this.observeWorkspaceEpoch(result.serverEpoch)
    return result
  }

  private observeWorkspaceEpoch(serverEpoch: string): void {
    if (this.serverEpoch === serverEpoch) return
    this.serverEpoch = serverEpoch
    for (const listener of this.epochListeners) listener(serverEpoch)
  }

  private workspaceMutationTransport(): WorkspaceMutationTransport {
    const transport = this.ports.workspaceMutations
    if (transport) return transport
    throw createClientInvariantError('Workspace mutation transport is unavailable')
  }
}

function ownedFileSyncPorts(queryClient: QueryClient): FileSyncPorts {
  const origin = originForQueryClient(queryClient)
  return {
    ...createFileSyncPorts(clientForQueryClient(queryClient)),
    assertWritable: () => assertEnvironmentWritable(origin),
  }
}

function fileResultForSavedDocument(
  path: FilesystemPath,
  content: string,
  entry: StatResult,
): FileResult {
  return {
    content,
    mtimeMs: entry.mtimeMs,
    path,
    size: entry.size,
    version: entry.version,
  }
}

function createWriteId() {
  if (globalThis.crypto?.randomUUID) return `editor:${globalThis.crypto.randomUUID()}`

  return `editor:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`
}

function workspaceTransitionId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  throw createClientInvariantError('Secure workspace transition identifiers are unavailable')
}

function neverAbortedSignal(): AbortSignal {
  return new AbortController().signal
}

function workspaceTransitionAdvanced(
  status: WorkspaceEditStatusResult,
  expectedGeneration: number,
): status is Extract<WorkspaceEditStatusResult, { readonly found: true }> {
  return status.found && status.result.generation > expectedGeneration
}

async function retryWorkspaceTransition(
  send: (signal: AbortSignal) => Promise<WorkspaceEditResult>,
  readStatus: () => Promise<WorkspaceEditStatusResult>,
  current: Pick<WorkspaceEditResult, 'generation' | 'operationId'>,
  signal: AbortSignal,
): Promise<WorkspaceEditResult> {
  try {
    return await send(signal)
  } catch (error) {
    signal.throwIfAborted()
    const status = await readStatus()
    if (workspaceTransitionAdvanced(status, current.generation)) return status.result
    throw error
  }
}
