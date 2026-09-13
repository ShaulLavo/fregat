import { comparisonDisplayPath } from '@/lib/documents/utils/labels'
import type { GitFileDiff } from '@workspace/contracts'
import type { DiffFile } from '@singapore-editor/diff'

import { toTreePath } from '@/lib/path-formatters'

import type { GitComparison } from '@/lib/documents/utils/types'

/**
 * Shown when the diff request came back with no file entries at all. Headings,
 * line counts and the rendering itself belong to the editor's diff view now;
 * what stays here is deciding when there is nothing for it to render, because a
 * diff pane must never be a blank rectangle the reader has to interpret.
 */
export function emptyDiffNotice(info: GitComparison, rootPath: string): string {
  const oldPath = info.oldPath
  if (oldPath && oldPath !== comparisonDisplayPath(info)) {
    return `Renamed from ${toTreePath(oldPath, rootPath)}. No content changes.`
  }
  if (info.status === 'renamed') return 'Renamed. No content changes.'

  return 'No changes to show.'
}

/**
 * Why a diff that *has* file entries still has no hunks to show. Binary files
 * and pure renames both come back this way.
 */
export function unrenderableDiffNotice(
  diffs: readonly GitFileDiff[],
  info: GitComparison,
  rootPath: string,
): string {
  if (diffs.some(isBinaryDiff)) return 'Binary file — no text diff to show.'

  const renamed = diffs.find(isRenamedDiff)
  if (renamed) {
    return `Renamed from ${toTreePath(renamed.oldPath ?? '', rootPath)}. No content changes.`
  }

  return emptyDiffNotice(info, rootPath)
}

function isBinaryDiff(diff: GitFileDiff) {
  return diff.patch.includes('Binary files ') || diff.patch.includes('GIT binary patch')
}

function isRenamedDiff(diff: GitFileDiff) {
  return Boolean(diff.oldPath && diff.oldPath !== diff.path)
}

/**
 * Why a file the pane *is* drawing has no changes in it. Null for an ordinary diff, where the
 * hunks say it themselves.
 *
 * The file is shown either way — this is a line of chrome above it, not a replacement for it —
 * because a reader who opened a rename cannot otherwise tell a rename from a file nobody touched.
 */
export function unchangedFileNotice(file: DiffFile, rootPath: string): string | null {
  if (file.hunks.length > 0) return null

  const oldPath = file.oldPath
  if (oldPath && oldPath !== file.newPath) {
    return `Renamed from ${toTreePath(oldPath, rootPath)} — no content changes`
  }

  return 'No content changes'
}
