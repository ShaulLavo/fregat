import { WarningCircleIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'

import type { WorkspaceSearchWarningEvent } from '@workspace/contracts'

import type { SearchBufferStatus } from '@/features/search/state/buffer-state'
import { SearchIdleState } from '@/features/search/components/idle-state'
import { SearchPendingOrEmpty } from '@/features/search/components/pending-or-empty'

export function SearchBufferStatusState({
  error,
  status,
  warnings = [],
}: {
  error: string | null
  status: SearchBufferStatus
  warnings?: readonly WorkspaceSearchWarningEvent[]
}) {
  if (status === 'idle') {
    return <SearchIdleState />
  }
  // No retry button: editing or resubmitting the query in the header re-runs the search.
  if (status === 'error') {
    return (
      <EmptyState
        description={error ?? 'Search failed.'}
        icon={<WarningCircleIcon className='size-(--icon-size)' weight='duotone' />}
        title='Search failed'
        tone='error'
      />
    )
  }

  return <SearchPendingOrEmpty status={status} warnings={warnings} />
}
