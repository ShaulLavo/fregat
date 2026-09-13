import { ChatWorkspaceRootContext } from '@/features/chat/providers/workspace-root-context'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { useComposerConnection } from '@/features/chat/hooks/use-composer-connection'
import { ComposerActivityStatus } from '@/features/chat/components/composer-activity-status'
import {
  composerPendingAction,
  correctionUnavailableReason,
} from '@/features/chat/utils/composer-state'
import { sessionStopFailure } from '@/features/chat/utils/session-stop'
import type { ModelSelection, SessionId, SessionTurnInterruptCommand } from '@workspace/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  createCheckpointRevertCommand,
  createProjectDefaultModelCommand,
  createSessionInterruptCommand,
  createTurnSubmission,
  createSteerSubmission,
} from '@workspace/client-core/chat/commands'
import { dispatchChatCommand, replayAfterDispatch } from '@/features/chat/utils/command-dispatch'
import { scheduleSessionProjectionSyncAfterDispatch } from '@/features/chat/utils/command-sync'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import { createChatSessionSelector } from '@workspace/client-core/chat/selectors'
import { useOptimisticMessages } from '@/features/chat/hooks/use-optimistic-messages'
import { placeChatMessage } from '@/features/chat/state/place-chat-message'
import { type ChatSession } from '@workspace/client-core/chat/types'
import { ChatTransportContext } from '@/features/chat/providers/transport-context'
import { ChatInput, type ChatInputSubmitPayload } from './chat-input'
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
  const sessionSelector = useMemo(
    () => createChatSessionSelector(activeSessionId),
    [activeSessionId],
  )
  // The same target ChatInput builds for itself, so a mode pick lands on the
  // draft the send path reads. Stable identity is required: it feeds the
  // composer modes context value.
  const draftTarget = useMemo<ChatInputDraftTarget>(
    () => ({ environmentId: transport.environmentId, draftKey: activeSessionId, rootPath }),
    [transport.environmentId, activeSessionId, rootPath],
  )
  const session = useActiveChatProjection(sessionSelector)
  const optimisticMessages = useOptimisticMessages(transport.environmentId, activeSessionId)
  const [sendError, setSendError] = useState<string | null>(null)
  const [interruptCommand, setInterruptCommand] = useState<SessionTurnInterruptCommand | null>(null)
  const [revertingCheckpoint, setRevertingCheckpoint] = useState(false)
  const [pendingCheckpoint, setPendingCheckpoint] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const busy = isChatSessionBusy(session)
  const interruptFailure = sessionStopFailure(session, interruptCommand)
  const interrupting =
    busy &&
    interruptCommand !== null &&
    interruptCommand.sessionId === session?.id &&
    interruptCommand.turnId === session?.latestTurn?.turnId &&
    interruptFailure === null
  const connection = useComposerConnection(transport, activeSessionId)
  const disabledReason = connection.kind === 'live' ? null : connection.label
  // Stable identity is required because this is part of the timeline action context value.
  const handleRevertToCheckpoint = useCallback(
    (turnCount: number) => {
      if (!session || revertingCheckpoint) return
      if (busy) {
        setSendError('Interrupt the current turn before reverting checkpoints.')
        return
      }
      setPendingCheckpoint(turnCount)
    },
    [busy, revertingCheckpoint, session],
  )

  const projectId = session?.project.id
  // Stable identity is required because this is part of the model picker context value.
  const handlePersistModelSelection = useCallback(
    (next: ModelSelection) => {
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
    },
    [transport, projectId],
  )

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

  async function handleSend(payload: ChatInputSubmitPayload) {
    if (!session) return false

    setInterruptCommand(null)
    return submitChatTurn({ transport, payload, setSendError, setSending, session })
  }

  async function handleStop() {
    if (!session || interrupting || disabledReason) return

    await dispatchSessionStop({
      transport,
      setInterruptCommand,
      setSendError,
      session,
    })
  }

  async function handleConfirmRevert() {
    if (!session || pendingCheckpoint === null || busy || sending || revertingCheckpoint) return

    const turnCount = pendingCheckpoint
    setPendingCheckpoint(null)
    await revertSessionToCheckpoint({
      transport,
      setRevertingCheckpoint,
      setSendError,
      session,
      turnCount,
    })
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <CheckpointRevertDialog
        turnCount={pendingCheckpoint}
        disabled={busy || sending || revertingCheckpoint}
        onCancel={() => setPendingCheckpoint(null)}
        onConfirm={() => void handleConfirmRevert()}
      />
      <ChatWorkspaceRootContext value={session.worktree}>
        <ChatTransportContext value={transport}>
          <ChatTimelineActionsProvider revertToCheckpoint={handleRevertToCheckpoint}>
            <MessagesTimeline
              checkpointRevertPending={revertingCheckpoint}
              optimisticMessages={optimisticMessages}
              session={session}
            />
          </ChatTimelineActionsProvider>
        </ChatTransportContext>
      </ChatWorkspaceRootContext>
      <ChatRuntimeStatus commandFailure={sendError ?? interruptFailure} session={session} />
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
            onStop={handleStop}
            onSubmit={handleSend}
          />
        </ChatPendingRequestsProvider>
      </ChatComposerModesProvider>
    </section>
  )
}

async function submitChatTurn({
  transport,
  payload,
  setSendError,
  setSending,
  session,
}: {
  transport: ChatTransport
  payload: ChatInputSubmitPayload
  setSendError: (value: string | null) => void
  setSending: (value: boolean) => void
  session: ChatSession
}): Promise<boolean> {
  const { attachments, interactionMode, modelSelection, runtimeMode, terminalContexts, text } =
    payload
  const input = {
    attachments,
    createdAt: new Date().toISOString(),
    interactionMode,
    modelSelection,
    runtimeMode,
    terminalContexts,
    text,
    sessionId: session.id,
  }
  const submission =
    isChatSessionBusy(session) && session.latestTurn
      ? createSteerSubmission({ ...input, turnId: session.latestTurn.turnId })
      : createTurnSubmission(input)
  setSendError(null)
  setSending(true)
  try {
    const outcome = await placeChatMessage({
      action: 'chat.command.dispatch.summary',
      command: submission.command,
      context: {
        attachmentCount: attachments.length,
        interactionMode,
        model: modelSelection.model,
        providerInstanceId: modelSelection.providerInstanceId,
        runtimeMode,
        terminalContextCount: terminalContexts.length,
        textLength: text.length,
      },
      dispatchCommand: transport.dispatchCommand,
      onAccepted: (result) =>
        scheduleSessionProjectionSyncAfterDispatch({
          transport,
          replayAfterSequence: replayAfterDispatch(submission.command, result),
          sessionId: session.id,
        }),
      placement: {
        environmentId: transport.environmentId,
        commandId: submission.command.commandId,
        message: submission.optimisticMessage,
      },
    })
    if (outcome.ok) return true

    setSendError(outcome.message)
    return false
  } finally {
    setSending(false)
  }
}

async function dispatchSessionStop({
  transport,
  setInterruptCommand,
  setSendError,
  session,
}: {
  transport: ChatTransport
  setInterruptCommand: (value: SessionTurnInterruptCommand | null) => void
  setSendError: (value: string | null) => void
  session: ChatSession
}) {
  const command = createSessionInterruptCommand({
    sessionId: session.id,
    turnId: session.latestTurn?.turnId,
  })
  setInterruptCommand(command)
  setSendError(null)
  const outcome = await dispatchChatCommand({
    action: 'chat.stop.dispatch.summary',
    command,
    dispatchCommand: transport.dispatchCommand,
    onAccepted: (result) =>
      scheduleSessionProjectionSyncAfterDispatch({
        transport,
        replayAfterSequence: replayAfterDispatch(command, result),
        sessionId: session.id,
      }),
  })
  if (outcome.ok) return

  setSendError(outcome.message)
  setInterruptCommand(null)
}

async function revertSessionToCheckpoint({
  transport,
  setRevertingCheckpoint,
  setSendError,
  session,
  turnCount,
}: {
  transport: ChatTransport
  setRevertingCheckpoint: (value: boolean) => void
  setSendError: (value: string | null) => void
  session: ChatSession
  turnCount: number
}) {
  setRevertingCheckpoint(true)
  setSendError(null)
  const command = createCheckpointRevertCommand({ sessionId: session.id, turnCount })
  try {
    const outcome = await dispatchChatCommand({
      action: 'chat.checkpoint_revert.dispatch.summary',
      command,
      dispatchCommand: transport.dispatchCommand,
      onAccepted: (result) =>
        scheduleSessionProjectionSyncAfterDispatch({
          transport,
          replayAfterSequence: replayAfterDispatch(command, result),
          sessionId: session.id,
        }),
    })
    if (!outcome.ok) setSendError(outcome.message)
  } finally {
    setRevertingCheckpoint(false)
  }
}
