import { DesktopIcon, ProhibitIcon } from '@phosphor-icons/react'
import type { WallpaperAsset, WallpaperSource } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { wallpaperDisplayName } from '@/lib/wallpapers/utils/groups'

function sourceName(source: WallpaperSource, asset: WallpaperAsset | undefined) {
  if (source.kind === 'none') return 'None'
  if (source.kind === 'desktop') return 'Desktop'
  return asset ? wallpaperDisplayName(asset) : 'Library image'
}

export function WallpaperModeTile({
  label,
  source,
  asset,
  onOpen,
}: {
  readonly label: string
  readonly source: WallpaperSource
  readonly asset: WallpaperAsset | undefined
  readonly onOpen: () => void
}) {
  const name = sourceName(source, asset)
  return (
    <Button
      variant='outline'
      className='h-auto min-w-0 flex-1 flex-col items-stretch gap-1 p-1'
      aria-label={`Choose ${label.toLowerCase()} wallpaper`}
      title={`${label} · ${asset?.name ?? name}`}
      onClick={onOpen}
    >
      {source.kind === 'library' ? (
        <img
          crossOrigin='anonymous'
          src={libraryImageUrl(source.asset, 'thumbnail')}
          alt=''
          className='bg-muted aspect-video w-full rounded-md object-cover'
        />
      ) : (
        <span className='bg-muted text-muted-foreground flex aspect-video w-full items-center justify-center rounded-md [&_svg]:size-5'>
          {source.kind === 'none' ? (
            <ProhibitIcon aria-hidden='true' />
          ) : (
            <DesktopIcon aria-hidden='true' />
          )}
        </span>
      )}
      <span className='flex min-w-0 items-baseline gap-2 px-1 text-xs'>
        <span className='font-medium'>{label}</span>
        <span className='text-muted-foreground truncate'>{name}</span>
      </span>
    </Button>
  )
}
