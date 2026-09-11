import type { ScopedProjectRef, ScopedSessionRef } from '@workspace/contracts'
import {
  selectChatSessionsForProject,
  selectSessionOwnership,
  selectWorktreeAtPath,
} from '@workspace/client-core/chat/selectors'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { compareSessionsForRail } from '@workspace/client-core/chat/rail/session-order'
import { neighbourSessionId } from '@/features/chat-mode/utils/session-neighbour'

export function sessionSummary(ref: ScopedSessionRef) {
  return selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
    .sessionById[ref.sessionId]
}
export function sessionRemoval(ref: ScopedSessionRef) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
  const owner = selectSessionOwnership(slice, ref.sessionId)
  if (!owner) return null
  const ids = selectChatSessionsForProject(slice, owner.project.id)
    .filter((session) => !session.archivedAt)
    .toSorted(compareSessionsForRail)
    .map((session) => session.id)
  return {
    environmentId: ref.environmentId,
    projectId: owner.project.id,
    removedSessionIds: [ref.sessionId],
    successorSessionId: neighbourSessionId(ids, ref.sessionId),
  }
}

export function projectSessions(ref: ScopedProjectRef) {
  return selectChatSessionsForProject(
    selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId),
    ref.projectId,
  )
}

export function removedProjectRoot(ref: ScopedProjectRef, rootPath: string | undefined) {
  if (rootPath === undefined) return undefined
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
  return selectWorktreeAtPath(slice, rootPath)?.projectId === ref.projectId ? rootPath : undefined
}
