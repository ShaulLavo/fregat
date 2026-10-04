import { isBinaryGitDiff, type GitFileDiff } from '@workspace/contracts'
import { editorDiffFiles } from '@workspace/client-core/git/diff-files'
import { documentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { languageIdForFilePath } from '@/lib/file-language'
import type {
  ImmutableGitSide,
  ResolvedGitObjectId,
  SnapshotComparison,
  SnapshotComparisonScope,
} from '@/lib/documents/utils/snapshot-comparison'
import type { SnapshotComparisonFile, SnapshotComparisonInput } from '@/lib/snapshot-comparison'

export function snapshotComparisonInput({
  scope,
  comparison,
  diffs,
}: {
  readonly scope: SnapshotComparisonScope
  readonly comparison: SnapshotComparison
  readonly diffs: readonly GitFileDiff[]
}): SnapshotComparisonInput {
  const files = diffs.map((diff) => snapshotFile(diff, comparison))
  return {
    scope,
    subject: documentKey({ kind: 'git-diff', source: comparison }),
    comparison,
    files,
    display: files.flatMap((file) => (file.kind === 'no-text' ? [] : file.display)),
  }
}

function snapshotFile(diff: GitFileDiff, comparison: SnapshotComparison): SnapshotComparisonFile {
  if (diff.omitted) return { kind: 'no-text', reason: 'size' }
  if (isBinaryGitDiff(diff)) return { kind: 'no-text', reason: 'binary' }
  if (
    diff.path !== comparison.path ||
    (diff.oldPath ?? diff.path) !== (comparison.oldPath ?? comparison.path)
  )
    return { kind: 'no-text', reason: 'unavailable' }
  const old = gitSide(
    diff.oldPath ?? diff.path,
    diff.oldObjectId,
    diff.oldText,
    diff.oldFileMissing,
    comparison.oldObjectId,
  )
  const next = gitSide(
    diff.path,
    diff.newObjectId,
    diff.newText,
    diff.newFileMissing,
    comparison.newObjectId,
  )
  if (old && next)
    return {
      kind: 'full',
      old,
      new: next,
      display: editorDiffFiles([diff], languageIdForFilePath, 'text'),
    }
  const patch = { ...diff, oldText: undefined, newText: undefined }
  return { kind: 'partial', display: editorDiffFiles([patch], languageIdForFilePath, 'text') }
}

function gitSide(
  path: string,
  objectId: string | undefined,
  text: string | undefined,
  missing: boolean | undefined,
  expected: string | undefined,
): ImmutableGitSide | null {
  if (missing) return expected ? null : { kind: 'missing', path: filesystemPath(path) }
  if (text === undefined || !isResolvedGitObjectId(objectId) || objectId !== expected) return null
  return { kind: 'blob', path: filesystemPath(path), objectId, text }
}

function isResolvedGitObjectId(value: string | undefined): value is ResolvedGitObjectId {
  return value !== undefined && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) && !/^0+$/.test(value)
}
