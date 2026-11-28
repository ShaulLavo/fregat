import { useState } from 'react'
import type { AssetId } from '@workspace/contracts'
import { cn } from '@workspace/ui/lib/utils'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'
import { wallpaperImageDecoded } from '@/lib/html-bootstrap'

export function LibraryWallpaper({
  asset,
  className,
}: {
  readonly asset: AssetId
  readonly className?: string
}) {
  const [readyAsset, setReadyAsset] = useState<AssetId | null>(() =>
    wallpaperImageDecoded(libraryImageUrl(asset, 'display')) ? asset : null,
  )
  const [attempt, setAttempt] = useState({ asset, thumbnailFailed: false, fullFailed: false })
  if (attempt.asset !== asset) {
    setAttempt({ asset, thumbnailFailed: false, fullFailed: false })
  }
  // Promote the decoded node itself; changing a painted image's src can clear it before paint.
  const assets = readyAsset === null || readyAsset === asset ? [asset] : [readyAsset, asset]
  const classes = cn(
    'pointer-events-none absolute inset-0 z-0 h-full w-full object-cover',
    className,
  )
  return (
    <>
      {(readyAsset === null || attempt.fullFailed) && !attempt.thumbnailFailed ? (
        <img
          crossOrigin='anonymous'
          alt=''
          aria-hidden='true'
          className={classes}
          data-workbench-wallpaper=''
          data-workbench-wallpaper-layer='thumbnail'
          src={libraryImageUrl(asset, 'thumbnail')}
          onError={() => setAttempt((current) => ({ ...current, thumbnailFailed: true }))}
        />
      ) : null}
      {assets.map((imageAsset) => {
        if (imageAsset === attempt.asset && attempt.fullFailed) return null
        const ready = imageAsset === readyAsset
        return (
          <img
            key={imageAsset}
            crossOrigin='anonymous'
            alt=''
            aria-hidden='true'
            className={cn(classes, !ready && 'opacity-0')}
            data-workbench-wallpaper={ready ? '' : undefined}
            data-workbench-wallpaper-layer={ready ? 'still' : 'pending-still'}
            src={libraryImageUrl(imageAsset, 'display')}
            decoding={ready ? 'sync' : 'async'}
            onError={() =>
              setAttempt((current) => {
                if (current.asset !== imageAsset) return current
                return { ...current, fullFailed: true }
              })
            }
            onLoad={(event) => {
              const image = event.currentTarget
              void image.decode().then(
                () => {
                  // Superseded images may finish decoding after their nodes have detached.
                  if (!image.isConnected) return
                  setReadyAsset(imageAsset)
                },
                () =>
                  setAttempt((current) => {
                    if (!image.isConnected || current.asset !== imageAsset) return current
                    return { ...current, fullFailed: true }
                  }),
              )
            }}
          />
        )
      })}
    </>
  )
}
