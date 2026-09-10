import { createHighlighterCore, type HighlighterCore, type TokensResult } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

import { CODE_THEME_PREVIEW_SAMPLE } from '@/lib/code-theme/utils/preview'
import { loadPreviewRegistration } from '@/lib/code-theme/utils/preview-registration'
import { log } from '@/lib/client-logging'

let highlighter: Promise<HighlighterCore> | undefined
const previews = new Map<string, Promise<TokensResult>>()

export function loadCodeThemePreview(themeId: string): Promise<TokensResult> {
  const cached = previews.get(themeId)
  if (cached) return cached

  const preview = highlightPreview(themeId).catch((error: unknown) => {
    previews.delete(themeId)
    log.error({ action: 'code-theme.preview_failed', area: 'appearance', themeId, error })
    throw error
  })
  previews.set(themeId, preview)
  return preview
}

async function highlightPreview(themeId: string): Promise<TokensResult> {
  const [engine, registration] = await Promise.all([
    previewHighlighter(),
    loadPreviewRegistration(themeId),
  ])
  await engine.loadTheme(registration)
  return engine.codeToTokens(CODE_THEME_PREVIEW_SAMPLE, { lang: 'typescript', theme: themeId })
}

function previewHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: [import('@shikijs/langs/typescript')],
    themes: [],
  }).catch((error: unknown) => {
    highlighter = undefined
    throw error
  })
  return highlighter
}
