import { WallpaperChoice } from '@/features/settings/components/widgets/wallpaper-choice'
import type { ReactNode } from 'react'

export function WallpaperSourceCard({
  label,
  description,
  icon,
  selected,
  disabled,
  onSelect,
}: {
  readonly label: string
  readonly description: string
  readonly icon: ReactNode
  readonly selected: boolean
  readonly disabled: boolean
  readonly onSelect: () => void
}) {
  return (
    <WallpaperChoice
      label={label}
      title={description}
      ariaLabel={label}
      selected={selected}
      disabled={disabled}
      onSelect={onSelect}
    >
      <span className='bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center rounded-md [&_svg]:size-6'>
        {icon}
      </span>
    </WallpaperChoice>
  )
}
