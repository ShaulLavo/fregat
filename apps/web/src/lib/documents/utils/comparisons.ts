import type { GitFileDiff } from '@workspace/contracts'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { DocumentRef, GitComparison } from '@/lib/documents/utils/types'

export function snapshotDocument(
  diff: GitFileDiff,
): Extract<DocumentRef, { kind: 'git-diff' }> | null {
  if (!diff.oldObjectId && !diff.newObjectId) return null
  return {
    kind: 'git-diff',
    source: {
      kind: 'snapshot',
      path: filesystemPath(diff.path),
      oldPath: diff.oldPath === undefined ? undefined : filesystemPath(diff.oldPath),
      oldObjectId: diff.oldObjectId,
      newObjectId: diff.newObjectId,
      source: diff.staged ? 'staged' : 'worktree',
      status: snapshotStatus(diff),
    },
  }
}

export function comparisonRequest(source: GitComparison) {
  if (source.kind === 'snapshot') {
    return {
      kind: 'snapshot' as const,
      query: {
        path: source.path,
        oldPath: source.oldPath,
        oldObjectId: source.oldObjectId,
        newObjectId: source.newObjectId,
      },
    }
  }
  return { kind: 'checkpoint' as const, query: checkpointRequest(source) }
}

export function checkpointRequest(source: Exclude<GitComparison, { kind: 'snapshot' }>) {
  const query = {
    sessionId: source.sessionId,
    fromTurnCount: source.fromTurnCount,
    toTurnCount: source.toTurnCount,
    oldObjectId: source.oldObjectId,
    newObjectId: source.newObjectId,
    oldPath: source.oldPath,
    status: source.status,
  }
  switch (source.kind) {
    case 'checkpoint-file':
      return {
        ...query,
        scope: 'file' as const,
        path: source.file.path,
        filePath: source.file.path,
      }
    case 'checkpoint-session':
      return {
        ...query,
        scope: 'session' as const,
        path: `checkpoint-session-${source.toTurnCount}`,
      }
    case 'checkpoint-turn':
      return { ...query, scope: 'turn' as const, path: `checkpoint-turn-${source.toTurnCount}` }
    default: {
      const exhaustive: never = source
      return exhaustive
    }
  }
}

function snapshotStatus(diff: GitFileDiff) {
  if (diff.oldPath && diff.oldPath !== diff.path) return 'renamed'
  if (diff.oldFileMissing) return diff.staged ? 'added' : 'untracked'
  if (diff.newFileMissing) return 'deleted'
  return 'modified'
}
