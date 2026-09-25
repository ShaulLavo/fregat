import type { ColorMode, Palette, ThemeBundle, ThemeVariant } from '@workspace/contracts'
import { Badge } from '@workspace/ui/components/badge'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'

import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { cardSwatches, cardWallpaper } from '@/features/theme-studio/utils/card'

/** A theme's identity, not a preview: the app behind the dock is the preview. */
export function ThemeCard({
  customized,
  mode,
  palette,
  rowProps,
  selected,
  theme,
  variant,
}: {
  customized: boolean
  mode: ColorMode
  palette: Palette | undefined
  rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  selected: boolean
  theme: ThemeBundle
  variant: ThemeVariant
}) {
  const wallpaper = cardWallpaper(variant)
  const swatches = cardSwatches(palette, mode)

  return (
    <ListRow
      {...rowProps}
      className='flex h-auto w-44 shrink-0 cursor-default flex-col gap-1.5 rounded-md p-1.5'
      role='option'
      selected={selected}
      title={theme.name}
    >
      <span className='bg-muted relative block h-20 w-full overflow-hidden rounded-md'>
        {wallpaper ? (
          <img
            alt=''
            className='size-full object-cover'
            crossOrigin='anonymous'
            decoding='async'
            src={libraryImageUrl(wallpaper, 'thumbnail')}
          />
        ) : null}
        <span className='absolute inset-x-1.5 bottom-1.5 flex gap-1'>
          {swatches.map((color, index) => (
            <span
              aria-hidden='true'
              className='size-3 rounded-md'
              key={index}
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
      </span>
      <span className='flex w-full min-w-0 items-center gap-1.5 text-xs'>
        <span className='min-w-0 flex-1 truncate'>{theme.name}</span>
        {customized ? <StatusDot aria-label='Changed from the theme' tone='info' /> : null}
        {theme.source === 'user' ? <Badge variant='secondary'>Yours</Badge> : null}
      </span>
    </ListRow>
  )
}
