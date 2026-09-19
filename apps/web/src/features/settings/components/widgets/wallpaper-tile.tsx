import { DesktopIcon } from '@phosphor-icons/react'
import type { WallpaperAsset, WallpaperSelection } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Switch } from '@workspace/ui/components/switch'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { wallpaperDisplayName } from '@/lib/wallpapers/utils/groups'

export function WallpaperTile({
  source,
  asset,
  enabled,
  disabled,
  onOpen,
  onToggle,
}: {
  readonly source: WallpaperSelection['source']
  readonly asset: WallpaperAsset | undefined
  readonly enabled: boolean
  readonly disabled: boolean
  readonly onOpen: () => void
  readonly onToggle: () => void
}) {
  let name = 'Desktop'
  if (source.kind === 'library') name = asset ? wallpaperDisplayName(asset) : 'Library image'
  return (
    <div className='flex w-full min-w-0 items-center gap-3'>
      <Button
        variant='outline'
        disabled={disabled}
        className='h-auto min-w-0 flex-1 justify-start gap-3 p-1'
        aria-label='Choose wallpaper'
        title={asset?.name ?? name}
        onClick={onOpen}
      >
        {source.kind === 'library' ? (
          <img
            crossOrigin='anonymous'
            src={libraryImageUrl(source.asset, 'thumbnail')}
            alt=''
            className='bg-muted aspect-video w-24 rounded-md object-cover'
          />
        ) : (
          <span className='bg-muted text-muted-foreground flex aspect-video w-24 items-center justify-center rounded-md'>
            <DesktopIcon aria-hidden='true' />
          </span>
        )}
        <span className='min-w-0 truncate text-xs'>{name}</span>
      </Button>
      <Switch
        aria-label='Show wallpaper'
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </div>
  )
}
