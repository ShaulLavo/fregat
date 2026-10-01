import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { WorkspaceAddress } from '@workspace/contracts'
import type { Navigation } from '@/state/navigation'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { readWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { workspaceQueryKeys } from '@/features/workspace/utils/query-keys'
import { toClientError, type ErrorCategory } from '@/lib/client-error-taxonomy'
import { log, observeClientOperation } from '@/lib/client-logging'
import { clientLogContext } from '@/lib/environments/state/log-context'

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
    navigation.invalidateWorkspace(store, path, 'This folder is missing or cannot be opened.')
  }
  const confirmWhenStillCurrent = (address: WorkspaceAddress) => {
    if (signal.aborted) return
    const rootFolder = store.getState().rootFolder
    if (!rootFolder || rootFolder.path !== path) return
    if (address.path !== path) {
      if (!navigation.ownsWorkspace(store, path)) return
      void navigation.openWorkspace({
        environmentId: confirmedEnvironmentId(originForQueryClient(queryClient)),
        path: address.path,
        replace: true,
      })
      return
    }
    if (rootFolder.workspaceAddress.id === address.id) return

    store.setState({ rootFolder: { ...rootFolder, workspaceAddress: address } })
  }

  let started = false
  const validateWhenOwned = () => {
    if (started || signal.aborted || !navigation.ownsWorkspace(store, path)) return
    const rootFolder = store.getState().rootFolder
    if (!rootFolder || rootFolder.path !== path) return
    started = true
    void validateRootAddress(
      rootFolder.workspaceAddress,
      signal,
      invalidateWhenStillCurrent,
      confirmWhenStillCurrent,
      queryClient,
    )
  }
  const unsubscribe = navigation.subscribe(validateWhenOwned)
  validateWhenOwned()
  return () => {
    controller.abort()
    unsubscribe()
  }
}

async function validateRootAddress(
  address: WorkspaceAddress,
  signal: AbortSignal,
  invalidate: (reason: string) => void,
  confirm: (address: WorkspaceAddress) => void,
  queryClient: QueryClient,
) {
  try {
    const result = await queryClient.query(
      queryOptions({
        queryKey: workspaceQueryKeys.rootValidation(address.id),
        queryFn: ({ signal }) => {
          const client = clientForQueryClient(queryClient)
          return observeClientOperation(
            {
              ...clientLogContext(client),
              action: 'fs.read_workspace_address',
              area: 'fs',
              method: 'GET',
              path: address.path,
              route: `/fs/workspace-address/${address.id}`,
              signal,
            },
            () => readWorkspaceAddress({ client, id: address.id, signal }),
          )
        },
        staleTime: 0,
        retry: false,
      }),
    )
    confirm(result)
  } catch (error) {
    if (signal.aborted) return

    const category = toClientError(error).category
    if (!invalidRootCategories.has(category)) return

    invalidate(category)
  }
}
