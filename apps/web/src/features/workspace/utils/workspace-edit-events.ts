import {
  planWorkspaceFilesystemEvents,
  type WorkspaceEventPlan,
  type WorkspaceFilesystemEvent,
  type WorkspaceOpenFileSnapshot,
} from '@/features/workspace/utils/event-model'

export type WorkspaceEditAwareFilesystemEvent = WorkspaceFilesystemEvent & {
  readonly origin?: string
  readonly writeId?: string
}

export function planWorkspaceEditAwareEventBatch(
  events: readonly WorkspaceEditAwareFilesystemEvent[],
  openFiles: readonly WorkspaceOpenFileSnapshot[],
  rootPath: string,
  isOwnWorkspaceEditEvent: (writeId: string) => boolean,
): WorkspaceEventPlan {
  const externalEvents = events.filter(
    (event) => !isMatchingWorkspaceEditEvent(event, isOwnWorkspaceEditEvent),
  )
  if (externalEvents.length === events.length) {
    return planWorkspaceFilesystemEvents({ events, openFiles, rootPath })
  }

  const allEffects = planWorkspaceFilesystemEvents({ events, openFiles: [], rootPath })
  const externalEffects = planWorkspaceFilesystemEvents({
    events: externalEvents,
    openFiles,
    rootPath,
  })
  return {
    openFileOperations: externalEffects.openFileOperations,
    shouldInvalidateGitState: allEffects.shouldInvalidateGitState,
    treeOperations: allEffects.treeOperations,
  }
}

function isMatchingWorkspaceEditEvent(
  event: WorkspaceEditAwareFilesystemEvent,
  isOwnWorkspaceEditEvent: (writeId: string) => boolean,
): boolean {
  if (event.origin !== 'workspace-edit' && event.origin !== 'conflict-editor-resolution')
    return false
  if (!event.writeId) return false
  return isOwnWorkspaceEditEvent(event.writeId)
}
