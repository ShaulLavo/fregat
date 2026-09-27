import { prepareDiffSyntax } from '@singapore-editor/diff'
import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import type { GitFileDiff } from '@workspace/contracts'
import { editorDiffFiles, renderableDiffFile } from '@workspace/client-core/git/diff-files'
import {
  hasPreparedDiffSyntax,
  isDiffSyntaxViewed,
  storePreparedDiffSyntax,
  trackDiffSyntaxPreparation,
} from '@/features/editor/state/prepared-diff-syntax'
import {
  editorDiffSyntaxConfiguration,
  editorSyntaxHighlightingSource,
} from '@/features/editor/state/syntax-highlighting'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { languageIdForFilePath } from '@/lib/file-language'
import { hasPrefetchMutationRoom } from '@/lib/intent-prefetch/state/scheduler'
import { runMutation } from '@/lib/mutations/run'

/** The `text` hunk source is what a git snapshot diff view builds its file from. */
export function prepareDiffSyntaxForDiffs(
  queryClient: QueryClient,
  diffs: readonly GitFileDiff[],
): Promise<number> {
  const source = editorSyntaxHighlightingSource()
  if (source === 'disabled') return Promise.resolve(0)
  const file = renderableDiffFile(editorDiffFiles(diffs, languageIdForFilePath))
  if (!file || file.isPartial || hasPreparedDiffSyntax(file, source)) return Promise.resolve(0)
  if (isDiffSyntaxViewed(file, source)) return Promise.resolve(0)
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
      mutationFn: async () => {
        if (hasPreparedDiffSyntax(file, source)) return 0
        const started = performance.now()
        const { backend } = editorDiffSyntaxConfiguration(source)
        const work = prepareDiffSyntax(file, { backend }).then((sources) =>
          storePreparedDiffSyntax(file, source, sources),
        )
        trackDiffSyntaxPreparation(file, source, work)
        await work
        return performance.now() - started
      },
      retry: false,
    }),
    undefined,
  )
}
