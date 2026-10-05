import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { createClientInvariantError } from '@/lib/structured-errors'
import {
  gitSnapshotTargetSchema,
  type GitFileDiff,
  type GitSnapshotTarget,
} from '@workspace/contracts'
import type * as v from 'valibot'
import { decodeTabContent } from '@/lib/documents/utils/storage-codec'

export function gitFileDiff(overrides: Partial<GitFileDiff> = {}): GitFileDiff {
  return {
    hunks: [],
    patch: '',
    path: 'repo/a.ts',
    staged: false,
    ...overrides,
  }
}

export function snapshotComparison(diff: GitFileDiff) {
  const document = snapshotDocument(
    diff,
    filesystemPath('repo'),
    diff.staged ? 'staged' : 'worktree',
  )
  if (!document) throw createClientInvariantError('A snapshot test fixture requires an object ID')
  return document.source
}

export function snapshotTarget(
  target: v.InferInput<typeof gitSnapshotTargetSchema> | GitSnapshotTarget,
) {
  const content = decodeTabContent(
    { kind: 'document', document: { kind: 'git-diff', source: { kind: 'snapshot', target } } },
    filesystemPath(target.rootPath),
  )
  if (
    content?.kind !== 'document' ||
    content.document.kind !== 'git-diff' ||
    content.document.source.kind !== 'snapshot'
  )
    throw createClientInvariantError('Snapshot target fixture must decode to a comparison')
  return content.document.source
}
