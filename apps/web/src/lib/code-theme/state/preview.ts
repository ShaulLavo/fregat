import type { HighlightResult } from '@singapore-editor/highlighting'
import { queryOptions } from '@tanstack/react-query'
import { CODE_THEME_PREVIEW_SAMPLE } from '@/lib/code-theme/utils/preview'
import { codeThemeQueryKeys } from '@/lib/code-theme/utils/query-keys'
import { loadPreviewTheme } from '@/lib/code-theme/state/preview-registration'
import { highlightingService } from '@/lib/highlighting/state/service'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { log } from '@/lib/client-logging'

// Registrations are immutable for a build, so the theme id names one revision.
export function codeThemePreviewQueryOptions(themeId: string) {
  return queryOptions({
    queryKey: codeThemeQueryKeys.preview(themeId),
    queryFn: async ({ signal }) => {
      try {
        return await highlightingService().highlight(CODE_THEME_PREVIEW_SAMPLE, {
          language: 'typescript',
          theme: await loadPreviewTheme(themeId),
          signal,
        })
      } catch (error) {
        // A preview scrolled or hovered away is cancelled, not failed.
        if (!signal.aborted) {
          log.error({ action: 'code-theme.preview_failed', area: 'appearance', themeId, error })
        }
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

export function loadCodeThemePreview(themeId: string): Promise<HighlightResult> {
  return resourceQueryClient.query(codeThemePreviewQueryOptions(themeId))
}
