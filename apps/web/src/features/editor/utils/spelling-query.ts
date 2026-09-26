import type { EditorSpellcheckFeature, SpellIssue } from '@singapore-editor/spellcheck'

import { editorQueryKeys } from '@/features/editor/utils/query-keys'

const SUGGESTION_LIMIT = 5

/** Suggestions depend on the word alone, so a second right-click on it answers from the cache. */
export function spellingSuggestionsQueryOptions(
  spelling: EditorSpellcheckFeature | null,
  issue: SpellIssue | null,
) {
  return {
    enabled: spelling !== null && issue !== null,
    queryFn: () => {
      if (!spelling || !issue) return []
      return spelling.suggestions(issue.start, SUGGESTION_LIMIT)
    },
    queryKey: editorQueryKeys.spellingSuggestions(issue?.word ?? ''),
    staleTime: Number.POSITIVE_INFINITY,
  }
}
