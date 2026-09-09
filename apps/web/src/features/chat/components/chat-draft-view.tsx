import {
  type EnvironmentId,
  type CommandId,
  type ModelSelection,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type SessionId,
  type OrchestrationWorktreeShell,
  type SessionWorktreeTarget,
} from '@workspace/contracts'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  createDraftSessionSubmission,
  createProjectDefaultModelCommand,
} from '@workspace/client-core/chat/commands'
import { providerListQueryOptions } from '@/features/chat/utils/provider-query'
import { resolveChatModelSelection } from '@workspace/client-core/chat/providers/selection'
import { dispatchChatCommand, replayAfterDispatch } from '@/features/chat/utils/command-dispatch'
import { scheduleSessionProjectionSyncAfterDispatch } from '@/features/chat/utils/command-sync'
import { optimisticMessageSummary } from '@/features/chat/utils/pipeline-logging'
import { ChatComposerModesProvider } from '../providers/composer-modes-provider'
import { useChatOptimisticStore } from '../state/chat-optimistic-store'
import type { ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { ChatInput, type ChatInputSubmitPayload } from './chat-input'
import { ChatWelcomeView } from './chat-welcome-view'
import { WorktreePicker } from '@/features/chat/components/worktree-picker'
import { newWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'

const DRAFT_CHAT_KEY = 'draft'

export function ChatDraftView({
  disabled,
  transport,
  onSessionCreated,
  project,
  worktree,
  rootPath,
}: {
  disabled: boolean
  transport: ChatTransport
  onSessionCreated: (sessionId: SessionId) => void
  project: OrchestrationProjectShell | null
  worktree: OrchestrationWorktreeShell | null
  rootPath: string
}) {
  const [chosenTarget, setChosenTarget] = useState<SessionWorktreeTarget | null>(null)
  const target =
    chosenTarget ?? (worktree ? { kind: 'current' as const, worktreeId: worktree.id } : null)
  const targetReady =
    worktree?.lifecycle.state === 'ready' &&
    (target?.kind !== 'new' || worktree.worktreeCreationCapability.allowed)
  const [sendError, setSendError] = useState<string | null>(null)
  // The same target ChatInput builds for itself, so a mode pick lands on the
  // draft the send path reads. Stable identity: it feeds the modes context value.
  // The user's chosen posture for a new session. The server keeps its own
  // `?? DEFAULT_RUNTIME_MODE` fallbacks as the untrusted-input floor; this is
  // only the seed the composer starts from.
  const defaultRuntimeMode = useSettingValue('chat.defaultRuntimeMode')
  const defaultInteractionMode = useSettingValue('chat.defaultInteractionMode')
  const draftTarget = useMemo<ChatInputDraftTarget>(
    () => ({ environmentId: transport.environmentId, draftKey: DRAFT_CHAT_KEY, rootPath }),
    [transport.environmentId, rootPath],
  )
  const providersQuery = useQuery(providerListQueryOptions())
  const modelSelection = resolveChatModelSelection(
    providersQuery.data?.providers,
    project?.defaultModelSelection ?? null,
  )
  const handleStop = useCallback(() => undefined, [])
  const handlePersistModelSelection = useCallback(
    (next: ModelSelection) => {
      if (!project) return

      void dispatchChatCommand({
        action: 'chat.project.default_model.set',
        command: createProjectDefaultModelCommand({
          defaultModelSelection: next,
          projectId: project.id,
        }),
        dispatchCommand: transport.dispatchCommand,
        onFailed: (error) => notifyChatCommandError(error, 'Could not save the default model'),
      })
    },
    [transport, project],
  )
  async function handleSend({
    attachments,
    interactionMode,
    modelSelection,
    runtimeMode,
    terminalContexts,
    text,
  }: ChatInputSubmitPayload) {
    if (!project || !worktree || !target || !targetReady) {
      setSendError('Workspace chat is still preparing.')
      return false
    }

    // Declared, not created. The server makes the worktree while the turn is
    // held at the gate, so a client that dies here cannot orphan a directory
    // no session owns.
    const submission = createDraftSessionSubmission({
      attachments,
      createdAt: new Date().toISOString(),
      interactionMode,
      modelSelection,
      worktreeTarget: target,
      runtimeMode,
      terminalContexts,
      text,
    })
    const outcome = await dispatchChatCommand({
      action: 'chat.draft.dispatch.summary',
      beforeDispatch: (scope) => {
        scope.increment('command.submitCount')
        addOptimisticMessage(
          transport.environmentId,
          submission.command.commandId,
          submission.optimisticMessage,
        )
        scope.increment('command.optimisticAddedCount')
        scope.set({
          optimistic: optimisticMessageSummary({
            commandId: submission.command.commandId,
            messageId: submission.optimisticMessage.id,
            textLength: submission.optimisticMessage.text.length,
            sessionId: submission.optimisticMessage.sessionId,
          }),
        })
      },
      command: submission.command,
      context: {
        attachmentCount: attachments.length,
        interactionMode,
        model: modelSelection.model,
        projectId: project.id,
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
          sessionId: submission.command.sessionId,
        }),
      onFailed: () =>
        removeOptimisticMessage(transport.environmentId, submission.optimisticMessage),
    })
    if (!outcome.ok) {
      setSendError(outcome.message)
      return false
    }

    setSendError(null)
    onSessionCreated(submission.command.sessionId)

    return true
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <ChatWelcomeView />
      {worktree && target ? (
        <WorktreePicker
          base={worktree}
          target={target}
          onCurrent={() => setChosenTarget({ kind: 'current', worktreeId: worktree.id })}
          onNew={() => setChosenTarget(newWorktreeTarget(worktree.id))}
        />
      ) : null}
      {/* No session exists yet, so a mode pick only lands in the draft — the turn
          that creates the session carries it through `bootstrap.createSession`. */}
      <ChatComposerModesProvider
        dispatchCommand={transport.dispatchCommand}
        draftTarget={draftTarget}
        sessionId={null}
      >
        <ChatInput
          busy={false}
          disabled={disabled || !project || !targetReady}
          draftKey={DRAFT_CHAT_KEY}
          error={sendError}
          interactionMode={defaultInteractionMode}
          modelSelection={modelSelection}
          rootPath={rootPath}
          runtimeMode={defaultRuntimeMode}
          onPersistModelSelection={handlePersistModelSelection}
          onStop={handleStop}
          onSubmit={handleSend}
        />
      </ChatComposerModesProvider>
    </section>
  )
}

function addOptimisticMessage(
  environmentId: EnvironmentId,
  commandId: CommandId,
  message: OrchestrationMessage,
) {
  useChatOptimisticStore.getState().addOptimisticMessage(environmentId, commandId, message)
}

function removeOptimisticMessage(environmentId: EnvironmentId, message: OrchestrationMessage) {
  useChatOptimisticStore
    .getState()
    .removeOptimisticMessage({ environmentId, sessionId: message.sessionId }, message.id)
}
