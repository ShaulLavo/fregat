import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import type { QueryClient } from '@tanstack/react-query'
import type { EditorApplyActions } from '@/features/editor/state/apply-actions'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { workspacePathLeaf } from '@workspace/client-core/files/path'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { fileSystemKeys } from '@/lib/query-keys'
import { runMutation } from '@/lib/mutations/run'
import { recordRecentMutationOptions } from '@/features/workspace/utils/record-recent-mutation'
import { openWorkspaceRootMutationOptions } from '@/features/workspace/utils/open-root-mutation'
import {
  activateWorkspaceRoot,
  holdsActiveProject,
  releaseActiveProject,
  useActiveProjectStore,
} from '@/features/workspace/state/active-project'

export type OpenWorkspaceRootResult = 'already-open' | 'failed' | 'opened' | 'superseded'

type WorkspaceRootOwner = {
  queryClient: QueryClient
  switchRootFolder: EditorApplyActions['switchRootFolder']
  workspaceStore: EditorWorkspaceStoreApi
  workspaceEdits: WorkspaceEditService | null
}

export async function openWorkspaceRootForOwner(
  { queryClient, switchRootFolder, workspaceStore, workspaceEdits }: WorkspaceRootOwner,
  workspaceRoot: string,
  options: { readonly isCurrent?: () => boolean; readonly signal?: AbortSignal } = {},
): Promise<OpenWorkspaceRootResult> {
  const origin = originForQueryClient(queryClient)
  const activity = AbortSignal.any(
    [environmentActivitySignal(origin)].concat(options.signal ? [options.signal] : []),
  )
  if (activity.aborted || options.isCurrent?.() === false) return 'superseded'
  const reservation = workspaceEdits?.acquireRootSwitchReservation() ?? null
  if (workspaceEdits && !reservation) return 'failed'
  const startedAt = performance.now()
  const previous = useActiveProjectStore.getState()
  let activation = activateWorkspaceRoot(workspaceRoot)
  // Chat follows the active project at once; an open that never lands must hand it back.
  // A later open of this same root holds a newer activation; handing back would strand it.
  const abandon = (endedBy: string) => {
    const claimed = !releaseActiveProject(activation, previous)
    log.info({
      action: 'workspace.root_open_superseded',
      area: 'workspace',
      path: workspaceRoot,
      endedBy: claimed ? 'claimed' : endedBy,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return 'superseded' as const
  }

  try {
    confirmedEnvironmentId(origin)
    const result = await runMutation(
      queryClient,
      openWorkspaceRootMutationOptions(filesystemPath(workspaceRoot)),
      { signal: activity },
    )
    // A later request already claimed the app; landing now would drag it back.
    if (activity.aborted) return abandon('aborted')
    if (options.isCurrent?.() === false) return abandon('not-current')
    if (!holdsActiveProject(activation)) return abandon('claimed')
    confirmedEnvironmentId(origin)
    const entry = result.entry
    // Still this open's activation: a switch that throws must hand the project back.
    activation = activateWorkspaceRoot(entry.path)
    const alreadyOpen = workspaceStore.getState().rootFolder?.path === entry.path
    if (alreadyOpen) {
      workspaceStore.setState({
        rootFolder: { ...entry, name: workspacePathLeaf(entry.path), type: 'directory' },
      })
      return 'already-open'
    }

    queryClient.removeQueries({ queryKey: fileSystemKeys.trees() })
    switchRootFolder({ ...entry, name: workspacePathLeaf(entry.path), type: 'directory' })
    log.info({
      action: 'workspace.root_opened',
      area: 'workspace',
      path: entry.path,
      workspaceId: entry.workspaceAddress.id,
    })
    void recordRootAsRecent(queryClient, entry.path)
    return 'opened'
  } catch (error) {
    if (activity.aborted) return abandon('aborted')
    if (options.isCurrent?.() === false) return abandon('not-current')
    releaseActiveProject(activation, previous)
    log.warn({ action: 'workspace.root_open_rejected', area: 'workspace', path: workspaceRoot })
    reportError(toClientError(error))
    return 'failed'
  } finally {
    if (reservation) workspaceEdits?.releaseRootSwitchReservation(reservation)
  }
}

/** Trails the open: a lost recency stamp is a worse menu, never a failed switch. */
async function recordRootAsRecent(queryClient: QueryClient, workspaceRoot: FilesystemPath) {
  try {
    await runMutation(
      queryClient,
      recordRecentMutationOptions(queryClient, workspaceRoot),
      undefined,
    )
  } catch {
    // Swallowed, not silent: the fs.record_recent wide event carries the failure.
  }
}
