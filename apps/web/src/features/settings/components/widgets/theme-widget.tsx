import { Button } from '@workspace/ui/components/button'

import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import { themeWallpapers } from '@/features/settings/utils/theme-summary'

/**
 * The theme in one row: its name, both halves' wallpapers, and the way into the studio, which
 * previews edits to the rows below on the live app before applying them.
 */
export function ThemeWidget({ disabled }: { disabled: boolean }) {
  const { bundleId, catalog } = useBundles()
  const bus = useCommandBus()
  const theme = catalog.find((entry) => entry.id === bundleId)

  return (
    <div className='flex w-full min-w-0 items-center gap-(--density-control-gap)'>
      <span className='min-w-0 flex-1 truncate text-sm' title={theme?.name ?? 'Default colors'}>
        {theme?.name ?? 'Default colors'}
      </span>
      {theme
        ? themeWallpapers(theme).map(({ asset, mode }) => (
            <img
              alt={`${mode === 'light' ? 'Light' : 'Dark'} wallpaper`}
              className='h-8 w-14 shrink-0 rounded-md object-cover'
              crossOrigin='anonymous'
              decoding='async'
              key={mode}
              src={libraryImageUrl(asset, 'thumbnail')}
            />
          ))
        : null}
      <Button
        disabled={disabled}
        size='sm'
        variant='outline'
        onClick={() =>
          bus.dispatch('workspace.openThemeStudio', {
            source: { kind: 'programmatic', caller: 'settings.theme-row' },
          })
        }
      >
        Open studio
      </Button>
    </div>
  )
}
