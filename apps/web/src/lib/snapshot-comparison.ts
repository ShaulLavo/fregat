import type { DiffFile } from '@singapore-editor/diff'
import type { DocumentKey, GitInputRevision } from '@/lib/documents/utils/types'
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
export type SnapshotComparisonInput = {
  readonly scope: SnapshotComparisonScope
  readonly subject: DocumentKey
  readonly comparison: SnapshotComparison
  readonly revision: GitInputRevision
  readonly files: readonly SnapshotComparisonFile[]
  readonly display: readonly DiffFile[]
}
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
