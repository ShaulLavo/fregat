import type { HighlighterCore, TokensResult } from 'shiki/core'
import { queryOptions } from '@tanstack/react-query'
import { CODE_THEME_PREVIEW_SAMPLE } from '@/lib/code-theme/utils/preview'
import { codeThemeQueryKeys } from '@/lib/code-theme/utils/query-keys'
import { loadPreviewRegistration } from '@/lib/code-theme/state/preview-registration'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { log } from '@/lib/client-logging'

export function codeThemePreviewQueryOptions(themeId: string) {
  return queryOptions({
    queryKey: codeThemeQueryKeys.preview(themeId),
    queryFn: async () => {
      try {
        return await highlightPreview(themeId)
      } catch (error) {
        log.error({ action: 'code-theme.preview_failed', area: 'appearance', themeId, error })
        throw error
      }
    },
    staleTime: 'static',
    gcTime: Infinity,
    networkMode: 'always',
    structuralSharing: false,
    retry: false,
  })
}

export function loadCodeThemePreview(themeId: string): Promise<TokensResult> {
  return resourceQueryClient.query(codeThemePreviewQueryOptions(themeId))
}

async function highlightPreview(themeId: string): Promise<TokensResult> {
  const [engine, registration] = await Promise.all([
    resourceQueryClient.query({
      queryKey: codeThemeQueryKeys.previewHighlighter,
      queryFn: createPreviewHighlighter,
      staleTime: 'static',
      gcTime: Infinity,
      networkMode: 'always',
      structuralSharing: false,
      retry: false,
    }),
    loadPreviewRegistration(themeId),
  ])
  await engine.loadTheme(registration)
  return engine.codeToTokens(CODE_THEME_PREVIEW_SAMPLE, {
    lang: 'typescript',
    theme: themeId,
    tokenizeTimeLimit: 0,
  })
}

// Shiki loads with the first preview; a static import would put it in the entry chunk.
async function createPreviewHighlighter(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ])
  return createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: [import('@shikijs/langs/typescript')],
    themes: [],
  })
}
