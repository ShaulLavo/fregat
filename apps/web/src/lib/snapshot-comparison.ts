import { sameGitInputRevision } from '@/lib/documents/utils/comparisons'
import type { DiffFile } from '@singapore-editor/diff'
import type {
  DocumentKey,
  FilesystemPath,
  GitComparison,
  GitInputRevision,
} from '@/lib/documents/utils/types'
import type { GitDiffHunk } from '@workspace/contracts'
import type {
  ImmutableGitSide,
  SnapshotComparison,
  SnapshotComparisonScope,
} from '@/lib/documents/utils/snapshot-comparison'

export type SnapshotComparisonFile =
  | {
      readonly kind: 'full'
      readonly old: ImmutableGitSide
      readonly new: ImmutableGitSide
      readonly display: readonly DiffFile[]
    }
  | { readonly kind: 'partial'; readonly display: readonly DiffFile[] }
  | { readonly kind: 'no-text'; readonly reason: 'binary' | 'size' | 'unavailable' }
export type SnapshotGitComparisonInput = {
  readonly kind: 'snapshot'
  readonly scope: SnapshotComparisonScope
  readonly subject: DocumentKey
  readonly comparison: SnapshotComparison
  readonly revision: GitInputRevision
  readonly files: readonly SnapshotComparisonFile[]
  readonly display: readonly DiffFile[]
}
export type CheckpointComparison = Exclude<GitComparison, { kind: 'snapshot' }>
export type CheckpointComparisonFile = SnapshotComparisonFile & {
  readonly path: FilesystemPath
  readonly revision: GitInputRevision
  readonly patch: string
  readonly hunks: readonly GitDiffHunk[]
}
export type CheckpointComparisonInput = {
  readonly kind: 'checkpoint'
  readonly scope: SnapshotComparisonScope
  readonly subject: DocumentKey
  readonly comparison: CheckpointComparison
  readonly files: readonly CheckpointComparisonFile[]
  readonly display: readonly DiffFile[]
}
export type SnapshotComparisonInput = SnapshotGitComparisonInput | CheckpointComparisonInput
export type SnapshotComparisonRead =
  | { readonly kind: 'ready'; readonly input: SnapshotComparisonInput }
  | { readonly kind: 'released'; readonly reason: 'interest-ended' | 'owner-disposed' }
export type SnapshotComparisonRefresh = { readonly lease: SnapshotComparisonLease }
export type SnapshotComparisonLease = {
  read(): SnapshotComparisonRead
  requestRefresh(): SnapshotComparisonRefresh
  refresh(input: SnapshotComparisonInput, request: SnapshotComparisonRefresh): boolean
  release(): void
}
export type SnapshotComparisonRequest = {
  readonly input: SnapshotComparisonInput
  readonly signal: AbortSignal
}

export function sameCheckpointCapture(
  left: CheckpointComparisonInput,
  right: CheckpointComparisonInput,
): boolean {
  return (
    left.subject === right.subject &&
    left.files.length === right.files.length &&
    left.files.every((file, index) => {
      const other = right.files[index]
      return (
        other !== undefined &&
        file.path === other.path &&
        sameGitInputRevision(file.revision, other.revision) &&
        file.patch === other.patch &&
        file.hunks.length === other.hunks.length &&
        file.hunks.every((hunk, hunkIndex) => hunk.id === other.hunks[hunkIndex]?.id)
      )
    })
  )
}

export function promoteCheckpointCapture(
  current: CheckpointComparisonInput,
  candidate: CheckpointComparisonInput,
): CheckpointComparisonInput | null {
  const files = current.files.map((file, index) => {
    const next = candidate.files[index]
    return file.kind === 'partial' && next?.kind === 'full' ? next : file
  })
  if (files.every((file, index) => file === current.files[index])) return null
  return {
    ...current,
    files,
    display: files.flatMap((file) => (file.kind === 'no-text' ? [] : file.display)),
  }
}
