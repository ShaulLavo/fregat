import type { GitFileDiff } from '@workspace/contracts'
import type { BlobDiffRequest } from '@/features/git/utils/types'

export function checkpointBlobRequest(diffs: readonly GitFileDiff[]): BlobDiffRequest | null {
  const diff = diffs.find((entry) => entry.hunks.length > 0)
  if (!diff || diff.oldText !== undefined || diff.newText !== undefined) return null
  if (!diff.oldObjectId && !diff.newObjectId) return null

  return {
    path: diff.path,
    oldPath: diff.oldPath,
    oldObjectId: diff.oldObjectId,
    newObjectId: diff.newObjectId,
  }
}
