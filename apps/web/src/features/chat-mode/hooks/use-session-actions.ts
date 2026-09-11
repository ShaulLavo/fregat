import { sessionSummary, sessionRemoval } from '@/features/chat-mode/state/removal'
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
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import {
  useSessionDeleteRequestStore,
  type SessionDeleteRequest,
} from '@/features/chat-mode/state/session-delete-request-store'
import { useNavigation } from '@/hooks/use-navigation'
import { hasRunningTurn } from '@/features/chat-mode/utils/running-turn'

export function useSessionActions() {
  const navigation = useNavigation()
  const requestDelete = useSessionDeleteRequestStore((state) => state.requestDelete)
  const dismissDelete = useSessionDeleteRequestStore((state) => state.dismissDelete)
  function dispatch(ref: ScopedSessionRef, action: string, command: ClientOrchestrationCommand) {
    return dispatchChatCommand({
      action,
      command,
      dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
    })
  }
  async function archive(ref: ScopedSessionRef) {
    const session = sessionSummary(ref)
    if (hasRunningTurn(session)) {
      toast.error(`“${session?.title ?? 'This session'}” is still running`, {
        description: 'Stop the agent before archiving it.',
      })
      return
    }
    const removal = sessionRemoval(ref)
    const outcome = await dispatch(
      ref,
      'chat.session.archive',
      createSessionArchiveCommand({ sessionId: ref.sessionId }),
    )
    if (outcome.ok && removal) await navigation.reconcileSessions(removal)
  }
  return {
    archive,
    async archiveSessions(refs: readonly ScopedSessionRef[]) {
      for (const ref of refs) await archive(ref)
      clearSessionMultiSelect()
    },
    cancelDelete() {
      dismissDelete()
    },
    async confirmDelete(request: SessionDeleteRequest) {
      dismissDelete()
      for (const ref of request.refs) {
        const removal = sessionRemoval(ref)
        const outcome = await dispatch(
          ref,
          'chat.session.delete',
          createSessionDeleteCommand({ sessionId: ref.sessionId }),
        )
        if (outcome.ok && removal) await navigation.reconcileSessions(removal)
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
