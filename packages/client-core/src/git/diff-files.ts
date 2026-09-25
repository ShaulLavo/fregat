import type { GitFileDiff } from '@workspace/contracts'
import { createTextDiff, parseGitPatch, type DiffFile } from '@singapore-editor/diff'

type LanguageResolver = (path: string) => string | null

/**
 * `text` recomputes hunks from the complete sources. `patch` keeps the server's hunks over them,
 * because a checkpoint patch carries its own whitespace policy.
 */
export type DiffHunkSource = 'patch' | 'text'

export function editorDiffFiles(
  diffs: readonly GitFileDiff[],
  language?: LanguageResolver,
  hunks: DiffHunkSource = 'text',
): DiffFile[] {
  return diffs.flatMap((diff) => toEditorDiffFiles(diff, hunks, language))
}

export function renderableDiffFile(files: readonly DiffFile[]): DiffFile | null {
  return files.find((file) => file.hunks.length > 0) ?? files.find(hasWholeFileText) ?? null
}

function hasWholeFileText(file: DiffFile) {
  if (file.isPartial) return false

  return file.newLines.length > 0 || file.oldLines.length > 0
}

function toEditorDiffFiles(
  diff: GitFileDiff,
  hunks: DiffHunkSource,
  language?: LanguageResolver,
): DiffFile[] {
  // Without both sources a patch is only the lines git printed, and stays marked partial.
  if (!hasCompleteSources(diff)) {
    return [...parseGitPatch(diff.patch, { cacheKey: diffCacheKey(diff) })]
  }
  if (hunks === 'patch' && diff.hunks.length > 0) return patchOverSources(diff, language)

  return [
    createTextDiff({
      newFile: newSide(diff, language),
      oldFile: oldSide(diff, language),
    }),
  ]
}

/** Every side that exists carries its text; a missing side is the only empty one. */
function hasCompleteSources(diff: GitFileDiff) {
  if (!diff.oldFileMissing && diff.oldText === undefined) return false

  return Boolean(diff.newFileMissing) || diff.newText !== undefined
}

function patchOverSources(diff: GitFileDiff, language?: LanguageResolver): DiffFile[] {
  return parseGitPatch(diff.patch, { cacheKey: diffCacheKey(diff) }).map((file) => ({
    ...file,
    isPartial: false,
    languageId: language?.(file.path) ?? file.languageId,
    newLines: sourceLines(diff.newFileMissing ? '' : diff.newText),
    oldLines: sourceLines(diff.oldFileMissing ? '' : diff.oldText),
  }))
}

/** The split `createTextDiff` uses, so both hunk sources index the same line arrays. */
function sourceLines(text: string | undefined): readonly string[] {
  if (!text) return []

  return text.split('\n')
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
