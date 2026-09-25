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
import { providerListQueryOptions } from '@/lib/provider-query'
import { resolveChatModelSelection } from '@workspace/client-core/chat/providers/selection'
import { dispatchChatCommand, replayAfterDispatch } from '@/features/chat/utils/command-dispatch'
import { scheduleSessionProjectionSyncAfterDispatch } from '@/features/chat/utils/command-sync'
import { placeChatMessage } from '@/features/chat/state/place-chat-message'
import { ChatComposerModesProvider } from '../providers/composer-modes-provider'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import { ChatInput } from './chat-input'
import type { ChatInputSubmitPayload, ChatInputSubmitResult } from '../utils/composed-message'
import { ChatWelcomeView } from './chat-welcome-view'
import { DraftContextStrip } from '@/features/chat/components/draft-context-strip'
import type { DraftMachine } from '@/features/chat/utils/draft-workspace'
import { useSettingValue } from '@/hooks/use-setting-value'
import { nextWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { useNavigation } from '@/hooks/use-navigation'

export function ChatDraftView({
  disabled,
  draftId,
  transport,
  onSessionCreated,
  project,
  worktree,
  rootPath,
  machines = null,
}: {
  disabled: boolean
  draftId: string
  transport: ChatTransport
  onSessionCreated: (sessionId: SessionId) => void
  project: OrchestrationProjectShell | null
  worktree: OrchestrationWorktreeShell | null
  rootPath: string
  /** The project's checkouts on every connected machine; null where a draft cannot move. */
  machines?: readonly DraftMachine[] | null
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
  // Manual memo: `draftTarget` is a useEffect dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useEffect re-runs.
  const draftTarget: ChatInputDraftTarget = useMemo(
    () => ({
      environmentId: transport.environmentId,
      draftKey: draftId,
      rootPath,
    }),
    [draftId, rootPath, transport.environmentId],
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
    // `draftTarget` is not rebuilt every render: the compiler keys it on draftId, rootPath and
    // transport.environmentId. Verified with `bun run compiler:explain` on this file.
    // oxlint-disable-next-line react/exhaustive-deps
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
  const handlePersistModelSelection = (next: ModelSelection) => {
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
  }
  /** `background` (Ctrl/Cmd+Enter) starts the session and keeps the user on a fresh draft. */
  async function handleSend(
    {
      attachments,
      interactionMode,
      modelSelection,
      runtimeMode,
      terminalContexts,
      text,
    }: ChatInputSubmitPayload,
    background = false,
  ): Promise<ChatInputSubmitResult> {
    if (!project || !worktree || !target || !targetReady) {
      setSendError('Workspace chat is still preparing.')
      return 'rejected'
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
        background,
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
      return 'rejected'
    }

    setSendError(null)
    // The next draft keeps this one's workspace mode and base branch; each start
    // in new-worktree mode declares its own worktree.
    if (background && identity) {
      useChatInputDraftStore
        .getState()
        .setIdentity(draftTarget, { ...identity, worktreeTarget: nextWorktreeTarget(target) })
      return 'started'
    }

    useChatInputDraftStore.getState().setIdentity(draftTarget, null)
    if (navigation.getSnapshot() === operation) onSessionCreated(submission.command.sessionId)

    return 'sent'
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <ChatWelcomeView />
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
          footer={
            project && worktree && target ? (
              <DraftContextStrip
                base={worktree}
                draftTarget={draftTarget}
                machines={machines}
                project={project}
                target={target}
                onTarget={chooseTarget}
              />
            ) : null
          }
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
