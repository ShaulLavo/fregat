import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { GitFileDiff } from '@workspace/contracts'

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
  const document = snapshotDocument(diff)
  if (!document) throw createClientInvariantError('A snapshot test fixture requires an object ID')
  return document.source
}
