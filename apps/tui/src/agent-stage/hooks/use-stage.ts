import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ClientOrchestrationCommand, SessionWorktreeTarget } from '@workspace/contracts'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import {
  createDraftSessionSubmission,
  createTurnSubmission,
} from '@workspace/client-core/chat/commands'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import {
  actionableProposedPlan,
  planImplementationPrompt,
  planImplementationSessionTitle,
} from '@workspace/client-core/chat/proposed-plan'
import type { StageTarget } from '@/agent/utils/target'
import type { SessionState } from '@/connection/state/session'
import { draftsForStorage, draftKey } from '@/agent-stage/state/drafts'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { connectionFailure } from '@/connection/utils/failure'
import { expandedPrompt } from '@/agent-stage/utils/prompt'
import { isOrchestrationRpcServerError } from '@workspace/client-core/transport/orchestration-rpc-client'
import { draftWorktreeReason, draftWorktreeTarget } from '@/agent-stage/utils/worktree-target'

export function useStage({
  ready,
  target,
  onSelect,
}: {
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly target: StageTarget
  readonly onSelect: (target: StageTarget) => void
}) {
  const [drafts] = useState(() => draftsForStorage(ready.storage))
  useSyncExternalStore(drafts.subscribe, drafts.getSnapshot)
  const snapshot = useSyncExternalStore(ready.chat.subscribe, ready.chat.getSnapshot)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const currentTarget = useRef(target)
  currentTarget.current = target
  const key = draftKey(target)
  const storedDraft = drafts.read(key)
  const defaultRuntimeMode = useSettingValue(ready.owner, 'chat.defaultRuntimeMode')
  const defaultInteractionMode = useSettingValue(ready.owner, 'chat.defaultInteractionMode')
  const conversation =
    target.kind === 'conversation'
      ? selectChatSessionById(snapshot.projection, target.sessionId)
      : undefined
  const worktreeId = target.kind === 'conversation' ? conversation?.worktreeId : target.worktreeId
  const worktree = worktreeId ? snapshot.projection.worktreeById[worktreeId] : undefined
  const project = worktree ? snapshot.projection.projectById[worktree.projectId] : undefined
  const draft = {
    ...storedDraft,
    runtimeMode: storedDraft.runtimeMode ?? conversation?.runtimeMode ?? defaultRuntimeMode,
    interactionMode:
      storedDraft.interactionMode ?? conversation?.interactionMode ?? defaultInteractionMode,
  }
  const busy = isChatSessionBusy(conversation)
  const plan = !busy && conversation ? actionableProposedPlan(conversation.proposedPlans) : null
  const selectedSessionId = target.kind === 'draft' ? null : target.sessionId
  useEffect(() => {
    ready.chat.selectSession(selectedSessionId)
  }, [ready.chat, selectedSessionId])
  useEffect(() => {
    if (worktreeId && target.kind !== 'terminal') drafts.takeInbox(key, worktreeId)
  }, [drafts, key, worktreeId, target.kind])

  function worktreeModeReason(mode: SessionWorktreeTarget['kind']) {
    if (target.kind !== 'draft') return 'A session keeps the worktree it was created in.'
    if (inFlight.current) return 'Wait for the current submission to finish.'
    return draftWorktreeReason(worktree, mode)
  }
  function setWorktreeMode(mode: SessionWorktreeTarget['kind']) {
    const reason = worktreeModeReason(mode)
    if (reason) {
      setError(reason)
      return false
    }
    drafts.update(key, { worktreeMode: mode })
    setError(null)
    return true
  }
  const sendDisabledReason = draftWorktreeReason(
    worktree,
    target.kind === 'draft' ? draft.worktreeMode : 'current',
  )

  async function run(command: ClientOrchestrationCommand) {
    setError(null)
    if (ready.connection.kind !== 'live') {
      setError('Reconnect before sending. Your draft is saved.')
      return false
    }
    try {
      await ready.chat.dispatch(command)
      return true
    } catch (failure) {
      if (command.type === 'session.turn.start' && isOrchestrationRpcServerError(failure))
        drafts.discardPending(key, command.commandId)
      setError(connectionFailure(failure).message)
      return false
    }
  }
  async function send(text?: string, implement: 'current' | 'new' | null = null) {
    if (inFlight.current || busy || !worktreeId || target.kind === 'terminal') return false
    if (text !== undefined && text !== drafts.read(key).text) drafts.update(key, { text })
    const sent = drafts.read(key)
    const reason = draftWorktreeReason(
      worktree,
      target.kind === 'draft' ? sent.worktreeMode : 'current',
    )
    if (reason) {
      setError(reason)
      return false
    }
    const modelSelection =
      sent.modelSelection ?? conversation?.modelSelection ?? project?.defaultModelSelection
    if (!modelSelection) {
      setError('Select an available model before sending.')
      return false
    }
    const implementing =
      implement ??
      (plan && !sent.text.trim() && sent.attachments.length === 0 && !sent.terminalContexts?.length
        ? 'current'
        : null)
    const content =
      implementing && plan ? planImplementationPrompt(plan.planMarkdown) : expandedPrompt(sent)
    if (!content && sent.attachments.length === 0) return false
    const sourceProposedPlan =
      implementing && plan ? { planId: plan.id, sessionId: plan.sessionId } : undefined
    const options = {
      createdAt: new Date().toISOString(),
      text: content,
      modelSelection,
      runtimeMode: sent.runtimeMode ?? conversation?.runtimeMode ?? defaultRuntimeMode,
      interactionMode:
        sent.interactionMode ?? conversation?.interactionMode ?? defaultInteractionMode,
      attachments: implementing === 'new' ? [] : sent.attachments,
      sourceProposedPlan,
    }
    if (plan && !implementing) options.interactionMode = 'plan'
    if (implementing) options.interactionMode = 'default'
    const intent = implementing ?? 'send'
    let command = drafts.pending(key, sent, intent)
    if (!command) {
      const submission =
        conversation && implementing !== 'new'
          ? createTurnSubmission({ ...options, sessionId: conversation.id })
          : createDraftSessionSubmission({
              ...options,
              worktreeTarget: draftWorktreeTarget(
                worktreeId,
                target.kind === 'draft' ? sent.worktreeMode : 'current',
              ),
              title:
                implementing && plan
                  ? planImplementationSessionTitle(plan.planMarkdown)
                  : undefined,
            })
      command = submission.command
    }
    drafts.retain(key, sent, intent, command)
    inFlight.current = true
    setSubmitting(true)
    try {
      if (!(await run(command))) return false
      drafts.discardPending(key, command.commandId)
      if (!implementing) drafts.remember(sent, command)
      if (implementing !== 'new') drafts.clearContent(key, sent)
      if (
        mounted.current &&
        draftKey(currentTarget.current) === key &&
        command.sessionId !== conversation?.id
      )
        onSelect({ kind: 'conversation', sessionId: command.sessionId })
      return true
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }
  return {
    snapshot,
    drafts,
    key,
    draft,
    conversation,
    worktree,
    project,
    busy,
    plan,
    submitting,
    error,
    sendDisabledReason,
    worktreeModeReason,
    setWorktreeMode,
    setError,
    run,
    send,
  }
}
