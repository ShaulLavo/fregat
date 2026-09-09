import { Elysia } from 'elysia'

import { observeRequestOperation } from '../observability'
import {
  readDesktopWallpaperInfo,
  readDesktopWallpaperMedia,
  readDesktopWallpaperStillMedia,
  type DesktopWallpaperInfo,
  type DesktopWallpaperMedia,
} from './service'
import { isWallpaperSourceUnavailableError } from './structured-errors'

const WALLPAPER_CACHE_CONTROL = 'public, max-age=60'

export type WallpaperService = {
  readDesktopWallpaperInfo(): Promise<DesktopWallpaperInfo | null>
  readDesktopWallpaperMedia(): Promise<DesktopWallpaperMedia | null>
  readDesktopWallpaperStillMedia(): Promise<DesktopWallpaperMedia | null>
}

const defaultWallpaperService: WallpaperService = {
  readDesktopWallpaperInfo,
  readDesktopWallpaperMedia,
  readDesktopWallpaperStillMedia,
}

// Unavailable desktop media returns 404 so the client uses its bundled wallpaper.
export function wallpaperRoutes(service: WallpaperService = defaultWallpaperService) {
  return new Elysia({ name: 'wallpaper-routes' })
    .get('/wallpaper/info', async ({ set }) => {
      const info = await observeRequestOperation(
        { area: 'wallpaper', operation: 'info' },
        () => readAvailableWallpaper(() => service.readDesktopWallpaperInfo()),
        summarizeWallpaperInfo,
      )
      if (!info) {
        set.status = 404
        return { error: { message: 'wallpaper unavailable' } }
      }

      return info
    })
    .get('/wallpaper/still', async ({ set }) => {
      const media = await observeRequestOperation(
        { area: 'wallpaper', operation: 'still' },
        () => readAvailableWallpaper(() => service.readDesktopWallpaperStillMedia()),
        summarizeWallpaperMedia,
      )
      if (!media) {
        set.status = 404
        return { error: { message: 'wallpaper still unavailable' } }
      }

      return wallpaperMediaResponse(media)
    })
    .get('/wallpaper', async ({ set }) => {
      const media = await observeRequestOperation(
        { area: 'wallpaper', operation: 'read' },
        () => readAvailableWallpaper(() => service.readDesktopWallpaperMedia()),
        summarizeWallpaperMedia,
      )
      if (!media) {
        set.status = 404
        return { error: { message: 'wallpaper unavailable' } }
      }

      return wallpaperMediaResponse(media)
    })
}

async function readAvailableWallpaper<T>(operation: () => Promise<T | null>): Promise<T | null> {
  try {
    return await operation()
  } catch (error) {
    if (isWallpaperSourceUnavailableError(error)) return null

    throw error
  }
}

function wallpaperMediaResponse(media: DesktopWallpaperMedia) {
  return new Response(media.buffer, {
    headers: {
      'cache-control': WALLPAPER_CACHE_CONTROL,
      'content-length': String(media.buffer.byteLength),
      'content-type': media.contentType,
    },
  })
}

function summarizeWallpaperMedia(media: DesktopWallpaperMedia | null): Record<string, unknown> {
  if (!media) return { available: false }

  return {
    available: true,
    byteLength: media.buffer.byteLength,
    contentType: media.contentType,
    kind: media.kind,
    source: media.source,
  }
}

function summarizeWallpaperInfo(info: DesktopWallpaperInfo | null): Record<string, unknown> {
  if (!info) return { available: false }

  return {
    available: true,
    contentType: info.contentType,
    kind: info.kind,
    source: info.source,
  }
}
