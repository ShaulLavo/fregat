/**
 * A workspace image served from `/fs/blob` loads as a CORS request, which carries the Origin the
 * server authenticates by; a plain image request carries none and is refused.
 */
export function fsBlobCrossOrigin(source: string) {
  const url = URL.parse(source)
  return url?.pathname.endsWith('/fs/blob') && url.searchParams.has('path')
    ? 'anonymous'
    : undefined
}
