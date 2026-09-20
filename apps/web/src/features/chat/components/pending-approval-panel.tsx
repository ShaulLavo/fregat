import { WarningCircleIcon } from '@phosphor-icons/react'

import { PendingApprovalActions } from '@/features/chat/components/pending-approval-actions'
import { usePendingRequests } from '@/features/chat/hooks/use-pending-requests'
import type { PendingApprovalKind } from '@workspace/client-core/chat/pending-approvals'

export function PendingApprovalPanel() {
  const { pendingApprovals } = usePendingRequests()
  const approval = pendingApprovals[0]
  if (!approval) return null

  return (
    <div
      aria-label='Pending approvals'
      className='shrink-0 px-(--density-control-padding-x) pb-(--density-section-gap)'
      role='alert'
    >
      <section
        aria-label={approvalTitle(approval.requestKind)}
        className='bg-card mx-auto flex max-w-3xl flex-col gap-(--density-control-gap) rounded-lg p-(--density-section-padding)'
      >
        <div className='flex min-w-0 items-center gap-2'>
          <WarningCircleIcon
            aria-hidden='true'
            className='text-warning size-(--icon-size-sm) shrink-0'
          />
          <span className='text-foreground flex-1 text-xs font-medium'>
            {approvalTitle(approval.requestKind)}
          </span>
          {pendingApprovals.length > 1 ? (
            <span className='text-muted-foreground text-3xs shrink-0 tabular-nums'>
              1/{pendingApprovals.length}
            </span>
          ) : null}
        </div>
        <pre
          aria-label={detailLabel(approval.requestKind)}
          className='focus-ring text-foreground text-2xs max-h-20 overflow-auto rounded-md font-mono leading-relaxed whitespace-pre outline-none'
          tabIndex={0}
        >
          {approval.detail || approvalTitle(approval.requestKind)}
        </pre>
        <PendingApprovalActions requestId={approval.requestId} />
      </section>
    </div>
  )
}

function approvalTitle(requestKind: PendingApprovalKind | null) {
  if (requestKind === 'command') return 'Run a command'
  if (requestKind === 'file-change') return 'Apply a file change'
  if (requestKind === 'file-read') return 'Read a file'

  return 'Approval requested'
}

function detailLabel(requestKind: PendingApprovalKind | null) {
  if (requestKind === 'command') return 'Command'
  if (requestKind === 'file-change') return 'File change'
  if (requestKind === 'file-read') return 'File to read'

  return 'Details'
}
