import { ClockCounterClockwiseIcon } from '@phosphor-icons/react'
import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { LocationPill } from '@/features/file-picker/components/location-pill'
import { RecentPill } from '@/features/file-picker/components/recent-pill'
import type { SidebarSection } from '@/features/file-picker/utils/sidebar-locations'

export function MobileLocations({
  currentPath,
  recentState,
  sections,
}: {
  currentPath: string
  recentState: EntriesLoadState
  sections: readonly SidebarSection[]
}) {
  const locations = sections.flatMap((section) => section.locations)
  const recents = recentState.status === 'ready' ? recentState.data : []

  // One strip, places then recents: a second row would cost the list a row of its own.
  return (
    <div
      aria-label='Places'
      className='mt-(--density-gap-tight) flex items-center gap-1 overflow-x-auto px-(--bar-padding-x) pb-0.5 lg:hidden'
      role='group'
    >
      {locations.map((location) => (
        <LocationPill currentPath={currentPath} key={location.id} location={location} />
      ))}
      {recents.length > 0 ? (
        <ClockCounterClockwiseIcon
          aria-label='Recent'
          className='text-muted-foreground mx-1 size-(--icon-size-sm) shrink-0'
          role='img'
        />
      ) : null}
      {recents.map((entry) => (
        <RecentPill currentPath={currentPath} entry={entry} key={entry.path} />
      ))}
    </div>
  )
}
