import type {
  ApprovalRequestId,
  CommandId,
  OrchestrationSessionActivity,
} from '@workspace/contracts'

import type { PendingRequestResponse } from '@/features/chat/providers/pending-requests-context'
import { pendingRequestError } from '@/features/chat/utils/pending-request-error'

/** One response mutation, as `useMutationState` selects it. */
export type PendingRequestMutation = {
  readonly commandId: CommandId | undefined
  readonly errorMessage: string | null
  readonly requestId: ApprovalRequestId | undefined
  readonly status: 'idle' | 'pending' | 'success' | 'error'
}

const IDLE: PendingRequestResponse = { kind: 'idle' }
const ACCEPTED: PendingRequestResponse = { kind: 'accepted' }

/**
 * The latest local mutation for the request wins; a failure the agent reported
 * for that command overrides its success. With no local mutation, an answer
 * another window submitted still shows as sent.
 */
export function pendingRequestResponse(input: {
  readonly activities: readonly OrchestrationSessionActivity[]
  readonly mutations: readonly PendingRequestMutation[]
  readonly requestId: ApprovalRequestId
  readonly submittedElsewhere: boolean
}): PendingRequestResponse {
  const latest = input.mutations.findLast((mutation) => mutation.requestId === input.requestId)
  if (!latest?.commandId) return input.submittedElsewhere ? ACCEPTED : IDLE
  if (latest.status === 'pending' || latest.status === 'idle') return { kind: 'submitting' }
  if (latest.status === 'error') {
    return { kind: 'failed', message: latest.errorMessage ?? 'The response was not sent.' }
  }

  const failure = pendingRequestError(input.activities, latest.commandId)
  return failure ? { kind: 'failed', message: failure } : ACCEPTED
}
