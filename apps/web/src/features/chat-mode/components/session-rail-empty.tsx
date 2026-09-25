import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'
import type { SessionRailView } from '@workspace/client-core/chat/rail/model'

export function SessionRailEmpty({
  query,
  ready,
  searching,
  incompleteSearch,
  view,
}: {
  readonly query: string
  readonly ready: boolean
  readonly searching: boolean
  readonly incompleteSearch: boolean
  readonly view: SessionRailView
}) {
  if (searching || !ready) {
    const label = searching ? 'Searching sessions…' : 'Connecting…'
    return (
      <div className='px-2 py-3'>
        <Spinner label={label} />
      </div>
    )
  }
  if (query.trim() && incompleteSearch)
    return <EmptyState align='start' title='Search is incomplete.' />
  if (query.trim())
    return <EmptyState align='start' title={`No sessions match “${query.trim()}”.`} />
  return (
    <EmptyState
      align='start'
      title={view === 'archived' ? 'No archived sessions.' : 'No sessions yet.'}
    />
  )
}
