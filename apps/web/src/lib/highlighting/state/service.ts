import {
  createHighlightingService,
  type HighlightingLanguage,
  type HighlightingService,
} from '@singapore-editor/highlighting'
import { themeRegistrationQueryOptions } from '@/lib/code-theme/state/registration-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

type LanguageSource = () => readonly HighlightingLanguage[] | null

// The editor runtime pushes its workspace census here; previews and fences never set one.
let languageSource: LanguageSource | null = null
let service: HighlightingService | null = null

/** The one highlighting service for editors, diffs, theme previews and rendered code. */
export function highlightingService(): HighlightingService {
  service ??= createHighlightingService({
    preloadLanguages: () => languageSource?.() ?? null,
    resolveTheme: async (id) =>
      (await resourceQueryClient.query(themeRegistrationQueryOptions(id))).registration,
  })
  return service
}

export function bindHighlightingLanguages(source: LanguageSource): () => void {
  languageSource = source
  return () => {
    if (languageSource === source) languageSource = null
  }
}

/** Stops the workers; the next caller starts a fresh service. */
export async function disposeHighlightingService(): Promise<void> {
  const current = service
  service = null
  await current?.dispose()
}

if (import.meta.hot) import.meta.hot.dispose(() => void disposeHighlightingService())
