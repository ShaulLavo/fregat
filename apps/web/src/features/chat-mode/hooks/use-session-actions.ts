import { sessionSummary, sessionRemoval } from '@/features/chat-mode/state/removal'
import type { ClientOrchestrationCommand, ScopedSessionRef } from '@workspace/contracts'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
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
import { CHAT_SESSION_SCOPE, chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { useNavigation } from '@/hooks/use-navigation'
import { hasRunningTurn } from '@/features/chat-mode/utils/running-turn'

type SessionCommandVariables = {
  readonly action: string
  readonly command: ClientOrchestrationCommand
  readonly ref: ScopedSessionRef
}

export function useSessionActions() {
  const navigation = useNavigation()
  const requestDelete = useSessionDeleteRequestStore((state) => state.requestDelete)
  const dismissDelete = useSessionDeleteRequestStore((state) => state.dismissDelete)
  const sessionCommand = useMutation({
    mutationFn: async ({ action, command, ref }: SessionCommandVariables) => {
      const outcome = await dispatchChatCommand({
        action,
        command,
        dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
      })
      if (!outcome.ok) throw outcome.error
      return outcome.result
    },
    mutationKey: chatModeMutationKeys.session(),
    onError: (error) => notifyChatCommandError(error, 'Session command failed'),
    scope: { id: CHAT_SESSION_SCOPE },
  })
  function dispatch(ref: ScopedSessionRef, action: string, command: ClientOrchestrationCommand) {
    return sessionCommand.mutateAsync({ action, command, ref }).then(
      () => true,
      () => false,
    )
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
    const accepted = await dispatch(
      ref,
      'chat.session.archive',
      createSessionArchiveCommand({ sessionId: ref.sessionId }),
    )
    if (accepted && removal) await navigation.reconcileSessions(removal)
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
        const accepted = await dispatch(
          ref,
          'chat.session.delete',
          createSessionDeleteCommand({ sessionId: ref.sessionId }),
        )
        if (accepted && removal) await navigation.reconcileSessions(removal)
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
      void dispatch(
        ref,
        'chat.session.rename',
        createSessionRenameCommand({ sessionId: ref.sessionId, title }),
      )
    },
    stopAgent(ref: ScopedSessionRef) {
      void dispatch(
        ref,
        'chat.session.stopAgent',
        createSessionRuntimeStopCommand({ sessionId: ref.sessionId }),
      )
    },
    unarchive(ref: ScopedSessionRef) {
      void dispatch(
        ref,
        'chat.session.unarchive',
        createSessionUnarchiveCommand({ sessionId: ref.sessionId }),
      )
    },
  }
}
