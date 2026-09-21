import { matchesWorkspaceRoot as isPathInWorkspace } from '@/lib/path-formatters'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { errorMessage, fetchTree } from '@/lib/file-server'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  FILE_TREE_PREFETCH_STALE_MS,
  treeDirectoryPrefetchKey,
} from '@/features/workspace/utils/file-tree-prefetch'
import { idleState, type LoadState } from '@/lib/load-state'
import { log } from '@/lib/client-logging'
import { createCoalescedLogQueue } from '@/lib/coalesced-log'
import { canonicalTreePath, toTreePath } from '@/lib/path-formatters'
import { fileSystemKeys } from '@/lib/query-keys'
import {
  type DirectoryLoadOptions,
  markDirectoryError,
  markDirectoryLoading,
  mergeDirectoryLoad,
  shouldLoadDirectory,
  treeModelWithDirectoryLoads,
  type TreeModel,
} from '@/lib/tree-model'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const DIRECTORY_LOAD_SKIPPED_LOG_DELAY_MS = 250
const directoryLoadSkippedLogs = createCoalescedLogQueue({
  delayMs: DIRECTORY_LOAD_SKIPPED_LOG_DELAY_MS,
  emit: (event) => log.info(event),
})

export function useWorkspaceTreeForRootPath(rootPath: string | null) {
  const { rootTreeKey, treeState } = useWorkspaceTreeQuery(rootPath)
  const queryClient = useQueryClient()

  const resetTreeLoad = () => {
    queryClient.removeQueries({ queryKey: fileSystemKeys.trees() })
  }

  const loadTreeDirectory = (
    entry: TreeEntry,
    treePath: string,
    options: DirectoryLoadOptions = {},
  ) => {
    if (!rootPath) {
      logDirectoryLoadSkipped(treePath, 'missing-root')
      return
    }
    if (treeState.status !== 'ready') {
      logDirectoryLoadSkipped(treePath, `tree-${treeState.status}`)
      return
    }
    if (!isDirectoryEntry(entry)) {
      logDirectoryLoadSkipped(treePath, 'not-directory')
      return
    }
    if (!shouldLoadDirectory(treeState.data, treePath, options)) {
      logDirectoryLoadSkipped(treePath, 'not-needed')
      return
    }

    const canonicalPath = canonicalTreePath(treePath)
    const directoryKey = treeDirectoryPrefetchKey(rootPath, canonicalPath, entry)
    log.info({
      action: 'file-tree.directory.load.start',
      area: 'file-tree',
      entryPath: entry.path,
      retry: options.retry === true,
      rootPath,
      treePath: canonicalPath,
    })

    queryClient.setQueryData(rootTreeKey, (model: TreeModel | undefined) => {
      if (!model) return model

      return markDirectoryLoading(model, canonicalPath)
    })

    void queryClient
      .fetchQuery({
        queryFn: ({ signal, client }) =>
          fetchTree(entry.path, signal, clientForQueryClient(client)),
        queryKey: directoryKey,
        staleTime: FILE_TREE_PREFETCH_STALE_MS,
      })
      .then((result) =>
        queryClient.setQueryData(rootTreeKey, (model: TreeModel | undefined) => {
          if (!model) return model

          log.info({
            action: 'file-tree.directory.load.success',
            area: 'file-tree',
            entryCount: result.entries.length,
            entryPath: entry.path,
            rootPath,
            treePath: canonicalPath,
          })
          return mergeDirectoryLoad(model, rootPath, result, canonicalPath)
        }),
      )
      .catch((error: unknown) => {
        const message = errorMessage(error)
        log.warn({
          action: 'file-tree.directory.load.error',
          area: 'file-tree',
          entryPath: entry.path,
          error: { message },
          rootPath,
          treePath: canonicalPath,
        })
        queryClient.setQueryData(rootTreeKey, (model: TreeModel | undefined) => {
          if (!model) return model

          return markDirectoryError(model, canonicalPath, message)
        })
      })
  }

  const prefetchTreeDirectory = (entry: TreeEntry, treePath: string) => {
    if (!rootPath) return
    if (treeState.status !== 'ready') return
    if (!isDirectoryEntry(entry)) return
    if (!shouldLoadDirectory(treeState.data, treePath)) return

    void queryClient.prefetchQuery({
      queryFn: ({ signal, client }) => fetchTree(entry.path, signal, clientForQueryClient(client)),
      queryKey: treeDirectoryPrefetchKey(rootPath, treePath, entry),
      staleTime: FILE_TREE_PREFETCH_STALE_MS,
    })
  }

  return {
    loadTreeDirectory,
    prefetchTreeDirectory,
    resetTreeLoad,
    treeState,
  }
}

export function useWorkspaceTreeState(rootFolder: PickedFsEntry | null) {
  return useWorkspaceTreeQuery(rootFolder?.path ?? null).treeState
}

function useWorkspaceTreeQuery(rootPath: string | null) {
  const workspaceStore = useEditorWorkspaceStoreApi()
  const resolvedRootPath = rootPath ?? ''
  const rootTreeKey = fileSystemKeys.tree(resolvedRootPath)
  const query = useQuery({
    enabled: Boolean(rootPath),
    queryFn: async ({ signal, client }) => {
      const selectedFilePath =
        tabFileResource(workspaceStore.getState().selectedTabContent)?.path ?? null
      const result = await fetchInitialTree(
        resolvedRootPath,
        selectedFilePath,
        signal,
        clientForQueryClient(client),
      )
      return treeModelWithDirectoryLoads(result.root, resolvedRootPath, result.directories)
    },
    queryKey: rootTreeKey,
  })
  const { data, error, isError, isPending } = query
  const treeState = rootPath ? treeLoadState({ data, error, isError, isPending }) : idleState

  return {
    rootTreeKey,
    treeState,
  }
}

function logDirectoryLoadSkipped(treePath: string, reason: string) {
  const event = {
    action: 'file-tree.directory.load.skipped',
    area: 'file-tree',
    reason,
    treePath,
  }

  directoryLoadSkippedLogs.queue(`${reason}:${treePath}`, event)
}

export function selectedFileAncestorDirectoryPaths(
  rootPath: string,
  selectedFilePath: string | null,
) {
  if (!selectedFilePath) return []
  if (!isPathInWorkspace(selectedFilePath, rootPath)) return []

  const treePath = canonicalTreePath(toTreePath(selectedFilePath, rootPath))
  const segments = treePath.split('/').filter(Boolean)
  if (segments.length <= 1) return []

  return segments.slice(0, -1).map((_, index) => {
    const directoryPath = segments.slice(0, index + 1).join('/')
    if (!rootPath) return directoryPath

    return `${rootPath}/${directoryPath}`
  })
}

async function fetchInitialTree(
  rootPath: string,
  selectedFilePath: string | null,
  signal: AbortSignal,
  client: Client,
) {
  const directoryPaths = selectedFileAncestorDirectoryPaths(rootPath, selectedFilePath)
  const root = fetchTree(filesystemPath(rootPath), signal, client)
  const directories = Promise.all(
    directoryPaths.map((path) => fetchOptionalTree(path, signal, client)),
  )
  const [rootResult, directoryResults] = await Promise.all([root, directories])

  return {
    directories: directoryResults.filter(isTreeResult),
    root: rootResult,
  }
}

async function fetchOptionalTree(path: string, signal: AbortSignal, client: Client) {
  try {
    return await fetchTree(filesystemPath(path), signal, client)
  } catch (error) {
    if (signal.aborted) throw error

    return null
  }
}

function isTreeResult(result: TreeResult | null): result is TreeResult {
  return result !== null
}

function treeLoadState(query: {
  data: TreeModel | undefined
  error: Error | null
  isError: boolean
  isPending: boolean
}): LoadState<TreeModel> {
  if (query.data) return { status: 'ready', data: query.data }
  if (query.isError) return { status: 'error', message: errorMessage(query.error) }
  if (query.isPending) return { status: 'loading' }

  return idleState
}
