import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import {
  entryFromResponse,
  fileResultFromResponse,
  metadataFromResponse,
  type WorkspaceEditPrepareRequest,
} from '@/lib/file-system-types'
import { readDirectory, readFilePreview } from '@workspace/client-core/files/read'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { getClient, type Client } from '@/lib/client'
import type {
  FileResult,
  FindMatch,
  ServerInfo,
  StatResult,
  TreeResult,
} from '@/lib/file-system-types'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'
import { annotateClientError } from '@/lib/client-error-context'
import { log, observeClientOperation } from '@/lib/client-logging'
import { createCoalescedLogQueue } from '@/lib/coalesced-log'
import { omitNullish } from '@/lib/objects'
import { createRpcError } from '@/lib/structured-errors'
import { collectWorkspaceSearch } from '@workspace/client-core/files/search-client'
import type {
  WorkspaceEditRecoverRequest,
  WorkspaceEditRecoveryListResult,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditStatusResult,
  WorkspaceEditTransitionRequest,
  WorkspaceSearchMeasurement,
  WorkspaceRootEntry,
} from '@workspace/contracts'

const TREE_LOG_DELAY_MS = 250
const treeLogs = createCoalescedLogQueue({
  delayMs: TREE_LOG_DELAY_MS,
  emit: (event) => log.info(event),
  merge: mergeTreeLogEvents,
})
const READ_LOG_DELAY_MS = 250
const readLogs = createCoalescedLogQueue({
  delayMs: READ_LOG_DELAY_MS,
  emit: (event) => log.info(event),
})

type DeleteResult = {
  deleted: boolean
  path: string
}

type OpenWorkspaceRootResult = {
  entry?: Omit<WorkspaceRootEntry, 'path'> & { path: FilesystemPath }
  status: 'opened' | 'superseded'
  workspaceIndex: NonNullable<ServerInfo['workspaceIndex']>
}

export type RecentEntriesOptions = {
  limit: number
  mode: 'file' | 'folder'
  showHidden: boolean
}

export type WriteFileContentOptions = {
  baseVersion?: string | null
  expectedMtimeMs?: number | null
  origin?: string | null
  writeId?: string | null
}

export type WorkspaceEditTransitionRoute =
  | 'abort'
  | 'commit'
  | 'finalize'
  | 'redo'
  | 'rollback'
  | 'undo'

export async function prepareWorkspaceEditMutation(
  request: WorkspaceEditPrepareRequest,
  signal: AbortSignal,
  client: Client = getClient(),
): Promise<WorkspaceEditResult> {
  const response = await client.fs['workspace-edit'].prepare.post(request, {
    fetch: { signal },
  })
  return unwrapWorkspaceEditResponse(response)
}

export async function transitionWorkspaceEditMutation(
  transition: WorkspaceEditTransitionRoute,
  request: WorkspaceEditTransitionRequest,
  signal: AbortSignal,
  client: Client = getClient(),
): Promise<WorkspaceEditResult> {
  const routes = client.fs['workspace-edit']
  if (transition === 'abort') {
    return unwrapWorkspaceEditResponse(await routes.abort.post(request, { fetch: { signal } }))
  }
  if (transition === 'commit') {
    return unwrapWorkspaceEditResponse(await routes.commit.post(request, { fetch: { signal } }))
  }
  if (transition === 'finalize') {
    return unwrapWorkspaceEditResponse(await routes.finalize.post(request, { fetch: { signal } }))
  }
  if (transition === 'redo') {
    return unwrapWorkspaceEditResponse(await routes.redo.post(request, { fetch: { signal } }))
  }
  if (transition === 'rollback') {
    return unwrapWorkspaceEditResponse(await routes.rollback.post(request, { fetch: { signal } }))
  }
  return unwrapWorkspaceEditResponse(await routes.undo.post(request, { fetch: { signal } }))
}

export async function recoverWorkspaceEditMutation(
  request: WorkspaceEditRecoverRequest,
  signal: AbortSignal,
  client: Client = getClient(),
): Promise<WorkspaceEditResult> {
  const response = await client.fs['workspace-edit'].recover.post(request, {
    fetch: { signal },
  })
  return unwrapWorkspaceEditResponse(response)
}

export async function releaseWorkspaceEditMutation(
  request: WorkspaceEditReleaseRequest,
  signal: AbortSignal,
  client: Client = getClient(),
): Promise<WorkspaceEditResult> {
  const response = await client.fs['workspace-edit'].release.post(request, {
    fetch: { signal },
  })
  return unwrapWorkspaceEditResponse(response)
}

export async function fetchWorkspaceEditStatus(
  operationId: string,
  signal: AbortSignal,
  client: Client = getClient(),
): Promise<WorkspaceEditStatusResult> {
  const response = await client.fs['workspace-edit'].status.get({
    fetch: { signal },
    query: { operationId },
  })
  return unwrapWorkspaceEditResponse(response)
}

export async function fetchWorkspaceEditRecovery(
  workspace: FilesystemPath,
  signal: AbortSignal,
  client: Client = getClient(),
): Promise<WorkspaceEditRecoveryListResult> {
  const response = await client.fs['workspace-edit'].recovery.get({
    fetch: { signal },
    query: { workspace },
  })
  return unwrapWorkspaceEditResponse(response)
}

export async function fetchTree(
  path: FilesystemPath,
  signal: AbortSignal,
  client: Client = getClient(),
) {
  const startedAt = performance.now()

  try {
    const response = await readDirectory({ client, path, signal })
    const result: TreeResult = {
      path: filesystemPath(response.path),
      entries: response.entries.map(entryFromResponse),
    }
    queueTreeSuccessLog(path, result, startedAt)
    return result
  } catch (error) {
    annotateClientError(error, {
      context: { method: 'GET', path, route: '/fs/tree' },
      operation: 'fs.tree',
    })
    logTreeError(path, error, startedAt, signal)
    throw error
  }
}

export async function fetchFile(
  path: FilesystemPath,
  signal: AbortSignal,
  client: Client = getClient(),
) {
  const startedAt = performance.now()

  try {
    const result = fileResultFromResponse(await readFilePreview({ client, path, signal }))
    queueReadSuccessLog(path, result, startedAt)
    return result
  } catch (error) {
    annotateClientError(error, {
      context: { method: 'GET', path, route: '/fs/read' },
      operation: 'fs.read',
    })
    logReadError(path, error, startedAt, signal)
    throw error
  }
}

export async function fetchQuickOpenFiles(
  {
    path,
    query,
    signal,
  }: {
    path: FilesystemPath
    query: string
    signal: AbortSignal
  },
  client: Client = getClient(),
) {
  let measurement: WorkspaceSearchMeasurement | undefined

  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.quick_open_files',
      area: 'fs',
      method: 'GET',
      path,
      queryLength: query.length,
      route: '/fs/search/events',
      // Chromium surfaces mid-stream cancellation as a bare TypeError that no
      // error-shape check can identify, so the signal is the only ground truth.
      signal,
    },
    async () => {
      const result = await collectWorkspaceSearch(
        {
          caseSensitive: false,
          entryType: 'file',
          includeContent: false,
          includeNames: true,
          limit: 200,
          matchMode: 'fuzzy',
          path,
          query,
          streamNameMatchesEarly: false,
          wholeWord: false,
        },
        signal,
        client,
      )
      measurement = result.measurement

      return result.matches.map((match): FindMatch => ({
        ...match,
        path: filesystemPath(match.path),
      }))
    },
    (matches) => ({
      matchCount: matches.length,
      providerSources: measurement?.providerSources,
    }),
  )
}

export async function writeFileContent(
  path: FilesystemPath,
  content: string,
  options?: number | null | WriteFileContentOptions,
  client: Client = getClient(),
) {
  const writeOptions = normalizeWriteFileContentOptions(options)
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.write',
      area: 'fs',
      hasBaseVersion: writeOptions.baseVersion !== undefined && writeOptions.baseVersion !== null,
      contentBytes: new Blob([content]).size,
      hasExpectedMtime:
        writeOptions.expectedMtimeMs !== undefined && writeOptions.expectedMtimeMs !== null,
      method: 'POST',
      path,
      route: '/fs/write',
      writeId: writeOptions.writeId ?? undefined,
    },
    async () => {
      const body = writeFileContentBody(path, content, writeOptions)
      const response = await client.fs.write.post(body)

      if (response.error) throw createRpcError(response.error)

      return metadataFromResponse(response.data)
    },
    (entry) => ({ entryType: entry.type, size: entry.size }),
  )
}

function normalizeWriteFileContentOptions(
  options: number | null | WriteFileContentOptions | undefined,
): WriteFileContentOptions {
  if (typeof options === 'number' || options === null) {
    return { expectedMtimeMs: options }
  }

  return options ?? {}
}

function unwrapWorkspaceEditResponse<T>(response: {
  readonly data: T | null
  readonly error: unknown
}): T {
  if (response.error) throw createRpcError(response.error)
  if (response.data !== null) return response.data
  throw createRpcError({ message: 'Workspace edit server returned no result' })
}

function writeFileContentBody(path: string, content: string, options: WriteFileContentOptions) {
  return {
    content,
    path,
    ...omitNullish({
      baseVersion: options.baseVersion,
      expectedMtimeMs: options.expectedMtimeMs,
      origin: options.origin,
      writeId: options.writeId,
    }),
  }
}

export async function createFileContent(
  path: FilesystemPath,
  content: string,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.create_file',
      area: 'fs',
      contentBytes: new Blob([content]).size,
      method: 'POST',
      path,
      route: '/fs/create-file',
    },
    async () => {
      const response = await client.fs['create-file'].post({ content, path })

      if (response.error) throw createRpcError(response.error)

      return metadataFromResponse(response.data)
    },
    (entry) => ({ entryType: entry.type, size: entry.size }),
  )
}

export async function ensureFolderPath(path: FilesystemPath, client: Client = getClient()) {
  if (!path) return null

  return requestFolderCreation(path, true, client)
}

export async function createFolderPath(path: FilesystemPath, client: Client = getClient()) {
  return requestFolderCreation(path, false, client)
}

async function requestFolderCreation(
  path: string,
  recursive: boolean,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.create_folder',
      area: 'fs',
      method: 'POST',
      path,
      recursive,
      route: '/fs/create-folder',
    },
    async () => {
      const response = await client.fs['create-folder'].post({
        path,
        recursive,
      })

      if (response.error) throw createRpcError(response.error)

      return metadataFromResponse(response.data)
    },
    (entry) => ({ entryType: entry.type }),
  )
}

export async function renamePath(
  from: FilesystemPath,
  to: FilesystemPath,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.rename',
      area: 'fs',
      from,
      method: 'POST',
      path: to,
      route: '/fs/rename',
    },
    async () => {
      const response = await client.fs.rename.post({ from, to })

      if (response.error) throw response.error

      return metadataFromResponse(response.data)
    },
    (entry) => ({ entryType: entry.type, size: entry.size }),
  )
}

export async function copyPath(
  from: FilesystemPath,
  to: FilesystemPath,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.copy',
      area: 'fs',
      from,
      method: 'POST',
      path: to,
      recursive: true,
      route: '/fs/copy',
    },
    async () => {
      // Directories are the common case for a tree duplicate, and copying a
      // file with `recursive` set is a no-op flag on the server's `cp`.
      const response = await client.fs.copy.post({ from, recursive: true, to })

      if (response.error) throw createRpcError(response.error)

      return metadataFromResponse(response.data)
    },
    (entry) => ({ entryType: entry.type, size: entry.size }),
  )
}

export async function deletePath(
  path: FilesystemPath,
  recursive: boolean,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.delete',
      area: 'fs',
      method: 'POST',
      path,
      recursive,
      route: '/fs/delete',
    },
    async () => {
      const response = await client.fs.delete.post({ path, recursive })

      if (response.error) throw createRpcError(response.error)

      return response.data as DeleteResult
    },
    (result) => ({ deleted: result.deleted }),
  )
}

export async function fetchServerInfo(signal: AbortSignal, client: Client = getClient()) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.server_info',
      area: 'fs',
      method: 'GET',
      route: '/health',
      signal,
    },
    async () => {
      const response = await client.health.get({ fetch: { signal } })

      if (response.error) throw createRpcError(response.error)

      return response.data as ServerInfo
    },
    (info) => ({
      homePath: info.homePath,
      workspaceIndexReadiness: info.workspaceIndex?.readiness,
    }),
  )
}

export async function statPath(
  path: FilesystemPath,
  signal: AbortSignal,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.stat',
      area: 'fs',
      method: 'GET',
      path,
      route: '/fs/stat',
      signal,
    },
    async () => {
      const response = await client.fs.stat.get({ query: { path }, fetch: { signal } })

      if (response.error) throw createRpcError(response.error)

      return {
        ...response.data,
        path: filesystemPath(response.data.path),
        canonicalPath:
          response.data.canonicalPath === undefined
            ? undefined
            : filesystemPath(response.data.canonicalPath),
      } satisfies StatResult
    },
    (entry) => ({ entryType: entry.type, size: entry.size }),
  )
}

export async function openWorkspaceRootPath(
  path: FilesystemPath,
  generation: number,
  signal: AbortSignal,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.open_workspace_root',
      area: 'fs',
      generation,
      method: 'POST',
      path,
      route: '/fs/workspace-root',
      signal,
    },
    async () => {
      const response = await client.fs['workspace-root'].post(
        { generation, path },
        { fetch: { signal } },
      )

      if (response.error) throw createRpcError(response.error)

      const result = response.data
      return {
        ...result,
        entry: result.entry ? metadataFromResponse(result.entry) : undefined,
      } satisfies OpenWorkspaceRootResult
    },
    (result) => ({
      openStatus: result.status,
      scanRoot: result.workspaceIndex.scanRoot,
      workspaceIndexReadiness: result.workspaceIndex.readiness,
    }),
  )
}

/** `signal` is optional: a caller with no lifecycle to hang it on must not fake one. */
export async function fetchRecentEntries(
  options: RecentEntriesOptions,
  signal?: AbortSignal,
  client: Client = getClient(),
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.recents',
      area: 'fs',
      ...options,
      method: 'GET',
      route: '/fs/recents',
      signal,
    },
    async () => {
      const response = await client.fs.recents.get({ query: options, fetch: { signal } })

      if (response.error) throw createRpcError(response.error)

      return response.data.entries.map(entryFromResponse)
    },
    (entries) => ({ entryCount: entries.length }),
  )
}

export async function recordRecentEntry(path: FilesystemPath, client: Client = getClient()) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'fs.record_recent',
      area: 'fs',
      method: 'POST',
      path,
      route: '/fs/recents',
    },
    async () => {
      const response = await client.fs.recents.post({ path })

      if (response.error) throw createRpcError(response.error)

      return null
    },
  )
}

export function errorMessage(error: unknown) {
  return clientErrorMessage(error)
}

function queueTreeSuccessLog(path: string, result: TreeResult, startedAt: number) {
  treeLogs.queue('fs.tree', {
    action: 'fs.tree',
    area: 'fs',
    durationMs: elapsedMs(startedAt),
    entryCount: result.entries.length,
    outcome: 'ok',
    path,
  })
}

function queueReadSuccessLog(path: string, result: FileResult, startedAt: number) {
  readLogs.queue(`fs.read:${path}`, {
    action: 'fs.read',
    area: 'fs',
    durationMs: elapsedMs(startedAt),
    outcome: 'ok',
    path,
    size: result.size,
  })
}

function logReadError(path: string, error: unknown, startedAt: number, signal: AbortSignal) {
  if (signal.aborted) return
  if (isAbortError(error)) return

  log.warn({
    action: 'fs.read',
    area: 'fs',
    durationMs: elapsedMs(startedAt),
    error: operationErrorSummary(error),
    outcome: 'error',
    path,
  })
}

function logTreeError(path: string, error: unknown, startedAt: number, signal: AbortSignal) {
  if (signal.aborted) return
  if (isAbortError(error)) return

  log.warn({
    action: 'fs.tree',
    area: 'fs',
    durationMs: elapsedMs(startedAt),
    error: operationErrorSummary(error),
    outcome: 'error',
    path,
  })
}

function mergeTreeLogEvents(current: Record<string, unknown>, next: Record<string, unknown>) {
  return {
    action: 'fs.tree',
    area: 'fs',
    latestPath: stringField(next, 'path') ?? stringField(next, 'latestPath'),
    maxDurationMs: Math.max(
      numberField(current, 'maxDurationMs'),
      durationMs(current),
      durationMs(next),
    ),
    outcome: 'ok',
    pathCount: numberField(current, 'pathCount', 1) + 1,
    pathSample: treePathSample(current, next),
    totalDurationMs: roundMs(totalDurationMs(current) + durationMs(next)),
    totalEntryCount: totalEntryCount(current) + entryCount(next),
  }
}

function treePathSample(current: Record<string, unknown>, next: Record<string, unknown>) {
  const paths = currentPathSample(current)
  const nextPath = stringField(next, 'path') ?? stringField(next, 'latestPath')
  if (nextPath) paths.push(nextPath)

  return paths.slice(0, 3)
}

function currentPathSample(event: Record<string, unknown>) {
  if (Array.isArray(event.pathSample)) {
    return event.pathSample.filter((value): value is string => typeof value === 'string')
  }

  const path = stringField(event, 'path') ?? stringField(event, 'latestPath')
  return path ? [path] : []
}

function operationErrorSummary(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: typeof error,
  }
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (error instanceof Error) return error.name === 'AbortError'

  return false
}

function totalDurationMs(event: Record<string, unknown>) {
  return numberField(event, 'totalDurationMs', durationMs(event))
}

function totalEntryCount(event: Record<string, unknown>) {
  return numberField(event, 'totalEntryCount', entryCount(event))
}

function durationMs(event: Record<string, unknown>) {
  return numberField(event, 'durationMs')
}

function entryCount(event: Record<string, unknown>) {
  return numberField(event, 'entryCount')
}

function numberField(event: Record<string, unknown>, key: string, fallback = 0) {
  const value = event[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringField(event: Record<string, unknown>, key: string) {
  const value = event[key]
  return typeof value === 'string' ? value : null
}

function elapsedMs(startedAt: number) {
  return roundMs(performance.now() - startedAt)
}

function roundMs(value: number) {
  return Math.round(value * 100) / 100
}
