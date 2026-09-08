import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import type { SessionRailView } from '@workspace/client-core/chat/rail/model'

export function SessionRailEmpty({
  query,
  ready,
  searching,
  view,
}: {
  readonly query: string
  readonly ready: boolean
  readonly searching: boolean
  readonly view: SessionRailView
}) {
  if (searching || !ready) {
    const label = searching ? 'Searching sessions…' : 'Connecting…'
    return (
      <LoadingState label={label} className='px-2 py-3'>
        <OrbitLoader label={label} />
      </LoadingState>
    )
  }
  if (query.trim())
    return <EmptyState align='start' title={`No sessions match “${query.trim()}”.`} />
  return (
    <EmptyState
      align='start'
      title={view === 'archived' ? 'No archived sessions.' : 'No sessions yet.'}
    />
  )
}
