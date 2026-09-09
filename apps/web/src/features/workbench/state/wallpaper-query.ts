import { queryOptions } from '@tanstack/react-query'

import { wallpaperMediaKind, type WallpaperMediaKind } from '@/features/workbench/utils/wallpaper'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { clientInstanceId, instanceHeaderName } from '@/lib/instance-id'
import { primaryServerOrigin, serverEndpoint } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

function desktopWallpaperUrl(origin: string) {
  return `${origin.replace(/\/+$/u, '')}/wallpaper`
}
const WALLPAPER_QUERY_GC_TIME_MS = 5 * 60_000
const WALLPAPER_QUERY_STALE_TIME_MS = 60 * 60_000

const wallpaperQueryDefaults = {
  gcTime: WALLPAPER_QUERY_GC_TIME_MS,
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: WALLPAPER_QUERY_STALE_TIME_MS,
} as const

export const wallpaperQueryKeys = {
  all: ['wallpaper'] as const,
  info: () => [...wallpaperQueryKeys.all, 'info'] as const,
  media: () => [...wallpaperQueryKeys.all, 'media'] as const,
}

export function wallpaperInfoQueryOptions({ enabled }: { enabled: boolean }) {
  return queryOptions({
    ...wallpaperQueryDefaults,
    enabled,
    queryFn: ({ client }) => fetchWallpaperKind(originForQueryClient(client)),
    queryKey: wallpaperQueryKeys.info(),
  })
}

export function wallpaperMediaQueryOptions({ enabled }: { enabled: boolean }) {
  return queryOptions({
    ...wallpaperQueryDefaults,
    enabled,
    queryFn: ({ client }) => fetchWallpaperBlob(originForQueryClient(client)),
    queryKey: wallpaperQueryKeys.media(),
  })
}

export function wallpaperStillUrl(origin: string): string | null {
  const source = wallpaperSource(origin)
  return source ? `${desktopWallpaperUrl(source)}/still` : null
}

export function wallpaperPreloadState(source: string): 'pending' | 'ready' | 'error' {
  if (typeof document === 'undefined') return 'pending'
  const href = new URL(source, document.baseURI).href
  for (const link of document.head.querySelectorAll<HTMLLinkElement>(
    'link[data-workbench-wallpaper-preload]',
  )) {
    if (link.href !== href) continue
    const status = link.dataset.workbenchWallpaperPreload
    if (status === 'ready' || status === 'error') return status
  }
  return 'pending'
}

async function fetchWallpaperKind(origin: string): Promise<WallpaperMediaKind> {
  const source = wallpaperSource(origin)
  if (!source) return 'image'
  const response = await fetchWallpaper(`${desktopWallpaperUrl(source)}/info`)
  if (!response.ok) return 'image'

  const info = (await response.json()) as { contentType?: string }
  return wallpaperMediaKind(info.contentType ?? null)
}

async function fetchWallpaperBlob(origin: string): Promise<Blob | null> {
  const source = wallpaperSource(origin)
  if (!source) return null
  const response = await fetchWallpaper(desktopWallpaperUrl(source))
  if (!response.ok) return null

  return response.blob()
}

function wallpaperSource(origin: string) {
  const primary = primaryServerOrigin()
  if (origin === primary) return serverEndpoint(primary)
  const entries = useEnvironmentsStore.getState().entries
  const primaryId = entries[primary]?.environmentId
  if (!primaryId || entries[origin]?.environmentId !== primaryId) return null
  return serverEndpoint(primary)
}

function fetchWallpaper(url: string): Promise<Response> {
  // StrictMode temporarily drops every observer. Cancelling here would turn one
  // shared mount fetch back into an aborted request followed by a duplicate.
  return fetch(url, { headers: { [instanceHeaderName]: clientInstanceId() } })
}
