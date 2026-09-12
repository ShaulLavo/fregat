import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { GitDiffHunk, GitFileDiff, GitLineChange } from '@workspace/contracts'

/**
 * Builds a hunk from unified-diff style lines (`' '` context, `'+'` added,
 * `'-'` removed) so tests read like the patch they describe. Line numbers and
 * the `@@` header are derived, never hand-written out of sync.
 */
export function gitDiffHunk({
  context = '',
  lines,
  newStart = 1,
  oldStart = 1,
}: {
  context?: string
  lines: readonly string[]
  newStart?: number
  oldStart?: number
}): GitDiffHunk {
  const changes: GitLineChange[] = []
  let oldLine = oldStart
  let newLine = newStart

  for (const raw of lines) {
    const type = changeType(raw[0])
    changes.push({
      type,
      newLine: type === 'deleted' ? null : newLine,
      oldLine: type === 'added' ? null : oldLine,
      text: raw.slice(1),
    })
    if (type !== 'added') oldLine += 1
    if (type !== 'deleted') newLine += 1
  }

  const oldLines = oldLine - oldStart
  const newLines = newLine - newStart

  return {
    changes,
    header: `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@ ${context}`.trimEnd(),
    newLines,
    newStart,
    oldLines,
    oldStart,
    patch: '',
  }
}

export function gitFileDiff(overrides: Partial<GitFileDiff> = {}): GitFileDiff {
  return {
    hunks: [],
    patch: '',
    path: 'repo/a.ts',
    staged: false,
    ...overrides,
  }
}

function changeType(marker: string | undefined): GitLineChange['type'] {
  if (marker === '+') return 'added'
  if (marker === '-') return 'deleted'

  return 'context'
}

export function snapshotComparison(diff: GitFileDiff) {
  const document = snapshotDocument(diff)
  if (!document) throw createClientInvariantError('A snapshot test fixture requires an object ID')
  return document.source
}
