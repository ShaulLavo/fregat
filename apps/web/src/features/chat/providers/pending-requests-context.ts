import type {
  ApprovalRequestId,
  SessionId,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  UserInputAttachmentUploads,
} from '@workspace/contracts'
import { createContext } from 'react'

import type { PendingApproval } from '@workspace/client-core/chat/pending-approvals'
import type { PendingUserInput } from '@workspace/client-core/chat/pending-user-input'

/** Requests holding the turn open, plus the actions and state of their responses. */
export type ChatPendingRequests = {
  readonly sessionId: SessionId
  readonly dismissUserInput: (requestId: ApprovalRequestId) => Promise<boolean>
  readonly disabledReason: string | null
  readonly responseState: (requestId: ApprovalRequestId) => PendingRequestResponse
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
    attachmentsByQuestionId?: UserInputAttachmentUploads,
  ) => Promise<boolean>
}

export type PendingRequestResponse =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'accepted' }
  | { readonly kind: 'failed'; readonly message: string }

export const ChatPendingRequestsContext = createContext<ChatPendingRequests | null>(null)
