import {
  type ModelSelection,
  type OrchestrationProjectShell,
  type SessionId,
  type OrchestrationWorktreeShell,
  type SessionWorktreeTarget,
} from '@workspace/contracts'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { placeChatMessage } from '@/features/chat/state/place-chat-message'
import { ChatComposerModesProvider } from '../providers/composer-modes-provider'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { ChatInput, type ChatInputSubmitPayload } from './chat-input'
import { ChatWelcomeView } from './chat-welcome-view'
import { WorktreePicker } from '@/features/chat/components/worktree-picker'
import { newWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useNavigation } from '@/hooks/use-navigation'

export function ChatDraftView({
  disabled,
  draftId,
  transport,
  onSessionCreated,
  project,
  worktree,
  rootPath,
}: {
  disabled: boolean
  draftId: string
  transport: ChatTransport
  onSessionCreated: (sessionId: SessionId) => void
  project: OrchestrationProjectShell | null
  worktree: OrchestrationWorktreeShell | null
  rootPath: string
}) {
  const navigation = useNavigation()
  const [sendError, setSendError] = useState<string | null>(null)
  // The same target ChatInput builds for itself, so a mode pick lands on the
  // draft the send path reads. Stable identity: it feeds the modes context value.
  // The user's chosen posture for a new session. The server keeps its own
  // `?? DEFAULT_RUNTIME_MODE` fallbacks as the untrusted-input floor; this is
  // only the seed the composer starts from.
  const defaultRuntimeMode = useSettingValue('chat.defaultRuntimeMode')
  const defaultInteractionMode = useSettingValue('chat.defaultInteractionMode')
  const draftTarget = useMemo<ChatInputDraftTarget>(
    () => ({ environmentId: transport.environmentId, draftKey: draftId, rootPath }),
    [transport.environmentId, rootPath, draftId],
  )
  const draft = useChatInputDraftStore((state) => state.getDraft(draftTarget))
  const identity = draft.identity
  useEffect(() => {
    if (identity || !project || !worktree) return
    useChatInputDraftStore.getState().setIdentity(draftTarget, {
      id: draftId,
      projectId: project.id,
      rootPath,
      baseWorktreeId: worktree.id,
      worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      createdAt: new Date().toISOString(),
    })
  }, [identity, project, worktree, draftTarget, draftId, rootPath])
  const target = identity?.worktreeTarget ?? null
  const targetReady =
    identity?.projectId === project?.id &&
    identity?.baseWorktreeId === worktree?.id &&
    identity?.rootPath === rootPath &&
    worktree?.path === rootPath &&
    worktree?.lifecycle.state === 'ready' &&
    (target?.kind !== 'new' || worktree.worktreeCreationCapability.allowed)
  function chooseTarget(worktreeTarget: SessionWorktreeTarget) {
    if (identity)
      useChatInputDraftStore.getState().setIdentity(draftTarget, { ...identity, worktreeTarget })
  }
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
    const operation = navigation.getSnapshot()

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
    const outcome = await placeChatMessage({
      action: 'chat.draft.dispatch.summary',
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
      placement: {
        environmentId: transport.environmentId,
        commandId: submission.command.commandId,
        message: submission.optimisticMessage,
      },
    })
    if (!outcome.ok) {
      setSendError(outcome.message)
      return false
    }

    useChatInputDraftStore.getState().setIdentity(draftTarget, null)
    setSendError(null)
    if (navigation.getSnapshot() === operation) onSessionCreated(submission.command.sessionId)

    return true
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <ChatWelcomeView />
      {worktree && target ? (
        <WorktreePicker
          base={worktree}
          target={target}
          onCurrent={() => chooseTarget({ kind: 'current', worktreeId: worktree.id })}
          onNew={() => chooseTarget(newWorktreeTarget(worktree.id))}
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
          draftKey={draftId}
          error={
            sendError ??
            (identity &&
            (!worktree ||
              identity.baseWorktreeId !== worktree.id ||
              identity.rootPath !== worktree.path)
              ? 'The draft worktree is unavailable. Restore it before sending.'
              : null)
          }
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
