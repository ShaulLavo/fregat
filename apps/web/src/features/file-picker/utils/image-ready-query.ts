import { queryOptions } from '@tanstack/react-query'

import { filePickerKeys } from '@/lib/query-keys'

/**
 * Whether the browser has decoded the image, so the thumbnail mounts complete. A failed decode is
 * ready too: the thumbnail shows its fallback at once.
 */
export function imageReadyQueryOptions(src: string) {
  return queryOptions({
    queryKey: filePickerKeys.imageReady(src),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => decodeImage(src),
  })
}

function decodeImage(src: string) {
  const image = new Image()
  // Matches FileThumbnail's CORS mode, so both requests share one cache entry.
  image.crossOrigin = 'anonymous'
  image.src = src
  return image.decode().then(
    () => true,
    () => false,
  )
}
