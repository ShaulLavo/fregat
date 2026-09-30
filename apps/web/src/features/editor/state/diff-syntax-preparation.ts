import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import type { GitFileDiff } from '@workspace/contracts'
import { editorDiffFiles, renderableDiffFile } from '@workspace/client-core/git/diff-files'
import { editorSyntaxColors, editorSyntaxTheme } from '@/features/editor/state/syntax-highlighting'
import { highlightingService } from '@/lib/highlighting/state/service'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { languageIdForFilePath } from '@/lib/file-language'
import { hasPrefetchMutationRoom } from '@/lib/intent-prefetch/state/scheduler'
import { runMutation } from '@/lib/mutations/run'

/** The `text` hunk source is what a git snapshot diff view builds its file from. */
export function prepareDiffSyntaxForDiffs(
  queryClient: QueryClient,
  diffs: readonly GitFileDiff[],
): Promise<number> {
  const theme = editorSyntaxTheme(editorSyntaxColors())
  if (!theme) return Promise.resolve(0)
  const file = renderableDiffFile(editorDiffFiles(diffs, languageIdForFilePath))
  const service = highlightingService()
  if (!file || file.isPartial || !service.canPrepareDiff(file, theme)) return Promise.resolve(0)
  if (
    !hasPrefetchMutationRoom(queryClient, { mutationKey: editorMutationKeys.diffSyntaxPrepare() })
  )
    return Promise.resolve(0)

  return runMutation(
    queryClient,
    mutationOptions({
      mutationKey: editorMutationKeys.diffSyntaxPrepare(),
      // One parse at a time: the syntax workers also serve the files on screen.
      scope: { id: 'editor.diff-syntax-prepare' },
      // The service rechecks when the scope lets it run: the view may have opened, or kept a
      // parse, since.
      mutationFn: async (_path: string) => {
        const started = performance.now()
        if (!(await service.prepareDiff(file, theme))) return 0
        return performance.now() - started
      },
      retry: false,
    }),
    file.path,
  )
}
