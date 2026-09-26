import type { Editor } from '@singapore-editor/core/editor'
import { EDITOR_SPELLCHECK_FEATURE } from '@singapore-editor/spellcheck'
import { useQuery } from '@tanstack/react-query'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { spellingMenuSection } from '@/features/editor/utils/spelling-menu'
import { spellingSuggestionsQueryOptions } from '@/features/editor/utils/spelling-query'
import { editorTextMenu } from '@/features/editor/utils/text-menu'

/**
 * Every item but the spelling section is a registered command, so `useResolvedMenu` supplies the
 * dispatch and the availability rule. Spelling acts on the word at `offset`: where the pointer was,
 * or the caret when the menu opened from the keyboard.
 */
export function useEditorTextMenu(editor: Editor | null, offset: number | null) {
  const spelling = editor?.getFeature(EDITOR_SPELLCHECK_FEATURE) ?? null
  const issue = spelling && offset !== null ? spelling.issueAt(offset) : null
  const suggestions = useQuery(spellingSuggestionsQueryOptions(spelling, issue))
  const hasWorkspace = useEditorWorkspaceState((state) => state.rootFolder !== null)
  const { setSpellingWord } = useSettingsActions()

  if (!spelling || !issue) return editorTextMenu()
  return editorTextMenu(
    spellingMenuSection({
      word: issue.word,
      suggestions: suggestions.data ?? null,
      hasWorkspace,
      replace: (word) => spelling.replace(issue.start, word),
      accept: (target) => setSpellingWord(issue.word, true, target),
    }),
  )
}
