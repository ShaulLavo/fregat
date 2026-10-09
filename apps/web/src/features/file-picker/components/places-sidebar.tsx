import { Separator } from '@workspace/ui/components/separator'

import type { EntriesLoadState } from '@/features/file-picker/utils/model'

import { LocationSection } from '@/features/file-picker/components/location-section'
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
        <LocationSection currentPath={currentPath} key={section.id} section={section} />
      ))}
      <Separator className='my-(--density-section-gap)' />
      <RecentSidebarSection currentPath={currentPath} state={recentState} />
    </aside>
  )
}
