import { cn } from '@workspace/ui/lib/utils'

import { FileTypeIcon } from '@/components/file-type-icon'
import { iconForEntry } from '@/lib/file-icons'
import type { SidebarLocation } from '@/features/file-picker/utils/sidebar-locations'

/** Root and Home keep their chrome glyphs; folders wear the file tree's folder. */
export function LocationIcon({
  location,
  selected,
}: {
  location: SidebarLocation
  selected: boolean
}) {
  if (!location.icon)
    return (
      <FileTypeIcon
        className='size-(--icon-size) shrink-0'
        icon={iconForEntry({ name: location.label, type: 'directory' }, { open: selected })}
      />
    )
  const Icon = location.icon

  return (
    <Icon
      className={cn(
        'size-(--icon-size) shrink-0',
        selected ? 'text-info' : 'text-muted-foreground',
      )}
      weight='duotone'
    />
  )
}
