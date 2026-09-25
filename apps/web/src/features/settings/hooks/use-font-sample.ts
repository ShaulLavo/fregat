import { useQuery } from '@tanstack/react-query'
import { fontFamilyName, parseFontRef } from '@workspace/contracts'

import { fontSampleQueryOptions } from '@/features/settings/state/font-samples'

/**
 * The family to draw `text` in for `ref`. Bundled fonts need no sample. An installed font is
 * sampled from the server's copy, so a device without it still sees its face, and falls back to
 * the local family when the server has none.
 */
export function useFontSample(ref: string, text: string, serverSample = true) {
  const parsed = parseFontRef(ref)
  const fetched = serverSample && parsed !== null && parsed.source !== 'bundled'
  const sample = useQuery({ ...fontSampleQueryOptions(ref, text), enabled: fetched })
  if (!parsed) return { family: null, pending: false }

  const fallback = parsed.source === 'local' || !fetched ? fontFamilyName(parsed) : null
  return { family: sample.data ?? fallback, pending: sample.isPending && fetched }
}
