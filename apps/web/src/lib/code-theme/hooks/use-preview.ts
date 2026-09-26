import { useQuery } from '@tanstack/react-query'
import type { TokensResult } from 'shiki/core'
import { codeThemePreviewQueryOptions } from '@/lib/code-theme/state/preview'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type PreviewState =
  | { readonly themeId: string; readonly kind: 'loading' }
  | { readonly themeId: string; readonly kind: 'ready'; readonly result: TokensResult }
  | { readonly themeId: string; readonly kind: 'error' }

export function useCodeThemePreview(themeId: string): PreviewState {
  const query = useQuery(codeThemePreviewQueryOptions(themeId), resourceQueryClient)
  if (query.isPending) return { kind: 'loading', themeId }
  if (query.isError) return { kind: 'error', themeId }
  return { kind: 'ready', result: query.data, themeId }
}
