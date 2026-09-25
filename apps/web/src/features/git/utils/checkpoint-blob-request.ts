import type { GitFileDiff } from '@workspace/contracts'
import type { BlobDiffRequest } from '@/features/git/utils/types'

/** The checkpoint entry the diff view draws: the first one with hunks. */
export function displayedCheckpointEntry(diffs: readonly GitFileDiff[]): GitFileDiff | null {
  return diffs.find((entry) => entry.hunks.length > 0) ?? null
}

/** Null unless every side that exists names its blob; a guessed side would be empty text. */
export function checkpointBlobRequest(diff: GitFileDiff | null): BlobDiffRequest | null {
  if (!diff || diff.oldText !== undefined || diff.newText !== undefined) return null
  if (!diff.oldFileMissing && !diff.oldObjectId) return null
  if (!diff.newFileMissing && !diff.newObjectId) return null

  return {
    path: diff.path,
    oldPath: diff.oldPath,
    oldObjectId: diff.oldObjectId,
    newObjectId: diff.newObjectId,
  }
}

/**
 * The checkpoint list with the displayed entry's complete sources from its blob pair, or nothing
 * while the pair loads. The entry keeps its own patch, ids and paths; a failed or textless answer
 * leaves it a partial patch.
 */
export function withCheckpointSources(
  diffs: readonly GitFileDiff[],
  displayed: GitFileDiff,
  blob: { readonly data?: readonly GitFileDiff[]; readonly isPending: boolean },
): readonly GitFileDiff[] | undefined {
  if (blob.isPending) return undefined

  const answer = blob.data?.[0]
  if (answer?.oldText === undefined || answer.newText === undefined) return diffs

  return diffs.map((entry) =>
    entry === displayed ? { ...entry, newText: answer.newText, oldText: answer.oldText } : entry,
  )
}
