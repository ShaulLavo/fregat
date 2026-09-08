import type { ClientOrchestrationCommand, ScopedSessionRef } from '@workspace/contracts'
import { toast } from 'sonner'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import {
  createSessionArchiveCommand,
  createSessionDeleteCommand,
  createSessionRenameCommand,
  createSessionRuntimeStopCommand,
  createSessionUnarchiveCommand,
} from '@workspace/client-core/chat/commands'
import {
  selectChatSessionsForProject,
  selectSessionOwnership,
} from '@workspace/client-core/chat/selectors'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import {
  useSessionDeleteRequestStore,
  type SessionDeleteRequest,
} from '@/features/chat-mode/state/session-delete-request-store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { compareSessionsForRail } from '@workspace/client-core/chat/rail/session-order'
import { hasRunningTurn } from '@/features/chat-mode/utils/running-turn'

export function useSessionActions() {
  const releaseSession = useSessionSelectionStore((state) => state.releaseSession)
  const requestDelete = useSessionDeleteRequestStore((state) => state.requestDelete)
  const dismissDelete = useSessionDeleteRequestStore((state) => state.dismissDelete)
  function dispatch(ref: ScopedSessionRef, action: string, command: ClientOrchestrationCommand) {
    void dispatchChatCommand({
      action,
      command,
      dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
    })
  }
  function archive(ref: ScopedSessionRef) {
    const session = sessionSummary(ref)
    if (hasRunningTurn(session)) {
      toast.error(`“${session?.title ?? 'This session'}” is still running`, {
        description: 'Stop the agent before archiving it.',
      })
      return
    }
    releaseSession(ref, railOrderSessionIds(ref))
    dispatch(ref, 'chat.session.archive', createSessionArchiveCommand({ sessionId: ref.sessionId }))
  }
  return {
    archive,
    archiveSessions(refs: readonly ScopedSessionRef[]) {
      for (const ref of refs) archive(ref)
      clearSessionMultiSelect()
    },
    cancelDelete() {
      dismissDelete()
    },
    confirmDelete(request: SessionDeleteRequest) {
      dismissDelete()
      for (const ref of request.refs) {
        releaseSession(ref, railOrderSessionIds(ref))
        dispatch(
          ref,
          'chat.session.delete',
          createSessionDeleteCommand({ sessionId: ref.sessionId }),
        )
      }
      clearSessionMultiSelect()
    },
    deleteSession(ref: ScopedSessionRef, title: string) {
      requestDelete({ refs: [ref], title })
    },
    deleteSessions(refs: readonly ScopedSessionRef[]) {
      const first = refs[0]
      if (!first) return
      requestDelete({ refs, title: sessionSummary(first)?.title ?? 'this session' })
    },
    rename(ref: ScopedSessionRef, title: string) {
      dispatch(
        ref,
        'chat.session.rename',
        createSessionRenameCommand({ sessionId: ref.sessionId, title }),
      )
    },
    stopAgent(ref: ScopedSessionRef) {
      dispatch(
        ref,
        'chat.session.stopAgent',
        createSessionRuntimeStopCommand({ sessionId: ref.sessionId }),
      )
    },
    unarchive(ref: ScopedSessionRef) {
      dispatch(
        ref,
        'chat.session.unarchive',
        createSessionUnarchiveCommand({ sessionId: ref.sessionId }),
      )
    },
  }
}
function sessionSummary(ref: ScopedSessionRef) {
  return selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
    .sessionById[ref.sessionId]
}
function railOrderSessionIds(ref: ScopedSessionRef) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
  const owner = selectSessionOwnership(slice, ref.sessionId)
  if (!owner) return []
  return selectChatSessionsForProject(slice, owner.project.id)
    .toSorted(compareSessionsForRail)
    .map((session) => session.id)
}
