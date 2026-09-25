import { approvalDecisionVariant } from '@/features/chat/utils/approval-presentation'
import type { ApprovalRequestId, ProviderApprovalOption } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { usePendingRequests } from '@/features/chat/hooks/use-pending-requests'
import { PendingRequestFeedback } from '@/features/chat/components/pending-request-feedback'

export function PendingApprovalActions({
  requestId,
  options,
}: {
  readonly requestId: ApprovalRequestId
  readonly options: readonly ProviderApprovalOption[]
}) {
  const { disabledReason, responseState, respondToApproval } = usePendingRequests()
  const response = responseState(requestId)
  const responding = response.kind === 'submitting' || response.kind === 'accepted'

  return (
    <div aria-busy={responding} className='flex flex-col gap-2'>
      <PendingRequestFeedback response={response} />
      {disabledReason !== null && !responding ? (
        <p className='text-muted-foreground text-2xs' role='status'>
          {disabledReason} · It may already have been answered in another window.
        </p>
      ) : null}
      <div className='flex flex-wrap items-center justify-end gap-1.5'>
        {options.map((option) => (
          <Button
            disabled={responding || disabledReason !== null}
            key={option.decision}
            onClick={() => void respondToApproval(requestId, option.decision)}
            size='sm'
            type='button'
            variant={approvalDecisionVariant(option.decision)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
