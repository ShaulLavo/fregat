import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from '@workspace/contracts'
import { createContext } from 'react'

import type { PendingApproval } from '@workspace/client-core/chat/pending-approvals'
import type { PendingUserInput } from '@workspace/client-core/chat/pending-user-input'

/**
 * The requests currently blocking the active session, plus the two actions that
 * unblock it. The in-flight set stays behind `isResponding` on purpose — a
 * panel only ever asks about the request it renders.
 */
export type ChatPendingRequests = {
  readonly isResponding: (requestId: ApprovalRequestId) => boolean
  readonly pendingApprovals: readonly PendingApproval[]
  readonly pendingUserInputs: readonly PendingUserInput[]
  /** True once the command is accepted, false when the dispatch failed. */
  readonly respondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<boolean>
  /** True once the command is accepted, false when the dispatch failed. */
  readonly respondToUserInput: (
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Promise<boolean>
}

export const ChatPendingRequestsContext = createContext<ChatPendingRequests | null>(null)
