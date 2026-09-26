import { Separator } from '@workspace/ui/components/separator'

import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { LocationButton } from '@/features/file-picker/components/location-button'
import { RecentSidebarSection } from '@/features/file-picker/components/recent-sidebar-section'
import { sidebarLocationsFor, type UserPlace } from '@/features/file-picker/utils/sidebar-locations'

export function PlacesSidebar({
  currentPath,
  homePath,
  places,
  recentState,
}: {
  currentPath: string
  homePath: string
  places: readonly UserPlace[]
  recentState: EntriesLoadState
}) {
  const locations = sidebarLocationsFor(homePath, places)

  return (
    <aside className='bg-muted/25 h-full min-h-0 overflow-y-auto p-(--density-section-gap)'>
      <div className='text-muted-foreground section-label mb-1 px-(--density-row-padding-x) py-1'>
        Locations
      </div>
      <div className='space-y-0.5'>
        {locations.map((location) => (
          <LocationButton currentPath={currentPath} key={location.id} location={location} />
        ))}
      </div>
      <Separator className='my-(--density-section-gap)' />
      <RecentSidebarSection currentPath={currentPath} state={recentState} />
    </aside>
  )
}
