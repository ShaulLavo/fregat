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
  const shouldInvalidateFileHistory = events.some((event) => event.origin === 'workspace-edit')
  const externalEvents = events.filter((event) => !isOwnEvent(event, isOwnWorkspaceEditEvent))
  if (externalEvents.length === events.length) {
    return {
      ...planWorkspaceFilesystemEvents({ events, openFiles, rootPath }),
      shouldInvalidateFileHistory,
    }
  }

  const allEffects = planWorkspaceFilesystemEvents({ events, openFiles: [], rootPath })
  const externalEffects = planWorkspaceFilesystemEvents({
    events: externalEvents,
    openFiles,
    rootPath,
  })
  return {
    openFileOperations: externalEffects.openFileOperations,
    shouldInvalidateFileHistory,
    shouldInvalidateGitState: allEffects.shouldInvalidateGitState,
    treeOperations: allEffects.treeOperations,
  }
}

function isOwnEvent(
  event: WorkspaceEditAwareFilesystemEvent,
  isOwnWorkspaceEditEvent: (writeId: string) => boolean,
): boolean {
  if (!event.writeId) return false
  return isOwnWorkspaceEditEvent(event.writeId)
}
