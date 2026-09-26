import { advanceBackgroundDraft } from '@/features/chat/state/advance-background-draft'
import {
  type ModelSelection,
  type OrchestrationProjectShell,
  type SessionId,
  type OrchestrationWorktreeShell,
  type SessionWorktreeTarget,
} from '@workspace/contracts'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import { ChatInput } from './chat-input'
import type { ChatInputSubmitPayload, ChatInputSubmitResult } from '../utils/composed-message'
import { ChatWelcomeView } from './chat-welcome-view'
import { DraftContextStrip } from '@/features/chat/components/draft-context-strip'
import type { DraftMachine } from '@/features/chat/utils/draft-workspace'
import { useSettingValue } from '@/hooks/use-setting-value'
import { fanOutWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { backgroundModelError, draftSendTargets } from '@/features/chat/utils/multiple-models'
import { draftSubmissionKey } from '@/features/chat/utils/draft-submission-key'
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
  // Submissions whose dispatch did not come back ok, kept so a retry resends the same command.
  const unsettledSubmissions = useRef(
    new Map<string, ReturnType<typeof createDraftSessionSubmission>>(),
  )
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
  const selectedProvider = (draft.modelSelection ?? modelSelection)?.providerInstanceId ?? null
  const selectedAgent =
    identity?.agent?.providerInstanceId === selectedProvider ? identity.agent : null
  function chooseAgent(name: string | null) {
    if (!identity || !selectedProvider) return
    const agent = name ? { name, providerInstanceId: selectedProvider } : null
    useChatInputDraftStore.getState().setIdentity(draftTarget, { ...identity, agent })
  }
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
  /**
   * Declared, not created: the server makes the worktree while the turn is held at the
   * gate, so a client that dies here cannot orphan a directory no session owns. A retried
   * target reuses its submission, so a lost acknowledgment never starts a duplicate.
   */
  async function startSession(
    payload: ChatInputSubmitPayload,
    worktreeTarget: SessionWorktreeTarget,
    context: Record<string, unknown>,
    fanOut = false,
  ) {
    const retryKey = draftSubmissionKey({
      agent: selectedAgent,
      payload,
      environmentId: transport.environmentId,
      worktreeTarget,
      fanOut,
    })
    const submission =
      unsettledSubmissions.current.get(retryKey) ??
      createDraftSessionSubmission({
        ...payload,
        agent: selectedAgent,
        createdAt: new Date().toISOString(),
        worktreeTarget:
          fanOut && worktree ? fanOutWorktreeTarget(worktreeTarget, worktree.id) : worktreeTarget,
      })
    unsettledSubmissions.current.set(retryKey, submission)
    const outcome = await placeChatMessage({
      action: 'chat.draft.dispatch.summary',
      command: submission.command,
      context: {
        ...context,
        attachmentCount: payload.attachments.length,
        interactionMode: payload.interactionMode,
        model: payload.modelSelection.model,
        projectId: project?.id,
        providerInstanceId: payload.modelSelection.providerInstanceId,
        runtimeMode: payload.runtimeMode,
        terminalContextCount: payload.terminalContexts.length,
        textLength: payload.text.length,
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
    if (outcome.ok) unsettledSubmissions.current.delete(retryKey)

    return { ...outcome, sessionId: submission.command.sessionId }
  }

  /** `background` (Ctrl/Cmd+Enter) starts the session and keeps the user on a fresh draft. */
  async function handleSend(
    payload: ChatInputSubmitPayload,
    background = false,
  ): Promise<ChatInputSubmitResult> {
    if (!project || !worktree || !target || !targetReady) {
      setSendError('Workspace chat is still preparing.')
      return 'rejected'
    }
    const operation = navigation.getSnapshot()
    const additional = useChatInputDraftStore
      .getState()
      .getDraft(draftTarget).additionalModelSelections
    const models = draftSendTargets(payload.modelSelection, additional)
    const backgroundError = backgroundModelError(models, background)
    if (backgroundError) {
      setSendError(backgroundError)
      return 'rejected'
    }
    if (models.length > 1 && !background) return sendToModels(payload, models, operation)

    const outcome = await startSession(payload, target, { background })
    if (!outcome.ok) {
      setSendError(outcome.message)
      return 'rejected'
    }

    setSendError(null)
    // The next draft keeps this one's workspace mode and base branch; each start
    // in new-worktree mode declares its own worktree.
    if (background && identity) {
      advanceBackgroundDraft(draftTarget, identity)
      return 'started'
    }

    useChatInputDraftStore.getState().setIdentity(draftTarget, null)
    if (navigation.getSnapshot() === operation) onSessionCreated(outcome.sessionId)

    return 'sent'
  }

  /**
   * One session per model, each on its own new worktree from the draft's base and branch.
   * Models that failed stay on the draft, with its text, for a retry; the rest are done.
   */
  async function sendToModels(
    payload: ChatInputSubmitPayload,
    models: readonly ModelSelection[],
    operation: unknown,
  ): Promise<ChatInputSubmitResult> {
    if (!worktree || !target) return 'rejected'
    const started: SessionId[] = []
    const failed: { model: ModelSelection; message: string }[] = []
    for (const model of models) {
      const outcome = await startSession(
        { ...payload, modelSelection: model },
        target,
        { modelCount: models.length },
        true,
      )
      if (outcome.ok) started.push(outcome.sessionId)
      else failed.push({ model, message: outcome.message })
    }

    const drafts = useChatInputDraftStore.getState()
    const [firstFailure, ...otherFailures] = failed
    if (firstFailure) {
      drafts.setModelSelection(draftTarget, firstFailure.model)
      drafts.setAdditionalModelSelections(
        draftTarget,
        otherFailures.map((entry) => entry.model),
      )
      setSendError(
        `Started ${started.length} of ${models.length} sessions. ${firstFailure.message}`,
      )
      return 'rejected'
    }

    setSendError(null)
    // Every model has its session, so nothing of this draft is left to recover.
    drafts.clearDraft(draftTarget)
    const [first] = started
    if (first && navigation.getSnapshot() === operation) onSessionCreated(first)

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
                agent={selectedAgent?.name ?? null}
                base={worktree}
                providerInstanceId={selectedProvider}
                onAgent={chooseAgent}
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
