import { useState } from 'react'
import type { AssetId } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'

export function LibraryWallpaper({
  asset,
  className,
}: {
  readonly asset: AssetId
  readonly className?: string
}) {
  const [ready, setReady] = useState(false)
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const [fullFailed, setFullFailed] = useState(false)
  const classes = cn(
    'pointer-events-none absolute inset-0 z-0 h-full w-full object-cover',
    className,
  )
  return (
    <>
      {!ready && !thumbnailFailed ? (
        <img
          crossOrigin='anonymous'
          alt=''
          aria-hidden='true'
          className={classes}
          data-workbench-wallpaper=''
          data-workbench-wallpaper-layer='thumbnail'
          src={libraryImageUrl(asset, 'thumbnail')}
          onError={() => setThumbnailFailed(true)}
        />
      ) : null}
      {!fullFailed ? (
        <img
          crossOrigin='anonymous'
          alt=''
          aria-hidden='true'
          className={cn(classes, !ready && 'opacity-0')}
          data-workbench-wallpaper={ready ? '' : undefined}
          data-workbench-wallpaper-layer={ready ? 'still' : 'pending-still'}
          src={libraryImageUrl(asset, 'display')}
          decoding='async'
          onError={() => setFullFailed(true)}
          onLoad={(event) => {
            const image = event.currentTarget
            void image.decode().then(
              () => setReady(true),
              () => setFullFailed(true),
            )
          }}
        />
      ) : null}
    </>
  )
}
