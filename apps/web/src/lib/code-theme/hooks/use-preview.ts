import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { useQuery } from '@tanstack/react-query'
import type { HighlightResult } from '@singapore-editor/highlighting'
import { codeThemePreviewQueryOptions } from '@/lib/code-theme/state/preview'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type PreviewState =
  | { readonly themeId: string; readonly kind: 'loading' }
  | { readonly themeId: string; readonly kind: 'ready'; readonly result: HighlightResult }
  | { readonly themeId: string; readonly kind: 'error' }

/** While `enabled` is false it starts no highlight; a preview already in the cache still shows. */
export function useCodeThemePreview(
  themeId: string,
  enabled = true,
): PreviewState & { readonly isFetching: boolean } {
  const next = useQuery({ ...codeThemePreviewQueryOptions(themeId), enabled }, resourceQueryClient)
  const shownId = useHeldUntilReady(themeId, !next.isPending)
  // The held observer reads the cache; only the selected subject starts a load.
  const shown = useQuery(
    { ...codeThemePreviewQueryOptions(shownId), enabled: false },
    resourceQueryClient,
  )
  const subject = { themeId: shownId, isFetching: next.isFetching }
  if (shown.isPending) return { kind: 'loading', ...subject }
  if (shown.isError) return { kind: 'error', ...subject }
  return { kind: 'ready', result: shown.data, ...subject }
}
