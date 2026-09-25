import { useSettingValue } from '@/hooks/use-setting-value'
import { errorMessage } from '@/lib/error-message'
import { useSessionSnoozeRequestStore } from '@/features/chat-mode/state/session-snooze-request-store'
import { removeSuccessfulSelection } from '@/features/chat-mode/state/session-multi-select-store'
import { currentSessionLifecyclePolicy } from '@/features/chat-mode/state/session-lifecycle'
import { canApplyLifecycle, lifecycleVerb } from '@/features/chat-mode/utils/session-lifecycle'
import { updateSessionRead } from '@/features/chat-mode/state/session-read-actions'
import { sessionSummary, sessionArchive, sessionDeletion } from '@/features/chat-mode/state/removal'
import type { ClientOrchestrationCommand, ScopedSessionRef } from '@workspace/contracts'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import {
  createSessionLifecycleCommand,
  type SessionLifecycleChange,
  createSessionArchiveCommand,
  createSessionDeleteCommand,
  createSessionRenameCommand,
  createSessionRuntimeStopCommand,
  createSessionUnarchiveCommand,
} from '@workspace/client-core/chat/commands'
import {
  useSessionDeleteRequestStore,
  type SessionDeleteRequest,
} from '@/features/chat-mode/state/session-delete-request-store'
import { CHAT_SESSION_SCOPE, chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { useNavigation } from '@/hooks/use-navigation'
import { hasRunningTurn } from '@/features/chat-mode/utils/running-turn'
import { toastError } from '@/lib/toast-error'

type SessionCommandVariables = {
  readonly action: string
  readonly command: ClientOrchestrationCommand
  readonly ref: ScopedSessionRef
}

export function useSessionActions() {
  const requestSnooze = useSessionSnoozeRequestStore((state) => state.requestSnooze)
  const lifecycle = useMutation({
    mutationKey: chatModeMutationKeys.lifecycle(),
    scope: { id: CHAT_SESSION_SCOPE },
    mutationFn: async ({
      refs,
      change,
    }: {
      readonly refs: readonly ScopedSessionRef[]
      readonly change: SessionLifecycleChange
    }) => {
      const succeeded: ScopedSessionRef[] = []
      let skipped = 0
      let failed = 0
      for (const ref of refs) {
        if (!canApplyLifecycle(change, currentSessionLifecyclePolicy(ref))) {
          skipped++
          continue
        }
        const outcome = await dispatchChatCommand({
          action: `chat.session.${change.type}`,
          command: createSessionLifecycleCommand(ref.sessionId, change),
          dispatchCommand: (command) => dispatchCommandForEnvironment(ref.environmentId, command),
        })
        if (!outcome.ok) {
          failed++
          continue
        }
        if (change.type === 'settle' || change.type === 'unsnooze') updateSessionRead(ref, 'wake')
        succeeded.push(ref)
      }
      removeSuccessfulSelection(succeeded)
      return { succeeded, skipped, failed }
    },
    onSuccess: (result, { change }) => {
      const message = `${result.succeeded.length} ${lifecycleVerb(change.type)}${result.skipped ? `, ${result.skipped} skipped` : ''}${result.failed ? `, ${result.failed} failed` : ''}`
      toast(
        message,
        change.type === 'snooze' && result.succeeded.length
          ? {
              action: {
                label: 'Undo',
                onClick: () =>
                  lifecycle.mutate({ refs: result.succeeded, change: { type: 'unsnooze' } }),
              },
            }
          : undefined,
      )
    },
  })
  const navigation = useNavigation()
  const confirmSessionDelete = useSettingValue('chat.confirmSessionDelete')
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
      if (command.type === 'session.archive') updateSessionRead(ref, 'wake')
      return outcome.result
    },
    mutationKey: chatModeMutationKeys.session(),
    onError: (error) => notifyChatCommandError(error, 'Session command failed'),
    scope: { id: CHAT_SESSION_SCOPE },
  })
  const readCommand = useMutation({
    mutationKey: chatModeMutationKeys.read(),
    mutationFn: async ({
      refs,
      action,
    }: {
      refs: readonly ScopedSessionRef[]
      action: 'unread' | 'wake'
    }) => {
      for (const ref of refs) updateSessionRead(ref, action)
    },
  })
  function dispatch(ref: ScopedSessionRef, action: string, command: ClientOrchestrationCommand) {
    return sessionCommand.mutateAsync({ action, command, ref }).then(
      () => true,
      () => false,
    )
  }
  async function reconcileRemoval(
    removal: Parameters<typeof navigation.reconcileSessions>[0],
    action: 'archived' | 'deleted',
  ) {
    try {
      const result = await navigation.reconcileSessions(removal)
      if (result.status !== 'unavailable') return true
      toastError(`Session ${action}, but navigation failed`, { description: result.reason })
    } catch (error) {
      toastError(`Session ${action}, but navigation failed`, {
        description: errorMessage(error, 'The destination could not be opened.'),
      })
    }
    return false
  }
  async function archive(ref: ScopedSessionRef) {
    const session = sessionSummary(ref)
    if (hasRunningTurn(session)) {
      toast.error(`“${session?.title ?? 'This session'}” is still running`, {
        description: 'Stop the agent before archiving it.',
      })
      return { accepted: false, navigationFailed: false }
    }
    const removal = sessionArchive(ref)
    const accepted = await dispatch(
      ref,
      'chat.session.archive',
      createSessionArchiveCommand({ sessionId: ref.sessionId }),
    )
    const navigated = !accepted || !removal || (await reconcileRemoval(removal, 'archived'))
    return { accepted, navigationFailed: !navigated }
  }
  async function confirmDelete(
    request: SessionDeleteRequest,
    options: { removeWorktree?: boolean } = {},
  ) {
    dismissDelete()
    const succeeded: ScopedSessionRef[] = []
    let navigationFailures = 0
    for (const ref of request.refs) {
      const removal = sessionDeletion(ref, succeeded)
      const accepted = await dispatch(
        ref,
        'chat.session.delete',
        createSessionDeleteCommand({
          sessionId: ref.sessionId,
          removeWorktree: options.removeWorktree,
        }),
      )
      if (!accepted) continue
      succeeded.push(ref)
      if (removal && !(await reconcileRemoval(removal, 'deleted'))) navigationFailures++
    }
    removeSuccessfulSelection(succeeded)
    toast(
      `${succeeded.length} deleted${succeeded.length < request.refs.length ? `, ${request.refs.length - succeeded.length} failed` : ''}${navigationFailures ? `, ${navigationFailures} navigation failure${navigationFailures === 1 ? '' : 's'}` : ''}`,
    )
  }
  function deleteSessions(request: SessionDeleteRequest) {
    if (confirmSessionDelete) {
      requestDelete(request)
      return
    }
    void confirmDelete(request)
  }
  return {
    async archive(ref: ScopedSessionRef) {
      return (await archive(ref)).accepted
    },
    applyLifecycle(ref: ScopedSessionRef, change: SessionLifecycleChange) {
      return lifecycle.mutateAsync({ refs: [ref], change })
    },
    applyLifecycleToSessions(refs: readonly ScopedSessionRef[], change: SessionLifecycleChange) {
      return lifecycle.mutateAsync({ refs, change })
    },
    requestSnooze(refs: readonly ScopedSessionRef[], title: string) {
      requestSnooze({ refs, title })
    },
    markUnread(ref: ScopedSessionRef) {
      readCommand.mutate({ refs: [ref], action: 'unread' })
    },
    markSessionsUnread(refs: readonly ScopedSessionRef[]) {
      readCommand.mutate({ refs, action: 'unread' })
    },
    acknowledgeWake(ref: ScopedSessionRef) {
      readCommand.mutate({ refs: [ref], action: 'wake' })
    },
    async archiveSessions(refs: readonly ScopedSessionRef[]) {
      const succeeded: ScopedSessionRef[] = []
      let navigationFailures = 0
      for (const ref of refs) {
        const outcome = await archive(ref)
        if (outcome.accepted) succeeded.push(ref)
        if (outcome.navigationFailed) navigationFailures++
      }
      removeSuccessfulSelection(succeeded)
      toast(
        `${succeeded.length} archived${succeeded.length < refs.length ? `, ${refs.length - succeeded.length} skipped or failed` : ''}${navigationFailures ? `, ${navigationFailures} navigation failure${navigationFailures === 1 ? '' : 's'}` : ''}`,
      )
    },
    cancelDelete() {
      dismissDelete()
    },
    confirmDelete,
    deleteSession(ref: ScopedSessionRef, title: string) {
      deleteSessions({ refs: [ref], title })
    },
    deleteSessions(refs: readonly ScopedSessionRef[]) {
      const first = refs[0]
      if (!first) return
      deleteSessions({ refs, title: sessionSummary(first)?.title ?? 'this session' })
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
