import { useQuery } from '@tanstack/react-query'
import { fontFamilyName, parseFontRef } from '@workspace/contracts'

import { fontSampleQueryOptions } from '@/features/settings/state/font-samples'

/** The family to draw `text` in for `ref`; bundled and installed fonts need no sample. */
export function useFontSample(ref: string, text: string) {
  const parsed = parseFontRef(ref)
  const fetched = parsed?.source === 'nerd' || parsed?.source === 'fontsource'
  const sample = useQuery({ ...fontSampleQueryOptions(ref, text), enabled: fetched })
  if (parsed && !fetched) return { family: fontFamilyName(parsed), pending: false }

  return { family: sample.data ?? null, pending: sample.isPending && fetched }
}
