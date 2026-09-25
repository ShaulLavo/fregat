import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { LocationPill } from '@/features/file-picker/components/location-pill'
import { RecentPill } from '@/features/file-picker/components/recent-pill'
import { sidebarLocationsFor } from '@/features/file-picker/utils/sidebar-locations'

export function MobileLocations({
  currentPath,
  homePath,
  recentState,
}: {
  currentPath: string
  homePath: string
  recentState: EntriesLoadState
}) {
  const locations = sidebarLocationsFor(homePath)
  const recents = recentState.status === 'ready' ? recentState.data : []

  return (
    <div className='mt-(--density-section-gap) space-y-1 lg:hidden'>
      <div className='flex gap-1 overflow-x-auto pb-0.5'>
        {locations.map((location) => (
          <LocationPill currentPath={currentPath} key={location.id} location={location} />
        ))}
      </div>
      {recents.length > 0 && (
        <div className='flex items-center gap-1 overflow-x-auto pb-0.5'>
          <span className='text-muted-foreground section-label shrink-0 px-1'>Recent</span>
          {recents.map((entry) => (
            <RecentPill currentPath={currentPath} entry={entry} key={entry.path} />
          ))}
        </div>
      )}
    </div>
  )
}
