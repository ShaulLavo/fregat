import { queryOptions } from '@tanstack/react-query'

import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { fontServerUrl } from '@/lib/fonts/utils/url'

/**
 * A picker row drawn in the font it names, from a woff2 the server subsets to just the row's
 * text: forty rows cost forty files of a few KB, not forty families. Registered under its own
 * family so it can never stand in for the real face the app loads.
 */
export function fontSampleQueryOptions(ref: string, text: string) {
  return queryOptions({
    queryKey: settingsQueryKeys.fontSample(ref, text),
    queryFn: () => registerSample(ref, text),
    staleTime: 'static',
    gcTime: Infinity,
    retry: false,
  })
}

async function registerSample(ref: string, text: string) {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return null

  const url = fontServerUrl('fonts/preview')
  url.searchParams.set('ref', ref)
  url.searchParams.set('text', text)
  // One family per text: each subset holds only its own glyphs.
  const family = `${ref} sample ${text}`
  const face = await new FontFace(family, `url(${JSON.stringify(url.href)})`).load()
  document.fonts.add(face)
  return family
}
