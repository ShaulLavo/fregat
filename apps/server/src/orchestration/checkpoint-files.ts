import type { OrchestrationCheckpointFile } from '@workspace/contracts'

import { parseDiff } from '../git/diff'
import type { GitFileDiff } from '../git/types'

/**
 * The checkpoint file summary a turn shows in "changed files". It is a stat
 * line, not the diff: the patch text stays in git and is fetched on demand by
 * the diff routes, so a session with hundreds of turns does not carry every
 * hunk it ever produced in the event log.
 */
export function checkpointFilesFromDiffs(
  diffs: readonly GitFileDiff[],
): OrchestrationCheckpointFile[] {
  const files: OrchestrationCheckpointFile[] = []

  for (const diff of diffs) {
    if (!diff.path) continue

    files.push({
      additions: diff.lineStats?.additions ?? countChangedLines(diff, 'added'),
      deletions: diff.lineStats?.deletions ?? countChangedLines(diff, 'deleted'),
      kind: checkpointFileKind(diff),
      path: diff.path,
    })
  }

  return files
}

/**
 * Providers stream their in-progress work as raw `git diff` text. Parsing it
 * with an empty repository root leaves repo-relative paths, which is the same
 * shape `GitService.diffRefs` produces for a workspace-rooted repository — so a
 * mid-turn placeholder and the real capture describe files the same way.
 */
export function checkpointFilesFromUnifiedDiff(unifiedDiff: string) {
  return checkpointFilesFromDiffs(parseDiff(unifiedDiff, '', false))
}

function checkpointFileKind(diff: GitFileDiff) {
  if (diff.oldFileMissing) return 'added'
  if (diff.newFileMissing) return 'deleted'
  if (diff.oldPath && diff.oldPath !== diff.path) return 'renamed'

  return 'modified'
}

function countChangedLines(diff: GitFileDiff, type: 'added' | 'deleted') {
  let count = 0

  for (const hunk of diff.hunks) {
    for (const change of hunk.changes) {
      if (change.type !== type) continue

      count += 1
    }
  }

  return count
}
