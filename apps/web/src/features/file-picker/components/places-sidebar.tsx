import { Separator } from '@workspace/ui/components/separator'

import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { LocationButton } from '@/features/file-picker/components/location-button'
import { RecentSidebarSection } from '@/features/file-picker/components/recent-sidebar-section'
import { sidebarLocationsFor } from '@/features/file-picker/utils/sidebar-locations'

export function PlacesSidebar({
  currentPath,
  homePath,
  recentState,
}: {
  currentPath: string
  homePath: string
  recentState: EntriesLoadState
}) {
  const locations = sidebarLocationsFor(homePath)

  return (
    <aside className='bg-muted/25 hidden min-h-0 p-(--density-section-gap) lg:block'>
      <div className='text-muted-foreground text-2xs mb-1 px-(--density-row-padding-x) py-1 font-medium tracking-normal uppercase'>
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
