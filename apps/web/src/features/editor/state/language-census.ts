import type { QueryClient } from '@tanstack/react-query'
import { languageCensusQueryOptions } from '@/features/editor/utils/language-census-query'
import {
  shikiGrammarsForCensus,
  treeSitterLanguagesForCensus,
} from '@/features/editor/utils/census-languages'
import type { HighlightingLanguage } from '@singapore-editor/highlighting'
import { bindHighlightingLanguages } from '@/lib/highlighting/state/service'

type CensusSource = {
  readonly queryClient: QueryClient
  readonly root: () => string | null
}

// The shared Shiki provider outlives workspace and machine switches; the active editor runtime
// binds its source on resume.
let activeSource: CensusSource | null = null

export function bindLanguageCensus(source: CensusSource): () => void {
  activeSource = source
  const unbindHighlighting = bindHighlightingLanguages(workspaceHighlightingLanguages)
  return () => {
    unbindHighlighting()
    if (activeSource === source) activeSource = null
  }
}

/** Null until a census is usable: the highlighting service then prepares its default grammars. */
export function workspacePreloadLanguages(): readonly string[] | null {
  const counts = usableCensusCounts()
  return counts ? shikiGrammarsForCensus(counts) : null
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

function workspaceHighlightingLanguages(): readonly HighlightingLanguage[] | null {
  const grammars = workspacePreloadLanguages()
  if (!grammars) return null
  const ids = new Set(grammars.concat(workspaceWarmLanguages()))
  return Array.from(ids, (languageId) => ({ languageId }))
}
