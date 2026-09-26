import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { useQuery } from '@tanstack/react-query'
import type { TokensResult } from 'shiki/core'
import { codeThemePreviewQueryOptions } from '@/lib/code-theme/state/preview'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type PreviewState =
  | { readonly themeId: string; readonly kind: 'loading' }
  | { readonly themeId: string; readonly kind: 'ready'; readonly result: TokensResult }
  | { readonly themeId: string; readonly kind: 'error' }

export function useCodeThemePreview(
  themeId: string,
): PreviewState & { readonly isFetching: boolean } {
  const next = useQuery(codeThemePreviewQueryOptions(themeId), resourceQueryClient)
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
