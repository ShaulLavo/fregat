import { parentPath } from '@/lib/path-formatters'
import { startWorkspaceEventStreams } from '@/features/workspace/state/event-streams'
import { startPageSubscription } from '@/lib/state/page-subscription'
import { entryFromResponse } from '@/lib/file-system-types'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { filePathsForTabs } from '@/lib/documents/utils/capabilities'
import type {
  DocumentKey,
  DocumentRef,
  FilesystemPath,
  TabContent,
} from '@/lib/documents/utils/types'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import {
  useEditorConflictStoreApi,
  type EditorConflictStoreApi,
} from '@/features/editor/state/conflict-state'
import {
  useEditorDocumentStoreApi,
  type LiveEditorDocument,
} from '@/features/editor/state/document-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { fileSnapshotQueryOptions, setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fetchFile, fetchTree } from '@/lib/file-server'
import type { FileResult } from '@/lib/file-system-types'
import type { Client } from '@/lib/client'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { setWatchCoverage, watchCoverageKey } from '@/lib/state/watch-coverage'
import {
  createDirectoryChurn,
  type DirectoryChurn,
} from '@/features/workspace/utils/directory-churn'
import { fileSystemKeys, gitKeys } from '@/lib/query-keys'
import { Throttler } from '@tanstack/react-pacer/throttler'
import { toTreePath } from '@/lib/path-formatters'
import { createWideEventScope } from '@/lib/wide-event-scope'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import type { WideEventScope } from '@workspace/observability/scope'
import {
  mayTrustCachedSnapshot,
  planFetchedOpenFileRefresh,
  planWorkspaceReady,
  type WorkspaceEventPlan,
  type WorkspaceFetchedOpenFileOperation,
  type WorkspaceOpenFileOperation,
  type WorkspaceOpenFileRefresh,
  type WorkspaceOpenFileSnapshot,
  type WorkspaceTreeOperation,
} from '@/features/workspace/utils/event-model'
import {
  dismissFilesystemConflicts,
  markDeletedFilesystemDocument,
  notifyChangedFilesystemConflict,
  notifyRenamedFilesystemConflict,
  type WorkspaceConflictContext,
} from '@/features/workspace/state/event-conflict-adapter'
import { patchTreeEntryMetadata, replaceDirectoryLoad, type TreeModel } from '@/lib/tree-model'
import {
  focusManager,
  onlineManager,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'
import type { TreeEntry, WatchServerMessage } from '@workspace/contracts'
import { useWorkspaceEditEventClassifier } from '@/features/editor/providers/workspace-edit-context'
import { planWorkspaceEditAwareEventBatch } from '@/features/workspace/utils/workspace-edit-events'

export type FilesystemEvent = Extract<
  WatchServerMessage,
  { type: 'created' | 'changed' | 'deleted' | 'renamed' }
>

const EVENT_BATCH_DELAY_MS = 100

const FILE_REFRESH_RETRY_DELAY_MS = 80

const FILE_REFRESH_RETRY_ATTEMPTS = 5

// Leading + trailing throttle so a runaway stream of filesystem events (an
// external tool writing into the workspace) cannot refetch git status on
// every batch.
const GIT_INVALIDATION_THROTTLE_MS = 2_000

export function useWorkspaceEvents(rootFolder: PickedFsEntry | null) {
  const queryClient = useQueryClient()
  const conflictStore = useEditorConflictStoreApi()
  const documentStore = useEditorDocumentStoreApi()
  const workspaceStore = useEditorWorkspaceStoreApi()
  const { discardLiveEditorDocument, renameLiveEditorDocument, selectContent } = useEditorCommands()
  const isOwnWorkspaceEditEvent = useWorkspaceEditEventClassifier()
  const rootPath = rootFolder?.path ?? null
  const applyEvents = useEffectEvent(
    (
      events: FilesystemEvent[],
      signal: AbortSignal,
      currentRootPath: string,
      eventsScope: WideEventScope,
      scheduleGitInvalidation: () => void,
    ) => {
      const documentState = documentStore.getState()
      const workspaceState = workspaceStore.getState()

      void applyWorkspaceEvents({
        conflictStore,
        discardLiveEditorDocument,
        dirtyDocumentKeys: documentState.dirtyDocumentKeys,
        ensureUnsyncedEditorDocument: documentState.ensureUnsyncedEditorDocument,
        events,
        forceReplaceLiveEditorDocument: documentState.forceReplaceLiveEditorDocument,
        getLiveEditorDocument: documentState.getLiveEditorDocument,
        setFileOrphaned: documentState.setFileOrphaned,
        isOwnWorkspaceEditEvent,
        openFilePaths: filePathsForTabs(workspaceState.openTabContents),
        queryClient,
        renameLiveEditorDocument,
        rootPath: currentRootPath,
        scheduleGitInvalidation,
        selectContent,
        signal,
        scope: eventsScope,
      }).catch((error: unknown) => {
        if (signal.aborted) return

        eventsScope.warn('Failed to apply workspace filesystem events.', { error })
        reportError(toClientError(error))
      })
    },
  )
  const applyReady = useEffectEvent(
    (
      signal: AbortSignal,
      currentRootPath: string,
      eventsScope: WideEventScope,
      scheduleGitInvalidation: () => void,
      readyFiles?: readonly string[],
    ) => {
      const documentState = documentStore.getState()
      const workspaceState = workspaceStore.getState()

      void applyWorkspaceReady({
        conflictStore,
        discardLiveEditorDocument,
        dirtyDocumentKeys: documentState.dirtyDocumentKeys,
        ensureUnsyncedEditorDocument: documentState.ensureUnsyncedEditorDocument,
        forceReplaceLiveEditorDocument: documentState.forceReplaceLiveEditorDocument,
        getLiveEditorDocument: documentState.getLiveEditorDocument,
        setFileOrphaned: documentState.setFileOrphaned,
        openFilePaths: readyFiles ?? filePathsForTabs(workspaceState.openTabContents),
        queryClient,
        renameLiveEditorDocument,
        rootPath: currentRootPath,
        scheduleGitInvalidation,
        selectContent,
        signal,
        scope: eventsScope,
      }).catch((error: unknown) => {
        if (signal.aborted) return

        eventsScope.warn('Failed to apply workspace ready events.', { error })
        reportError(toClientError(error))
      })
    },
  )

  useEffect(() => {
    if (!rootPath) return

    return startPageSubscription(() => {
      const controller = new AbortController()
      const gitInvalidation = new Throttler(() => invalidateGitState(queryClient), {
        wait: GIT_INVALIDATION_THROTTLE_MS,
      })
      const eventsScope = createWideEventScope({
        action: 'workspace.events.summary',
        area: 'workspace-events',
        path: rootPath,
      })
      const churn = createDirectoryChurn()
      const coverageKey = watchCoverageKey(originForQueryClient(queryClient), rootPath)
      let limited = false
      const queue = createEventQueue((events) => {
        churn.record(events.flatMap((event) => filesystemEventDirectories(event, rootPath)))
        applyEvents(events, controller.signal, rootPath, eventsScope, gitInvalidation.maybeExecute)
      })
      eventsScope.increment('subscription.subscribeCount')

      const streams = startWorkspaceEventStreams({
        client: clientForQueryClient(queryClient),
        rootPath,
        onMessage: (message) => {
          if (message.type === 'ready') {
            eventsScope.increment('subscription.readyCount')
            limited = message.watch?.mode === 'limited'
            if (message.watch) eventsScope.set({ watch: message.watch })
            setWatchCoverage(coverageKey, message.watch)
            applyReady(controller.signal, rootPath, eventsScope, gitInvalidation.maybeExecute)
            return
          }
          if (message.type === 'coverage') {
            eventsScope.increment('subscription.coverageCount')
            eventsScope.set({ watch: message.watch })
            limited = message.watch.mode === 'limited'
            setWatchCoverage(coverageKey, message.watch)
            // What changed below the top level while it was limited arrived nowhere; read it again.
            applyReady(controller.signal, rootPath, eventsScope, gitInvalidation.maybeExecute)
            return
          }
          if (message.type === 'error') {
            eventsScope.increment('subscription.errorCount')
            eventsScope.warn(message.message, {
              code: message.code,
            })
            reportError(toClientError(message))
            return
          }
          if (
            message.type === 'subscribed' ||
            message.type === 'unsubscribed' ||
            message.type === 'pong'
          ) {
            return
          }

          queue.push(message)
        },
        onFilesReady: (files) => {
          eventsScope.increment('subscription.filesReadyCount')
          applyReady(controller.signal, rootPath, eventsScope, gitInvalidation.maybeExecute, files)
        },
        onError: (error: unknown) => {
          if (controller.signal.aborted) return

          eventsScope.increment('stream.errorCount')
          eventsScope.warn('Workspace event stream failed.', { error })
          reportError(toClientError(error))
        },
        onInterrupted: ({ scope, error, retryInMs }) => {
          eventsScope.increment(`stream.${scope}InterruptionCount`)
          eventsScope.set({
            stream: { lastInterruption: { scope, failed: error !== undefined, retryInMs } },
          })
        },
      })
      const unsubscribeFiles = workspaceStore.subscribe(
        (state) => state.openTabContents,
        (contents) => streams.setFiles(filePathsForTabs(contents)),
        { fireImmediately: true },
      )
      // The stream can outlive an outage that failed the reads its events asked for.
      const unsubscribeOnline = onlineManager.subscribe((online) => {
        if (!online) return
        eventsScope.increment('subscription.onlineResyncCount')
        applyReady(controller.signal, rootPath, eventsScope, gitInvalidation.maybeExecute)
      })
      // A limited root reports only its top level, so coming back to the window rereads the rest.
      const unsubscribeFocus = focusManager.subscribe((focused) => {
        if (!focused || !limited) return
        eventsScope.increment('subscription.focusResyncCount')
        applyReady(controller.signal, rootPath, eventsScope, gitInvalidation.maybeExecute)
      })

      return () => {
        unsubscribeFocus()
        setWatchCoverage(coverageKey, undefined)
        unsubscribeOnline()
        unsubscribeFiles()
        streams.close()
        controller.abort()
        gitInvalidation.cancel()
        queue.clear()
        eventsScope.increment('subscription.unsubscribeCount')
        recordEventChurn(eventsScope, churn)
        endWorkspaceEventsScope(eventsScope)
      }
    })
  }, [queryClient, rootPath, workspaceStore])

  useEffect(() => {
    return () => dismissFilesystemConflicts(conflictStore)
  }, [conflictStore, rootPath])
}

function endWorkspaceEventsScope(eventsScope: WideEventScope) {
  if (!workspaceEventsScopeHasWork(eventsScope)) return

  eventsScope.end()
}

function workspaceEventsScopeHasWork(eventsScope: WideEventScope) {
  if (eventsScope.count('events.eventCount') > 0) return true
  if (eventsScope.count('subscription.readyCount') > 0) return true
  if (eventsScope.count('subscription.errorCount') > 0) return true

  if (eventsScope.count('stream.projectInterruptionCount') > 0) return true
  if (eventsScope.count('stream.filesInterruptionCount') > 0) return true
  return eventsScope.count('stream.errorCount') > 0
}

type WorkspaceEventContext = Omit<
  Parameters<typeof applyWorkspaceEventPlan>[0],
  'plan' | 'ignoreOpenFileRefreshErrors'
> & {
  openFilePaths: readonly string[]
  scope: WideEventScope
}

export async function applyWorkspaceEvents({
  events,
  isOwnWorkspaceEditEvent,
  openFilePaths,
  scope,
  ...context
}: WorkspaceEventContext & {
  events: FilesystemEvent[]
  isOwnWorkspaceEditEvent: (writeId: string) => boolean
}) {
  const plan = planWorkspaceEditAwareEventBatch(
    events,
    openFileSnapshots(openFilePaths, context.dirtyDocumentKeys, context.getLiveEditorDocument),
    context.rootPath,
    isOwnWorkspaceEditEvent,
  )
  logWorkspaceEventBatch(scope, events)
  logWorkspaceEventPlan(scope, 'workspace.events.plan', plan)
  await applyWorkspaceEventPlan({ ...context, plan })
}

function invalidateGitState(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: gitKeys.all })
}

function logWorkspaceEventBatch(scope: WideEventScope, events: readonly FilesystemEvent[]) {
  if (!events.length) return

  scope.increment('events.batchCount')
  scope.increment('events.eventCount', events.length)
  scope.set({
    events: {
      latestBatchTypes: filesystemEventCounts(events),
    },
  })
}

function logWorkspaceEventPlan(
  scope: WideEventScope,
  action: 'workspace.events.plan' | 'workspace.events.ready_plan',
  plan: WorkspaceEventPlan,
) {
  scope.increment('plans.count')
  scope.increment(`plans.${action === 'workspace.events.ready_plan' ? 'readyCount' : 'batchCount'}`)
  scope.increment('plans.openFileOperationCount', plan.openFileOperations.length)
  scope.increment('plans.treeOperationCount', plan.treeOperations.length)
  if (plan.shouldInvalidateGitState) scope.increment('plans.gitInvalidationCount')

  scope.set({
    plans: {
      latestAction: action,
      latestInvalidatesGitState: plan.shouldInvalidateGitState,
      latestOpenFileOperationCount: plan.openFileOperations.length,
      latestTreeOperationCount: plan.treeOperations.length,
    },
  })
}

function filesystemEventCounts(events: readonly FilesystemEvent[]) {
  const counts: Record<string, number> = {}

  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1
  }

  return counts
}

function filesystemEventDirectories(event: FilesystemEvent, rootPath: string): readonly string[] {
  if (event.type === 'renamed') {
    return [parentPath(event.path, rootPath), parentPath(event.oldPath, rootPath)]
  }

  return [parentPath(event.path, rootPath)]
}

// Folded into the summary at scope end (not per batch) because `set` deep-merge
// concatenates arrays — repeated sets of `topDirectories` would grow without
// bound.
function recordEventChurn(scope: WideEventScope, churn: DirectoryChurn) {
  const summary = churn.summary()
  if (!summary) return

  scope.set({ events: { churn: summary } })
}

async function applyWorkspaceReady({ openFilePaths, scope, ...context }: WorkspaceEventContext) {
  const plan = planWorkspaceReady({
    openFiles: openFileSnapshots(
      openFilePaths,
      context.dirtyDocumentKeys,
      context.getLiveEditorDocument,
    ),
    rootPath: context.rootPath,
  })
  logWorkspaceEventPlan(scope, 'workspace.events.ready_plan', plan)
  await applyWorkspaceEventPlan({ ...context, ignoreOpenFileRefreshErrors: true, plan })
}

async function applyWorkspaceEventPlan({
  conflictStore,
  discardLiveEditorDocument,
  dirtyDocumentKeys,
  ensureUnsyncedEditorDocument,
  forceReplaceLiveEditorDocument,
  getLiveEditorDocument,
  setFileOrphaned,
  ignoreOpenFileRefreshErrors = false,
  plan,
  queryClient,
  renameLiveEditorDocument,
  rootPath,
  scheduleGitInvalidation,
  selectContent,
  signal,
}: {
  conflictStore: EditorConflictStoreApi
  discardLiveEditorDocument: (document: DocumentRef) => { wasDirty: boolean }
  dirtyDocumentKeys: ReadonlySet<DocumentKey>
  ensureUnsyncedEditorDocument: WorkspaceConflictContext['ensureUnsyncedEditorDocument']
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  getLiveEditorDocument: (key: DocumentKey) => LiveEditorDocument | null
  setFileOrphaned: WorkspaceConflictContext['setFileOrphaned']
  ignoreOpenFileRefreshErrors?: boolean
  plan: WorkspaceEventPlan
  queryClient: ReturnType<typeof useQueryClient>
  renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
  rootPath: string
  scheduleGitInvalidation: () => void
  selectContent: (content: TabContent) => void
  signal: AbortSignal
}) {
  const client = clientForQueryClient(queryClient)
  const conflictContext: WorkspaceConflictContext = {
    client,
    conflictStore,
    discardLiveEditorDocument,
    ensureUnsyncedEditorDocument,
    fetchFile: (path, signal) => fetchFileWithRetry(path, signal, client),
    forceReplaceLiveEditorDocument,
    getLiveEditorDocument,
    setFileOrphaned,
    queryClient,
    renameLiveEditorDocument,
    selectContent,
  }

  if (plan.shouldInvalidateGitState) scheduleGitInvalidation()
  if (plan.shouldInvalidateFileHistory) {
    void queryClient.invalidateQueries({ queryKey: fileSystemKeys.fileOperationHistory(rootPath) })
  }

  await applyTreeOperations(queryClient, rootPath, plan.treeOperations, signal)
  await applyOpenFileOperations({
    conflictContext,
    dirtyDocumentKeys,
    forceReplaceLiveEditorDocument,
    ignoreRefreshErrors: ignoreOpenFileRefreshErrors,
    operations: plan.openFileOperations,
    queryClient,
    signal,
  })
}

async function applyTreeOperations(
  queryClient: ReturnType<typeof useQueryClient>,
  rootPath: string,
  operations: readonly WorkspaceTreeOperation[],
  signal: AbortSignal,
) {
  for (const operation of operations) {
    if (operation.type !== 'patch-changed-tree-entries') continue

    patchChangedTreeEntries(queryClient, rootPath, operation.entries)
  }

  await Promise.all(
    operations.map((operation) =>
      applyTreeRefreshOperation(queryClient, rootPath, operation, signal).catch(() => null),
    ),
  )
}

function patchChangedTreeEntries(
  queryClient: ReturnType<typeof useQueryClient>,
  rootPath: string,
  entries: readonly TreeEntry[],
) {
  if (!entries.length) return

  const rootTreeKey = fileSystemKeys.tree(rootPath)
  queryClient.setQueryData(rootTreeKey, (current: TreeModel | undefined) => {
    if (!current) return current

    return entries.reduce(
      (model, entry) => patchTreeEntryMetadata(model, rootPath, entryFromResponse(entry)),
      current,
    )
  })
}

async function applyTreeRefreshOperation(
  queryClient: ReturnType<typeof useQueryClient>,
  rootPath: string,
  operation: WorkspaceTreeOperation,
  signal: AbortSignal,
) {
  if (operation.type === 'refresh-tree-directory') {
    await refreshTreeDirectory(queryClient, rootPath, operation.path, signal)
    return
  }
  if (operation.type !== 'refresh-ready-tree') return

  // Whatever was listed before the watch attached can miss what changed while it attached.
  const model = queryClient.getQueryData<TreeModel>(fileSystemKeys.tree(rootPath))
  const directories = [...(model?.loadedDirectoryPaths ?? [])].map((treePath) =>
    treePath ? `${operation.path}/${treePath}` : operation.path,
  )
  await Promise.all(
    [operation.path, ...directories].map((path) =>
      refreshTreeDirectory(queryClient, rootPath, path, signal),
    ),
  )
}

async function refreshTreeDirectory(
  queryClient: ReturnType<typeof useQueryClient>,
  rootPath: string,
  path: string,
  signal: AbortSignal,
) {
  const rootTreeKey = fileSystemKeys.tree(rootPath)
  const model = queryClient.getQueryData<TreeModel>(rootTreeKey)
  if (!model) return
  if (!shouldRefreshDirectory(model, rootPath, path)) return

  const result = await fetchTree(filesystemPath(path), signal, clientForQueryClient(queryClient))
  queryClient.setQueryData(rootTreeKey, (current: TreeModel | undefined) => {
    if (!current) return current

    return replaceDirectoryLoad(current, rootPath, result)
  })
}

async function applyOpenFileOperations({
  conflictContext,
  dirtyDocumentKeys,
  forceReplaceLiveEditorDocument,
  ignoreRefreshErrors,
  operations,
  queryClient,
  signal,
}: {
  conflictContext: WorkspaceConflictContext
  dirtyDocumentKeys: ReadonlySet<DocumentKey>
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  ignoreRefreshErrors: boolean
  operations: readonly WorkspaceOpenFileOperation[]
  queryClient: ReturnType<typeof useQueryClient>
  signal: AbortSignal
}) {
  for (const operation of operations) {
    try {
      await applyOpenFileOperation({
        conflictContext,
        dirtyDocumentKeys,
        forceReplaceLiveEditorDocument,
        operation,
        queryClient,
        signal,
      })
    } catch (error) {
      if (ignoreRefreshErrors && operation.type === 'refresh-open-file') continue

      throw error
    }
  }
}

function openFileSnapshots(
  openFilePaths: readonly string[],
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
  getLiveEditorDocument: (key: DocumentKey) => LiveEditorDocument | null,
): WorkspaceOpenFileSnapshot[] {
  return openFilePaths.map((path) =>
    openFileSnapshot(path, dirtyDocumentKeys, getLiveEditorDocument),
  )
}

function openFileSnapshot(
  path: string,
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
  getLiveEditorDocument: (key: DocumentKey) => LiveEditorDocument | null,
): WorkspaceOpenFileSnapshot {
  const liveDocument = getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))

  return {
    hasLiveDocument: Boolean(liveDocument),
    isDirty:
      dirtyDocumentKeys.has(fileDocumentKey(filesystemPath(path))) ||
      liveDocument?.buffer.isDirty() === true,
    path,
  }
}

async function applyOpenFileOperation({
  conflictContext,
  dirtyDocumentKeys,
  forceReplaceLiveEditorDocument,
  operation,
  queryClient,
  signal,
}: {
  conflictContext: WorkspaceConflictContext
  dirtyDocumentKeys: ReadonlySet<DocumentKey>
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  operation: WorkspaceOpenFileOperation
  queryClient: ReturnType<typeof useQueryClient>
  signal: AbortSignal
}) {
  if (operation.type === 'rename-open-file') {
    applyRenameOpenFileOperation(operation.from, operation.to, conflictContext)
    return
  }
  if (operation.type === 'renamed-conflict') {
    await applyRenamedConflictOperation(operation.localPath, operation.remotePath, conflictContext)
    return
  }

  await applyRefreshOpenFileOperation({
    conflictContext,
    dirtyDocumentKeys,
    forceReplaceLiveEditorDocument,
    queryClient,
    refresh: operation,
    signal,
  })
}

async function applyRefreshOpenFileOperation({
  conflictContext,
  dirtyDocumentKeys,
  forceReplaceLiveEditorDocument,
  queryClient,
  refresh,
  signal,
}: {
  conflictContext: WorkspaceConflictContext
  dirtyDocumentKeys: ReadonlySet<DocumentKey>
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean }
  queryClient: ReturnType<typeof useQueryClient>
  refresh: WorkspaceOpenFileRefresh
  signal: AbortSignal
}) {
  const path = refresh.path
  // Share reads with the selected-file query. Only that query owns cancellation;
  // subscription teardown stops application without cancelling other consumers.
  if (signal.aborted) return
  await settlePendingSaves(queryClient, fileDocumentKey(filesystemPath(path)), signal)
  if (signal.aborted) return

  const cached = queryClient.getQueryData<FileResult>(fileSystemKeys.fileSnapshot(path))
  const file = await queryClient
    .fetchQuery({
      ...fileSnapshotQueryOptions(filesystemPath(path), {
        fetcher: (path, signal) => {
          const client = clientForQueryClient(queryClient)
          if (refresh.reason === 'deleted') return fetchFile(path, signal, client)
          return fetchFileWithRetry(path, signal, client)
        },
      }),
      // fetchFileWithRetry retries internally; query-level retry would stack.
      retry: false,
      ...(mayTrustCachedSnapshot(refresh, cached?.version) ? {} : { staleTime: 0 }),
    })
    .catch((error: unknown) => {
      if (signal.aborted) return null
      if (toClientError(error).category !== 'not_found') throw error
      markDeletedFilesystemDocument(filesystemPath(path), conflictContext)
      return null
    })
  if (signal.aborted || !file) return
  conflictContext.setFileOrphaned(fileDocumentKey(filesystemPath(path)), false)

  setFileSnapshotQueryData(queryClient, file)
  const operation = planFetchedOpenFileRefresh({
    baseVersion: liveDocumentVersion(path, conflictContext),
    isDirty: isDirtyLiveDocument(path, dirtyDocumentKeys, conflictContext),
    liveText: liveDocumentText(path, conflictContext),
    path,
    remoteText: file.content,
    remoteVersion: file.version,
  })
  applyFetchedOpenFileOperation(operation, file, forceReplaceLiveEditorDocument, conflictContext)
}

function applyFetchedOpenFileOperation(
  operation: WorkspaceFetchedOpenFileOperation,
  file: FileResult,
  forceReplaceLiveEditorDocument: (file: FileResult) => { wasDirty: boolean },
  context: WorkspaceConflictContext,
) {
  if (operation.type === 'unchanged-open-file') return
  if (operation.type === 'changed-conflict') {
    notifyChangedFilesystemConflict(filesystemPath(operation.path), file, context)
    return
  }
  if (!context.getLiveEditorDocument(fileDocumentKey(file.path))) return

  forceReplaceLiveEditorDocument(file)
}

function applyRenameOpenFileOperation(from: string, to: string, context: WorkspaceConflictContext) {
  // A buffer that turned dirty after planning moves with its unsaved text; nothing is lost.
  context.renameLiveEditorDocument(filesystemPath(from), filesystemPath(to))
  moveFileQueryData(context.queryClient, from, to)
}

async function applyRenamedConflictOperation(
  localPath: string,
  remotePath: string,
  context: WorkspaceConflictContext,
) {
  await notifyRenamedFilesystemConflict(
    filesystemPath(localPath),
    filesystemPath(remotePath),
    context,
  )
}

function pendingSaves(queryClient: QueryClient, key: DocumentKey) {
  return queryClient
    .getMutationCache()
    .findAll({ mutationKey: editorMutationKeys.save(key), status: 'pending' })
}

function settlePendingSaves(queryClient: QueryClient, key: DocumentKey, signal: AbortSignal) {
  if (pendingSaves(queryClient, key).length === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const finish = () => {
      unsubscribe()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const unsubscribe = queryClient.getMutationCache().subscribe(() => {
      if (pendingSaves(queryClient, key).length === 0) finish()
    })
    signal.addEventListener('abort', finish)
  })
}

function liveDocumentVersion(path: string, context: WorkspaceConflictContext) {
  const sync = context.getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))?.sync
  return sync?.kind === 'file' ? sync.fileVersion : null
}

function liveDocumentText(path: string, context: WorkspaceConflictContext) {
  return (
    context
      .getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))
      ?.buffer.materializeFullText() ?? null
  )
}

async function fetchFileWithRetry(path: string, signal: AbortSignal, client: Client) {
  let lastError: unknown = null

  for (let attempt = 0; attempt < FILE_REFRESH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetchFile(filesystemPath(path), signal, client)
    } catch (error) {
      lastError = error
      if (signal.aborted) throw error
      await delay(FILE_REFRESH_RETRY_DELAY_MS, signal)
    }
  }

  throw lastError
}

function isDirtyLiveDocument(
  path: string,
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
  context: WorkspaceConflictContext,
) {
  return (
    dirtyDocumentKeys.has(fileDocumentKey(filesystemPath(path))) ||
    context.getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))?.buffer.isDirty() === true
  )
}

function moveFileQueryData(
  queryClient: ReturnType<typeof useQueryClient>,
  from: string,
  to: string,
) {
  const file = queryClient.getQueryData<FileResult>(fileSystemKeys.fileSnapshot(from))
  queryClient.removeQueries({
    exact: true,
    queryKey: fileSystemKeys.fileSnapshot(from),
  })
  if (!file) return

  setFileSnapshotQueryData(queryClient, { ...file, path: filesystemPath(to) })
}

function shouldRefreshDirectory(model: TreeModel, rootPath: string, path: string) {
  if (path === rootPath) return true

  const treePath = toTreePath(path, rootPath)
  return model.loadedDirectoryPaths.has(treePath)
}

function createEventQueue(onFlush: (events: FilesystemEvent[]) => void) {
  let queued: FilesystemEvent[] = []
  const sequences = new Set<number>()
  let timeout: number | null = null

  return {
    clear: () => {
      queued = []
      sequences.clear()
      if (timeout === null) return

      window.clearTimeout(timeout)
      timeout = null
    },
    push: (event: FilesystemEvent) => {
      if (event.sequence !== undefined && sequences.has(event.sequence)) return
      if (event.sequence !== undefined) sequences.add(event.sequence)
      queued.push(event)
      if (timeout !== null) return

      timeout = window.setTimeout(() => {
        const events = queued
        queued = []
        sequences.clear()
        timeout = null
        onFlush(events)
      }, EVENT_BATCH_DELAY_MS)
    },
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
