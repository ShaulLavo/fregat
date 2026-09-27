import { mutationOptions } from '@tanstack/react-query'
import {
  editorSyntaxHighlightingSource,
  editorTreeSitterSyntaxProvider,
} from '@/features/editor/state/syntax-highlighting'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'

// Tree-sitter serves folds, brackets and markdown preview under every theme, Shiki's included.
export function treeSitterWarmUpMutationOptions() {
  return mutationOptions({
    mutationKey: editorMutationKeys.treeSitterWarmUp(),
    scope: { id: 'editor.tree-sitter-warm-up' },
    mutationFn: async (languageIds: readonly string[]) => {
      if (editorSyntaxHighlightingSource() === 'disabled') return
      await editorTreeSitterSyntaxProvider().warmLanguages(languageIds)
    },
    retry: false,
  })
}
