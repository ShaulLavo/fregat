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
import { compareSessionsByActivity } from '@workspace/client-core/chat/rail/session-order'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { scopedSessionKey } from '@workspace/contracts'

export function sessionSummary(ref: ScopedSessionRef) {
  return selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
    .sessionById[ref.sessionId]
}
export function sessionArchive(ref: ScopedSessionRef) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
  const owner = selectSessionOwnership(slice, ref.sessionId)
  if (!owner) return null
  return {
    environmentId: ref.environmentId,
    projectId: owner.project.id,
    removedSessionIds: [ref.sessionId],
    successorSessionId: null,
  }
}
export function sessionDeletion(ref: ScopedSessionRef, deleted: readonly ScopedSessionRef[] = []) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
  const owner = selectSessionOwnership(slice, ref.sessionId)
  if (!owner) return null
  const removed = new Set(deleted.map(scopedSessionKey))
  const sortOrder = readSettingsMirror()['chat.sessionSortOrder']
  const candidates = selectChatSessionsForProject(slice, owner.project.id)
    .filter(
      (session) =>
        !session.archivedAt &&
        session.id !== ref.sessionId &&
        !removed.has(scopedSessionKey({ environmentId: ref.environmentId, sessionId: session.id })),
    )
    .toSorted((left, right) =>
      compareSessionsByActivity(
        slice.sessionById[left.id]!,
        slice.sessionById[right.id]!,
        sortOrder,
      ),
    )
  return {
    environmentId: ref.environmentId,
    projectId: owner.project.id,
    removedSessionIds: [ref.sessionId],
    successorSessionId: candidates[0]?.id ?? null,
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
