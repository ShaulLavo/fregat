import { MagnifyingGlassIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { WorkspaceSearchWarningEvent } from '@workspace/contracts'
import { EmptyState } from '@workspace/ui/components/empty-state'

import { SearchResultsLoading } from '@/features/search/components/results-loading'
import type { SearchBufferStatus } from '@/features/search/state/buffer-state'

export function SearchPendingOrEmpty({
  className,
  status,
  warnings = [],
}: {
  className?: string
  status: SearchBufferStatus
  warnings?: readonly WorkspaceSearchWarningEvent[]
}) {
  if (status === 'loading') {
    return <SearchResultsLoading className={className} />
  }

  const warning = warnings[0]
  if (warning) {
    return (
      <EmptyState
        className={className}
        description={warning.message}
        icon={<WarningCircleIcon className='size-(--icon-size)' weight='duotone' />}
        title='No matches'
        tone='warning'
      />
    )
  }

  return (
    <EmptyState
      className={className}
      description='Try a different query.'
      icon={<MagnifyingGlassIcon className='size-(--icon-size)' />}
      title='No matches'
    />
  )
}
