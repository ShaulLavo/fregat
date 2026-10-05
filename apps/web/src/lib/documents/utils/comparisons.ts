import * as v from 'valibot'
import type { GitCommitDetails, GitCommitFile, GitFileDiff } from '@workspace/contracts'
import { gitCommitOriginSchema, resolvedGitObjectIdSchema } from '@workspace/contracts'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type {
  DocumentRef,
  GitComparison,
  GitInputRevision,
  GitRevisionSide,
  GitSnapshotTarget,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'

export function snapshotDocument(
  diff: GitFileDiff,
  rootPath: WorkspaceRoot,
  changeSource: 'staged' | 'worktree',
): Extract<DocumentRef, { kind: 'git-diff' }> | null {
  if (!diff.oldObjectId && !diff.newObjectId) return null
  return {
    kind: 'git-diff',
    source: {
      kind: 'snapshot',
      target: { kind: 'moving', rootPath, path: filesystemPath(diff.path), changeSource },
    },
  }
}

export type HistoricalDiffOpen = {
  readonly rootPath: WorkspaceRoot
  readonly details: GitCommitDetails
  readonly file: GitCommitFile
}

export function historicalDocument({
  rootPath,
  details,
  file,
}: HistoricalDiffOpen): Extract<DocumentRef, { kind: 'git-diff' }> | null {
  const origin = v.safeParse(gitCommitOriginSchema, { id: details.id, parents: details.parents })
  if (!origin.success || file.kind !== 'file' || !details.files.includes(file)) return null
  return {
    kind: 'git-diff',
    source: {
      kind: 'snapshot',
      target: {
        kind: 'historical',
        rootPath,
        path: filesystemPath(file.path),
        origin: origin.output,
        revision: historicalRevision(file),
      },
    },
  }
}

export function capturedReviewDocument(
  diff: GitFileDiff,
  rootPath: WorkspaceRoot,
): Extract<DocumentRef, { kind: 'git-diff' }> | null {
  if (!diff.oldObjectId && !diff.newObjectId) return null
  return {
    kind: 'git-diff',
    source: {
      kind: 'snapshot',
      target: {
        kind: 'captured-review',
        rootPath,
        path: filesystemPath(diff.path),
        revision: gitInputRevisionForDiff(diff, 'historical'),
      },
    },
  }
}

export function gitInputRevisionForDiff(
  diff: GitFileDiff,
  source: 'worktree' | 'staged' | 'historical',
): GitInputRevision {
  return {
    old: revisionSide(diff.oldObjectId, diff.oldFileMissing === true),
    new: revisionSide(diff.newObjectId, diff.newFileMissing === true),
    oldPath: filesystemPath(diff.oldPath ?? diff.path),
    status:
      diff.oldFileMissing && source === 'historical'
        ? 'added'
        : snapshotStatus({ ...diff, staged: source === 'staged' }),
  }
}

function historicalRevision(file: GitCommitFile): GitInputRevision {
  return {
    old: revisionSide(file.oldObjectId, file.status === 'added'),
    new: revisionSide(file.newObjectId, file.status === 'deleted'),
    oldPath: filesystemPath(file.oldPath ?? file.path),
    status: file.status,
  }
}

function revisionSide(objectId: string | undefined, missing: boolean): GitRevisionSide {
  if (missing) return { kind: 'missing' }
  const parsed = v.safeParse(resolvedGitObjectIdSchema, objectId)
  return parsed.success ? { kind: 'blob', objectId: parsed.output } : { kind: 'unresolved' }
}

export function sameGitInputRevision(left: GitInputRevision, right: GitInputRevision): boolean {
  return (
    left.oldPath === right.oldPath &&
    left.status === right.status &&
    sameSide(left.old, right.old) &&
    sameSide(left.new, right.new)
  )
}

function sameSide(left: GitRevisionSide, right: GitRevisionSide): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== 'blob' || (right.kind === 'blob' && left.objectId === right.objectId))
  )
}

export function matchesHistoricalTarget(
  target: Extract<GitSnapshotTarget, { kind: 'historical' }>,
  details: GitCommitDetails,
): boolean {
  if (
    details.id !== target.origin.id ||
    details.parents.length !== target.origin.parents.length ||
    details.parents.some((parent, index) => parent !== target.origin.parents[index])
  )
    return false
  const file = details.files.find((entry) => entry.kind === 'file' && entry.path === target.path)
  return file !== undefined && sameGitInputRevision(target.revision, historicalRevision(file))
}

export function comparisonRequest(source: GitComparison) {
  if (source.kind === 'snapshot') return snapshotRequest(source)
  return { kind: 'checkpoint' as const, query: checkpointRequest(source) }
}

export function snapshotRequest(source: Extract<GitComparison, { kind: 'snapshot' }>) {
  const target = source.target
  if (target.kind === 'moving')
    return {
      kind: 'moving' as const,
      query: { path: target.path, staged: target.changeSource === 'staged' },
    }
  const revision = target.revision
  return {
    kind: 'snapshot' as const,
    query: {
      path: target.path,
      oldPath: revision.oldPath === target.path ? undefined : revision.oldPath,
      oldObjectId: revision.old.kind === 'blob' ? revision.old.objectId : undefined,
      newObjectId: revision.new.kind === 'blob' ? revision.new.objectId : undefined,
    },
  }
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

export function sameSnapshotTarget(left: GitSnapshotTarget, right: GitSnapshotTarget): boolean {
  if (left.kind !== right.kind || left.rootPath !== right.rootPath || left.path !== right.path)
    return false
  if (left.kind === 'moving' || right.kind === 'moving')
    return (
      left.kind === 'moving' && right.kind === 'moving' && left.changeSource === right.changeSource
    )
  if (!sameGitInputRevision(left.revision, right.revision)) return false
  if (left.kind === 'historical' && right.kind === 'historical')
    return (
      left.origin.id === right.origin.id &&
      left.origin.parents.length === right.origin.parents.length &&
      left.origin.parents.every((parent, index) => parent === right.origin.parents[index])
    )
  return true
}
