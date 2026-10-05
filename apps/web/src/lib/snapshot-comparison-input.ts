import { isBinaryGitDiff, type GitFileDiff } from '@workspace/contracts'
import { editorDiffFiles } from '@workspace/client-core/git/diff-files'
import { documentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { gitInputRevisionForDiff, sameGitInputRevision } from '@/lib/documents/utils/comparisons'
import type { GitInputRevision, GitRevisionSide } from '@/lib/documents/utils/types'
import { resolvedGitObjectIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { languageIdForFilePath } from '@/lib/file-language'
import type {
  ImmutableGitSide,
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
  const target = comparison.target
  const captured = diffs.find((diff) => diff.path === target.path)
  const revision = capturedRevision(comparison, captured)
  const files = diffs.map((diff) => snapshotFile(diff, comparison, revision))
  return {
    scope,
    subject: documentKey({ kind: 'git-diff', source: comparison }),
    comparison,
    revision,
    files,
    display: files.flatMap((file) => (file.kind === 'no-text' ? [] : file.display)),
  }
}

function capturedRevision(
  comparison: SnapshotComparison,
  captured: GitFileDiff | undefined,
): GitInputRevision {
  const target = comparison.target
  if (target.kind !== 'moving') return target.revision
  if (captured) return gitInputRevisionForDiff(captured, target.changeSource)
  return {
    old: { kind: 'unresolved' },
    new: { kind: 'unresolved' },
    oldPath: target.path,
    status: 'modified',
  }
}

function snapshotFile(
  diff: GitFileDiff,
  comparison: SnapshotComparison,
  revision: GitInputRevision,
): SnapshotComparisonFile {
  if (diff.omitted) return { kind: 'no-text', reason: 'size' }
  if (isBinaryGitDiff(diff)) return { kind: 'no-text', reason: 'binary' }
  if (diff.path !== comparison.target.path || (diff.oldPath ?? diff.path) !== revision.oldPath)
    return { kind: 'no-text', reason: 'unavailable' }
  if (
    comparison.target.kind !== 'moving' &&
    !sameGitInputRevision(
      { ...gitInputRevisionForDiff(diff, 'historical'), status: revision.status },
      revision,
    )
  )
    return { kind: 'no-text', reason: 'unavailable' }
  const old = gitSide(
    diff.oldPath ?? diff.path,
    diff.oldObjectId,
    diff.oldText,
    diff.oldFileMissing,
    revision.old,
  )
  const next = gitSide(diff.path, diff.newObjectId, diff.newText, diff.newFileMissing, revision.new)
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
  expected: GitRevisionSide,
): ImmutableGitSide | null {
  if (missing)
    return expected.kind === 'missing' ? { kind: 'missing', path: filesystemPath(path) } : null
  const parsed = v.safeParse(resolvedGitObjectIdSchema, objectId)
  if (
    text === undefined ||
    !parsed.success ||
    expected.kind !== 'blob' ||
    parsed.output !== expected.objectId
  )
    return null
  return { kind: 'blob', path: filesystemPath(path), objectId: parsed.output, text }
}
