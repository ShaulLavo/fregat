import type { GitFileDiff } from '@workspace/contracts'
import { createTextDiff, parseGitPatch, type DiffFile } from '@singapor/diff'

type LanguageResolver = (path: string) => string | null

export function editorDiffFiles(
  diffs: readonly GitFileDiff[],
  language?: LanguageResolver,
): DiffFile[] {
  return diffs.flatMap((diff) => toEditorDiffFiles(diff, language))
}

export function renderableDiffFile(files: readonly DiffFile[]): DiffFile | null {
  return files.find((file) => file.hunks.length > 0) ?? files.find(hasWholeFileText) ?? null
}

function hasWholeFileText(file: DiffFile) {
  if (file.isPartial) return false

  return file.newLines.length > 0 || file.oldLines.length > 0
}

function toEditorDiffFiles(diff: GitFileDiff, language?: LanguageResolver): DiffFile[] {
  if (diff.oldText === undefined && diff.newText === undefined) {
    return [...parseGitPatch(diff.patch, { cacheKey: diffCacheKey(diff) })]
  }

  return [
    createTextDiff({
      newFile: newSide(diff, language),
      oldFile: oldSide(diff, language),
    }),
  ]
}

function oldSide(diff: GitFileDiff, language?: LanguageResolver) {
  if (diff.oldFileMissing) return null

  const path = diff.oldPath ?? diff.path
  return {
    languageId: language?.(path),
    objectId: diff.oldObjectId,
    path,
    text: diff.oldText ?? '',
  }
}

function newSide(diff: GitFileDiff, language?: LanguageResolver) {
  if (diff.newFileMissing) return null

  return {
    languageId: language?.(diff.path),
    objectId: diff.newObjectId,
    path: diff.path,
    text: diff.newText ?? '',
  }
}

function diffCacheKey(diff: GitFileDiff) {
  return `${diff.oldObjectId ?? ''}:${diff.newObjectId ?? ''}:${diff.path}`
}
