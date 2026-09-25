import { useSettingValue } from '@/hooks/use-setting-value'
import { errorMessage } from '@/lib/error-message'
import { useSessionSnoozeRequestStore } from '@/features/chat-mode/state/session-snooze-request-store'
import { removeSuccessfulSelection } from '@/features/chat-mode/state/session-multi-select-store'
import { currentSessionLifecyclePolicy } from '@/features/chat-mode/state/session-lifecycle'
import { canApplyLifecycle } from '@/features/chat-mode/utils/session-lifecycle'
import { updateSessionRead } from '@/features/chat-mode/state/session-read-actions'
import { sessionSummary, sessionArchive, sessionDeletion } from '@/features/chat-mode/state/removal'
import type { ClientOrchestrationCommand, ScopedSessionRef } from '@workspace/contracts'
import { useMutation } from '@tanstack/react-query'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { toast } from 'sonner'
import {
  captureSessionLifecycle,
  sessionLifecycleVerb,
} from '@workspace/client-core/chat/rail/lifecycle-undo'
import {
  forgetSessionUndo,
  offerSessionUndo,
  type SessionUndoEntry,
} from '@/features/chat-mode/state/session-undo'
import {
  batchDetail,
  lifecycleUndoKind,
  surfaceShowsSession,
  viewedSessionSurface,
} from '@/features/chat-mode/utils/session-undo'
import { useSessionUndoShortcut } from '@/features/chat-mode/hooks/use-session-undo-shortcut'
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

type ArchiveOutcome = {
  /** Present once the server accepted the archive. */
  readonly undo: SessionUndoEntry | null
  readonly navigationFailed: boolean
}

type SessionCommandVariables = {
  readonly action: string
  readonly command: ClientOrchestrationCommand
  readonly ref: ScopedSessionRef
}

export function useSessionActions() {
  const requestSnooze = useSessionSnoozeRequestStore((state) => state.requestSnooze)
  const shortcut = useSessionUndoShortcut()
  const lifecycle = useMutation(
    {
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
        const undo: SessionUndoEntry[] = []
        let skipped = 0
        let failed = 0
        for (const ref of refs) {
          if (!canApplyLifecycle(change, currentSessionLifecyclePolicy(ref))) {
            skipped++
            continue
          }
          const before = captureSessionLifecycle(sessionSummary(ref) ?? {})
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
          undo.push({ ref, before, reopen: null })
        }
        removeSuccessfulSelection(succeeded)
        return { succeeded, skipped, failed, undo }
      },
      onSuccess: (result, { change }) => {
        const detail = batchDetail(result)
        const kind = lifecycleUndoKind(change.type)
        if (kind && result.undo.length) {
          offerSessionUndo({ kind, entries: result.undo, detail, shortcut })
          return
        }
        forgetSessionUndo(result.succeeded)
        toast(`${result.succeeded.length} ${sessionLifecycleVerb(change.type)}${detail}`)
      },
    },
    primaryQueryClient(),
  )
  const navigation = useNavigation()
  const confirmSessionDelete = useSettingValue('chat.confirmSessionDelete')
  const requestDelete = useSessionDeleteRequestStore((state) => state.requestDelete)
  const dismissDelete = useSessionDeleteRequestStore((state) => state.dismissDelete)
  const sessionCommand = useMutation(
    {
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
    },
    primaryQueryClient(),
  )
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
      if (result.status !== 'unavailable') return result.status
      toastError(`Session ${action}, but navigation failed`, { description: result.reason })
    } catch (error) {
      toastError(`Session ${action}, but navigation failed`, {
        description: errorMessage(error, 'The destination could not be opened.'),
      })
    }
    return 'failed'
  }
  async function archive(ref: ScopedSessionRef): Promise<ArchiveOutcome> {
    const session = sessionSummary(ref)
    if (hasRunningTurn(session)) {
      toast.error(`“${session?.title ?? 'This session'}” is still running`, {
        description: 'Stop the agent before archiving it.',
      })
      return { undo: null, navigationFailed: false }
    }
    const removal = sessionArchive(ref)
    const before = captureSessionLifecycle(session ?? {})
    const surface = viewedSessionSurface(navigation.currentAddress(), ref.sessionId)
    const accepted = await dispatch(
      ref,
      'chat.session.archive',
      createSessionArchiveCommand({ sessionId: ref.sessionId }),
    )
    if (!accepted) return { undo: null, navigationFailed: false }
    const navigated = removal ? await reconcileRemoval(removal, 'archived') : 'superseded'
    // The side chat reconciles on its own, so read where the reader ended up.
    const movedOff =
      surface !== null && !surfaceShowsSession(navigation.currentAddress(), surface, ref.sessionId)
    const reopen = movedOff && removal ? { surface, projectId: removal.projectId } : null
    return { undo: { ref, before, reopen }, navigationFailed: navigated === 'failed' }
  }
  function offerArchiveUndo(entries: readonly SessionUndoEntry[], detail: string) {
    offerSessionUndo({ kind: 'archive', entries, detail, shortcut })
  }
  async function confirmDelete(request: SessionDeleteRequest) {
    dismissDelete()
    const succeeded: ScopedSessionRef[] = []
    let navigationFailures = 0
    for (const ref of request.refs) {
      const removal = sessionDeletion(ref, succeeded)
      const accepted = await dispatch(
        ref,
        'chat.session.delete',
        createSessionDeleteCommand({ sessionId: ref.sessionId }),
      )
      if (!accepted) continue
      succeeded.push(ref)
      if (removal && (await reconcileRemoval(removal, 'deleted')) === 'failed') navigationFailures++
    }
    removeSuccessfulSelection(succeeded)
    forgetSessionUndo(succeeded)
    const failed = request.refs.length - succeeded.length
    toast(`${succeeded.length} deleted${batchDetail({ failed, navigationFailures })}`)
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
      const outcome = await archive(ref)
      if (!outcome.undo) return false
      offerArchiveUndo([outcome.undo], '')
      return true
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
      const undo: SessionUndoEntry[] = []
      let navigationFailures = 0
      for (const ref of refs) {
        const outcome = await archive(ref)
        if (outcome.undo) undo.push(outcome.undo)
        if (outcome.navigationFailed) navigationFailures++
      }
      removeSuccessfulSelection(undo.map((entry) => entry.ref))
      const detail = batchDetail({ skippedOrFailed: refs.length - undo.length, navigationFailures })
      if (undo.length) {
        offerArchiveUndo(undo, detail)
        return
      }
      toast(`0 archived${detail}`)
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
      forgetSessionUndo([ref])
      void dispatch(
        ref,
        'chat.session.unarchive',
        createSessionUnarchiveCommand({ sessionId: ref.sessionId }),
      )
    },
  }
}
