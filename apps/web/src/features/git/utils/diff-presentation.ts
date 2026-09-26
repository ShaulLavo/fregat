import { comparisonDisplayPath } from '@/lib/documents/utils/labels'
import { isBinaryGitDiff, type GitFileDiff } from '@workspace/contracts'
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
  if (diffs.some(isBinaryGitDiff)) return 'Binary file — no text diff to show.'

  const renamed = diffs.find(isRenamedDiff)
  if (renamed) {
    return `Renamed from ${toTreePath(renamed.oldPath ?? '', rootPath)}. No content changes.`
  }

  return emptyDiffNotice(info, rootPath)
}

function isRenamedDiff(diff: GitFileDiff) {
  return Boolean(diff.oldPath && diff.oldPath !== diff.path)
}

export type DiffFileNotice = { readonly kind: 'partial' | 'unchanged'; readonly message: string }

/**
 * A line of chrome above a file the pane *is* drawing. Null for an ordinary diff, where the hunks
 * say it themselves.
 *
 * A rename is shown with its notice because a reader cannot otherwise tell it from a file nobody
 * touched. A partial patch is drawn uncoloured, so the notice says why.
 */
export function diffFileNotice(file: DiffFile, rootPath: string): DiffFileNotice | null {
  if (file.isPartial) {
    return { kind: 'partial', message: 'Changed lines only. Syntax colors need the whole file.' }
  }
  if (file.hunks.length > 0) return null

  const oldPath = file.oldPath
  if (oldPath && oldPath !== file.newPath) {
    const message = `Renamed from ${toTreePath(oldPath, rootPath)} — no content changes`
    return { kind: 'unchanged', message }
  }

  return { kind: 'unchanged', message: 'No content changes' }
}
