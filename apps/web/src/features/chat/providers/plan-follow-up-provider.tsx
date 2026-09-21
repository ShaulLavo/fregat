import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { chatSubmissionValidation } from '@/features/chat/utils/submission-validation'
import type {
  OrchestrationMessage,
  OrchestrationProposedPlan,
  SessionId,
  SessionTurnStartCommand,
} from '@workspace/contracts'
import { useState, type ReactNode } from 'react'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  createDraftSessionSubmission,
  createTurnSubmission,
  type SourceProposedPlanReference,
} from '@workspace/client-core/chat/commands'
import { replayAfterDispatch } from '@/features/chat/utils/command-dispatch'
import { scheduleSessionProjectionSyncAfterDispatch } from '@/features/chat/utils/command-sync'
import { chatInputUploadAttachments } from '@/features/chat/utils/input-attachments'
import {
  actionableProposedPlan,
  planImplementationPrompt,
  planImplementationSessionTitle,
  resolvePlanFollowUpSubmission,
} from '@workspace/client-core/chat/proposed-plan'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import {
  ChatPlanFollowUpContext,
  type ChatPlanFollowUp,
} from '@/features/chat/providers/plan-follow-up-context'
import {
  useChatInputDraftStore,
  chatInputAttachmentsPreparing,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'
import { placeChatMessage } from '@/features/chat/state/place-chat-message'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { type ChatSession } from '@workspace/client-core/chat/types'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'

const NO_PLANS: ChatSession['proposedPlans'] = []

type PlanDispatchContext = {
  draftTarget: ChatInputDraftTarget
  transport: ChatTransport
  onSessionCreated: (sessionId: SessionId) => void
  plan: OrchestrationProposedPlan
  session: ChatSession
}

/**
 * Turns a finished plan into the next turn. Plan mode only pays off if the plan
 * can be acted on without retyping "go ahead", so this owns the two actions that
 * close that loop — build it here, or build it in a session of its own — and
 * stamps whichever turn results with the plan it came from.
 *
 * It reads the composer draft rather than being handed it: the empty-draft rule
 * has to see the text as it stands at click time, and the banner must not become
 * a second owner of the composer's state.
 *
 * The transport arrives as a prop rather than being reached for, which keeps
 * the banner renderable against any `ChatTransport`, including the real
 * in-process one under test.
 */
export function ChatPlanFollowUpProvider({
  children,
  disabledReason = null,
  draftTarget,
  transport,
  onSessionCreated,
  sessionId,
}: {
  readonly children: ReactNode
  readonly disabledReason?: string | null
  readonly draftTarget: ChatInputDraftTarget
  readonly transport: ChatTransport
  /**
   * Puts a newly split-off implementation session on screen. A callback rather
   * than a reach into the session store: the two chat surfaces keep their
   * selection in different places, and only the host knows which it is.
   */
  readonly onSessionCreated: (sessionId: SessionId) => void
  readonly sessionId: SessionId
}) {
  const session = useActiveChatProjection((state) => selectChatSessionById(state, sessionId))
  const [submitting, setSubmitting] = useState(false)
  const preparingImages = useChatInputDraftStore((state) =>
    chatInputAttachmentsPreparing(state, draftTarget),
  )
  const unavailableReason = planUnavailableReason(disabledReason, session, preparingImages)
  // A running turn already owns the composer: the plan has been answered, and a
  // second Implement would start a duplicate build.
  const plan = isChatSessionBusy(session)
    ? null
    : actionableProposedPlan(session?.proposedPlans ?? NO_PLANS)
  // One follow-up in flight at a time whichever button started it: both end in
  // a turn against the same plan, and only one of them can be its implementation.
  const once = (dispatch: (context: PlanDispatchContext) => Promise<boolean>) => async () => {
    if (!plan || !session || submitting || unavailableReason) return false

    setSubmitting(true)
    try {
      const sent = await dispatch({ draftTarget, transport, onSessionCreated, plan, session })
      setSubmitting(false)
      return sent
    } catch (error) {
      // Not `finally`: the compiler refuses the whole provider over one.
      setSubmitting(false)
      throw error
    }
  }

  const value: ChatPlanFollowUp = {
    disabledReason: unavailableReason,
    implementInNewSession: once(dispatchPlanImplementationSession),
    plan,
    submitFollowUp: once(dispatchPlanFollowUpTurn),
    submitting,
  }

  return <ChatPlanFollowUpContext value={value}>{children}</ChatPlanFollowUpContext>
}

async function dispatchPlanFollowUpTurn({
  draftTarget,
  transport,
  plan,
  session,
}: PlanDispatchContext): Promise<boolean> {
  const drafts = useChatInputDraftStore.getState()
  // Read live: the draft as it stands at click time is what decides implement
  // versus refine, and a render-time copy would be one keystroke stale.
  const draft = drafts.getDraft(draftTarget)
  const followUp = resolvePlanFollowUpSubmission({
    draftText: draft.prompt,
    planMarkdown: plan.planMarkdown,
  })
  const sourceProposedPlan = followUp.implementsPlan ? planReference(plan) : undefined
  const validation = chatSubmissionValidation(followUp.text, draft.terminalContexts)
  if (validation) {
    notifyChatCommandError(validation, 'Message is too long')
    return false
  }
  const submission = createTurnSubmission({
    attachments: chatInputUploadAttachments(draft.attachments),
    createdAt: new Date().toISOString(),
    interactionMode: followUp.interactionMode,
    modelSelection: draft.modelSelection ?? session.modelSelection,
    runtimeMode: draft.runtimeMode ?? session.runtimeMode,
    sourceProposedPlan,
    // This path builds its own turn from the draft and then clears it, so
    // anything staged that it forgets is destroyed rather than deferred.
    terminalContexts: draft.terminalContexts,
    text: followUp.text,
    sessionId: session.id,
  })

  return dispatchPlanTurn({
    action: 'chat.plan_follow_up.dispatch.summary',
    command: submission.command,
    context: {
      implementsPlan: followUp.implementsPlan,
      planId: plan.id,
      planSessionId: plan.sessionId,
      sourcePlanId: sourceProposedPlan?.planId ?? null,
      terminalContextCount: draft.terminalContexts.length,
    },
    transport,
    onAccepted: () => drafts.clearDraft(draftTarget),
    optimisticMessage: submission.optimisticMessage,
    planSessionId: plan.sessionId,
  })
}

/**
 * Splits the build off into its own conversation. The plan is the whole first
 * turn, so nothing staged in the composer travels with it — that draft belongs
 * to the session the user is leaving open, and destroying it to send a plan the
 * user never typed would be a trade they did not ask for.
 */
async function dispatchPlanImplementationSession({
  draftTarget,
  transport,
  onSessionCreated,
  plan,
  session,
}: PlanDispatchContext): Promise<boolean> {
  const draft = useChatInputDraftStore.getState().getDraft(draftTarget)
  const validation = chatSubmissionValidation(planImplementationPrompt(plan.planMarkdown), [])
  if (validation) {
    notifyChatCommandError(validation, 'Plan is too long')
    return false
  }
  const submission = createDraftSessionSubmission({
    createdAt: new Date().toISOString(),
    // The composer's live pick, same as the in-session path: switching model and
    // then splitting the build off should still run on the model that was picked.
    modelSelection: draft.modelSelection ?? session.modelSelection,
    worktreeTarget: { kind: 'current', worktreeId: session.worktreeId },
    // The plan was written against this checkout, so a worktree session hands
    // its implementation to the same worktree rather than back to the project root.
    runtimeMode: draft.runtimeMode ?? session.runtimeMode,
    // Stamped on the command the server sees, so the plan is marked implemented
    // by the turn that implements it rather than by a second round trip.
    sourceProposedPlan: { planId: plan.id, sessionId: plan.sessionId },
    text: planImplementationPrompt(plan.planMarkdown),
    // The prompt's first line is the instruction carrying the plan, not the
    // plan, so the session would otherwise be named "Please implement this plan".
    title: planImplementationSessionTitle(plan.planMarkdown),
  })
  const command = submission.command

  return dispatchPlanTurn({
    action: 'chat.plan_implementation_session.dispatch.summary',
    command,
    context: {
      planId: plan.id,
      planSessionId: plan.sessionId,
      sourceSessionId: session.id,
    },
    transport,
    // Only once the command is accepted: a rejected dispatch created no session,
    // and the stage would sit on one that never arrives.
    onAccepted: () => onSessionCreated(command.sessionId),
    optimisticMessage: submission.optimisticMessage,
    planSessionId: plan.sessionId,
  })
}

async function dispatchPlanTurn({
  action,
  command,
  context,
  transport,
  onAccepted,
  optimisticMessage,
  planSessionId,
}: {
  action: string
  command: SessionTurnStartCommand
  context: Record<string, unknown>
  transport: ChatTransport
  onAccepted: () => void
  optimisticMessage: OrchestrationMessage
  /** The session the plan lives on, which is not always the one running the turn. */
  planSessionId: SessionId
}): Promise<boolean> {
  const outcome = await placeChatMessage({
    action,
    command,
    context: { ...context, planSessionResynced: planSessionId !== command.sessionId },
    dispatchCommand: transport.dispatchCommand,
    // Runs on a command the server accepted, so nothing here can roll the
    // message back: the turn it answers is already running.
    onAccepted: (result) => {
      syncSessionsAfterPlanTurn({
        transport,
        planSessionId,
        replayAfterSequence: replayAfterDispatch(command, result),
        turnSessionId: command.sessionId,
      })
      onAccepted()
    },
    placement: {
      environmentId: transport.environmentId,
      commandId: command.commandId,
      message: optimisticMessage,
    },
  })

  if (!outcome.ok) notifyChatCommandError(outcome.error, 'Could not send the plan follow-up')
  return outcome.ok
}

/**
 * The turn session converges on its own — its events carry the new turn. The plan's
 * session does not: the server stamps `implementedAt` across sessions while projecting
 * the turn start, and that write appends nothing to the plan session's aggregate, so
 * its detail stream (filtered by session) will never mention it. Without a resnapshot
 * here the source session keeps offering to implement a plan that is already building.
 */
function syncSessionsAfterPlanTurn({
  transport,
  planSessionId,
  replayAfterSequence,
  turnSessionId,
}: {
  transport: ChatTransport
  planSessionId: SessionId
  replayAfterSequence: number
  turnSessionId: SessionId
}) {
  scheduleSessionProjectionSyncAfterDispatch({
    transport,
    replayAfterSequence,
    sessionId: turnSessionId,
  })
  if (planSessionId === turnSessionId) return

  // The plan's session ran no turn of its own, so there is no tail to replay past
  // what it already holds; the snapshot half of the sync is what carries the stamp.
  const planSessionSequence =
    selectChatProjectionSlice(useChatProjectionStore.getState(), transport.environmentId)
      .sessionDetailSequenceById[planSessionId] ?? 0

  scheduleSessionProjectionSyncAfterDispatch({
    transport,
    replayAfterSequence: planSessionSequence,
    sessionId: planSessionId,
  })
}

function planReference(plan: OrchestrationProposedPlan): SourceProposedPlanReference {
  return { planId: plan.id, sessionId: plan.sessionId }
}

function planUnavailableReason(
  disabledReason: string | null,
  session: ChatSession | undefined,
  preparingImages: boolean,
) {
  if (disabledReason) return disabledReason
  if (preparingImages) return 'Preparing images…'
  if (session && session.worktree.lifecycle.state !== 'ready') return 'Workspace is not ready'
  if (session?.pendingApprovalCount || session?.pendingUserInputCount)
    return 'Answer the pending request first'
  return null
}
