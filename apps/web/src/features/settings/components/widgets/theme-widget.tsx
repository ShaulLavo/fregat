import { Button } from '@workspace/ui/components/button'

import { useSettingValue } from '@/hooks/use-setting-value'
import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { visibleWallpaper } from '@/lib/wallpapers/utils/selection'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'

/**
 * The theme in one row: its name, the wallpaper on screen, and the way into the studio, which
 * previews edits to the rows below on the live app before applying them.
 */
export function ThemeWidget({ disabled }: { disabled: boolean }) {
  const { theme } = useBundles()
  const bus = useCommandBus()
  // The resolved value: the shown mode's half with this theme's saved changes over it.
  const wallpaper = visibleWallpaper(useSettingValue('workbench.wallpaper'))

  return (
    <div className='flex w-full min-w-0 items-center gap-(--density-control-gap)'>
      <span className='min-w-0 flex-1 truncate text-sm' title={theme?.name ?? 'Default colors'}>
        {theme?.name ?? 'Default colors'}
      </span>
      {wallpaper.kind === 'library' ? (
        <img
          alt='Wallpaper'
          className='h-8 w-14 shrink-0 rounded-md object-cover'
          crossOrigin='anonymous'
          decoding='async'
          key={wallpaper.asset}
          src={libraryImageUrl(wallpaper.asset, 'thumbnail')}
        />
      ) : null}
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
