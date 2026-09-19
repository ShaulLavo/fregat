import { useQuery } from '@tanstack/react-query'
import type { WallpaperSelection } from '@workspace/contracts'
import { useState } from 'react'
import { WallpaperModeTile } from '@/features/settings/components/widgets/wallpaper-mode-tile'
import {
  WallpaperPickerDialog,
  type WallpaperMode,
} from '@/features/settings/components/widgets/wallpaper-picker-dialog'
import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'

const TILES = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
] as const

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
  const [pickerMode, setPickerMode] = useState<WallpaperMode | null>(null)
  return (
    <div className='flex w-full min-w-0 gap-2' role='group' aria-label='Wallpaper'>
      {TILES.map(({ mode, label }) => {
        const source = value[mode]
        return (
          <WallpaperModeTile
            key={mode}
            label={label}
            source={source}
            asset={
              source.kind === 'library'
                ? library.data?.assets.find((asset) => asset.id === source.asset)
                : undefined
            }
            onOpen={() => setPickerMode(mode)}
          />
        )
      })}
      {pickerMode ? (
        <WallpaperPickerDialog
          initialMode={pickerMode}
          disabled={disabled}
          value={value}
          onChange={onChange}
          onClose={() => setPickerMode(null)}
        />
      ) : null}
    </div>
  )
}
