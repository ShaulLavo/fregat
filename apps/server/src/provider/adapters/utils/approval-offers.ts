import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from '@workspace/contracts'
import { sessionIdentityErrors } from '../../structured-errors'

/** One choice an approval shows, with the harness response it sends. */
export type ApprovalOffer<Response> = {
  readonly option: ProviderApprovalOption
  readonly response: Response
}

export function offeredOptions<Response>(offers: readonly ApprovalOffer<Response>[]) {
  return offers.map((offer) => offer.option)
}

/** Refuses a decision the approval never offered before the harness sees it. */
export function offeredResponse<Response>(
  offers: readonly ApprovalOffer<Response>[],
  decision: ProviderApprovalDecision,
  requestId: ApprovalRequestId,
): Response {
  const offer = offers.find((candidate) => candidate.option.decision === decision)
  if (offer) return offer.response

  throw sessionIdentityErrors.APPROVAL_DECISION_NOT_OFFERED({
    internal: {
      decision,
      offered: offers.map((candidate) => candidate.option.decision),
      requestId,
    },
  })
}
