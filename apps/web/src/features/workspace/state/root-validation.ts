import type { QueryClient } from '@tanstack/react-query'
import type { WorkspaceRootEntry } from '@workspace/contracts'
import type { Navigation } from '@/state/navigation'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { Client } from '@/lib/client'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { openWorkspaceRootPath } from '@/lib/file-server'
import { claimWorkspaceOpenGeneration } from '@/features/workspace/state/open-generation'
import { toClientError, type ErrorCategory } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'

// Transient failures must not invalidate a retained workspace.
const invalidRootCategories: ReadonlySet<ErrorCategory> = new Set([
  'not_found',
  'not_a_directory',
  'invalid_path',
])

export function watchRootValidation({
  navigation,
  path,
  queryClient,
  store,
}: {
  readonly navigation: Navigation
  readonly path: string
  readonly queryClient: QueryClient
  readonly store: EditorWorkspaceStoreApi
}) {
  const controller = new AbortController()
  const signal = AbortSignal.any([
    controller.signal,
    environmentActivitySignal(originForQueryClient(queryClient)),
  ])
  const invalidateWhenStillCurrent = (reason: string) => {
    if (signal.aborted) return
    if (store.getState().rootFolder?.path !== path) return

    log.warn({ action: 'workspace.root_invalid', area: 'workspace', path, reason })
    navigation.invalidateWorkspace(store, path, 'This workspace directory is unavailable.')
  }
  const confirmWhenStillCurrent = (entry: WorkspaceRootEntry) => {
    if (signal.aborted) return
    const rootFolder = store.getState().rootFolder
    if (!rootFolder || rootFolder.path !== path) return
    if (entry.path !== path) {
      if (!navigation.ownsWorkspace(store, path)) return
      void navigation.openWorkspace({
        environmentId: confirmedEnvironmentId(originForQueryClient(queryClient)),
        path: entry.path,
        replace: true,
      })
      return
    }
    if (rootFolder.workspaceAddress?.id === entry.workspaceAddress.id) return

    store.setState({ rootFolder: { ...rootFolder, workspaceAddress: entry.workspaceAddress } })
  }

  let started = false
  const validateWhenOwned = () => {
    if (started || signal.aborted || !navigation.ownsWorkspace(store, path)) return
    started = true
    void validateRootPath(
      path,
      signal,
      invalidateWhenStillCurrent,
      confirmWhenStillCurrent,
      clientForQueryClient(queryClient),
    )
  }
  const unsubscribe = navigation.subscribe(validateWhenOwned)
  validateWhenOwned()
  return () => {
    controller.abort()
    unsubscribe()
  }
}

async function validateRootPath(
  path: string,
  signal: AbortSignal,
  invalidate: (reason: string) => void,
  confirm: (entry: WorkspaceRootEntry) => void,
  client: Client,
) {
  try {
    const result = await openWorkspaceRootPath(path, claimWorkspaceOpenGeneration(), signal, client)
    if (result.status === 'opened' && result.entry) confirm(result.entry)
  } catch (error) {
    if (signal.aborted) return

    const category = toClientError(error).category
    if (!invalidRootCategories.has(category)) return

    invalidate(category)
  }
}
