import type { WallpaperAsset } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'

export function WallpaperCard({
  asset,
  selected,
  disabled,
  deleting,
  onSelect,
  onDelete,
}: {
  readonly asset: WallpaperAsset
  readonly selected: boolean
  readonly disabled: boolean
  readonly deleting: boolean
  readonly onSelect: () => void
  readonly onDelete: () => void
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <Button
        variant='outline'
        className='aria-pressed:bg-accent h-auto flex-col overflow-hidden p-1'
        aria-label={`Select ${asset.name}`}
        aria-pressed={selected}
        title={asset.name}
        disabled={disabled}
        onClick={onSelect}
      >
        <img
          crossOrigin='anonymous'
          src={libraryImageUrl(asset.id, 'thumbnail')}
          alt=''
          className='aspect-video w-full rounded-md object-cover'
          loading='lazy'
        />
        <span className='w-full truncate text-xs'>{asset.name}</span>
        <span className='text-muted-foreground text-2xs tabular-nums'>
          {asset.width} × {asset.height}
        </span>
      </Button>
      <Button
        size='sm'
        variant='ghost'
        disabled={disabled || deleting}
        aria-label={`Delete ${asset.name}`}
        onClick={onDelete}
      >
        {deleting ? <Spinner /> : null}Delete
      </Button>
    </div>
  )
}
