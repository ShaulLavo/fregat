import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { useComposerConnection } from '@/features/chat/hooks/use-composer-connection'
import { ComposerActivityStatus } from '@/features/chat/components/composer-activity-status'
import {
  composerPendingAction,
  correctionUnavailableReason,
} from '@/features/chat/utils/composer-state'
import type { ModelSelection, SessionId } from '@workspace/contracts'
import { useEffect, useMemo, useState } from 'react'

import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createProjectDefaultModelCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import { createChatSessionSelector } from '@workspace/client-core/chat/selectors'
import { useOptimisticMessages } from '@/features/chat/hooks/use-optimistic-messages'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { ChatInput } from './chat-input'
import { QueuedMessages } from './queued-messages'
import { useSessionComposer } from '../hooks/use-session-composer'
import { ImportedChatNotice } from '@/features/chat/components/imported-chat-notice'
import { CheckpointRevertDialog } from '@/features/chat/components/checkpoint-revert-dialog'
import { ChatRuntimeStatus } from './chat-runtime-status'
import { MessagesTimeline } from './messages-timeline'
import { PendingApprovalPanel } from './pending-approval-panel'
import { PendingUserInputPanel } from './pending-user-input-panel'
import { PlanFollowUpBanner } from './plan-follow-up-banner'
import { ChatComposerModesProvider } from '../providers/composer-modes-provider'
import { ChatPendingRequestsProvider } from '../providers/pending-requests-provider'
import { ChatPlanFollowUpProvider } from '../providers/plan-follow-up-provider'
import { ChatTimelineActionsProvider } from '../providers/timeline-actions-provider'
import type { ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { useCheckpointRewind } from '@/features/chat/hooks/use-checkpoint-rewind'
import { errorMessage } from '@/lib/error-message'
import { carryOnPayload, tryAgainPayload } from '@/features/chat/utils/turn-retry'

export function ChatView({
  activeSessionId,
  transport,
  onSessionCreated,
  rootPath,
}: {
  activeSessionId: SessionId | null
  transport: ChatTransport
  /**
   * Puts a session this view created — splitting a plan off to build it — on
   * screen. Each host keeps its own selection, so only it can honour this.
   */
  onSessionCreated: (sessionId: SessionId) => void
  rootPath: string
}) {
  // Manual memo: the store keys on this selector's identity, and the compiler's cache is a cache, not an identity
  // guarantee — a recompute hands it a cold value every render.
  const sessionSelector = useMemo(
    () => createChatSessionSelector(activeSessionId),
    [activeSessionId],
  )
  // The same target ChatInput builds for itself, so a mode pick lands on the
  // draft the send path reads. Stable identity is required: it feeds the
  // composer modes context value.
  const draftTarget: ChatInputDraftTarget = {
    environmentId: transport.environmentId,
    draftKey: activeSessionId,
    rootPath,
  }
  const session = useActiveChatProjection(sessionSelector)
  const currentDetail = useActiveChatProjection(
    (state) =>
      activeSessionId !== null && state.sessionDetailSequenceById[activeSessionId] !== undefined,
  )
  const optimisticMessages = useOptimisticMessages(transport.environmentId, activeSessionId)
  const [sendError, setSendError] = useState<string | null>(null)
  const rewind = useCheckpointRewind(transport, activeSessionId)
  const revertingCheckpoint = rewind.isPending
  const [pendingCheckpoint, setPendingCheckpoint] = useState<{
    turnCount: number
    messageId: string
  } | null>(null)
  const busy = isChatSessionBusy(session)
  const connection = useComposerConnection(transport, activeSessionId)
  const disabledReason = connection.kind === 'live' ? null : connection.label
  const composer = useSessionComposer({
    transport,
    session,
    target: draftTarget,
    blocked: disabledReason !== null || !currentDetail || revertingCheckpoint,
  })
  const { sending, interrupting } = composer
  // Stable identity is required because this is part of the timeline action context value.
  const handleRevertToCheckpoint = (turnCount: number, messageId: string) => {
    if (!currentDetail || !session || revertingCheckpoint) return
    if (busy) {
      setSendError('Interrupt the current turn before reverting checkpoints.')
      return
    }
    setPendingCheckpoint({ turnCount, messageId })
  }

  const projectId = session?.project.id
  // Stable identity is required because this is part of the model picker context value.
  const handlePersistModelSelection = (next: ModelSelection) => {
    if (!projectId) return

    void dispatchChatCommand({
      action: 'chat.project.default_model.set',
      command: createProjectDefaultModelCommand({
        defaultModelSelection: next,
        projectId,
      }),
      dispatchCommand: transport.dispatchCommand,
      onFailed: (error) => notifyChatCommandError(error, 'Could not save the default model'),
    })
  }

  useEffect(() => {
    if (!activeSessionId || transport.closed) return

    return transport.retainSessionDetail(activeSessionId)
  }, [activeSessionId, transport])

  if (!activeSessionId || !session) {
    return (
      <LoadingState
        className='flex min-h-0 flex-1 flex-col gap-4 p-4'
        label={activeSessionId ? 'Loading session' : 'Preparing workspace chat'}
      >
        {/* Only the user message is a bubble; an assistant reply is plain text. */}
        <div className='skeleton-sweep ml-auto h-12 w-2/3 rounded-lg' />
        <div className='skeleton-sweep h-24 w-3/4 rounded-md' />
      </LoadingState>
    )
  }

  const tryAgain = tryAgainPayload(session)

  function handleConfirmRevert(restoreFiles: boolean) {
    if (
      !currentDetail ||
      !session ||
      pendingCheckpoint === null ||
      busy ||
      sending ||
      revertingCheckpoint
    )
      return
    const message = session.messages.find((entry) => entry.id === pendingCheckpoint.messageId)
    if (!message || message.role !== 'user') return
    setSendError(null)
    // The held confirm is the decision; the timeline shows the restore from here.
    setPendingCheckpoint(null)
    rewind.mutate(
      {
        message,
        turnCount: pendingCheckpoint.turnCount,
        restoreFiles,
        target: { ...draftTarget, draftKey: session.id },
      },
      {
        onError: (error) => setSendError(errorMessage(error, 'Could not rewind this session.')),
      },
    )
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <CheckpointRevertDialog
        turnCount={pendingCheckpoint?.turnCount ?? null}
        disabled={busy || sending || revertingCheckpoint}
        pending={revertingCheckpoint}
        onCancel={() => setPendingCheckpoint(null)}
        onConfirm={handleConfirmRevert}
        canRestoreFiles={session.worktree.kind === 'linked'}
        error={rewind.isError ? errorMessage(rewind.error, 'Could not rewind this session.') : null}
      />
      <ChatWorkspaceRootContext value={session.worktree}>
        <ChatTransportContext value={transport}>
          <ChatTimelineActionsProvider
            retry={{
              blocked: busy || composer.sendBlocked,
              carryOn: () => void composer.send(carryOnPayload(session)),
              tryAgain: tryAgain ? () => void composer.send(tryAgain) : null,
            }}
            revertToCheckpoint={handleRevertToCheckpoint}
          >
            <MessagesTimeline
              checkpointRevertPending={revertingCheckpoint || !currentDetail}
              optimisticMessages={optimisticMessages}
              session={session}
            />
          </ChatTimelineActionsProvider>
        </ChatTransportContext>
      </ChatWorkspaceRootContext>
      <ChatRuntimeStatus commandFailure={sendError ?? composer.error} session={session} />
      {/* The panels sit above the composer rather than inside it: each one is a
          request holding the turn open, so it stays visible while the user
          types their answer. */}
      <ChatComposerModesProvider
        dispatchCommand={transport.dispatchCommand}
        draftTarget={draftTarget}
        sessionId={session.id}
      >
        <ChatPendingRequestsProvider
          disabledReason={disabledReason}
          transport={transport}
          sessionId={session.id}
        >
          <ComposerActivityStatus
            connection={connection}
            pendingAction={composerPendingAction({
              sending,
              interrupting,
              awaitingProjection: optimisticMessages.length > 0 && !busy,
              session,
            })}
            session={session}
          />
          <PendingApprovalPanel />
          <PendingUserInputPanel />
          <ChatPlanFollowUpProvider
            draftTarget={draftTarget}
            disabledReason={
              disabledReason ??
              (sending || revertingCheckpoint ? 'Finishing the current action…' : null)
            }
            transport={transport}
            onSessionCreated={onSessionCreated}
            sessionId={session.id}
          >
            <PlanFollowUpBanner draftTarget={draftTarget} />
          </ChatPlanFollowUpProvider>
          {session.origin === 'discovered' && !session.latestTurn && !session.runtime ? (
            <ImportedChatNotice />
          ) : null}
          <QueuedMessages
            messages={composer.queue}
            disabled={composer.sendBlocked}
            onSendNow={composer.sendNow}
            onRestore={composer.restore}
          />
          <ChatInput
            busy={busy}
            correctionDisabledReason={correctionUnavailableReason(session)}
            disabledReason={disabledReason}
            pendingAction={composerPendingAction({
              sending,
              interrupting,
              awaitingProjection: optimisticMessages.length > 0 && !busy,
              session,
            })}
            disabled={
              sending ||
              interrupting ||
              revertingCheckpoint ||
              (!busy && session.worktree.lifecycle.state !== 'ready')
            }
            draftKey={session.id}
            error={null}
            interactionMode={session.interactionMode}
            modelSelection={session.modelSelection}
            sessionProviderInstanceId={session.modelSelection.providerInstanceId}
            rootPath={rootPath}
            runtimeMode={session.runtimeMode}
            onPersistModelSelection={handlePersistModelSelection}
            onStop={composer.stop}
            onSubmit={composer.send}
          />
        </ChatPendingRequestsProvider>
      </ChatComposerModesProvider>
    </section>
  )
}
