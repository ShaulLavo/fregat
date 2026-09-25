import { DotsThreeIcon, TrashIcon } from '@phosphor-icons/react'
import type { WallpaperAsset } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { WallpaperChoice } from '@/features/theme-studio/components/wallpaper-choice'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { wallpaperDisplayName, wallpaperTitle } from '@/lib/wallpapers/utils/groups'

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
  // Absent on imported assets: the next import restores them, so delete would be a lie.
  readonly onDelete?: () => void
}) {
  const name = wallpaperDisplayName(asset)
  return (
    <div className='group/wallpaper relative min-w-0'>
      <WallpaperChoice
        label={name}
        title={wallpaperTitle(asset)}
        ariaLabel={`Select ${asset.name}`}
        selected={selected}
        disabled={disabled}
        onSelect={onSelect}
      >
        <img
          crossOrigin='anonymous'
          src={libraryImageUrl(asset.id, 'thumbnail')}
          alt=''
          className='bg-muted aspect-video w-full rounded-md object-cover'
          loading='lazy'
        />
      </WallpaperChoice>
      {onDelete ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      size='icon-sm'
                      variant='secondary'
                      className='absolute top-2 left-2 opacity-0 group-focus-within/wallpaper:opacity-100 group-hover/wallpaper:opacity-100 aria-expanded:opacity-100'
                      aria-label={`Actions for ${asset.name}`}
                      disabled={disabled || deleting}
                      focusableWhenDisabled
                    />
                  }
                />
              }
            >
              {deleting ? <Spinner /> : <DotsThreeIcon weight='bold' />}
            </TooltipTrigger>
            <TooltipContent>Actions for {asset.name}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align='start'>
            <DropdownMenuItem variant='destructive' onClick={onDelete}>
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
