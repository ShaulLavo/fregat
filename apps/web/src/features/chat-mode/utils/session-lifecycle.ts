import type { HealthDescriptor, OrchestrationSessionActivity } from '@workspace/contracts'
import type { ProjectionSession } from '@workspace/client-core/chat/types'
import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'
import type { SessionLifecycleChange } from '@workspace/client-core/chat/commands'

export function sessionLifecyclePolicy(
  session: ProjectionSession | undefined,
  owner:
    | { readonly phase: EnvironmentPhase; readonly descriptor: HealthDescriptor | null }
    | undefined,
  activities: readonly OrchestrationSessionActivity[],
) {
  const capabilities = owner?.phase === 'live' ? owner.descriptor?.capabilities : undefined
  const visible = Boolean(session && !session.archivedAt)
  const start = session?.latestTurn?.providerStartState
  const queued =
    start === 'queued' ||
    start === 'claimed' ||
    (start === 'adopted' &&
      (session?.runtime?.status !== 'running' ||
        session.runtime.activeTurnId !== session.latestTurn?.turnId))
  const questions = derivePendingUserInputs(activities, session?.pendingMessageQuestions)
  const optionalCount = questions.filter((question) => question.responseMode === 'message').length
  const approvals = (session?.pendingApprovalCount ?? 0) > 0
  const nativeInputs = (session?.pendingUserInputCount ?? 0) > optionalCount
  const anyInputs = (session?.pendingUserInputCount ?? 0) > 0
  const running =
    session?.latestTurn?.state === 'running' ||
    ['starting', 'running', 'waiting'].includes(session?.runtime?.status ?? '')
  return {
    settlement: visible && capabilities?.sessionSettlement === true,
    snooze: visible && capabilities?.sessionSnooze === true,
    pinning: visible && capabilities?.sessionPinning === true,
    settleBlocked: approvals || nativeInputs || queued || running,
    snoozeBlocked: approvals || anyInputs || queued,
  }
}

export function canApplyLifecycle(
  change: SessionLifecycleChange,
  policy: ReturnType<typeof sessionLifecyclePolicy>,
) {
  switch (change.type) {
    case 'settle':
      return policy.settlement && !policy.settleBlocked
    case 'unsettle':
      return policy.settlement
    case 'snooze':
      return policy.snooze && !policy.snoozeBlocked
    case 'unsnooze':
      return policy.snooze
    case 'pin':
    case 'unpin':
      return policy.pinning
  }
}
