import type { QueryClient } from '@tanstack/react-query'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import {
  shikiGrammarsForCensus,
  treeSitterLanguagesForCensus,
} from '@/features/editor/utils/census-languages'
import { EDITOR_SHIKI_PRELOAD_LANGUAGES } from '@/features/editor/utils/shiki-languages'

type CensusSource = {
  readonly queryClient: QueryClient
  readonly root: () => string | null
}

// The shared Shiki provider outlives workspace and machine switches; the active editor runtime
// binds its source on resume.
let activeSource: CensusSource | null = null

export function bindLanguageCensus(source: CensusSource): () => void {
  activeSource = source
  return () => {
    if (activeSource === source) activeSource = null
  }
}

export function workspacePreloadLanguages(): readonly string[] {
  const counts = usableCensusCounts()
  return counts ? shikiGrammarsForCensus(counts) : EDITOR_SHIKI_PRELOAD_LANGUAGES
}

/** Tree-sitter warms nothing without a census: compiling every bundled grammar is the cost. */
export function workspaceWarmLanguages(): readonly string[] {
  const counts = usableCensusCounts()
  return counts ? treeSitterLanguagesForCensus(counts) : []
}

function usableCensusCounts() {
  const root = activeSource?.root()
  if (!activeSource || root === null || root === undefined) return null
  const census = activeSource.queryClient.getQueryData(languageCensusQueryOptions(root).queryKey)
  if (!census || (census.readiness !== 'ready' && census.readiness !== 'stale')) return null
  return census.counts
}
