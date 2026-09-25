import { Spinner } from '@workspace/ui/components/spinner'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'

export function SessionSearchStatus() {
  const query = useSessionRailStore((state) => state.query).trim()
  const result = useSessionSearchStore()
  if (!query || result.matchedQuery !== query) return null
  if (!result.searching && result.unavailable.length === 0) return null
  return (
    <div
      className='text-muted-foreground text-2xs px-(--density-row-padding-x) py-(--density-row-padding-y)'
      role='status'
    >
      {result.searching ? <Spinner label='Searching sessions…' /> : null}
      {result.unavailable.length > 0 ? (
        <p>Search unavailable on: {result.unavailable.join(', ')}</p>
      ) : null}
    </div>
  )
}
