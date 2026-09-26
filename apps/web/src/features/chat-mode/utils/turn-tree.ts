import type { GitFileDiff, OrchestrationCheckpointFile } from '@workspace/contracts'

import { matchingCheckpointDiff } from '@/lib/checkpoint-diff-query'
import { turnHunkRows, type TurnHunkRow } from '@/features/chat-mode/utils/checkpoint-hunks'

export type TurnTreeRow =
  | {
      readonly kind: 'file'
      readonly id: string
      readonly file: OrchestrationCheckpointFile
      /** The whitespace-exact diff for the file; null until it loads, or for whitespace only. */
      readonly diff: GitFileDiff | null
    }
  | ({ readonly kind: 'hunk'; readonly path: string } & TurnHunkRow)

/** The turn's files, each followed by its changes, numbered across the whole turn. */
export function turnTreeRows(
  files: readonly OrchestrationCheckpointFile[],
  diffs: readonly GitFileDiff[],
): { readonly count: number; readonly rows: readonly TurnTreeRow[] } {
  const hunks = turnHunkRows(diffs)
  const rows = files.flatMap((file): TurnTreeRow[] => {
    const diff = matchingCheckpointDiff(diffs, file.path)
    const fileRow: TurnTreeRow = { kind: 'file', id: `file:${file.path}`, file, diff }
    if (!diff) return [fileRow]
    const own = hunks.filter((row) => row.file === diff)
    return [fileRow, ...own.map((row) => ({ ...row, kind: 'hunk' as const, path: file.path }))]
  })
  return { count: hunks.length, rows }
}
