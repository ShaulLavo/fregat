import { languageIdForFilePath } from '@/features/editor/utils/file-path'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { HistoryComparisonSide } from '@singapore-editor/core'
import { createTextDiff, type DiffFile } from '@singapore-editor/diff'
import { materializePieceTableFullText } from '@singapore-editor/textbuffer'

// Past this a full-text diff stops being a quick preview; the pane says so instead.
const MAX_HISTORY_COMPARE_LENGTH = 2 * 1024 * 1024

export type HistoryComparisonResult = DiffFile | 'too-large'

// Both snapshots are materialized only for the diff and dropped with it: holding a
// snapshot keeps every piece it references alive, including text deleted since.
export function compareHistoryStates(
  oldSide: HistoryComparisonSide,
  newSide: HistoryComparisonSide,
  path: FilesystemPath,
): HistoryComparisonResult {
  if (
    oldSide.snapshot.length > MAX_HISTORY_COMPARE_LENGTH ||
    newSide.snapshot.length > MAX_HISTORY_COMPARE_LENGTH
  ) {
    return 'too-large'
  }
  const languageId = languageIdForFilePath(path)
  return createTextDiff({
    newFile: { languageId, path, text: materializePieceTableFullText(newSide.snapshot) },
    oldFile: { languageId, path, text: materializePieceTableFullText(oldSide.snapshot) },
  })
}
