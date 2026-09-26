import { Separator } from '@workspace/ui/components/separator'

import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { LocationButton } from '@/features/file-picker/components/location-button'
import { RecentSidebarSection } from '@/features/file-picker/components/recent-sidebar-section'
import type { SidebarSection } from '@/features/file-picker/utils/sidebar-locations'

export function PlacesSidebar({
  currentPath,
  recentState,
  sections,
}: {
  currentPath: string
  recentState: EntriesLoadState
  sections: readonly SidebarSection[]
}) {
  return (
    <aside className='bg-muted/25 h-full min-h-0 overflow-y-auto p-(--density-section-gap)'>
      {sections.map((section) => (
        <section aria-label={section.label} className='mb-(--density-section-gap)' key={section.id}>
          <div className='text-muted-foreground section-label mb-1 px-(--density-row-padding-x) py-1'>
            {section.label}
          </div>
          <div className='space-y-0.5'>
            {section.locations.map((location) => (
              <LocationButton currentPath={currentPath} key={location.id} location={location} />
            ))}
          </div>
        </section>
      ))}
      <Separator className='my-(--density-section-gap)' />
      <RecentSidebarSection currentPath={currentPath} state={recentState} />
    </aside>
  )
}
