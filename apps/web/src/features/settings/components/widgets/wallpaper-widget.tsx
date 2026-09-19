import { useQuery } from '@tanstack/react-query'
import type { WallpaperSelection } from '@workspace/contracts'
import { useState } from 'react'
import { WallpaperTile } from '@/features/settings/components/widgets/wallpaper-tile'
import { WallpaperPickerDialog } from '@/features/settings/components/widgets/wallpaper-picker-dialog'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'

export function WallpaperWidget({
  disabled,
  value,
  onChange,
}: {
  readonly disabled: boolean
  readonly value: WallpaperSelection
  readonly onChange: (value: WallpaperSelection) => void
}) {
  const library = useQuery(wallpaperLibraryOptions(), useSettingsOwner())
  const [pickerOpen, setPickerOpen] = useState(false)
  const source = value.source
  return (
    <div className='flex w-full min-w-0 gap-2' role='group' aria-label='Wallpaper'>
      <WallpaperTile
        source={source}
        enabled={value.enabled}
        disabled={disabled}
        onToggle={() => onChange({ ...value, enabled: !value.enabled })}
        asset={
          source.kind === 'library'
            ? library.data?.assets.find((asset) => asset.id === source.asset)
            : undefined
        }
        onOpen={() => setPickerOpen(true)}
      />
      {pickerOpen ? (
        <WallpaperPickerDialog
          disabled={disabled}
          value={value}
          onChange={onChange}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}
