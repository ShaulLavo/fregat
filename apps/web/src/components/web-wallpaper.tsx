import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { cn } from '@workspace/ui/lib/utils'
import { originForQueryClient } from '@/lib/environments/state/query-clients'

import { useMediaBlobUrl } from '@/features/workbench/hooks/use-media-blob-url'
import { useWallpaperPlayback } from '@/features/workbench/hooks/use-wallpaper-playback'
import { prefersReducedMotion, WALLPAPER_URL } from '@/features/workbench/utils/wallpaper'
import {
  wallpaperInfoQueryOptions,
  wallpaperMediaQueryOptions,
  wallpaperPreloadState,
  wallpaperStillUrl,
} from '@/features/workbench/state/wallpaper-query'

const wallpaperClassName = 'pointer-events-none absolute inset-0 z-0 h-full w-full object-cover'

// Browser-only wallpaper: a page in a tab has nothing behind it, so the backdrop
// has to be drawn here. The still image carries the look; the video is the
// optional animated upgrade and is the expensive half, so it stays gated.
export function WebWallpaper({ className }: { readonly className?: string }) {
  const queryClient = useQueryClient()
  const desktopSource = wallpaperStillUrl(originForQueryClient(queryClient))
  const motionAllowed = !prefersReducedMotion()
  const info = useQuery(wallpaperInfoQueryOptions({ enabled: motionAllowed }))
  const videoMedia = useQuery(
    wallpaperMediaQueryOptions({ enabled: motionAllowed && info.data === 'video' }),
  )
  const [failedStillSource, setFailedStillSource] = useState<string | null>(null)
  const [loadedStillSource, setLoadedStillSource] = useState<string | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const showVideo = !videoFailed && Boolean(videoMedia.data)
  const preload = desktopSource ? wallpaperPreloadState(desktopSource) : 'pending'
  const desktopReady = loadedStillSource === desktopSource || preload === 'ready'
  const desktopFailed = failedStillSource === desktopSource || preload === 'error'
  const stillSources = desktopSource && desktopReady && !desktopFailed ? [] : [WALLPAPER_URL]
  if (desktopSource && !desktopFailed) stillSources.push(desktopSource)

  useMediaBlobUrl(videoFailed ? null : videoMedia.data, videoRef)
  useWallpaperPlayback(videoRef)

  return (
    <>
      {stillSources.map((source) => {
        const visible = source === WALLPAPER_URL || desktopReady
        return (
          <img
            alt=''
            aria-hidden='true'
            className={cn(wallpaperClassName, !visible && 'opacity-0', className)}
            crossOrigin='anonymous'
            data-workbench-wallpaper={!showVideo && visible ? '' : undefined}
            data-workbench-wallpaper-layer={visible ? 'still' : 'pending-still'}
            decoding='sync'
            fetchPriority='high'
            key={source}
            onError={() => {
              if (source === desktopSource) setFailedStillSource(source)
            }}
            onLoad={() => {
              if (source === desktopSource) setLoadedStillSource(source)
            }}
            src={source}
          />
        )
      })}
      {showVideo ? (
        <video
          aria-hidden='true'
          autoPlay
          className={cn(wallpaperClassName, videoReady ? 'opacity-100' : 'opacity-0', className)}
          crossOrigin='anonymous'
          data-workbench-wallpaper=''
          data-workbench-wallpaper-layer='video'
          loop
          muted
          onError={() => setVideoFailed(true)}
          onLoadedData={() => setVideoReady(true)}
          playsInline
          preload='auto'
          ref={videoRef}
        />
      ) : null}
    </>
  )
}
