import { LocationButton } from '@/features/file-picker/components/location-button'
import type { SidebarSection } from '@/features/file-picker/utils/sidebar-locations'

/** One labelled group of places, as the sidebar and the phone's Places sheet list them. */
export function LocationSection({
  currentPath,
  section,
}: {
  currentPath: string
  section: SidebarSection
}) {
  return (
    <section aria-label={section.label} className='mb-(--density-section-gap)'>
      <div className='text-muted-foreground section-label mb-1 px-(--density-row-padding-x) py-1'>
        {section.label}
      </div>
      {section.id === 'projects' ? (
        <p className='text-muted-foreground text-2xs mb-1 px-(--density-row-padding-x)'>
          Folders containing projects, found from folders you open.
        </p>
      ) : null}
      <div className='space-y-0.5'>
        {section.locations.map((location) => (
          <LocationButton currentPath={currentPath} key={location.id} location={location} />
        ))}
      </div>
    </section>
  )
}
