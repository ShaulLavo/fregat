import type { QueryClient } from '@tanstack/react-query'
import type { GitFileDiff } from '@workspace/contracts'

/** Parses the sides a diff view of `diffs` will draw; resolves with the milliseconds it spent. */
export type DiffSyntaxPreparer = (
  queryClient: QueryClient,
  diffs: readonly GitFileDiff[],
) => Promise<number>

// The editor runtime owns the syntax configuration and the prepared-syntax store; it binds this on
// resume, the way it binds the language census.
let preparer: DiffSyntaxPreparer | null = null

export function bindDiffSyntaxPreparer(next: DiffSyntaxPreparer): () => void {
  preparer = next
  return () => {
    if (preparer === next) preparer = null
  }
}

/** Diff reads that answer with file diffs get their syntax prepared; commit details do not. */
export function prepareIntentDiffSyntax(queryClient: QueryClient, data: unknown): Promise<number> {
  if (!preparer || !isFileDiffList(data)) return Promise.resolve(0)
  return preparer(queryClient, data)
}

function isFileDiffList(data: unknown): data is readonly GitFileDiff[] {
  if (!Array.isArray(data)) return false
  return data.every(
    (diff: unknown) =>
      typeof diff === 'object' && diff !== null && 'patch' in diff && 'hunks' in diff,
  )
}
