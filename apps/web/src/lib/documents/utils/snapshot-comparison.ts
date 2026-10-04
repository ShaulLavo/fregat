import type { EnvironmentId } from '@workspace/contracts'
import type { FilesystemPath, GitComparison } from '@/lib/documents/utils/types'

declare const resolvedGitObjectBrand: unique symbol
export type ResolvedGitObjectId = string & { readonly [resolvedGitObjectBrand]: true }
export type SnapshotComparison = Extract<GitComparison, { kind: 'snapshot' }>
export type SnapshotComparisonScope = {
  readonly environmentId: EnvironmentId
  readonly rootPath: FilesystemPath
}
export type ImmutableGitSide =
  | {
      readonly kind: 'blob'
      readonly path: FilesystemPath
      readonly objectId: ResolvedGitObjectId
      readonly text: string
    }
  | { readonly kind: 'missing'; readonly path: FilesystemPath }
