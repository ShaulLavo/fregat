import { paletteColorsFor, type ColorMode, type WallpaperSelection } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'

import { WallpaperLibrary } from '@/lib/appearance/components/wallpaper-library'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { selectWallpaper } from '@/lib/wallpapers/utils/selection'

/** Matches sorts against the app colors on screen. */
export function WallpaperWidget({
  disabled,
  labelledBy,
  mode,
  value,
  onChange,
}: {
  disabled: boolean
  labelledBy: string
  mode: ColorMode
  value: WallpaperSelection
  onChange: (next: WallpaperSelection) => void
}) {
  const { catalog, paletteId } = usePalette()
  const palette = catalog.find((entry) => entry.id === paletteId)

  return (
    <div
      aria-labelledby={labelledBy}
      className={cn('h-96 w-full min-w-0', disabled && 'opacity-50')}
      inert={disabled}
      role='group'
    >
      <WallpaperLibrary
        colors={palette ? paletteColorsFor(palette, mode) : null}
        value={value}
        onChange={(source) => onChange(selectWallpaper(value, source))}
      />
    </div>
  )
}
