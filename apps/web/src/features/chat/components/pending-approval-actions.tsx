import type { ApprovalRequestId, ProviderApprovalDecision } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { usePendingRequests } from '@/features/chat/hooks/use-pending-requests'
import { PendingRequestFeedback } from '@/features/chat/components/pending-request-feedback'

/** The four `providerApprovalDecisionSchema` decisions, in product language. */
const DECISIONS: ReadonlyArray<{
  readonly decision: ProviderApprovalDecision
  readonly label: string
  readonly variant: 'default' | 'destructive' | 'ghost' | 'outline'
}> = [
  { decision: 'cancel', label: 'Cancel', variant: 'ghost' },
  { decision: 'decline', label: 'Deny', variant: 'destructive' },
  { decision: 'acceptForSession', label: 'Allow for this session', variant: 'outline' },
  { decision: 'accept', label: 'Allow', variant: 'default' },
]

export function PendingApprovalActions({ requestId }: { readonly requestId: ApprovalRequestId }) {
  const { disabledReason, responseState, respondToApproval } = usePendingRequests()
  const response = responseState(requestId)
  const responding = response.kind === 'submitting' || response.kind === 'accepted'

  return (
    <div aria-busy={responding} className='flex flex-col gap-2'>
      <PendingRequestFeedback response={response} />
      <div className='flex flex-wrap items-center justify-end gap-1.5'>
        {DECISIONS.map((option) => (
          <Button
            disabled={responding || disabledReason !== null}
            key={option.decision}
            onClick={() => void respondToApproval(requestId, option.decision)}
            size='sm'
            type='button'
            variant={option.variant}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
